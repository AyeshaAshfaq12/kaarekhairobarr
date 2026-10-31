import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from './db'
import { getSubtreeIds } from './hierarchy'
import { eventSummary, eventWhere } from './events'
import {
  formatRatio,
  frozenSnapshot,
  groupMetrics,
  memberMetrics,
  previousPeriod,
  statusBand,
  taskMetrics,
  type MoneyMetrics,
} from './metrics'
import { caseProgress, caseWhere, donationWhere, donorWhere, outreachWhere } from './money'
import { scopeFor, visibleMemberIds, type ActiveViewer } from './rbac'
import { getSettings } from './settings'
import { taskWhere } from './tasks'
import { daysBetween, formatDate, formatPeriod, makePeriod, monthRange, parseKarachiDate, periodMonths } from './time'

// ---------- Shapes shared by the page, Excel and PDF ----------

export type ColumnKind = 'text' | 'pkr' | 'number' | 'percent'
export type Column = { key: string; label: string; kind?: ColumnKind }
export type Cell = string | number | null
export type Table = { name: string; columns: Column[]; rows: Record<string, Cell>[] }
export type Report = { title: string; scopeLabel: string; period: string; tables: Table[]; notes?: string[] }

export class ReportNotFound extends Error {}

export const REPORTS = {
  impact: 'Monthly impact',
  cases: 'Cases',
  donations: 'Donations ledger',
  event: 'Event',
  team: 'Team',
  member: 'Member month',
  onboarding: 'Onboarding',
} as const

export type ReportKey = keyof typeof REPORTS | 'tasks' | 'members' | 'donors' | 'outreach'

export type ReportParams = Record<string, string | undefined>

// ---------- Scope picker (§10.2: limited to what the viewer can see) ----------

export type ScopeOption = { value: string; label: string }

