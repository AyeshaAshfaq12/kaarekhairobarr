'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma, type Tx } from '@/lib/portal/db'
import { getRequestMeta } from '@/lib/portal/auth'
import { writeAudit } from '@/lib/portal/audit'
import { donorWhere, findOrLinkDonor, createOutreach, loggableMemberIds } from '@/lib/portal/money'
import { ForbiddenError, requireActiveViewer, type ActiveViewer } from '@/lib/portal/rbac'
import { parseKarachiDate } from '@/lib/portal/time'
import { runAction, UserError } from '@/lib/portal/action-utils'
import { formDataToObject, normalizePhone, type ActionState } from '@/lib/portal/validation'

const optional = z.string().trim().optional().transform((value) => value || null)

const CHANNELS = ['WHATSAPP', 'CALL', 'IN_PERSON', 'SOCIAL', 'OTHER'] as const
const OUTCOMES = ['CONTACTED', 'PROMISED', 'DONATED', 'DECLINED', 'NO_RESPONSE'] as const

const donorSchema = z.object({
  fullName: z.string().trim().min(2, 'Donor name is required').max(120),
  phone: optional.refine((value) => !value || !!normalizePhone(value), 'Enter a Pakistani mobile number, e.g. 0300 1234567'),
  email: optional.pipe(z.string().email('Enter a valid email').nullable()),
  city: optional,
  relationNote: optional,
})

/** Members log their own; leads can log on behalf of anyone in their subtree (§7.3). */
async function resolveSubject(viewer: ActiveViewer, requested: string | null) {
  const memberId = requested || viewer.memberId
  const allowed = await loggableMemberIds(viewer, 'donors')
  if (allowed !== 'all' && !allowed.includes(memberId)) throw new ForbiddenError('You can only log outreach for yourself or your subtree.')
  return memberId
}

const linkMessage = (outcome: 'created' | 'linked' | 'existing', name: string) =>
  outcome === 'created' ? `${name} added.` : outcome === 'linked' ? `${name} already existed (same phone), so they are now linked to you.` : `${name} is already in your donors.`

export async function createDonorAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const input = donorSchema.parse(formDataToObject(formData))
    const memberId = await resolveSubject(viewer, String(formData.get('memberId') ?? '') || null)
    const { ip } = getRequestMeta()
    const result = await prisma.$transaction(async (tx) => {
      const linked = await findOrLinkDonor(tx, input, memberId, viewer.memberId)
      await writeAudit(tx, { actorId: viewer.userId, action: linked.outcome === 'created' ? 'create' : 'link', entity: 'Donor', entityId: linked.donor.id, after: { ...input, memberId }, ip })
      return linked
    })
    revalidatePath('/portal/donors')
    return { ok: true, message: linkMessage(result.outcome, result.donor.fullName) }
  })
}

export async function updateDonorAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const donorId = String(formData.get('donorId'))
    const before = await prisma.donor.findFirst({ where: { AND: [{ id: donorId }, await donorWhere(viewer, 'edit')] } })
    if (!before) throw new ForbiddenError()
    const input = donorSchema.parse(formDataToObject(formData))
    const phoneNormalized = normalizePhone(input.phone)
    if (phoneNormalized && phoneNormalized !== before.phoneNormalized && (await prisma.donor.findUnique({ where: { phoneNormalized } }))) {
      return { ok: false, fieldErrors: { phone: ['Another donor already has this phone number'] } }
    }
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      // The relation note is only submitted by people allowed to see it; otherwise keep it.
      const relationNote = formData.has('relationNote') ? input.relationNote : before.relationNote
      const after = await tx.donor.update({ where: { id: donorId }, data: { ...input, relationNote, phoneNormalized } })
      await writeAudit(tx, { actorId: viewer.userId, action: 'update', entity: 'Donor', entityId: donorId, before, after, ip })
    })
    revalidatePath(`/portal/donors/${donorId}`)
    return { ok: true, message: 'Donor updated.' }
  })
}

const outreachSchema = z.object({
  donorId: optional,
  newDonorName: optional,
  newDonorPhone: optional,
  memberId: optional,
  caseId: optional,
  channel: z.enum(CHANNELS, { errorMap: () => ({ message: 'Choose a channel' }) }),
  outcome: z.enum(OUTCOMES, { errorMap: () => ({ message: 'Choose an outcome' }) }),
  promisedAmount: optional.transform((value, ctx) => {
    if (!value) return null
    const amount = Number(value)
    if (!Number.isInteger(amount) || amount <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Whole rupees above 0' })
      return z.NEVER
    }
    return amount
  }),
  followUpAt: optional.transform((value) => (value ? parseKarachiDate(value) : null)),
  contactedAt: optional.transform((value) => (value ? parseKarachiDate(value) : new Date())),
  notes: optional,
})

async function resolveCase(tx: Tx, caseId: string | null) {
  if (!caseId) return null
  const kase = await tx.case.findUnique({ where: { id: caseId }, select: { id: true, status: true, deletedAt: true } })
  if (!kase || kase.deletedAt || !['OPEN', 'FUNDED'].includes(kase.status)) throw new UserError('Choose an open case.')
  return kase.id
}

