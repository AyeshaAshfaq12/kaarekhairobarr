import 'server-only'
import { prisma } from '@/lib/portal/db'
import { donorWhere, loggableMemberIds } from '@/lib/portal/money'
import type { Viewer } from '@/lib/portal/rbac'

/** Dropdown options for the donation form, limited to what the viewer may use. */
export async function donationFormOptions(viewer: Viewer & { memberId: string }, includeCaseId?: string) {
  const loggable = await loggableMemberIds(viewer, 'donations')
  const [donors, cases, members] = await Promise.all([
    prisma.donor.findMany({ where: await donorWhere(viewer), select: { id: true, fullName: true, phoneNormalized: true }, orderBy: { fullName: 'asc' }, take: 3000 }),
    prisma.case.findMany({
      where: { deletedAt: null, OR: [{ status: { in: ['OPEN', 'FUNDED'] } }, ...(includeCaseId ? [{ id: includeCaseId }] : [])] },
      select: { id: true, title: true },
      orderBy: { title: 'asc' },
    }),
    // Credit candidates: anyone active; the server checks they actually approached the donor.
    prisma.member.findMany({ where: { status: 'ACTIVE' }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } }),
  ])
  const loggableSet = loggable === 'all' ? null : new Set(loggable)
  return {
    donors: donors.map((donor) => ({ id: donor.id, label: donor.phoneNormalized ? `${donor.fullName} (…${donor.phoneNormalized.slice(-4)})` : donor.fullName })),
    cases: cases.map((kase) => ({ id: kase.id, label: kase.title })),
    creditFor: members.filter((member) => !loggableSet || loggableSet.has(member.id)).map((member) => ({ id: member.id, label: member.id === viewer.memberId ? `${member.fullName} (me)` : member.fullName })),
    coCredit: members.map((member) => ({ id: member.id, label: member.fullName })),
  }
}
