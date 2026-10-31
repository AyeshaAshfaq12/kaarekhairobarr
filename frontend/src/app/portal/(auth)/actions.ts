'use server'

import { redirect } from 'next/navigation'
import { prisma } from '@/lib/portal/db'
import {
  createSession,
  destroyCurrentSession,
  findValidToken,
  getRequestMeta,
  hashPassword,
  isLoginRateLimited,
  issueToken,
  revokeAllSessions,
  verifyPassword,
} from '@/lib/portal/auth'
import { encryptString } from '@/lib/portal/crypto'
import { writeAudit } from '@/lib/portal/audit'
import { portalUrl, sendEmail } from '@/lib/portal/email'
import { getSettings } from '@/lib/portal/settings'
import { storeUpload } from '@/lib/portal/storage'
import { ageOn } from '@/lib/portal/time'
import { runAction, UserError } from '@/lib/portal/action-utils'
import {
  formDataToObject,
  loginSchema,
  passwordSchema,
  signupSchema,
  type ActionState,
} from '@/lib/portal/validation'

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000
const RESET_TTL_MS = 60 * 60 * 1000

async function sendVerificationEmail(userId: string, email: string) {
  const token = await issueToken({ purpose: 'EMAIL_VERIFY', email, userId, ttlMs: VERIFY_TTL_MS })
  await sendEmail({
    to: email,
    subject: 'Confirm your email for the KKB member portal',
    text: `Assalam o Alaikum,\n\nConfirm your email to continue your KKB application:\n${portalUrl(`/portal/verify?token=${token}`)}\n\nThis link expires in 24 hours.`,
  })
}

export async function signupAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const input = signupSchema.parse(formDataToObject(formData))
    const settings = await getSettings()
    if (ageOn(input.dateOfBirth) < settings.minimumAge) {
      return { ok: false, fieldErrors: { dateOfBirth: [`Members must be at least ${settings.minimumAge} years old`] } }
    }

    if (await prisma.user.findUnique({ where: { email: input.email } })) {
      return { ok: false, fieldErrors: { email: ['An account with this email already exists. Try signing in.'] } }
    }

    const invite = input.inviteToken ? await findValidToken(input.inviteToken, 'INVITE') : null
    const referrer = input.referrerEmail
      ? await prisma.member.findFirst({ where: { user: { email: input.referrerEmail } }, select: { id: true } })
      : null
    if (input.referrerEmail && !referrer) {
      return { ok: false, fieldErrors: { referrerEmail: ['No member has that email. Leave it blank if unsure.'] } }
    }

    // An invite link was delivered to this inbox, so it already proves ownership of the email.
    const preVerified = !!invite && invite.email === input.email
    const { ip } = getRequestMeta()
    const passwordHash = await hashPassword(input.password)

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          emailVerifiedAt: preVerified ? new Date() : null,
          member: {
            create: {
              fullName: input.fullName,
              fatherName: input.fatherName,
              gender: input.gender,
              dateOfBirth: input.dateOfBirth,
              phone: input.phone,
              whatsapp: input.whatsapp,
              city: input.city,
              address: input.address,
              cnicEncrypted: encryptString(input.cnic),
              cnicLast4: input.cnic.replace(/\D/g, '').slice(-4),
              institutionOrJob: input.institutionOrJob,
              skills: input.skills,
              availabilityHoursPerWeek: input.availabilityHoursPerWeek,
              emergencyName: input.emergencyName,
              emergencyPhone: input.emergencyPhone,
              howHeard: input.howHeard,
              referredById: referrer?.id,
              status: 'PENDING_NDA',
            },
          },
        },
        include: { member: true },
      })
      if (invite) {
        await tx.authToken.update({ where: { id: invite.id }, data: { usedAt: new Date() } })
      }
      await writeAudit(tx, {
        actorId: created.id,
        action: 'signup',
        entity: 'Member',
        entityId: created.member!.id,
        after: { ...created.member!, email: created.email, invited: !!invite },
        ip,
      })
      return created
    })

    const photo = formData.get('photo')
    if (photo instanceof File && photo.size > 0) {
      try {
        const key = await storeUpload(photo, { uploadedById: user.id, purpose: 'member-photo', allow: ['image/jpeg', 'image/png'] })
        await prisma.member.update({ where: { userId: user.id }, data: { photoKey: key } })
      } catch (error) {
        // The account exists; a bad photo shouldn't block it. They can upload again from their profile.
        console.warn('[signup] photo rejected', error)
      }
    }

    if (preVerified) {
      await createSession(user.id)
      redirect('/portal/onboarding/nda')
    }

    await sendVerificationEmail(user.id, user.email)
    redirect(`/portal/verify?sent=${encodeURIComponent(user.email)}`)
  })
}

