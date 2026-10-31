'use server'

import { redirect } from 'next/navigation'
import { prisma } from '@/lib/portal/db'
import { getRequestMeta } from '@/lib/portal/auth'
import { sha256 } from '@/lib/portal/crypto'
import { writeAudit } from '@/lib/portal/audit'
import { sendEmail } from '@/lib/portal/email'
import { renderNdaPdf } from '@/lib/portal/nda-pdf'
import { adminUserIds, notifyMany } from '@/lib/portal/notify'
import { requireViewer } from '@/lib/portal/rbac'
import { runAction, UserError } from '@/lib/portal/action-utils'
import type { ActionState } from '@/lib/portal/validation'

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

export async function signNdaAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireViewer()
    if (!viewer.memberId) throw new UserError('No member profile is linked to this account.')
    const memberId = viewer.memberId

    const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId }, include: { user: true } })
    if (!['PENDING_NDA', 'ACTIVE'].includes(member.status)) throw new UserError('Your account cannot sign right now.')

    const active = await prisma.ndaVersion.findFirst({ where: { isActive: true }, orderBy: { version: 'desc' } })
    if (!active) throw new UserError('No agreement is published yet. Please contact an admin.')

    const bodySha256 = sha256(active.body)
    if (formData.get('ndaVersionId') !== active.id || formData.get('bodySha256') !== bodySha256) {
      throw new UserError('A newer version of the agreement was published. Reload the page and read it again.')
    }
    if (formData.get('agree') !== 'on') {
      return { ok: false, fieldErrors: { agree: ['Read to the end and tick "I agree" to continue'] } }
    }
    const typedName = String(formData.get('typedName') ?? '')
    if (normalizeName(typedName) !== normalizeName(member.fullName)) {
      return { ok: false, fieldErrors: { typedName: [`Type your full name exactly as registered: ${member.fullName}`] } }
    }

    const { ip, userAgent } = getRequestMeta()
    const signedAt = new Date()
    const wasApplicant = member.status === 'PENDING_NDA'

    const signature = await prisma.$transaction(async (tx) => {
      const created = await tx.ndaSignature.upsert({
        where: { memberId_ndaVersionId: { memberId, ndaVersionId: active.id } },
        create: { memberId, ndaVersionId: active.id, typedName: typedName.trim(), bodySha256, signedAt, ip, userAgent },
        update: {},
      })
      if (wasApplicant) {
        await tx.member.update({ where: { id: memberId }, data: { status: 'PENDING_APPROVAL' } })
      }
      await writeAudit(tx, {
        actorId: viewer.userId,
        action: 'nda_sign',
        entity: 'NdaSignature',
        entityId: created.id,
        after: { memberId, version: active.version, bodySha256, typedName: created.typedName, userAgent },
        ip,
      })
      return created
    })

    // Email the signed copy. Best effort: the signature is already stored.
    try {
      const pdf = await renderNdaPdf({ body: active.body, version: active.version, typedName: signature.typedName, signedAt, ip, bodySha256 })
      await sendEmail({
        to: member.user.email,
        subject: `Your signed KKB agreement (v${active.version})`,
        text: `Thank you for signing the KKB Member Confidentiality and Conduct Agreement. A copy is attached. You can download it any time from Settings in the portal.`,
        attachments: [{ filename: `KKB-agreement-v${active.version}.pdf`, content: pdf }],
      })
    } catch (error) {
      console.error('[nda] could not email PDF', error)
    }

    if (wasApplicant) {
      await notifyMany(await adminUserIds(), 'APPLICANT_PENDING', {
        title: `${member.fullName} is awaiting approval`,
        body: `${member.fullName} (${member.city}) signed the agreement and is ready for review.`,
        href: '/portal/members/pending',
      })
      redirect('/portal/onboarding/pending')
    }
    redirect('/portal/dashboard')
  })
}