export async function scopeOptions(viewer: ActiveViewer): Promise<ScopeOption[]> {
  const options: ScopeOption[] = [{ value: 'self', label: 'Just me' }]
  const scope = scopeFor(viewer, 'reports', 'view')
  if (scope === 'subtree' || scope === 'all') {
    const subtree = scope === 'all' ? null : [...(await getSubtreeIds(viewer.memberId))]
    const leads = await prisma.member.findMany({
      where: { status: 'ACTIVE', reports: { some: {} }, ...(subtree ? { id: { in: subtree } } : {}) },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    })
    for (const lead of leads) options.push({ value: `subtree:${lead.id}`, label: `${lead.id === viewer.memberId ? 'My' : `${lead.fullName}'s`} subtree` })
  }
  const teams = await prisma.team.findMany({
    where: viewer.isAdmin || scope === 'all' ? {} : { memberships: { some: { memberId: viewer.memberId, isLead: true } } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
  for (const team of teams) options.push({ value: `team:${team.id}`, label: `Team: ${team.name}` })
  if (scope === 'all') options.push({ value: 'org', label: 'Whole organisation' })
  return options
}

type ResolvedScope = { label: string; memberIds: string[] | 'all'; snapshot: { scope: 'team' | 'org'; id: string | null } | null; teamTarget?: number | null }

async function resolveScope(viewer: ActiveViewer, value: string | undefined, month: string): Promise<ResolvedScope> {
  const options = await scopeOptions(viewer)
  const chosen = options.find((option) => option.value === (value || 'self'))
  if (!chosen) throw new ReportNotFound()
  if (chosen.value === 'self') return { label: viewer.fullName, memberIds: [viewer.memberId], snapshot: null }
  if (chosen.value === 'org') return { label: 'Whole organisation', memberIds: 'all', snapshot: { scope: 'org', id: null } }
  const [kind, id] = chosen.value.split(':')
  if (kind === 'subtree') return { label: chosen.label, memberIds: [...(await getSubtreeIds(id))], snapshot: null }
  const team = await prisma.team.findUniqueOrThrow({ where: { id }, include: { memberships: { select: { memberId: true } }, targets: { where: { month: { in: periodMonths(month) } } } } })
  return { label: chosen.label, memberIds: team.memberships.map((m) => m.memberId), snapshot: { scope: 'team', id }, teamTarget: sumTargets(team.targets) }
}

/** A month, or a month range when `toMonth` is given (§10.2: "a month (or range) picker"). */
function monthParam(params: ReportParams, fallback: string) {
  const from = /^\d{4}-\d{2}$/.test(params.month ?? '') ? params.month! : fallback
  return makePeriod(from, params.toMonth)
}

const sumTargets = (targets: { amountTarget: number }[]) => (targets.length ? targets.reduce((sum, target) => sum + target.amountTarget, 0) : null)

// ---------- Columns ----------

const METRIC_COLUMNS: Column[] = [
  { key: 'reached', label: 'Reached', kind: 'number' },
  { key: 'converted', label: 'Converted', kind: 'number' },
  { key: 'conversion', label: 'Conversion', kind: 'percent' },
  { key: 'raised', label: 'Raised', kind: 'pkr' },
  { key: 'pending', label: 'Pending', kind: 'pkr' },
  { key: 'target', label: 'Target', kind: 'pkr' },
  { key: 'achievement', label: 'Achievement', kind: 'percent' },
  { key: 'band', label: 'Status', kind: 'text' },
  { key: 'averageGift', label: 'Average gift', kind: 'pkr' },
  { key: 'promised', label: 'Promised', kind: 'pkr' },
  { key: 'paidFromPromised', label: 'Paid of promised', kind: 'pkr' },
  { key: 'repeatDonors', label: 'Repeat donors', kind: 'number' },
]

const BAND_LABEL = { ON_TRACK: 'On track', CLOSE: 'Close', BEHIND: 'Behind' } as const

async function metricRow(m: MoneyMetrics) {
  const settings = await getSettings()
  const band = statusBand(m.achievement, { onTrack: settings.bandOnTrack, close: settings.bandClose })
  return {
    reached: m.reached,
    converted: m.converted,
    conversion: m.conversionRate,
    raised: m.raised,
    pending: m.pending,
    target: m.amountTarget,
    achievement: m.achievement,
    band: band ? BAND_LABEL[band] : '—',
    averageGift: m.averageGift,
    promised: m.promised,
    paidFromPromised: m.paidFromPromised,
    repeatDonors: m.repeatDonors,
  }
}

// ---------- Builders ----------

/** 1. Monthly impact: per-member metrics, totals, bands, top performers, month-over-month. */
async function impact(viewer: ActiveViewer, params: ReportParams, month: string): Promise<Report> {
  const scope = await resolveScope(viewer, params.scope, month)
  const ids =
    scope.memberIds === 'all'
      ? (await prisma.member.findMany({ where: { status: { in: ['ACTIVE', 'INACTIVE', 'LEFT'] }, joinedAt: { not: null } }, select: { id: true } })).map((m) => m.id)
      : scope.memberIds
  const members = await prisma.member.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } })
  // Closed months read frozen snapshots; the current month is live (§9.4).
  const live = await memberMetrics(ids, month)
  const perMember = await Promise.all(members.map(async (member) => ({ member, m: (await frozenSnapshot(month, 'member', member.id)) ?? live.get(member.id)! })))
  const totals = scope.snapshot
    ? (await frozenSnapshot(month, scope.snapshot.scope, scope.snapshot.id)) ?? (await groupMetrics(scope.memberIds, month, scope.teamTarget))
    : await groupMetrics(ids, month)
  const previous = await groupMetrics(scope.memberIds === 'all' ? 'all' : ids, previousPeriod(month))
  const change = previous.raised ? (totals.raised - previous.raised) / previous.raised : null
  const rows = await Promise.all(perMember.map(async ({ member, m }) => ({ member: member.fullName, ...(await metricRow(m)) })))
  const top = [...perMember].sort((a, b) => b.m.raised - a.m.raised).slice(0, 5).filter((row) => row.m.raised > 0)
  return {
    title: 'Monthly impact report',
    scopeLabel: scope.label,
    period: formatPeriod(month),
    tables: [
      { name: 'Members', columns: [{ key: 'member', label: 'Member' }, ...METRIC_COLUMNS], rows },
      { name: 'Totals', columns: [{ key: 'member', label: 'Group' }, ...METRIC_COLUMNS], rows: [{ member: `${scope.label} (each donation once)`, ...(await metricRow(totals)) }] },
      {
        name: 'Top performers',
        columns: [
          { key: 'rank', label: '#', kind: 'number' },
          { key: 'member', label: 'Member' },
          { key: 'raised', label: 'Raised', kind: 'pkr' },
        ],
        rows: top.map((row, index) => ({ rank: index + 1, member: row.member.fullName, raised: row.m.raised })),
      },
      {
        name: month.includes('..') ? 'Compared with the previous period' : 'Month over month',
        columns: [
          { key: 'month', label: 'Period' },
          { key: 'raised', label: 'Raised', kind: 'pkr' },
          { key: 'change', label: 'Change', kind: 'percent' },
        ],
        rows: [
          { month: formatPeriod(previousPeriod(month)), raised: previous.raised, change: null },
          { month: formatPeriod(month), raised: totals.raised, change },
        ],
      },
    ],
  }
}

/** 2. Case report: target, verified, pending, donors, contributors, donations. */
async function cases(viewer: ActiveViewer, params: ReportParams): Promise<Report> {
  const where: Prisma.CaseWhereInput = { AND: [await caseWhere(viewer), params.caseId ? { id: params.caseId } : { status: { not: 'DRAFT' } }] }
  const list = await prisma.case.findMany({ where, orderBy: { startDate: 'desc' } })
  const progress = await caseProgress(list.map((kase) => kase.id))
  const donations = await prisma.donation.findMany({
    where: { AND: [{ caseId: { in: list.map((kase) => kase.id) } }, await donationWhere(viewer)] },
    include: { donor: { select: { fullName: true } }, case: { select: { title: true } }, credits: { include: { member: { select: { fullName: true } } } } },
    orderBy: { receivedAt: 'desc' },
  })
  const contributors = new Map<string, Set<string>>()
  for (const donation of donations.filter((d) => d.status === 'VERIFIED')) {
    const set = contributors.get(donation.caseId) ?? new Set<string>()
    donation.credits.forEach((credit) => set.add(credit.member.fullName))
    contributors.set(donation.caseId, set)
  }
  return {
    title: 'Case report',
    scopeLabel: params.caseId && list[0] ? list[0].title : 'All cases you can see',
    period: 'All time',
    tables: [
      {
        name: 'Cases',
        columns: [
          { key: 'title', label: 'Case' },
          { key: 'category', label: 'Category' },
          { key: 'status', label: 'Status' },
          { key: 'target', label: 'Target', kind: 'pkr' },
          { key: 'verified', label: 'Verified', kind: 'pkr' },
          { key: 'pending', label: 'Pending', kind: 'pkr' },
          { key: 'progress', label: 'Progress', kind: 'percent' },
          { key: 'donors', label: 'Donors', kind: 'number' },
          { key: 'contributors', label: 'Contributors' },
        ],
        rows: list.map((kase) => {
          const p = progress.get(kase.id)!
          return {
            title: kase.title,
            category: kase.category,
            status: kase.status,
            target: kase.targetAmount,
            verified: p.verified,
            pending: p.pending,
            progress: kase.targetAmount ? p.verified / kase.targetAmount : null,
            donors: p.donors,
            contributors: [...(contributors.get(kase.id) ?? [])].join(', '),
          }
        }),
      },
      ledgerTable('Donations', donations),
    ],
  }
}

type LedgerDonation = Prisma.DonationGetPayload<{ include: { donor: { select: { fullName: true } }; case: { select: { title: true } }; credits: { include: { member: { select: { fullName: true } } } } } }>

function ledgerTable(name: string, donations: (LedgerDonation & { verifierName?: string | null })[]): Table {
  return {
    name,
    columns: [
      { key: 'received', label: 'Received' },
      { key: 'donor', label: 'Donor' },
      { key: 'case', label: 'Case' },
      { key: 'amount', label: 'Amount', kind: 'pkr' },
      { key: 'status', label: 'Status' },
      { key: 'method', label: 'Method' },
      { key: 'ref', label: 'Ref' },
      { key: 'credited', label: 'Credited to' },
      { key: 'verifier', label: 'Verified by' },
    ],
    rows: donations.map((donation) => ({
      received: formatDate(donation.receivedAt),
      donor: donation.donor.fullName,
      case: donation.case.title,
      amount: donation.amount,
      status: donation.status,
      method: donation.method,
      ref: donation.transactionRef,
      credited: donation.credits.map((credit) => credit.member.fullName).join(', '),
      verifier: donation.verifierName ?? null,
    })),
  }
}

/** 3. Donations ledger — same filters as the Donations list page. */
async function donations(viewer: ActiveViewer, params: ReportParams): Promise<Report> {
  const period = /^\d{4}-\d{2}$/.test(params.month ?? '') ? makePeriod(params.month!, params.toMonth) : null
  const range = period ? monthRange(period) : null
  const where: Prisma.DonationWhereInput = {
    AND: [
      await donationWhere(viewer),
      params.status && ['PENDING', 'VERIFIED', 'REJECTED'].includes(params.status) ? { status: params.status as 'PENDING' } : {},
      params.method ? { method: params.method as 'CASH' } : {},
      params.caseId ? { caseId: params.caseId } : {},
      range ? { receivedAt: { gte: range.start, lt: range.end } } : {},
      params.from ? { receivedAt: { gte: parseKarachiDate(params.from) } } : {},
      params.to ? { receivedAt: { lte: new Date(parseKarachiDate(params.to).getTime() + 12 * 3_600_000) } } : {},
    ],
  }
  const rows = await prisma.donation.findMany({
    where,
    include: { donor: { select: { fullName: true } }, case: { select: { title: true } }, credits: { include: { member: { select: { fullName: true } } } } },
    orderBy: { receivedAt: 'desc' },
  })
  const verifiers = new Map(
    (await prisma.member.findMany({ where: { id: { in: rows.map((row) => row.verifiedById).filter((id): id is string => !!id) } }, select: { id: true, fullName: true } })).map((m) => [m.id, m.fullName])
  )
  return {
    title: 'Donations ledger',
    scopeLabel: 'Donations you can see',
    period: period ? formatPeriod(period) : (params.from || params.to ? `${params.from ?? '…'} to ${params.to ?? '…'}` : 'All time'),
    tables: [ledgerTable('Ledger', rows.map((row) => ({ ...row, verifierName: row.verifiedById ? verifiers.get(row.verifiedById) : null })))],
  }
}

/** 4. Event report: §8.4 summary + responsibilities + expenses. */
async function event(viewer: ActiveViewer, params: ReportParams): Promise<Report> {
  const found = await prisma.event.findFirst({
    where: { AND: [{ id: params.eventId ?? '' }, await eventWhere(viewer)] },
    include: { responsibilities: { include: { member: { select: { fullName: true } } } }, expenses: { include: { paidBy: { select: { fullName: true } } }, orderBy: { spentAt: 'asc' } } },
  })
  if (!found) throw new ReportNotFound()
  const s = await eventSummary(found.id)
  return {
    title: `Event report: ${found.name}`,
    scopeLabel: found.name,
    period: formatDate(found.startsAt),
    notes: found.surplusNote ? [`Note: ${found.surplusNote}`] : undefined,
    tables: [
      {
        name: 'Summary',
        columns: [
          { key: 'line', label: 'Line' },
          { key: 'value', label: 'Value', kind: 'pkr' },
          { key: 'percent', label: '%', kind: 'percent' },
        ],
        rows: [
          { line: 'Collection target', value: s.collectionTarget, percent: null },
          { line: 'Collected (verified)', value: s.collected, percent: null },
          { line: 'Pending collection', value: s.pendingCollection, percent: null },
          { line: 'Budget', value: s.budget, percent: null },
          { line: 'Spent (approved)', value: s.spent, percent: null },
          { line: 'Awaiting approval', value: s.awaitingApproval, percent: null },
          { line: s.net >= 0 ? 'Net (surplus)' : 'Net (deficit)', value: s.net, percent: null },
          { line: 'Collection vs target', value: null, percent: s.collectionVsTarget },
          { line: 'Spend vs budget', value: null, percent: s.spendVsBudget },
        ],
      },
      {
        name: 'Responsibilities',
        columns: [
          { key: 'title', label: 'Responsibility' },
          { key: 'member', label: 'Member' },
          { key: 'status', label: 'Status' },
          { key: 'notes', label: 'Notes' },
        ],
        rows: found.responsibilities.map((item) => ({ title: item.title, member: item.member.fullName, status: item.status, notes: item.notes })),
      },
      {
        name: 'Expenses',
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'title', label: 'Expense' },
          { key: 'category', label: 'Category' },
          { key: 'paidBy', label: 'Paid by' },
          { key: 'amount', label: 'Amount', kind: 'pkr' },
          { key: 'status', label: 'Status' },
        ],
        rows: found.expenses.map((expense) => ({ date: formatDate(expense.spentAt), title: expense.title, category: expense.category, paidBy: expense.paidBy.fullName, amount: expense.amount, status: expense.status })),
      },
    ],
  }
}