export async function verifyEmailAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const token = String(formData.get('token') ?? '')
    const record = await findValidToken(token, 'EMAIL_VERIFY')
    if (!record?.userId) throw new UserError('This link is invalid or has expired. Request a new one below.')
    const userId = record.userId
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      await tx.authToken.update({ where: { id: record.id }, data: { usedAt: new Date() } })
      await tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } })
      await writeAudit(tx, { actorId: userId, action: 'verify_email', entity: 'User', entityId: userId, ip })
    })
    await createSession(userId)
    redirect('/portal/onboarding/nda')
  })
}

export async function resendVerificationAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const email = String(formData.get('email') ?? '').trim().toLowerCase()
    const user = email ? await prisma.user.findUnique({ where: { email } }) : null
    if (user && !user.emailVerifiedAt) await sendVerificationEmail(user.id, user.email)
    return { ok: true, message: 'If that account is waiting for verification, a new link is on its way.' }
  })
}

export async function loginAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const input = loginSchema.parse(formDataToObject(formData))
    const { ip } = getRequestMeta()

    if (await isLoginRateLimited(input.email, ip)) {
      throw new UserError('Too many failed attempts. Wait 15 minutes and try again.')
    }

    const user = await prisma.user.findUnique({ where: { email: input.email }, include: { member: true } })
    const valid = !!user && (await verifyPassword(input.password, user.passwordHash))

    await prisma.$transaction(async (tx) => {
      await tx.loginAttempt.create({ data: { email: input.email, ip, success: valid } })
      await writeAudit(tx, {
        actorId: valid ? user!.id : null,
        action: valid ? 'login' : 'login_failed',
        entity: 'User',
        entityId: user?.id ?? input.email,
        ip,
      })
    })

    if (!valid || !user) throw new UserError('Email or password is incorrect.')
    if (user.disabledAt || user.member?.status === 'LEFT') throw new UserError('This account has been disabled.')
    if (user.member?.status === 'REJECTED') {
      throw new UserError('Your application was not approved. Contact a KKB admin if you think this is a mistake.')
    }
    if (!user.emailVerifiedAt) {
      throw new UserError('Please confirm your email first. Check your inbox, or request a new link on the verify page.')
    }

    await createSession(user.id)
    const next = input.next && input.next.startsWith('/portal/') && !input.next.startsWith('//') ? input.next : '/portal/dashboard'
    redirect(next)
  })
}

export async function logoutAction() {
  await destroyCurrentSession()
  redirect('/portal/login')
}

export async function requestResetAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const email = String(formData.get('email') ?? '').trim().toLowerCase()
    const user = email ? await prisma.user.findUnique({ where: { email } }) : null
    if (user && !user.disabledAt) {
      const token = await issueToken({ purpose: 'PASSWORD_RESET', email, userId: user.id, ttlMs: RESET_TTL_MS })
      await sendEmail({
        to: email,
        subject: 'Reset your KKB portal password',
        text: `Someone asked to reset the password for this account. If it was you, open this link within 1 hour:\n${portalUrl(`/portal/reset?token=${token}`)}\n\nIf it wasn't you, ignore this email.`,
      })
    }
    return { ok: true, message: 'If an account exists for that email, a reset link is on its way.' }
  })
}

export async function resetPasswordAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const token = String(formData.get('token') ?? '')
    const password = passwordSchema.safeParse(formData.get('password'))
    if (!password.success) return { ok: false, fieldErrors: { password: password.error.issues.map((issue) => issue.message) } }
    if (formData.get('password') !== formData.get('confirmPassword')) {
      return { ok: false, fieldErrors: { confirmPassword: ['Passwords do not match'] } }
    }

    const record = await findValidToken(token, 'PASSWORD_RESET')
    if (!record?.userId) throw new UserError('This reset link is invalid, used or expired. Request a new one.')
    const userId = record.userId
    const passwordHash = await hashPassword(password.data)
    const { ip } = getRequestMeta()

    await prisma.$transaction(async (tx) => {
      await tx.authToken.update({ where: { id: record.id }, data: { usedAt: new Date() } })
      await tx.user.update({ where: { id: userId }, data: { passwordHash } })
      await writeAudit(tx, { actorId: userId, action: 'password_reset', entity: 'User', entityId: userId, ip })
    })
    await revokeAllSessions(userId)
    redirect('/portal/login?reset=1')
  })
}
