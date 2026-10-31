import 'server-only'
import type { Event, Prisma } from '@prisma/client'
import { prisma } from './db'
import { getSubtreeIds } from './hierarchy'
import { scopeFor, type Viewer } from './rbac'

/**
 * Events: assigned = I lead it or hold a responsibility; subtree = same for my subtree; all.
 * Whoever created an event (its case's creator) always sees it.
 */
export async function eventWhere(viewer: Viewer): Promise<Prisma.EventWhereInput> {
  const me = viewer.memberId ?? ''
  const scope = scopeFor(viewer, 'events', 'view')
  // Expense approvers (seeded: Finance) review on the event page, so they see every event.
  if (scope === 'all' || scopeFor(viewer, 'expenses', 'approve') === 'all' || scopeFor(viewer, 'expenses', 'view') === 'all') return { deletedAt: null }
  const people = scope === 'subtree' ? [...(await getSubtreeIds(me))] : [me]
  return {
    deletedAt: null,
    OR: [{ leadId: { in: people } }, { responsibilities: { some: { memberId: { in: people } } } }, { case: { createdById: me } }],
  }
}

/** The event lead, Admin, or someone with events.edit over it can manage it (§8.1). */
export async function canManageEvent(viewer: Viewer, event: Pick<Event, 'id' | 'leadId'>) {
  if (viewer.isAdmin || event.leadId === viewer.memberId) return true
  const scope = scopeFor(viewer, 'events', 'edit')
  if (scope === 'all') return true
  if (scope === 'subtree' && viewer.memberId) return (await getSubtreeIds(viewer.memberId)).has(event.leadId)
  return false
}

/** Expenses are logged by the event lead or anyone with a responsibility on the event (§8.3). */
export async function canSubmitExpense(viewer: Viewer, event: Pick<Event, 'id' | 'leadId'>) {
  if (await canManageEvent(viewer, event)) return true
  return (await prisma.eventResponsibility.count({ where: { eventId: event.id, memberId: viewer.memberId ?? '' } })) > 0
}

export const EXPENSE_CATEGORIES = ['Venue', 'Food', 'Transport', 'Printing', 'Supplies', 'Other'] as const

/** Over budget when approved + submitted expenses exceed the budget (§8.3). */
export function isOverBudget(summary: Pick<EventSummary, 'spent' | 'awaitingApproval' | 'budget'>) {
  return summary.spent + summary.awaitingApproval > summary.budget
}

export type EventSummary = {
  collectionTarget: number
  collected: number
  pendingCollection: number
  budget: number
  spent: number
  awaitingApproval: number
  net: number
  collectionVsTarget: number | null
  spendVsBudget: number | null
}

/** Pure §8.4 summary from totals. */
export function summarize(input: { target: number; collected: number; pending: number; budget: number; spent: number; awaiting: number }): EventSummary {
  return {
    collectionTarget: input.target,
    collected: input.collected,
    pendingCollection: input.pending,
    budget: input.budget,
    spent: input.spent,
    awaitingApproval: input.awaiting,
    net: input.collected - input.spent,
    collectionVsTarget: input.target ? input.collected / input.target : null,
    spendVsBudget: input.budget ? input.spent / input.budget : null,
  }
}

/**
 * Event summary (§8.4): collected = verified donations on the event's case; spent = approved +
 * reimbursed expenses; awaiting = submitted expenses.
 */
export async function eventSummary(eventId: string): Promise<EventSummary> {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, include: { case: true } })
  const [donations, expenses] = await Promise.all([
    event.case ? prisma.donation.groupBy({ by: ['status'], where: { caseId: event.case.id }, _sum: { amount: true } }) : [],
    prisma.expense.groupBy({ by: ['status'], where: { eventId }, _sum: { amount: true } }),
  ])
  const donationSum = (status: string) => donations.find((row) => row.status === status)?._sum.amount ?? 0
  const expenseSum = (...statuses: string[]) => expenses.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + (row._sum.amount ?? 0), 0)
  return summarize({
    target: event.case?.targetAmount ?? 0,
    collected: donationSum('VERIFIED'),
    pending: donationSum('PENDING'),
    budget: event.budget,
    spent: expenseSum('APPROVED', 'REIMBURSED'),
    awaiting: expenseSum('SUBMITTED'),
  })
}
