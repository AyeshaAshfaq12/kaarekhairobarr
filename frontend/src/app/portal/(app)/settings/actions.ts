'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/portal/db'
import { SESSION_COOKIE, getRequestMeta, hashPassword, verifyPassword } from '@/lib/portal/auth'
import { cookies } from 'next/headers'
import { sha256 } from '@/lib/portal/crypto'
import { writeAudit } from '@/lib/portal/audit'
import { NOTIFICATION_TYPES, notifyMany } from '@/lib/portal/notify'
import { ForbiddenError, can, requireActiveViewer } from '@/lib/portal/rbac'
import { DEFAULT_SETTINGS } from '@/lib/portal/settings'
import { storeUpload } from '@/lib/portal/storage'
import { runAction, UserError } from '@/lib/portal/action-utils'
import { formDataToObject, passwordSchema, profileSchema, type ActionState } from '@/lib/portal/validation'

// ---------- Own account ----------

export async function updateProfileAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const input = profileSchema.parse(formDataToObject(formData))
    const before = await prisma.member.findUniqueOrThrow({ where: { id: viewer.memberId } })

    let photoKey: string | undefined
    const photo = formData.get('photo')
    if (photo instanceof File && photo.size > 0) {
      photoKey = await storeUpload(photo, { uploadedById: viewer.userId, purpose: 'member-photo', allow: ['image/jpeg', 'image/png'] })
    }

    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      const after = await tx.member.update({ where: { id: viewer.memberId }, data: { ...input, ...(photoKey ? { photoKey } : {}) } })
      await writeAudit(tx, { actorId: viewer.userId, action: 'update_profile', entity: 'Member', entityId: viewer.memberId, before, after, ip })
    })
    revalidatePath('/portal', 'layout')
    return { ok: true, message: 'Profile saved.' }
  })
}

export async function changePasswordAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const user = await prisma.user.findUniqueOrThrow({ where: { id: viewer.userId } })
    if (!(await verifyPassword(String(formData.get('currentPassword') ?? ''), user.passwordHash))) {
      return { ok: false, fieldErrors: { currentPassword: ['Current password is incorrect'] } }
    }
    const next = passwordSchema.safeParse(formData.get('newPassword'))
    if (!next.success) return { ok: false, fieldErrors: { newPassword: next.error.issues.map((issue) => issue.message) } }
    const passwordHash = await hashPassword(next.data)
    const currentToken = cookies().get(SESSION_COOKIE)?.value
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } })
      // Sign out every other device.
      await tx.session.deleteMany({ where: { userId: user.id, ...(currentToken ? { tokenHash: { not: sha256(currentToken) } } : {}) } })
      await writeAudit(tx, { actorId: user.id, action: 'password_change', entity: 'User', entityId: user.id, ip })
    })
    return { ok: true, message: 'Password changed. Other devices were signed out.' }
  })
}

export async function updateEmailPrefsAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const enabled = new Set(formData.getAll('email').map(String))
    const emailOptOuts = Object.keys(NOTIFICATION_TYPES).filter((type) => !enabled.has(type))
    const before = await prisma.user.findUniqueOrThrow({ where: { id: viewer.userId }, select: { emailOptOuts: true } })
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: viewer.userId }, data: { emailOptOuts } })
      await writeAudit(tx, { actorId: viewer.userId, action: 'update_email_prefs', entity: 'User', entityId: viewer.userId, before, after: { emailOptOuts }, ip })
    })
    return { ok: true, message: 'Email preferences saved.' }
  })
}

// ---------- Organisation (settings.edit) ----------

async function requireSettingsEditor() {
  const viewer = await requireActiveViewer()
  if (!can(viewer, 'settings', 'edit')) throw new ForbiddenError()
  return viewer
}

export async function updateOrgSettingsAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireSettingsEditor()
    const input = z
      .object({
        minimumAge: z.coerce.number().int().min(10).max(80),
        handbookUrl: z.union([z.literal(''), z.string().trim().url('Enter a full URL starting with https://')]),
        bandOnTrack: z.coerce.number().int().min(1).max(1000),
        bandClose: z.coerce.number().int().min(0).max(1000),
      })
      .refine((data) => data.bandClose < data.bandOnTrack, { path: ['bandClose'], message: '"Close" must be below "On track"' })
      .parse(formDataToObject(formData))

    const rows = await prisma.setting.findMany()
    const before = { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((row) => [row.key, row.value])) }
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      for (const [key, value] of Object.entries(input)) {
        await tx.setting.upsert({ where: { key }, create: { key, value: value as Prisma.InputJsonValue }, update: { value: value as Prisma.InputJsonValue } })
      }
      await writeAudit(tx, { actorId: viewer.userId, action: 'update', entity: 'Settings', entityId: 'org', before, after: input, ip })
    })
    revalidatePath('/portal/settings/admin')
    return { ok: true, message: 'Settings saved.' }
  })
}

