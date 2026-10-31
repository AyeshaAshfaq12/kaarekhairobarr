import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma, type Tx } from './db'
import { getLedTeamMemberIds, getSubtreeIds } from './hierarchy'
import { tickAutoItem } from './members'
import { notifyMany } from './notify'
import { scopeFor, type ActionName, type Viewer } from './rbac'
import { dayRange, monthRange, monthKey } from './time'
import { normalizePhone } from './validation'

// ---------- Scope → SQL WHERE (§3.2: list endpoints turn the scope into a WHERE clause) ----------

async function scopedMemberIds(viewer: Viewer, scope: string) {
  const ids = new Set<string>(viewer.memberId ? [viewer.memberId] : [])
  if (!viewer.memberId) return ids
  if (scope === 'subtree') for (const id of await getSubtreeIds(viewer.memberId)) ids.add(id)
  if (scope === 'team' || scope === 'subtree') for (const id of await getLedTeamMemberIds(viewer.memberId)) ids.add(id)
  return ids
}

const NONE = { id: '__none__' }

/**
 * OR of scope filters. Prisma treats `OR: [{}, …]` as false, not true, so an unrestricted
 * filter ({}) must short-circuit to {}.
 */
export function anyOf<T extends object>(...wheres: T[]): T | { OR: T[] } {
  if (wheres.some((where) => Object.keys(where).length === 0)) return {} as T
  return { OR: wheres }
}

/**
 * Donors are visible to the members linked to them and everyone above them (subtree scope),
 * plus all-scope roles (§7.2).
 */
export async function donorWhere(viewer: Viewer, action: ActionName = 'view'): Promise<Prisma.DonorWhereInput> {
  const scope = scopeFor(viewer, 'donors', action)
  if (!scope) return NONE
  if (scope === 'all') return { deletedAt: null }
  const ids = [...(await scopedMemberIds(viewer, scope))]
  return {
    deletedAt: null,
    OR: [{ links: { some: { memberId: { in: ids } } } }, { createdById: viewer.memberId ?? '' }],
  }
}

/**
 * Donations: own = logged by me or credited to me; assigned = on cases assigned to me or on
 * events I lead / have a responsibility on; team/subtree = credited to those members.
 */
export async function donationWhere(viewer: Viewer, action: ActionName = 'view'): Promise<Prisma.DonationWhereInput> {
  const scope = scopeFor(viewer, 'donations', action)
  if (!scope) return NONE
  if (scope === 'all') return {}
  const me = viewer.memberId ?? ''
  const or: Prisma.DonationWhereInput[] = [{ loggedById: me }, { credits: { some: { memberId: me } } }]
  if (scope !== 'own') {
    or.push(
      { case: { assignments: { some: { memberId: me } } } },
      { case: { event: { OR: [{ leadId: me }, { responsibilities: { some: { memberId: me } } }] } } }
    )
  }
  if (scope === 'team' || scope === 'subtree') {
    const ids = [...(await scopedMemberIds(viewer, scope))]
    or.push({ credits: { some: { memberId: { in: ids } } } }, { loggedById: { in: ids } })
  }
  return { OR: or }
}

/** Outreach follows the donors scope: own = mine or typed by me; team/subtree = those members. */
export async function outreachWhere(viewer: Viewer): Promise<Prisma.OutreachWhereInput> {
  const scope = scopeFor(viewer, 'donors', 'view')
  if (!scope) return NONE
  if (scope === 'all') return {}
  const me = viewer.memberId ?? ''
  if (scope === 'own' || scope === 'assigned') return { OR: [{ memberId: me }, { loggedById: me }] }
  return { OR: [{ memberId: { in: [...(await scopedMemberIds(viewer, scope))] } }, { loggedById: me }] }
}

/** Members the viewer may log outreach/donations for: themselves, plus their scope (§7.3). */
export async function loggableMemberIds(viewer: Viewer, module: 'donors' | 'donations') {
  const scope = scopeFor(viewer, module, 'create')
  if (!scope) return []
  if (scope === 'all') return 'all' as const
  return [...(await scopedMemberIds(viewer, scope))]
}