const TASK_COLUMNS: Column[] = [
  { key: 'member', label: 'Member' },
  { key: 'assigned', label: 'Assigned', kind: 'number' },
  { key: 'completed', label: 'Completed', kind: 'number' },
  { key: 'onTime', label: 'On time', kind: 'percent' },
  { key: 'overdue', label: 'Overdue now', kind: 'number' },
  { key: 'cycle', label: 'Avg cycle (days)', kind: 'number' },
]

/** 5. Team report: task metrics per member, team target vs raised. */
async function team(viewer: ActiveViewer, params: ReportParams, month: string): Promise<Report> {
  const options = await scopeOptions(viewer)
  if (!options.some((option) => option.value === `team:${params.teamId}`)) throw new ReportNotFound()
  const found = await prisma.team.findUniqueOrThrow({
    where: { id: params.teamId! },
    include: { memberships: { include: { member: { select: { id: true, fullName: true } } } }, targets: { where: { month: { in: periodMonths(month) } } } },
  })
  const ids = found.memberships.map((m) => m.memberId)
  const perMember = await Promise.all(found.memberships.map(async (m) => ({ name: m.member.fullName, t: await taskMetrics([m.memberId], month) })))
  const money = (await frozenSnapshot(month, 'team', found.id)) ?? (await groupMetrics(ids, month, sumTargets(found.targets)))
  const teamTasks = await taskMetrics(ids, month)
  return {
    title: `Team report: ${found.name}`,
    scopeLabel: found.name,
    period: formatPeriod(month),
    tables: [
      {
        name: 'Tasks by member',
        columns: TASK_COLUMNS,
        rows: [...perMember.map(({ name, t }) => ({ member: name, assigned: t.assigned, completed: t.completed, onTime: t.onTimeRate, overdue: t.overdueNow, cycle: t.avgCycleDays })), { member: 'Team total', assigned: teamTasks.assigned, completed: teamTasks.completed, onTime: teamTasks.onTimeRate, overdue: teamTasks.overdueNow, cycle: teamTasks.avgCycleDays }],
      },
      {
        name: 'Target',
        columns: [
          { key: 'target', label: 'Team target', kind: 'pkr' },
          { key: 'raised', label: 'Raised (each donation once)', kind: 'pkr' },
          { key: 'achievement', label: 'Achievement', kind: 'percent' },
        ],
        rows: [{ target: money.amountTarget, raised: money.raised, achievement: money.achievement }],
      },
    ],
  }
}