/** Quick-add (§7.3): donor (search or create inline), case, channel, outcome, promise, follow-up. */
export async function logOutreachAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const input = outreachSchema.parse(formDataToObject(formData))
    if (!input.donorId && !input.newDonorName) return { ok: false, fieldErrors: { donorId: ['Pick a donor or add a new one'] } }
    if (input.newDonorPhone && !normalizePhone(input.newDonorPhone)) return { ok: false, fieldErrors: { newDonorPhone: ['Enter a Pakistani mobile number'] } }
    if (input.outcome === 'PROMISED' && !input.promisedAmount) return { ok: false, fieldErrors: { promisedAmount: ['How much did they promise?'] } }
    const memberId = await resolveSubject(viewer, input.memberId)
    const { ip } = getRequestMeta()

    const outcome = await prisma.$transaction(async (tx) => {
      let donorId = input.donorId
      let linkOutcome: string | null = null
      if (donorId) {
        // An existing donor must be one the viewer can see.
        const visible = await tx.donor.findFirst({ where: { AND: [{ id: donorId }, await donorWhere(viewer)] }, select: { id: true } })
        if (!visible) throw new ForbiddenError('Donor not found.')
        await tx.donorLink.upsert({ where: { donorId_memberId: { donorId, memberId } }, create: { donorId, memberId }, update: { historical: false } })
      } else {
        const linked = await findOrLinkDonor(tx, { fullName: input.newDonorName!, phone: input.newDonorPhone }, memberId, viewer.memberId)
        donorId = linked.donor.id
        linkOutcome = linked.outcome
      }
      const outreach = await createOutreach(tx, {
        memberId,
        donorId,
        caseId: await resolveCase(tx, input.caseId),
        contactedAt: input.contactedAt,
        channel: input.channel,
        outcome: input.outcome,
        promisedAmount: input.promisedAmount,
        followUpAt: input.followUpAt,
        notes: input.notes,
        loggedById: viewer.memberId,
      })
      await writeAudit(tx, { actorId: viewer.userId, action: 'create', entity: 'Outreach', entityId: outreach.id, after: outreach, ip })
      return linkOutcome
    })
    revalidatePath('/portal/outreach')
    return { ok: true, message: outcome === 'linked' ? 'Logged. That phone number already belonged to a donor, so they were linked to you.' : 'Outreach logged.' }
  })
}

/** Bulk add (§7.3): one contact per line, "name, phone, outcome". */
export async function bulkOutreachAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const memberId = await resolveSubject(viewer, String(formData.get('memberId') ?? '') || null)
    const channel = z.enum(CHANNELS).parse(formData.get('channel') || 'WHATSAPP')
    let text = String(formData.get('csv') ?? '')
    const file = formData.get('file')
    if (file instanceof File && file.size > 0) {
      if (file.size > 512 * 1024) throw new UserError('CSV files must be under 512 KB.')
      text = `${text}\n${await file.text()}`
    }
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    if (lines[0] && /name/i.test(lines[0]) && /phone/i.test(lines[0])) lines.shift()
    if (lines.length === 0) return { ok: false, fieldErrors: { csv: ['Paste at least one line: name, phone, outcome'] } }
    if (lines.length > 500) throw new UserError('Up to 500 contacts per upload.')

    const errors: string[] = []
    const parsed = lines.map((line, index) => {
      const [name, phone, outcomeRaw] = line.split(/[,\t;]/).map((part) => part?.trim().replace(/^"|"$/g, ''))
      const outcome = (outcomeRaw || 'CONTACTED').toUpperCase().replace(/[\s-]+/g, '_')
      if (!name) errors.push(`Line ${index + 1}: missing name`)
      if (phone && !normalizePhone(phone)) errors.push(`Line ${index + 1}: "${phone}" isn't a Pakistani mobile number`)
      if (!OUTCOMES.includes(outcome as (typeof OUTCOMES)[number])) errors.push(`Line ${index + 1}: outcome must be one of ${OUTCOMES.join(', ').toLowerCase()}`)
      return { name, phone: phone || null, outcome: outcome as (typeof OUTCOMES)[number] }
    })
    if (errors.length) return { ok: false, message: errors.slice(0, 6).join(' · ') + (errors.length > 6 ? ` (+${errors.length - 6} more)` : '') }

    const { ip } = getRequestMeta()
    const summary = await prisma.$transaction(async (tx) => {
      let created = 0
      let linked = 0
      for (const row of parsed) {
        const result = await findOrLinkDonor(tx, { fullName: row.name, phone: row.phone }, memberId, viewer.memberId)
        if (result.outcome === 'created') created += 1
        else linked += 1
        await createOutreach(tx, { memberId, donorId: result.donor.id, contactedAt: new Date(), channel, outcome: row.outcome, loggedById: viewer.memberId })
      }
      await writeAudit(tx, { actorId: viewer.userId, action: 'bulk_create', entity: 'Outreach', entityId: memberId, after: { rows: parsed.length, created, linked, channel }, ip })
      return { created, linked }
    }, { timeout: 60_000 })
    revalidatePath('/portal/outreach')
    return { ok: true, message: `Logged ${parsed.length} contacts (${summary.created} new donors, ${summary.linked} existing).` }
  })
}