/**
 * Cases: every active member sees OPEN/FUNDED summaries (§7.1). DRAFTs are visible only to
 * their creator and Admin. Otherwise the cases.view scope decides.
 */
export async function caseWhere(viewer: Viewer): Promise<Prisma.CaseWhereInput> {
  const me = viewer.memberId ?? ''
  const base: Prisma.CaseWhereInput = { deletedAt: null }
  const publicCases: Prisma.CaseWhereInput = { status: { in: ['OPEN', 'FUNDED'] } }
  if (viewer.isAdmin) return base
  const scope = scopeFor(viewer, 'cases', 'view')
  const or: Prisma.CaseWhereInput[] = [publicCases, { createdById: me }]
  if (scope === 'all') or.push({ status: { not: 'DRAFT' } })
  else if (scope) {
    or.push({ status: { not: 'DRAFT' }, assignments: { some: { memberId: me } } })
    if (scope === 'team' || scope === 'subtree') {
      const ids = [...(await scopedMemberIds(viewer, scope))]
      or.push({ status: { not: 'DRAFT' }, OR: [{ createdById: { in: ids } }, { assignments: { some: { memberId: { in: ids } } } }] })
    }
  }
  return { ...base, OR: or }
}

/** Beneficiary details: assigned members, the case creator and Admin only (§7.1). */
export function canSeeBeneficiary(viewer: Viewer, kase: { createdById: string; assignments: { memberId: string }[] }) {
  return viewer.isAdmin || kase.createdById === viewer.memberId || kase.assignments.some((a) => a.memberId === viewer.memberId)
}

// ---------- Donors ----------

export type DonorInput = { fullName: string; phone?: string | null; email?: string | null; city?: string | null; relationNote?: string | null }

/**
 * Dedupe on the normalised phone (§4, §7.2): if a donor with that phone exists, link it to
 * the member instead of creating a duplicate.
 */
export async function findOrLinkDonor(tx: Tx, input: DonorInput, memberId: string, createdById: string) {
  const phoneNormalized = normalizePhone(input.phone)
  if (input.phone && !phoneNormalized) throw new Error('INVALID_PHONE')
  const existing = phoneNormalized ? await tx.donor.findUnique({ where: { phoneNormalized } }) : null
  if (existing) {
    const link = await tx.donorLink.findUnique({ where: { donorId_memberId: { donorId: existing.id, memberId } } })
    if (!link) await tx.donorLink.create({ data: { donorId: existing.id, memberId } })
    else if (link.historical) await tx.donorLink.update({ where: { id: link.id }, data: { historical: false } })
    return { donor: existing, outcome: link && !link.historical ? ('existing' as const) : ('linked' as const) }
  }
  const donor = await tx.donor.create({
    data: {
      fullName: input.fullName,
      phone: input.phone || null,
      phoneNormalized,
      email: input.email || null,
      city: input.city || null,
      relationNote: input.relationNote || null,
      createdById,
      links: { create: { memberId } },
    },
  })
  return { donor, outcome: 'created' as const }
}

// ---------- Outreach ----------

/** Records outreach and ticks the "first outreach" onboarding item (§5.4). */
export async function createOutreach(tx: Tx, data: Prisma.OutreachUncheckedCreateInput) {
  const outreach = await tx.outreach.create({ data })
  await tickAutoItem(tx, data.memberId, 'FIRST_OUTREACH')
  return outreach
}

// ---------- Donations ----------

/** Duplicate guard (§7.4): same transaction ref, or same donor + amount + day. */
export async function findDuplicateDonations(input: { donorId: string; amount: number; receivedAt: Date; transactionRef?: string | null; excludeId?: string }) {
  const { start: dayStart, end: dayEnd } = dayRange(input.receivedAt)
  return prisma.donation.findMany({
    where: {
      id: input.excludeId ? { not: input.excludeId } : undefined,
      status: { not: 'REJECTED' },
      OR: [
        ...(input.transactionRef ? [{ transactionRef: { equals: input.transactionRef, mode: 'insensitive' as const } }] : []),
        { donorId: input.donorId, amount: input.amount, receivedAt: { gte: dayStart, lt: dayEnd } },
      ],
    },
    select: { id: true, amount: true, transactionRef: true, receivedAt: true },
  })
}

