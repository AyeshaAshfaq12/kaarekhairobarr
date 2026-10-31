import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from './db'
import { monthKey, monthRange } from './time'
import {
  computeMoneyMetrics,
  computeTaskMetrics,
  monthSeries,
  type DonationRow,
  type MoneyMetrics,
  type OutreachRow,
  type TaskMetrics,
} from './metrics-core'

export * from './metrics-core'

type MemberSet = 'all' | string[]

const memberWhere = (ids: MemberSet) => (ids === 'all' ? {} : { in: ids })

/**
 * Raised = sum of VERIFIED donations credited to each member, by the month they were
 * received (Asia/Karachi), not the month verified (§9.2). Co-credited donations count in
 * full for every credited member.
 */
export async function raisedByMember(memberIds: string[], month: string) {
  if (memberIds.length === 0) return new Map<string, number>()
  const { start, end } = monthRange(month)
  const rows = await prisma.$queryRaw<{ memberId: string; raised: bigint }[]>`
    SELECT dc."memberId", COALESCE(SUM(d.amount), 0)::bigint AS raised
    FROM "DonationCredit" dc
    JOIN "Donation" d ON d.id = dc."donationId"
    WHERE d.status = 'VERIFIED'
      AND d."receivedAt" >= ${start} AND d."receivedAt" < ${end}
      AND dc."memberId" IN (${Prisma.join(memberIds)})
    GROUP BY dc."memberId"
  `
  return new Map(rows.map((row) => [row.memberId, Number(row.raised)]))
}

export async function targetsByMember(memberIds: string[], month: string) {
  if (memberIds.length === 0) return new Map<string, number>()
  const rows = await prisma.target.findMany({
    where: { month, memberId: { in: memberIds } },
    select: { memberId: true, amountTarget: true },
  })
  return new Map(rows.map((row) => [row.memberId!, row.amountTarget]))
}

/** Team / org totals count each donation once, even when several members are credited (§9.3). */
export async function raisedByGroup(memberIds: MemberSet, month: string) {
  const { start, end } = monthRange(month)
  const memberFilter =
    memberIds === 'all'
      ? Prisma.empty
      : memberIds.length === 0
        ? Prisma.sql`AND FALSE`
        : Prisma.sql`AND EXISTS (SELECT 1 FROM "DonationCredit" dc WHERE dc."donationId" = d.id AND dc."memberId" IN (${Prisma.join(memberIds)}))`
  const [row] = await prisma.$queryRaw<{ raised: bigint }[]>`
    SELECT COALESCE(SUM(d.amount), 0)::bigint AS raised
    FROM "Donation" d
    WHERE d.status = 'VERIFIED' AND d."receivedAt" >= ${start} AND d."receivedAt" < ${end}
    ${memberFilter}
  `
  return Number(row?.raised ?? 0)
}

// ---------- Month data ----------

export type MonthData = {
  outreach: OutreachRow[]
  donations: DonationRow[]
  priorDonorIds: Set<string>
}

/** All outreach and non-rejected donations in the month that involve the member set. */
export async function loadMonthData(memberIds: MemberSet, month: string): Promise<MonthData> {
  const { start, end } = monthRange(month)
  if (memberIds !== 'all' && memberIds.length === 0) return { outreach: [], donations: [], priorDonorIds: new Set() }
  const [outreach, donations] = await Promise.all([
    prisma.outreach.findMany({
      where: { memberId: memberWhere(memberIds), contactedAt: { gte: start, lt: end } },
      select: { memberId: true, donorId: true, promisedAmount: true },
    }),
    prisma.donation.findMany({
      where: {
        receivedAt: { gte: start, lt: end },
        status: { in: ['PENDING', 'VERIFIED'] },
        ...(memberIds === 'all' ? {} : { credits: { some: { memberId: { in: memberIds } } } }),
      },
      select: { id: true, donorId: true, amount: true, status: true, credits: { select: { memberId: true } } },
    }),
  ])
  const donorIds = [...new Set(donations.filter((d) => d.status === 'VERIFIED').map((d) => d.donorId))]
  const prior = donorIds.length
    ? await prisma.donation.findMany({
        where: { donorId: { in: donorIds }, status: 'VERIFIED', receivedAt: { lt: start } },
        select: { donorId: true },
        distinct: ['donorId'],
      })
    : []
  return {
    outreach,
    donations: donations.map((donation) => ({
      id: donation.id,
      donorId: donation.donorId,
      amount: donation.amount,
      status: donation.status,
      creditedMemberIds: donation.credits.map((credit) => credit.memberId),
    })),
    priorDonorIds: new Set(prior.map((row) => row.donorId)),
  }
}

