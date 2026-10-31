// Pure metric definitions (§9.2, §9.3, §6.3). No DB access: the server layer loads rows and
// hands them here, so every definition is unit-tested in isolation.

export type OutreachRow = {
  memberId: string
  donorId: string
  promisedAmount: number | null
}

export type DonationRow = {
  id: string
  donorId: string
  amount: number
  status: 'PENDING' | 'VERIFIED' | 'REJECTED'
  creditedMemberIds: string[]
}

export type TaskRow = {
  assigneeId: string | null
  status: string
  dueAt: Date | null
  createdAt: Date
  completedAt: Date | null
}

export type MoneyMetrics = {
  reached: number
  converted: number
  conversionRate: number | null // null renders as "—"
  raised: number
  pending: number
  verifiedCount: number
  averageGift: number | null
  amountTarget: number | null
  achievement: number | null // raised ÷ target, as a fraction
  outreachTarget: number | null
  outreachAchievement: number | null
  promised: number
  paidFromPromised: number
  repeatDonors: number
}

export type TaskMetrics = {
  assigned: number
  completed: number
  onTimeRate: number | null
  overdueNow: number
  avgCycleDays: number | null
}

export type Band = 'ON_TRACK' | 'CLOSE' | 'BEHIND'

const ratio = (numerator: number, denominator: number | null | undefined) =>
  denominator ? numerator / denominator : null

/**
 * Metrics for a set of members over one month.
 * - For one member, pass a single-id set: credited donations count in full (§4).
 * - For a subtree/team/org, pass the whole set: each donation counts once (distinct id) and
 *   Reached/Converted are distinct donors across the group (§9.3). Never sum credits.
 * Inputs must already be limited to the month (by contactedAt / receivedAt in Asia/Karachi).
 */
export function computeMoneyMetrics(input: {
  memberIds: ReadonlySet<string>
  outreach: OutreachRow[]
  donations: DonationRow[]
  amountTarget?: number | null
  outreachTarget?: number | null
  /** Donors with a verified donation in any earlier month. */
  priorDonorIds?: ReadonlySet<string>
}): MoneyMetrics {
  const { memberIds } = input
  const outreach = input.outreach.filter((row) => memberIds.has(row.memberId))
  const credited = new Map<string, DonationRow>()
  for (const donation of input.donations) {
    if (donation.creditedMemberIds.some((id) => memberIds.has(id))) credited.set(donation.id, donation)
  }
  const verified = [...credited.values()].filter((donation) => donation.status === 'VERIFIED')
  const pendingRows = [...credited.values()].filter((donation) => donation.status === 'PENDING')

  const reachedDonors = new Set(outreach.map((row) => row.donorId))
  const convertedDonors = new Set(verified.map((donation) => donation.donorId))
  const raised = verified.reduce((sum, donation) => sum + donation.amount, 0)

  const promisedDonors = new Set(outreach.filter((row) => row.promisedAmount).map((row) => row.donorId))
  const promised = outreach.reduce((sum, row) => sum + (row.promisedAmount ?? 0), 0)
  const paidFromPromised = verified.filter((donation) => promisedDonors.has(donation.donorId)).reduce((sum, donation) => sum + donation.amount, 0)

  const amountTarget = input.amountTarget ?? null
  const outreachTarget = input.outreachTarget ?? null
  const prior = input.priorDonorIds ?? new Set<string>()

  return {
    reached: reachedDonors.size,
    converted: convertedDonors.size,
    conversionRate: ratio(convertedDonors.size, reachedDonors.size),
    raised,
    pending: pendingRows.reduce((sum, donation) => sum + donation.amount, 0),
    verifiedCount: verified.length,
    averageGift: verified.length ? Math.round(raised / verified.length) : null,
    amountTarget,
    achievement: ratio(raised, amountTarget),
    outreachTarget,
    outreachAchievement: ratio(reachedDonors.size, outreachTarget),
    promised,
    paidFromPromised,
    repeatDonors: [...convertedDonors].filter((donorId) => prior.has(donorId)).length,
  }
}

/** Task metrics (§6.3). Tasks must be those with dueAt in the month, plus open overdue ones. */
export function computeTaskMetrics(input: { memberIds: ReadonlySet<string>; tasksDueInMonth: TaskRow[]; openTasks: TaskRow[]; now?: Date }): TaskMetrics {
  const now = input.now ?? new Date()
  const mine = (task: TaskRow) => !!task.assigneeId && input.memberIds.has(task.assigneeId)
  const assigned = input.tasksDueInMonth.filter(mine)
  const completed = assigned.filter((task) => task.status === 'DONE')
  const onTime = completed.filter((task) => task.completedAt && task.dueAt && task.completedAt <= task.dueAt)
  const cycle = completed.filter((task) => task.completedAt).map((task) => (task.completedAt!.getTime() - task.createdAt.getTime()) / 86_400_000)
  return {
    assigned: assigned.length,
    completed: completed.length,
    onTimeRate: ratio(onTime.length, completed.length),
    overdueNow: input.openTasks.filter((task) => mine(task) && isOverdue(task, now)).length,
    avgCycleDays: cycle.length ? Math.round((cycle.reduce((a, b) => a + b, 0) / cycle.length) * 10) / 10 : null,
  }
}

export function isOverdue(task: { dueAt: Date | null; status: string }, now: Date = new Date()) {
  return !!task.dueAt && task.dueAt < now && task.status !== 'DONE' && task.status !== 'CANCELLED'
}

/** Status band (§9.2). Thresholds are percentages from Settings. No target → no band. */
export function statusBand(achievement: number | null, thresholds: { onTrack: number; close: number }): Band | null {
  if (achievement === null) return null
  const percent = achievement * 100
  if (percent >= thresholds.onTrack) return 'ON_TRACK'
  if (percent >= thresholds.close) return 'CLOSE'
  return 'BEHIND'
}

export function formatRatio(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`
}

export function previousMonth(month: string, count = 1) {
  const [year, m] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, m - 1 - count, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * The period just before `period`, of the same length: "2026-03" → "2026-02",
 * "2026-01..2026-03" → "2025-10..2025-12".
 */
export function previousPeriod(period: string) {
  const [first, last] = period.split('..')
  if (!last) return previousMonth(first)
  const [fy, fm] = first.split('-').map(Number)
  const [ly, lm] = last.split('-').map(Number)
  const length = (ly - fy) * 12 + (lm - fm) + 1
  return `${previousMonth(first, length)}..${previousMonth(first)}`
}

/** The last `count` months ending with `month`, oldest first. */
export function monthSeries(month: string, count: number) {
  return Array.from({ length: count }, (_, index) => previousMonth(month, count - 1 - index))
}