/** Publishing a new NDA version forces every active member to re-sign on next page load (§5.2). */
export async function publishNdaAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireSettingsEditor()
    const input = z
      .object({ title: z.string().trim().min(3).max(150), body: z.string().trim().min(50, 'The agreement text looks too short') })
      .parse({ title: formData.get('title'), body: formData.get('body') })
    const current = await prisma.ndaVersion.findFirst({ where: { isActive: true }, orderBy: { version: 'desc' } })
    if (current && current.body === input.body && current.title === input.title) throw new UserError('Nothing changed from the current version.')
    const { ip } = getRequestMeta()

    const created = await prisma.$transaction(async (tx) => {
      const latest = await tx.ndaVersion.aggregate({ _max: { version: true } })
      await tx.ndaVersion.updateMany({ where: { isActive: true }, data: { isActive: false } })
      const version = await tx.ndaVersion.create({
        data: { version: (latest._max.version ?? 0) + 1, title: input.title, body: input.body, isActive: true, publishedAt: new Date() },
      })
      await writeAudit(tx, {
        actorId: viewer.userId,
        action: 'publish',
        entity: 'NdaVersion',
        entityId: version.id,
        before: current ? { version: current.version, bodySha256: sha256(current.body) } : null,
        after: { version: version.version, bodySha256: sha256(version.body) },
        ip,
      })
      return version
    })

    const active = await prisma.user.findMany({ where: { member: { status: 'ACTIVE' }, disabledAt: null }, select: { id: true } })
    await notifyMany(
      active.map((user) => user.id),
      'NDA_PUBLISHED',
      { title: `Agreement updated to version ${created.version}`, body: 'Please read and sign the updated agreement next time you open the portal.', href: '/portal/onboarding/nda' }
    )
    revalidatePath('/portal', 'layout')
    return { ok: true, message: `Version ${created.version} published. Members will be asked to re-sign.` }
  })
}

// ---------- Onboarding checklist template (onboarding.edit all) ----------

async function requireTemplateEditor() {
  const viewer = await requireActiveViewer()
  if (!viewer.isAdmin) throw new ForbiddenError('Only an Admin can change the checklist template.')
  return viewer
}

export async function saveChecklistItemAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireTemplateEditor()
    const itemId = String(formData.get('itemId') ?? '')
    const input = z
      .object({
        title: z.string().trim().min(2).max(120),
        description: z.string().trim().max(300).optional().transform((value) => value || null),
        completedBy: z.enum(['MEMBER', 'LEAD']),
        isActive: z.boolean(),
      })
      .parse({ ...formDataToObject(formData), isActive: formData.get('isActive') === 'on' })
    const { ip } = getRequestMeta()

    await prisma.$transaction(async (tx) => {
      const before = itemId ? await tx.onboardingItem.findUniqueOrThrow({ where: { id: itemId } }) : null
      // System-ticked items keep their completer.
      const data = before?.completedBy === 'SYSTEM' ? { ...input, completedBy: 'SYSTEM' as const } : input
      const max = await tx.onboardingItem.aggregate({ _max: { order: true } })
      const saved = before
        ? await tx.onboardingItem.update({ where: { id: itemId }, data })
        : await tx.onboardingItem.create({ data: { ...data, order: (max._max.order ?? 0) + 1 } })
      if (!before) {
        // New items join the checklist of members who are still onboarding (last 60 days).
        const recent = await tx.member.findMany({ where: { status: 'ACTIVE', joinedAt: { gte: new Date(Date.now() - 60 * 86_400_000) } }, select: { id: true } })
        await tx.onboardingProgress.createMany({ data: recent.map((member) => ({ memberId: member.id, itemId: saved.id })), skipDuplicates: true })
      }
      await writeAudit(tx, { actorId: viewer.userId, action: before ? 'update' : 'create', entity: 'OnboardingItem', entityId: saved.id, before, after: saved, ip })
    })
    revalidatePath('/portal/settings/admin')
    return { ok: true, message: 'Checklist item saved.' }
  })
}

export async function moveChecklistItemAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireTemplateEditor()
    const itemId = String(formData.get('itemId'))
    const direction = formData.get('direction') === 'up' ? -1 : 1
    const items = await prisma.onboardingItem.findMany({ orderBy: { order: 'asc' } })
    const index = items.findIndex((item) => item.id === itemId)
    const swap = items[index + direction]
    if (index < 0 || !swap) return { ok: true }
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      // Renumber everything so orders stay dense, then swap the pair.
      const reordered = [...items]
      ;[reordered[index], reordered[index + direction]] = [reordered[index + direction], reordered[index]]
      for (const [position, item] of reordered.entries()) {
        if (item.order !== position + 1) await tx.onboardingItem.update({ where: { id: item.id }, data: { order: position + 1 } })
      }
      await writeAudit(tx, { actorId: viewer.userId, action: 'reorder', entity: 'OnboardingItem', entityId: itemId, after: { order: reordered.map((item) => item.title) }, ip })
    })
    revalidatePath('/portal/settings/admin')
    return { ok: true }
  })
}

export async function deleteChecklistItemAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireTemplateEditor()
    const itemId = String(formData.get('itemId'))
    const item = await prisma.onboardingItem.findUniqueOrThrow({ where: { id: itemId } })
    if (item.autoKey) throw new UserError('Built-in items can be deactivated but not deleted.')
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      await tx.onboardingItem.delete({ where: { id: itemId } })
      await writeAudit(tx, { actorId: viewer.userId, action: 'delete', entity: 'OnboardingItem', entityId: itemId, before: item, ip })
    })
    revalidatePath('/portal/settings/admin')
    return { ok: true, message: 'Item deleted.' }
  })
}