/**
 * On save (§7.4): if the donor has an outreach this month by the credited member that isn't
 * DONATED, flip it; if none exists, create one.
 */
export async function syncOutreachForDonation(tx: Tx, input: { donorId: string; memberId: string; caseId: string; receivedAt: Date; loggedById: string }) {
  const { start, end } = monthRange(monthKey(input.receivedAt))
  const existing = await tx.outreach.findMany({
    where: { donorId: input.donorId, memberId: input.memberId, contactedAt: { gte: start, lt: end } },
    orderBy: { contactedAt: 'desc' },
  })
  if (existing.some((row) => row.outcome === 'DONATED')) return
  if (existing.length) {
    await tx.outreach.update({ where: { id: existing[0].id }, data: { outcome: 'DONATED' } })
    return
  }
  await createOutreach(tx, {
    memberId: input.memberId,
    donorId: input.donorId,
    caseId: input.caseId,
    contactedAt: input.receivedAt,
    channel: 'OTHER',
    outcome: 'DONATED',
    loggedById: input.loggedById,
    notes: 'Created automatically when the donation was logged.',
  })
}

/** Sets FUNDED when verified ≥ target, and back to OPEN if a reopen drops it below (§7.1). */
export async function refreshCaseFunding(tx: Tx, caseId: string) {
  const kase = await tx.case.findUniqueOrThrow({ where: { id: caseId } })
  const verified = await tx.donation.aggregate({ where: { caseId, status: 'VERIFIED' }, _sum: { amount: true } })
  const total = verified._sum.amount ?? 0
  if (kase.status === 'OPEN' && total >= kase.targetAmount) await tx.case.update({ where: { id: caseId }, data: { status: 'FUNDED' } })
  if (kase.status === 'FUNDED' && total < kase.targetAmount) await tx.case.update({ where: { id: caseId }, data: { status: 'OPEN' } })
}

export async function caseProgress(caseIds: string[]) {
  if (caseIds.length === 0) return new Map<string, { verified: number; pending: number; donors: number }>()
  const rows = await prisma.donation.groupBy({
    by: ['caseId', 'status'],
    where: { caseId: { in: caseIds }, status: { in: ['VERIFIED', 'PENDING'] } },
    _sum: { amount: true },
  })
  const donors = await prisma.donation.findMany({ where: { caseId: { in: caseIds }, status: 'VERIFIED' }, select: { caseId: true, donorId: true }, distinct: ['caseId', 'donorId'] })
  const result = new Map(caseIds.map((id) => [id, { verified: 0, pending: 0, donors: 0 }]))
  for (const row of rows) {
    const entry = result.get(row.caseId)!
    if (row.status === 'VERIFIED') entry.verified = row._sum.amount ?? 0
    else entry.pending = row._sum.amount ?? 0
  }
  for (const row of donors) result.get(row.caseId)!.donors += 1
  return result
}

/** The members a donation is about: logger and credited members (for own/subtree checks). */
export function donationPeople(donation: { loggedById: string; credits: { memberId: string }[] }) {
  return [donation.loggedById, ...donation.credits.map((credit) => credit.memberId)]
}

export async function notifyDonationOutcome(donationId: string, verified: boolean, reason?: string) {
  const donation = await prisma.donation.findUniqueOrThrow({
    where: { id: donationId },
    include: { donor: { select: { fullName: true } }, credits: { select: { memberId: true } } },
  })
  const memberIds = donationPeople(donation)
  const users = await prisma.member.findMany({ where: { id: { in: memberIds } }, select: { userId: true } })
  await notifyMany(
    users.map((user) => user.userId),
    verified ? 'DONATION_VERIFIED' : 'DONATION_REJECTED',
    {
      title: verified ? `Donation of PKR ${donation.amount.toLocaleString('en-PK')} verified` : `Donation of PKR ${donation.amount.toLocaleString('en-PK')} rejected`,
      body: verified ? `From ${donation.donor.fullName}. It now counts in your metrics.` : `From ${donation.donor.fullName}. Reason: ${reason}. Fix it and resubmit.`,
      href: `/portal/donations/${donation.id}`,
    }
  )
}