/** 6. Member report: one member's full month, for 1:1s with their lead. */
async function member(viewer: ActiveViewer, params: ReportParams, month: string): Promise<Report> {
  const memberId = params.memberId || viewer.memberId
  if (memberId !== viewer.memberId) {
    const scope = scopeFor(viewer, 'reports', 'view')
    const allowed = scope === 'all' || (scope === 'subtree' && (await getSubtreeIds(viewer.memberId)).has(memberId))
    if (!allowed) throw new ReportNotFound()
  }
  const subject = await prisma.member.findUniqueOrThrow({ where: { id: memberId }, select: { fullName: true } })
  const { start, end } = monthRange(month)
  const m = (await frozenSnapshot(month, 'member', memberId)) ?? (await memberMetrics([memberId], month)).get(memberId)!
  const t = await taskMetrics([memberId], month)
  const [donationRows, outreachRows, tasks] = await Promise.all([
    prisma.donation.findMany({
      where: { receivedAt: { gte: start, lt: end }, credits: { some: { memberId } } },
      include: { donor: { select: { fullName: true } }, case: { select: { title: true } }, credits: { include: { member: { select: { fullName: true } } } } },
      orderBy: { receivedAt: 'asc' },
    }),
    prisma.outreach.findMany({ where: { memberId, contactedAt: { gte: start, lt: end } }, include: { donor: { select: { fullName: true } } }, orderBy: { contactedAt: 'asc' } }),
    prisma.task.findMany({ where: { assigneeId: memberId, deletedAt: null, OR: [{ dueAt: { gte: start, lt: end } }, { completedAt: { gte: start, lt: end } }] }, include: { team: { select: { name: true } } } }),
  ])
  return {
    title: `Member report: ${subject.fullName}`,
    scopeLabel: subject.fullName,
    period: formatPeriod(month),
    tables: [
      { name: 'Metrics', columns: [{ key: 'member', label: 'Member' }, ...METRIC_COLUMNS], rows: [{ member: subject.fullName, ...(await metricRow(m)) }] },
      { name: 'Tasks summary', columns: TASK_COLUMNS, rows: [{ member: subject.fullName, assigned: t.assigned, completed: t.completed, onTime: t.onTimeRate, overdue: t.overdueNow, cycle: t.avgCycleDays }] },
      ledgerTable('Donations', donationRows),
      {
        name: 'Outreach',
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'donor', label: 'Donor' },
          { key: 'channel', label: 'Channel' },
          { key: 'outcome', label: 'Outcome' },
          { key: 'promised', label: 'Promised', kind: 'pkr' },
        ],
        rows: outreachRows.map((row) => ({ date: formatDate(row.contactedAt), donor: row.donor.fullName, channel: row.channel, outcome: row.outcome, promised: row.promisedAmount })),
      },
      {
        name: 'Tasks',
        columns: [
          { key: 'title', label: 'Task' },
          { key: 'team', label: 'Team' },
          { key: 'status', label: 'Status' },
          { key: 'due', label: 'Due' },
        ],
        rows: tasks.map((task) => ({ title: task.title, team: task.team.name, status: task.status, due: formatDate(task.dueAt) })),
      },
    ],
  }
}

