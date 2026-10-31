'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { prisma, type Tx } from '@/lib/portal/db'
import { getRequestMeta } from '@/lib/portal/auth'
import { writeAudit } from '@/lib/portal/audit'
import { getSubtreeIds } from '@/lib/portal/hierarchy'
import {
  donationPeople,
  donationWhere,
  donorWhere,
  findDuplicateDonations,
  findOrLinkDonor,
  loggableMemberIds,
  notifyDonationOutcome,
  refreshCaseFunding,
  syncOutreachForDonation,
} from '@/lib/portal/money'
import { ForbiddenError, can, requireActiveViewer, type ActiveViewer } from '@/lib/portal/rbac'
import { storeUpload } from '@/lib/portal/storage'
import { formatDate, parseKarachiDate } from '@/lib/portal/time'
import { runAction, UserError } from '@/lib/portal/action-utils'
import { formDataToObject, normalizePhone, reasonSchema, type ActionState } from '@/lib/portal/validation'

const optional = z.string().trim().optional().transform((value) => value || null)

const donationSchema = z.object({
  donorId: optional,
  newDonorName: optional,
  newDonorPhone: optional,
  caseId: z.string().min(1, 'Choose a case'),
  amount: z.coerce.number({ invalid_type_error: 'Enter an amount' }).int('Whole rupees only').positive('Amount must be above 0'),
  receivedAt: z.string().min(1, 'When was it received?').transform(parseKarachiDate),
  method: z.enum(['EASYPAISA', 'JAZZCASH', 'BANK', 'CASH', 'OTHER'], { errorMap: () => ({ message: 'Choose a method' }) }),
  transactionRef: optional,
  cashReceivedNote: optional,
  memberId: optional,
  confirmDuplicate: optional,
})

type Loaded = NonNullable<Awaited<ReturnType<typeof loadDonation>>>

async function loadDonation(id: string) {
  return prisma.donation.findUnique({ where: { id }, include: { credits: true, donor: true, case: true } })
}

/**
 * Edit/delete (§7.4): only while PENDING (or REJECTED, to fix and resubmit), by the logger,
 * any credited member, or their leads. Admin always.
 */
async function assertCanChange(viewer: ActiveViewer, donation: Loaded) {
  if (donation.status === 'VERIFIED') throw new UserError('Verified donations are locked. An Admin can reopen them with a reason.')
  if (viewer.isAdmin) return
  const people = donationPeople(donation)
  if (people.includes(viewer.memberId)) return
  const subtree = await getSubtreeIds(viewer.memberId)
  if (people.some((id) => subtree.has(id))) return
  throw new ForbiddenError('Only the logger, a credited member or their lead can change this donation.')
}

/** Co-credits must be members who also approached that donor (§7.4). */
async function validateCoCredits(tx: Tx, donorId: string, memberIds: string[]) {
  if (memberIds.length === 0) return
  const approached = await tx.member.findMany({
    where: {
      id: { in: memberIds },
      status: 'ACTIVE',
      OR: [{ donorLinks: { some: { donorId } } }, { outreach: { some: { donorId } } }],
    },
    select: { id: true },
  })
  if (approached.length !== new Set(memberIds).size) throw new UserError('Co-credits can only go to members who also approached this donor.')
}

async function parseInput(viewer: ActiveViewer, formData: FormData) {
  const input = donationSchema.parse(formDataToObject(formData))
  const fieldErrors: Record<string, string[]> = {}
  if (input.newDonorPhone && !normalizePhone(input.newDonorPhone)) fieldErrors.newDonorPhone = ['Enter a Pakistani mobile number']
  if (input.method === 'CASH' && !input.cashReceivedNote) fieldErrors.cashReceivedNote = ['For cash, note who received it']
  if (input.receivedAt > new Date(Date.now() + 86_400_000)) fieldErrors.receivedAt = ["Can't be in the future"]
  const coCreditIds = formData.getAll('coCreditIds').map(String).filter(Boolean)
  const proof = formData.get('proof')
  return { input, coCreditIds, proof: proof instanceof File && proof.size > 0 ? proof : null, fieldErrors }
}

