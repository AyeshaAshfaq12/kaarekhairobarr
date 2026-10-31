import 'server-only'
import { NextResponse } from 'next/server'
import { prisma } from './db'
import { previousMonth, writeMonthlySnapshots } from './metrics'
import { adminUserIds, notify, notifyMany } from './notify'
import { ADMIN_ROLE_NAMES, SYSTEM_ROLE } from './rbac/model'
import { dayKey, dayRange, monthKey } from './time'

/** Cron routes are called by Vercel Cron with Authorization: Bearer $CRON_SECRET. */
export function cronUnauthorized(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  return null
}

/**
 * Monthly close (§9.4): on the 1st (03:00 PKT) snapshot the previous month, recompute nightly
 * for 10 days to catch late verifications, then freeze on the 11th.
 */
export async function runMonthlyClose(now = new Date()) {
  const day = Number(dayKey(now).slice(8, 10))
  const month = previousMonth(monthKey(now))
  if (day > 11) return { month, action: 'none' as const }
  const freeze = day === 11
  const rows = await writeMonthlySnapshots(month, freeze)
  if (day === 1) {
    const leads = await prisma.member.findMany({ where: { status: 'ACTIVE', reports: { some: { status: 'ACTIVE' } } }, select: { userId: true } })
    await notifyMany([...leads.map((lead) => lead.userId), ...(await adminUserIds())], 'MONTHLY_REPORT_READY', {
      title: `Monthly report for ${month} is ready`,
      body: 'Numbers may still change for 10 days as late donations are verified.',
      href: `/portal/reports?report=impact&month=${month}`,
    })
  }
  return { month, action: freeze ? ('frozen' as const) : ('snapshotted' as const), rows }
}

/** Daily digest to verifiers of donations pending more than 3 days (§11.2). */
export async function runPendingDigest(now = new Date()) {
  const cutoff = new Date(now.getTime() - 3 * 86_400_000)
  const stale = await prisma.donation.aggregate({ where: { status: 'PENDING', createdAt: { lt: cutoff } }, _count: true, _sum: { amount: true } })
  if (!stale._count) return 0
  const verifiers = await prisma.userRole.findMany({
    where: { role: { name: { in: [...ADMIN_ROLE_NAMES, SYSTEM_ROLE.FINANCE] } }, user: { disabledAt: null, member: { status: 'ACTIVE' } } },
    select: { userId: true },
  })
  await notifyMany(
    verifiers.map((row) => row.userId),
    'DONATIONS_PENDING_DIGEST',
    { title: `${stale._count} donation(s) pending over 3 days`, body: `PKR ${(stale._sum.amount ?? 0).toLocaleString('en-PK')} is waiting for verification.`, href: '/portal/donations/verify' }
  )
  return stale._count
}

/** "Follow-up due today" to the member who logged the outreach (§7.3, §11.2). */
export async function runFollowUpReminders(now = new Date()) {
  const { end } = dayRange(now)
  const due = await prisma.outreach.findMany({
    where: { followUpAt: { lt: end }, followUpNotifiedAt: null, outcome: { notIn: ['DONATED', 'DECLINED'] } },
    include: { donor: { select: { id: true, fullName: true } }, loggedBy: { select: { userId: true, status: true } } },
  })
  for (const row of due) {
    if (row.loggedBy.status === 'ACTIVE') {
      await notify(row.loggedBy.userId, 'FOLLOW_UP_DUE', { title: `Follow up with ${row.donor.fullName} today`, href: `/portal/donors/${row.donor.id}` })
    }
  }
  await prisma.outreach.updateMany({ where: { id: { in: due.map((row) => row.id) } }, data: { followUpNotifiedAt: now } })
  return due.length
}