/** 7. Onboarding report: applicants, approvals, time to approval, checklist completion. */
async function onboarding(viewer: ActiveViewer, params: ReportParams, month: string): Promise<Report> {
  if (scopeFor(viewer, 'onboarding', 'view') !== 'all' && !viewer.isAdmin) throw new ReportNotFound()
  const { start, end } = monthRange(month)
  const applicants = await prisma.member.findMany({
    where: { OR: [{ createdAt: { gte: start, lt: end } }, { joinedAt: { gte: start, lt: end } }] },
    include: { onboarding: { where: { item: { isActive: true } }, select: { doneAt: true } }, ndaSignatures: { orderBy: { signedAt: 'asc' }, take: 1, select: { signedAt: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return {
    title: 'Onboarding report',
    scopeLabel: 'Applicants and new members',
    period: formatPeriod(month),
    tables: [
      {
        name: 'Applicants',
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'applied', label: 'Applied' },
          { key: 'status', label: 'Status' },
          { key: 'approved', label: 'Approved' },
          { key: 'daysToApproval', label: 'Days to approval', kind: 'number' },
          { key: 'checklist', label: 'Checklist', kind: 'percent' },
        ],
        rows: applicants.map((applicant) => ({
          name: applicant.fullName,
          applied: formatDate(applicant.createdAt),
          status: applicant.status,
          approved: formatDate(applicant.joinedAt),
          daysToApproval: applicant.joinedAt ? daysBetween(applicant.createdAt, applicant.joinedAt) : null,
          checklist: applicant.onboarding.length ? applicant.onboarding.filter((row) => row.doneAt).length / applicant.onboarding.length : null,
        })),
      },
    ],
  }
}

// ---------- List-page exports (same filters and scope as the page) ----------

async function membersList(viewer: ActiveViewer, params: ReportParams, month: string): Promise<Report> {
  const visible = await visibleMemberIds(viewer, 'members', 'view')
  const where: Prisma.MemberWhereInput = {
    id: visible === 'all' ? undefined : { in: visible },
    deletedAt: null,
    status: params.status ? (params.status as 'ACTIVE') : { in: ['ACTIVE', 'INACTIVE'] },
    ...(params.q ? { fullName: { contains: params.q, mode: 'insensitive' } } : {}),
    ...(params.team ? { teams: { some: { teamId: params.team } } } : {}),
    ...(params.lead ? { reportsToId: params.lead } : {}),
  }
  const list = await prisma.member.findMany({
    where,
    orderBy: { fullName: 'asc' },
    include: { reportsTo: { select: { fullName: true } }, teams: { include: { team: true } }, user: { select: { roles: { include: { role: true } } } } },
  })
  const metrics = await memberMetrics(list.map((m) => m.id), month)
  return {
    title: 'Members',
    scopeLabel: 'Members you can see',
    period: formatPeriod(month),
    tables: [
      {
        name: 'Members',
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'lead', label: 'Lead' },
          { key: 'teams', label: 'Teams' },
          { key: 'roles', label: 'Roles' },
          { key: 'status', label: 'Status' },
          { key: 'joined', label: 'Joined' },
          { key: 'raised', label: 'Raised this month', kind: 'pkr' },
          { key: 'target', label: 'Target', kind: 'pkr' },
        ],
        rows: list.map((m) => ({
          name: m.fullName,
          lead: m.reportsTo?.fullName ?? null,
          teams: m.teams.map((t) => t.team.name).join(', '),
          roles: m.user.roles.map((r) => r.role.name).join(', '),
          status: m.status,
          joined: formatDate(m.joinedAt),
          raised: metrics.get(m.id)?.raised ?? 0,
          target: metrics.get(m.id)?.amountTarget ?? null,
        })),
      },
    ],
  }
}

async function donorsList(viewer: ActiveViewer, params: ReportParams): Promise<Report> {
  const list = await prisma.donor.findMany({
    where: { AND: [await donorWhere(viewer), params.q ? { fullName: { contains: params.q, mode: 'insensitive' } } : {}] },
    include: { links: { where: { historical: false }, include: { member: { select: { fullName: true } } } }, outreach: { orderBy: { contactedAt: 'desc' }, take: 1, select: { contactedAt: true } } },
    orderBy: { fullName: 'asc' },
  })
  return {
    title: 'Donors',
    scopeLabel: 'Donors you can see',
    period: 'All time',
    tables: [
      {
        name: 'Donors',
        columns: [
          { key: 'name', label: 'Name' },
          // Phones are shown on the donors pages to these viewers, so they may export them (§10.3).
          { key: 'phone', label: 'Phone' },
          { key: 'city', label: 'City' },
          { key: 'linked', label: 'Linked members' },
          { key: 'lastContact', label: 'Last contacted' },
        ],
        rows: list.map((donor) => ({ name: donor.fullName, phone: donor.phone, city: donor.city, linked: donor.links.map((l) => l.member.fullName).join(', '), lastContact: formatDate(donor.outreach[0]?.contactedAt) })),
      },
    ],
  }
}

async function outreachList(viewer: ActiveViewer): Promise<Report> {
  const rows = await prisma.outreach.findMany({
    where: await outreachWhere(viewer),
    include: { donor: { select: { fullName: true } }, member: { select: { fullName: true } }, case: { select: { title: true } } },
    orderBy: { contactedAt: 'desc' },
  })
  return {
    title: 'Outreach',
    scopeLabel: 'Outreach you can see',
    period: 'All time',
    tables: [
      {
        name: 'Outreach',
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'member', label: 'Member' },
          { key: 'donor', label: 'Donor' },
          { key: 'case', label: 'Case' },
          { key: 'channel', label: 'Channel' },
          { key: 'outcome', label: 'Outcome' },
          { key: 'promised', label: 'Promised', kind: 'pkr' },
          { key: 'followUp', label: 'Follow up' },
        ],
        rows: rows.map((row) => ({ date: formatDate(row.contactedAt), member: row.member.fullName, donor: row.donor.fullName, case: row.case?.title ?? null, channel: row.channel, outcome: row.outcome, promised: row.promisedAmount, followUp: formatDate(row.followUpAt) })),
      },
    ],
  }
}