export async function loadMemberTargets(memberIds: string[], month: string) {
  const rows = memberIds.length
    ? await prisma.target.findMany({ where: { month, memberId: { in: memberIds } }, select: { memberId: true, amountTarget: true, outreachTarget: true } })
    : []
  return new Map(rows.map((row) => [row.memberId!, row]))
}

/** Per-member metrics for a list of members (each member's credits count in full). */
export async function memberMetrics(memberIds: string[], month: string) {
  const [data, targets] = await Promise.all([loadMonthData(memberIds, month), loadMemberTargets(memberIds, month)])
  return new Map(
    memberIds.map((memberId) => [
      memberId,
      computeMoneyMetrics({
        memberIds: new Set([memberId]),
        ...data,
        amountTarget: targets.get(memberId)?.amountTarget ?? null,
        outreachTarget: targets.get(memberId)?.outreachTarget ?? null,
      }),
    ])
  )
}

/**
 * Rollup for a group (subtree, team or org). The target is the team target when given,
 * otherwise the sum of members' targets (subtree rollup, §9.1).
 */
export async function groupMetrics(memberIds: MemberSet, month: string, teamTarget?: number | null): Promise<MoneyMetrics> {
  const data = await loadMonthData(memberIds, month)
  const ids = memberIds === 'all' ? null : memberIds
  let amountTarget = teamTarget ?? null
  let outreachTarget: number | null = null
  if (teamTarget === undefined) {
    const targets = await prisma.target.aggregate({
      where: { month, memberId: ids ? { in: ids } : { not: null } },
      _sum: { amountTarget: true, outreachTarget: true },
    })
    amountTarget = targets._sum.amountTarget
    outreachTarget = targets._sum.outreachTarget
  }
  const memberSet = new Set(ids ?? [...data.outreach.map((row) => row.memberId), ...data.donations.flatMap((row) => row.creditedMemberIds)])
  return computeMoneyMetrics({ memberIds: memberSet, ...data, amountTarget, outreachTarget })
}

export async function taskMetrics(memberIds: MemberSet, month: string): Promise<TaskMetrics> {
  const { start, end } = monthRange(month)
  const assignee = memberIds === 'all' ? { not: null } : { in: memberIds }
  const [tasksDueInMonth, openTasks] = await Promise.all([
    prisma.task.findMany({ where: { deletedAt: null, assigneeId: assignee, dueAt: { gte: start, lt: end } }, select: { assigneeId: true, status: true, dueAt: true, createdAt: true, completedAt: true } }),
    prisma.task.findMany({ where: { deletedAt: null, assigneeId: assignee, status: { notIn: ['DONE', 'CANCELLED'] }, dueAt: { lt: new Date() } }, select: { assigneeId: true, status: true, dueAt: true, createdAt: true, completedAt: true } }),
  ])
  const ids = new Set(memberIds === 'all' ? [...tasksDueInMonth, ...openTasks].map((task) => task.assigneeId!).filter(Boolean) : memberIds)
  return computeTaskMetrics({ memberIds: ids, tasksDueInMonth, openTasks })
}

/** Outreach with followUpAt < now and no later outreach or donation for that donor (§9.2). */
export async function followUpsOverdue(memberIds: string[]) {
  if (memberIds.length === 0) return new Map<string, number>()
  const rows = await prisma.$queryRaw<{ memberId: string; count: bigint }[]>`
    SELECT o."memberId", COUNT(*)::bigint AS count
    FROM "Outreach" o
    WHERE o."memberId" IN (${Prisma.join(memberIds)})
      AND o."followUpAt" < NOW()
      AND NOT EXISTS (SELECT 1 FROM "Outreach" later WHERE later."donorId" = o."donorId" AND later."contactedAt" > o."contactedAt")
      AND NOT EXISTS (SELECT 1 FROM "Donation" d WHERE d."donorId" = o."donorId" AND d."receivedAt" > o."contactedAt" AND d.status <> 'REJECTED')
    GROUP BY o."memberId"
  `
  return new Map(rows.map((row) => [row.memberId, Number(row.count)]))
}