export async function logDonationAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    if (!can(viewer, 'donations', 'create')) throw new ForbiddenError()
    const { input, coCreditIds, proof, fieldErrors } = await parseInput(viewer, formData)
    if (!input.donorId && !input.newDonorName) fieldErrors.donorId = ['Choose a donor or add a new one']
    if (input.method !== 'CASH' && !proof) fieldErrors.proof = ['Attach the payment screenshot (required unless cash)']
    if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors }

    const memberId = input.memberId || viewer.memberId
    const allowed = await loggableMemberIds(viewer, 'donations')
    if (allowed !== 'all' && !allowed.includes(memberId)) throw new ForbiddenError('You can only log donations for yourself or your subtree.')

    const kase = await prisma.case.findUnique({ where: { id: input.caseId } })
    if (!kase || kase.deletedAt || !['OPEN', 'FUNDED'].includes(kase.status)) return { ok: false, fieldErrors: { caseId: ['Choose an open case'] } }

    if (input.donorId) {
      const visible = await prisma.donor.findFirst({ where: { AND: [{ id: input.donorId }, await donorWhere(viewer)] }, select: { id: true } })
      if (!visible) throw new ForbiddenError('Donor not found.')
      // Duplicate guard: warn on the same ref, or same donor + amount + day, unless confirmed.
      const duplicates = await findDuplicateDonations({ donorId: input.donorId, amount: input.amount, receivedAt: input.receivedAt, transactionRef: input.transactionRef })
      if (duplicates.length && !input.confirmDuplicate) {
        return {
          ok: false,
          message: `This looks like a duplicate of ${duplicates.length} existing donation(s) (${duplicates.map((d) => `PKR ${d.amount} on ${formatDate(d.receivedAt)}${d.transactionRef ? `, ref ${d.transactionRef}` : ''}`).join('; ')}). Tick "Log anyway" if it is genuinely new.`,
          fieldErrors: { confirmDuplicate: ['Confirm this is not a duplicate'] },
        }
      }
    }

    const proofKey = proof ? await storeUpload(proof, { uploadedById: viewer.userId, purpose: 'donation-proof' }) : null
    const { ip } = getRequestMeta()

    const donation = await prisma.$transaction(async (tx) => {
      const donorId = input.donorId ?? (await findOrLinkDonor(tx, { fullName: input.newDonorName!, phone: input.newDonorPhone }, memberId, viewer.memberId)).donor.id
      const credits = [...new Set([memberId, ...coCreditIds])]
      await validateCoCredits(tx, donorId, credits.filter((id) => id !== memberId))
      await tx.donorLink.upsert({ where: { donorId_memberId: { donorId, memberId } }, create: { donorId, memberId }, update: { historical: false } })
      const created = await tx.donation.create({
        data: {
          donorId,
          caseId: kase.id,
          amount: input.amount,
          receivedAt: input.receivedAt,
          method: input.method,
          transactionRef: input.transactionRef,
          cashReceivedNote: input.cashReceivedNote,
          proofKey,
          status: 'PENDING',
          loggedById: viewer.memberId,
          credits: { create: credits.map((id) => ({ memberId: id })) },
        },
      })
      await syncOutreachForDonation(tx, { donorId, memberId, caseId: kase.id, receivedAt: input.receivedAt, loggedById: viewer.memberId })
      await writeAudit(tx, { actorId: viewer.userId, action: 'create', entity: 'Donation', entityId: created.id, after: { ...created, credits }, ip })
      return created
    })
    revalidatePath('/portal/donations')
    redirect(`/portal/donations/${donation.id}?logged=1`)
  })
}