async function tasksList(viewer: ActiveViewer, params: ReportParams): Promise<Report> {
  const rows = await prisma.task.findMany({
    where: {
      AND: [
        await taskWhere(viewer),
        params.teamId ? { teamId: params.teamId } : {},
        params.assigneeId ? { assigneeId: params.assigneeId } : {},
        params.mine ? { assigneeId: viewer.memberId } : {},
        params.status && params.status !== 'ALL' ? { status: params.status as 'TODO' } : params.status ? {} : { status: { notIn: ['DONE', 'CANCELLED'] } },
        params.priority ? { priority: params.priority as 'LOW' } : {},
      ],
    },
    include: { team: { select: { name: true } }, assignee: { select: { fullName: true } } },
    orderBy: { dueAt: 'asc' },
  })
  return {
    title: 'Tasks',
    scopeLabel: 'Tasks you can see',
    period: 'Current',
    tables: [
      {
        name: 'Tasks',
        columns: [
          { key: 'title', label: 'Task' },
          { key: 'team', label: 'Team' },
          { key: 'assignee', label: 'Assignee' },
          { key: 'status', label: 'Status' },
          { key: 'priority', label: 'Priority' },
          { key: 'due', label: 'Due' },
          { key: 'completed', label: 'Completed' },
        ],
        rows: rows.map((task) => ({ title: task.title, team: task.team.name, assignee: task.assignee?.fullName ?? null, status: task.status, priority: task.priority, due: formatDate(task.dueAt), completed: formatDate(task.completedAt) })),
      },
    ],
  }
}

export async function buildReport(viewer: ActiveViewer, key: ReportKey, params: ReportParams, currentMonth: string): Promise<Report> {
  const month = monthParam(params, currentMonth)
  switch (key) {
    case 'impact':
      return impact(viewer, params, month)
    case 'cases':
      return cases(viewer, params)
    case 'donations':
      return donations(viewer, params)
    case 'event':
      return event(viewer, params)
    case 'team':
      return team(viewer, params, month)
    case 'member':
      return member(viewer, params, month)
    case 'onboarding':
      return onboarding(viewer, params, month)
    case 'members':
      return membersList(viewer, params, month)
    case 'donors':
      return donorsList(viewer, params)
    case 'outreach':
      return outreachList(viewer)
    case 'tasks':
      return tasksList(viewer, params)
    default:
      throw new ReportNotFound()
  }
}

export function formatCell(value: Cell, kind: ColumnKind = 'text') {
  if (value === null || value === undefined || value === '') return '—'
  if (kind === 'pkr' && typeof value === 'number') return `PKR ${value.toLocaleString('en-PK')}`
  if (kind === 'percent' && typeof value === 'number') return formatRatio(value)
  if (kind === 'number' && typeof value === 'number') return value.toLocaleString('en-PK')
  return String(value)
}
