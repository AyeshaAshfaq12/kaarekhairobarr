import { describe, expect, it } from 'vitest'
import {
  computeMoneyMetrics,
  computeTaskMetrics,
  formatRatio,
  isOverdue,
  monthSeries,
  previousMonth,
  statusBand,
  type DonationRow,
  type OutreachRow,
} from '@/lib/portal/metrics-core'
import { summarize } from '@/lib/portal/events'

// Fixture for one month. Alice and Bob are in the same team.
//   Alice reached d1, d2, d3 (d2 promised 5000); Bob reached d3, d4.
//   don1: d1 → 3000 verified, credited Alice
//   don2: d2 → 4000 verified, credited Alice AND Bob (co-credit)
//   don3: d3 → 2000 pending,  credited Alice
//   don4: d4 → 1000 rejected, credited Bob (loader excludes rejected, kept here to prove it's ignored)
const outreach: OutreachRow[] = [
  { memberId: 'alice', donorId: 'd1', promisedAmount: null },
  { memberId: 'alice', donorId: 'd2', promisedAmount: 5000 },
  { memberId: 'alice', donorId: 'd3', promisedAmount: null },
  { memberId: 'alice', donorId: 'd3', promisedAmount: null }, // contacted twice: still one donor
  { memberId: 'bob', donorId: 'd3', promisedAmount: null },
  { memberId: 'bob', donorId: 'd4', promisedAmount: null },
]
const donations: DonationRow[] = [
  { id: 'don1', donorId: 'd1', amount: 3000, status: 'VERIFIED', creditedMemberIds: ['alice'] },
  { id: 'don2', donorId: 'd2', amount: 4000, status: 'VERIFIED', creditedMemberIds: ['alice', 'bob'] },
  { id: 'don3', donorId: 'd3', amount: 2000, status: 'PENDING', creditedMemberIds: ['alice'] },
  { id: 'don4', donorId: 'd4', amount: 1000, status: 'REJECTED', creditedMemberIds: ['bob'] },
]

describe('member metrics (§9.2)', () => {
  const alice = computeMoneyMetrics({ memberIds: new Set(['alice']), outreach, donations, amountTarget: 10000, outreachTarget: 4, priorDonorIds: new Set(['d1']) })
  const bob = computeMoneyMetrics({ memberIds: new Set(['bob']), outreach, donations, amountTarget: 8000 })

  it('Reached = distinct donors with outreach by the member', () => {
    expect(alice.reached).toBe(3)
    expect(bob.reached).toBe(2)
  })

  it('Converted = distinct donors with a verified donation credited to the member', () => {
    expect(alice.converted).toBe(2)
    expect(bob.converted).toBe(1)
  })

  it('Conversion rate = converted ÷ reached, "—" when nobody was reached', () => {
    expect(alice.conversionRate).toBeCloseTo(2 / 3)
    const none = computeMoneyMetrics({ memberIds: new Set(['carol']), outreach, donations })
    expect(none.conversionRate).toBeNull()
    expect(formatRatio(none.conversionRate)).toBe('—')
  })

  it('Raised counts verified only; pending is separate; rejected never counts', () => {
    expect(alice.raised).toBe(7000)
    expect(alice.pending).toBe(2000)
    expect(bob.raised).toBe(4000)
    expect(bob.pending).toBe(0)
  })

  it('a co-credited donation adds the full amount to each credited member', () => {
    expect(alice.raised + bob.raised).toBe(11000) // 4000 counted for both
  })

  it('Achievement = raised ÷ target, "—" without a target', () => {
    expect(alice.achievement).toBeCloseTo(0.7)
    expect(computeMoneyMetrics({ memberIds: new Set(['alice']), outreach, donations }).achievement).toBeNull()
  })

  it('Outreach achievement = reached ÷ outreach target', () => {
    expect(alice.outreachAchievement).toBeCloseTo(3 / 4)
  })

  it('Promised vs paid: promised amounts vs raised from those donors', () => {
    expect(alice.promised).toBe(5000)
    expect(alice.paidFromPromised).toBe(4000)
  })

  it('Average gift = raised ÷ count of verified donations credited', () => {
    expect(alice.verifiedCount).toBe(2)
    expect(alice.averageGift).toBe(3500)
  })

  it('Repeat donors = converted donors who also gave in an earlier month', () => {
    expect(alice.repeatDonors).toBe(1)
  })
})