export async function updateDonationAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const donation = await loadDonation(String(formData.get('donationId')))
    if (!donation) throw new UserError('Donation not found.')
    await assertCanChange(viewer, donation)
    const { input, coCreditIds, proof, fieldErrors } = await parseInput(viewer, formData)
    if (input.method !== 'CASH' && !proof && !donation.proofKey) fieldErrors.proof = ['Attach the payment screenshot']
    if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors }
    if (input.caseId !== donation.caseId) {
      const kase = await prisma.case.findUnique({ where: { id: input.caseId } })
      if (!kase || !['OPEN', 'FUNDED'].includes(kase.status)) return { ok: false, fieldErrors: { caseId: ['Choose an open case'] } }
    }
    const duplicates = await findDuplicateDonations({ donorId: donation.donorId, amount: input.amount, receivedAt: input.receivedAt, transactionRef: input.transactionRef, excludeId: donation.id })
    if (duplicates.length && !input.confirmDuplicate) {
      return { ok: false, message: 'This now matches another donation (same ref, or same donor, amount and day). Tick "Log anyway" to save.', fieldErrors: { confirmDuplicate: ['Confirm this is not a duplicate'] } }
    }
    const proofKey = proof ? await storeUpload(proof, { uploadedById: viewer.userId, purpose: 'donation-proof' }) : donation.proofKey
    const primary = donation.credits[0]?.memberId ?? donation.loggedById
    const credits = [...new Set([primary, ...coCreditIds])]
    const { ip } = getRequestMeta()

    await prisma.$transaction(async (tx) => {
      await validateCoCredits(tx, donation.donorId, credits.filter((id) => id !== primary))
      const after = await tx.donation.update({
        where: { id: donation.id },
        data: {
          caseId: input.caseId,
          amount: input.amount,
          receivedAt: input.receivedAt,
          method: input.method,
          transactionRef: input.transactionRef,
          cashReceivedNote: input.cashReceivedNote,
          proofKey,
          // Fixing a rejected donation resubmits it (§7 flow).
          status: 'PENDING',
          rejectionReason: null,
        },
      })
      await tx.donationCredit.deleteMany({ where: { donationId: donation.id, memberId: { notIn: credits } } })
      await tx.donationCredit.createMany({ data: credits.map((memberId) => ({ donationId: donation.id, memberId })), skipDuplicates: true })
      await writeAudit(tx, {
        actorId: viewer.userId,
        action: donation.status === 'REJECTED' ? 'resubmit' : 'update',
        entity: 'Donation',
        entityId: donation.id,
        before: { ...donation, case: undefined, donor: undefined, credits: donation.credits.map((credit) => credit.memberId) },
        after: { ...after, credits },
        ip,
      })
    })
    revalidatePath(`/portal/donations/${donation.id}`)
    return { ok: true, message: donation.status === 'REJECTED' ? 'Resubmitted for verification.' : 'Donation updated.' }
  })
}

export async function deleteDonationAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const donation = await loadDonation(String(formData.get('donationId')))
    if (!donation) throw new UserError('Donation not found.')
    await assertCanChange(viewer, donation)
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      await tx.donation.delete({ where: { id: donation.id } })
      await writeAudit(tx, { actorId: viewer.userId, action: 'delete', entity: 'Donation', entityId: donation.id, before: { amount: donation.amount, donorId: donation.donorId, caseId: donation.caseId, status: donation.status }, ip })
    })
    redirect('/portal/donations')
  })
}

// ---------- Verification (§7.5) ----------

async function loadForVerification(viewer: ActiveViewer, donationId: string) {
  const donation = await prisma.donation.findFirst({ where: { AND: [{ id: donationId }, await donationWhere(viewer, 'verify')] }, include: { credits: true } })
  if (!donation) throw new ForbiddenError('You cannot verify this donation.')
  // Hard rule: nobody verifies their own donation.
  if (donationPeople(donation).includes(viewer.memberId)) throw new ForbiddenError("You can't verify a donation you logged or are credited on.")
  if (donation.status !== 'PENDING') throw new UserError('This donation is no longer pending.')
  return donation
}