// ---------- Snapshots (§9.4) ----------

export type SnapshotData = MoneyMetrics & { tasks: TaskMetrics }

export function snapshotKey(month: string, scope: 'member' | 'team' | 'org', id?: string | null) {
  return `${month}:${scope}:${id ?? 'org'}`
}

/** Frozen snapshot for a closed month, if any. The current month is always live. */
export async function frozenSnapshot(month: string, scope: 'member' | 'team' | 'org', id?: string | null) {
  if (month >= monthKey()) return null
  const row = await prisma.monthlyMetric.findUnique({ where: { key: snapshotKey(month, scope, id) } })
  return row?.frozenAt ? (row.data as unknown as SnapshotData) : null
}

/** Group metrics, read from a frozen snapshot when the month is closed. */
export async function groupMetricsForMonth(scope: 'team' | 'org', id: string | null, memberIds: MemberSet, month: string, teamTarget?: number | null) {
  return (await frozenSnapshot(month, scope, id)) ?? groupMetrics(memberIds, month, teamTarget)
}

/** Raised per month for a group, oldest first. Closed months come from snapshots when frozen. */
export async function trend(memberIds: MemberSet, month: string, count: number, scope: { kind: 'org' | 'team' | 'live'; id?: string }) {
  return Promise.all(
    monthSeries(month, count).map(async (m) => {
      const snap = scope.kind === 'live' ? null : await frozenSnapshot(m, scope.kind, scope.id)
      const metrics = snap ?? (await groupMetrics(memberIds, m))
      return { month: m, raised: metrics.raised, pending: metrics.pending, reached: metrics.reached, converted: metrics.converted }
    })
  )
}

/** Writes snapshot rows for every member, team and the org for `month`. */
export async function writeMonthlySnapshots(month: string, freeze: boolean) {
  const members = await prisma.member.findMany({ where: { status: { in: ['ACTIVE', 'INACTIVE', 'LEFT'] } }, select: { id: true } })
  const memberIds = members.map((member) => member.id)
  const perMember = await memberMetrics(memberIds, month)
  const teams = await prisma.team.findMany({ include: { memberships: { select: { memberId: true } } } })
  const frozenAt = freeze ? new Date() : null

  const rows: { key: string; scope: string; memberId: string | null; teamId: string | null; data: SnapshotData }[] = []
  for (const memberId of memberIds) {
    rows.push({ key: snapshotKey(month, 'member', memberId), scope: 'member', memberId, teamId: null, data: { ...perMember.get(memberId)!, tasks: await taskMetrics([memberId], month) } })
  }
  for (const team of teams) {
    const ids = team.memberships.map((membership) => membership.memberId)
    const target = await prisma.target.findUnique({ where: { month_teamId: { month, teamId: team.id } } })
    rows.push({ key: snapshotKey(month, 'team', team.id), scope: 'team', memberId: null, teamId: team.id, data: { ...(await groupMetrics(ids, month, target?.amountTarget ?? null)), tasks: await taskMetrics(ids, month) } })
  }
  rows.push({ key: snapshotKey(month, 'org'), scope: 'org', memberId: null, teamId: null, data: { ...(await groupMetrics('all', month)), tasks: await taskMetrics('all', month) } })

  for (const row of rows) {
    const existing = await prisma.monthlyMetric.findUnique({ where: { key: row.key }, select: { frozenAt: true } })
    if (existing?.frozenAt) continue // frozen snapshots never change
    const data = row.data as unknown as Prisma.InputJsonValue
    await prisma.monthlyMetric.upsert({
      where: { key: row.key },
      create: { key: row.key, month, scope: row.scope, memberId: row.memberId, teamId: row.teamId, data, frozenAt },
      update: { data, frozenAt },
    })
  }
  return rows.length
}