describe('group rollups (§9.3)', () => {
  const team = computeMoneyMetrics({ memberIds: new Set(['alice', 'bob']), outreach, donations, amountTarget: 20000 })

  it('counts each donation once, even when several members are credited', () => {
    expect(team.raised).toBe(7000) // not 11000
    expect(team.verifiedCount).toBe(2)
  })

  it('Reached and Converted are distinct donors across the group', () => {
    expect(team.reached).toBe(4) // d1, d2, d3, d4
    expect(team.converted).toBe(2)
  })

  it('a pending donation never appears in Raised or Achievement', () => {
    expect(team.pending).toBe(2000)
    expect(team.achievement).toBeCloseTo(7000 / 20000)
  })
})

describe('status bands', () => {
  const thresholds = { onTrack: 100, close: 70 }
  it.each([
    [1.2, 'ON_TRACK'],
    [1, 'ON_TRACK'],
    [0.99, 'CLOSE'],
    [0.7, 'CLOSE'],
    [0.69, 'BEHIND'],
  ])('achievement %s → %s', (achievement, band) => {
    expect(statusBand(achievement, thresholds)).toBe(band)
  })
  it('no target → no band', () => expect(statusBand(null, thresholds)).toBeNull())
  it('respects edited thresholds', () => expect(statusBand(0.85, { onTrack: 90, close: 80 })).toBe('CLOSE'))
})

describe('task metrics (§6.3)', () => {
  const now = new Date('2026-10-20T12:00:00Z')
  const day = (d: number) => new Date(Date.UTC(2026, 9, d, 12))
  const tasksDueInMonth = [
    { assigneeId: 'alice', status: 'DONE', dueAt: day(10), createdAt: day(1), completedAt: day(9) }, // on time, 8 days
    { assigneeId: 'alice', status: 'DONE', dueAt: day(10), createdAt: day(5), completedAt: day(12) }, // late, 7 days
    { assigneeId: 'alice', status: 'IN_PROGRESS', dueAt: day(15), createdAt: day(1), completedAt: null }, // overdue
    { assigneeId: 'bob', status: 'DONE', dueAt: day(10), createdAt: day(1), completedAt: day(2) },
  ]
  const metrics = computeTaskMetrics({ memberIds: new Set(['alice']), tasksDueInMonth, openTasks: tasksDueInMonth.filter((t) => t.status !== 'DONE'), now })

  it('Assigned / Completed count tasks due in the month', () => {
    expect(metrics.assigned).toBe(3)
    expect(metrics.completed).toBe(2)
  })
  it('On-time rate = completed by the due date ÷ completed', () => expect(metrics.onTimeRate).toBe(0.5))
  it('Overdue now = open tasks past due', () => expect(metrics.overdueNow).toBe(1))
  it('Avg cycle time = mean completedAt − createdAt in days', () => expect(metrics.avgCycleDays).toBe(7.5))
  it('DONE and CANCELLED are never overdue', () => {
    expect(isOverdue({ dueAt: day(1), status: 'DONE' }, now)).toBe(false)
    expect(isOverdue({ dueAt: day(1), status: 'CANCELLED' }, now)).toBe(false)
    expect(isOverdue({ dueAt: day(1), status: 'BLOCKED' }, now)).toBe(true)
  })
})

describe('event summary (§8.4)', () => {
  const s = summarize({ target: 200_000, collected: 35_000, pending: 25_000, budget: 150_000, spent: 75_000, awaiting: 60_000 })
  it('net = collected − spent', () => expect(s.net).toBe(-40_000))
  it('collection vs target and spend vs budget', () => {
    expect(s.collectionVsTarget).toBeCloseTo(0.175)
    expect(s.spendVsBudget).toBeCloseTo(0.5)
  })
  it('handles zero target/budget', () => {
    const zero = summarize({ target: 0, collected: 0, pending: 0, budget: 0, spent: 0, awaiting: 0 })
    expect(zero.collectionVsTarget).toBeNull()
    expect(zero.spendVsBudget).toBeNull()
  })
})

describe('month helpers', () => {
  it('previousMonth crosses years', () => {
    expect(previousMonth('2026-01')).toBe('2025-12')
    expect(previousMonth('2026-03', 3)).toBe('2025-12')
  })
  it('monthSeries is oldest first', () => expect(monthSeries('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02']))
})