async function verifyOne(viewer: ActiveViewer, donationId: string, ip: string) {
  const donation = await loadForVerification(viewer, donationId)
  await prisma.$transaction(async (tx) => {
    await tx.donation.update({ where: { id: donation.id }, data: { status: 'VERIFIED', verifiedById: viewer.memberId, verifiedAt: new Date(), rejectionReason: null } })
    await refreshCaseFunding(tx, donation.caseId)
    await writeAudit(tx, { actorId: viewer.userId, action: 'verify', entity: 'Donation', entityId: donation.id, before: { status: 'PENDING' }, after: { status: 'VERIFIED', amount: donation.amount }, ip })
  })
  await notifyDonationOutcome(donation.id, true)
}

function afterVerification(formData: FormData) {
  revalidatePath('/portal/donations/verify')
  revalidatePath('/portal', 'layout')
  const back = String(formData.get('back') ?? '')
  if (back.startsWith('/portal/')) redirect(back)
}

export async function verifyDonationAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    await verifyOne(viewer, String(formData.get('donationId')), getRequestMeta().ip)
    afterVerification(formData)
    return { ok: true, message: 'Verified.' }
  })
}

export async function rejectDonationAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const reason = reasonSchema.safeParse(formData.get('reason'))
    if (!reason.success) return { ok: false, fieldErrors: { reason: ['A reason is required to reject'] } }
    const donation = await loadForVerification(viewer, String(formData.get('donationId')))
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      await tx.donation.update({ where: { id: donation.id }, data: { status: 'REJECTED', rejectionReason: reason.data, verifiedById: viewer.memberId, verifiedAt: new Date() } })
      await writeAudit(tx, { actorId: viewer.userId, action: 'reject', entity: 'Donation', entityId: donation.id, before: { status: 'PENDING' }, after: { status: 'REJECTED' }, reason: reason.data, ip })
    })
    await notifyDonationOutcome(donation.id, false, reason.data)
    afterVerification(formData)
    return { ok: true, message: 'Rejected. The logger and credited members were notified.' }
  })
}

/** Bulk verify is allowed only for donations with a unique transaction ref (§7.5). */
export async function bulkVerifyAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const ids = formData.getAll('donationIds').map(String)
    if (ids.length === 0) return { ok: false, message: 'Select at least one donation.' }
    const rows = await prisma.donation.findMany({ where: { id: { in: ids } }, select: { id: true, transactionRef: true } })
    for (const row of rows) {
      if (!row.transactionRef) throw new UserError('Bulk verify only works for donations with a transaction ref.')
      const sharing = await prisma.donation.count({ where: { transactionRef: { equals: row.transactionRef, mode: 'insensitive' }, status: { not: 'REJECTED' } } })
      if (sharing > 1) throw new UserError(`Ref ${row.transactionRef} is used by more than one donation; verify it individually.`)
    }
    // Check every selected donation first so a bad one can't leave the batch half done.
    for (const id of ids) await loadForVerification(viewer, id)
    const { ip } = getRequestMeta()
    for (const id of ids) await verifyOne(viewer, id, ip)
    revalidatePath('/portal/donations/verify')
    return { ok: true, message: `Verified ${ids.length} donation(s).` }
  })
}

/** Reopen a verified donation: Admin only, reason required, audited (§3.4, §7.5). */
export async function reopenDonationAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    if (!viewer.isAdmin) throw new ForbiddenError('Only an Admin can reopen a verified donation.')
    const reason = reasonSchema.safeParse(formData.get('reason'))
    if (!reason.success) return { ok: false, fieldErrors: { reason: ['A reason is required to reopen'] } }
    const donation = await loadDonation(String(formData.get('donationId')))
    if (!donation || donation.status !== 'VERIFIED') throw new UserError('Only verified donations can be reopened.')
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      await tx.donation.update({ where: { id: donation.id }, data: { status: 'PENDING', verifiedById: null, verifiedAt: null } })
      await refreshCaseFunding(tx, donation.caseId)
      await writeAudit(tx, { actorId: viewer.userId, action: 'reopen', entity: 'Donation', entityId: donation.id, before: { status: 'VERIFIED', verifiedById: donation.verifiedById }, after: { status: 'PENDING' }, reason: reason.data, ip })
    })
    revalidatePath(`/portal/donations/${donation.id}`)
    return { ok: true, message: 'Reopened. It is pending again and no longer counts in metrics.' }
  })
}
