import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/portal/db'
import { EXPENSE_CATEGORIES, canManageEvent, canSubmitExpense, eventSummary, eventWhere } from '@/lib/portal/events'
import { formatRatio } from '@/lib/portal/metrics-core'
import { can, requireActiveViewer } from '@/lib/portal/rbac'
import { formatDate, formatDateTime, formatPKR, toDateInput } from '@/lib/portal/time'
import { ActionForm, Field, SubmitButton } from '@/components/portal/ActionForm'
import { Badge, Card, EmptyState, PageHeader, TASK_STATUS_TONE, humanize, type BadgeTone } from '@/components/portal/ui'
import type { ReactNode } from 'react'
import EventForm from '../EventForm'
import {
  addResponsibilityAction,
  deleteExpenseAction,
  reimburseExpenseAction,
  reopenExpenseAction,
  reviewExpenseAction,
  saveSurplusNoteAction,
  setEventStatusAction,
  setResponsibilityStatusAction,
  submitExpenseAction,
} from '../actions'

export const metadata: Metadata = { title: 'Event | KKB Portal' }

const EXPENSE_TONE: Record<string, BadgeTone> = { SUBMITTED: 'amber', APPROVED: 'green', REJECTED: 'red', REIMBURSED: 'blue' }

export default async function EventPage({ params, searchParams }: { params: { id: string }; searchParams: { edit?: string } }) {
  const viewer = await requireActiveViewer()
  const event = await prisma.event.findFirst({
    where: { AND: [{ id: params.id }, await eventWhere(viewer)] },
    include: {
      lead: { select: { id: true, fullName: true } },
      case: true,
      responsibilities: { include: { member: { select: { fullName: true } } }, orderBy: { createdAt: 'asc' } },
      tasks: { where: { deletedAt: null }, include: { assignee: { select: { fullName: true } } }, orderBy: { dueAt: 'asc' } },
      expenses: { include: { paidBy: { select: { fullName: true } } }, orderBy: { spentAt: 'desc' } },
    },
  })
  if (!event) notFound()

  const [summary, manage, canExpense, collections, members] = await Promise.all([
    eventSummary(event.id),
    canManageEvent(viewer, event),
    canSubmitExpense(viewer, event),
    event.case
      ? prisma.donationCredit.findMany({ where: { donation: { caseId: event.case.id, status: 'VERIFIED' } }, include: { member: { select: { id: true, fullName: true } }, donation: { select: { amount: true } } } })
      : [],
    prisma.member.findMany({ where: { status: 'ACTIVE' }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } }),
  ])
  const canApprove = can(viewer, 'expenses', 'approve')
  const overBudget = summary.spent + summary.awaitingApproval > summary.budget

  // Collection by member: verified credits on the event case (each credited member in full).
  const byMember = new Map<string, { name: string; amount: number }>()
  for (const credit of collections) {
    const entry = byMember.get(credit.member.id) ?? { name: credit.member.fullName, amount: 0 }
    entry.amount += credit.donation.amount
    byMember.set(credit.member.id, entry)
  }

  if (searchParams.edit && manage) {
    return (
      <>
        <PageHeader title={`Edit: ${event.name}`} actions={<Link href={`/portal/events/${event.id}`} className="btn-outline">Cancel</Link>} />
        <Card className="max-w-3xl">
          <EventForm event={{ ...event, collectionTarget: event.case?.targetAmount ?? 0 }} selfId={viewer.memberId} canChangeLead={viewer.isAdmin} />
        </Card>
      </>
    )
  }

  const summaryRows: [string, ReactNode][] = [
    ['Collection target', formatPKR(summary.collectionTarget)],
    ['Collected (verified)', formatPKR(summary.collected)],
    ['Pending collection', formatPKR(summary.pendingCollection)],
    ['Budget', formatPKR(summary.budget)],
    ['Spent (approved)', formatPKR(summary.spent)],
    ['Awaiting approval', formatPKR(summary.awaitingApproval)],
    ['Net', <span key="net" className={summary.net >= 0 ? 'font-semibold text-forest-700' : 'font-semibold text-clay-600'}>{summary.net >= 0 ? 'Surplus ' : 'Deficit '}{formatPKR(Math.abs(summary.net))}</span>],
    ['Collection vs target', formatRatio(summary.collectionVsTarget)],
    ['Spend vs budget', formatRatio(summary.spendVsBudget)],
  ]

  return (
    <>
      <PageHeader
        title={event.name}
        eyebrow={humanize(event.status)}
        description={`${formatDateTime(event.startsAt)}${event.venue ? ` · ${event.venue}` : ''} · lead ${event.lead.fullName}`}
        actions={
          <>
            {event.case && ['OPEN', 'FUNDED'].includes(event.case.status) ? <Link href={`/portal/donations/new?caseId=${event.case.id}`} className="btn-primary">Log collection</Link> : null}
            {<a href={`/api/portal/export/event?eventId=${event.id}&format=pdf`} className="btn-outline">Summary PDF</a>}
            {manage ? <Link href={`/portal/events/${event.id}?edit=1`} className="btn-outline">Edit</Link> : null}
          </>
        }
      />
      {event.description ? <p className="mb-5 whitespace-pre-line text-sm text-ink-700">{event.description}</p> : null}

      <div className="grid gap-5 lg:grid-cols-[2fr_3fr]">
        <div className="space-y-5">
          <Card title="Summary">
            <dl className="divide-y divide-ink-900/5 text-sm">
              {summaryRows.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3 py-2">
                  <dt className="text-ink-600">{label}</dt>
                  <dd className="text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            {overBudget ? <p className="mt-3 rounded-2xl bg-clay-50 px-3 py-2 text-xs font-medium text-clay-700">Over budget: approved + submitted expenses exceed the budget.</p> : null}
            {event.surplusNote ? <p className="mt-3 text-xs text-ink-600">Note: {event.surplusNote}</p> : null}
            {event.case ? (
              <Link href={`/portal/cases/${event.case.id}`} className="mt-3 inline-block text-xs font-medium text-forest-700 underline">
                Open the collection case
              </Link>
            ) : null}
          </Card>

          {manage && ['PLANNING', 'LIVE'].includes(event.status) ? (
            <Card title="Status">
              <div className="flex flex-wrap gap-2">
                {(event.status === 'PLANNING' ? ['LIVE', 'CANCELLED'] : ['COMPLETED', 'CANCELLED']).map((status) => (
                  <ActionForm key={status} action={setEventStatusAction} confirm={status === 'CANCELLED' ? 'Cancel this event? Its collection case is cancelled too.' : undefined}>
                    <input type="hidden" name="eventId" value={event.id} />
                    <input type="hidden" name="status" value={status} />
                    <SubmitButton variant={status === 'CANCELLED' ? 'outline' : 'secondary'}>{status === 'LIVE' ? 'Go live' : humanize(status)}</SubmitButton>
                  </ActionForm>
                ))}
              </div>
            </Card>
          ) : null}

          {viewer.isAdmin ? (
            <Card title="Surplus note (Admin)">
              <ActionForm action={saveSurplusNoteAction} className="space-y-2">
                <input type="hidden" name="eventId" value={event.id} />
                <Field label="e.g. surplus moved to Dialysis case" name="surplusNote">
                  <input id="surplusNote" name="surplusNote" defaultValue={event.surplusNote ?? ''} className="field" />
                </Field>
                <SubmitButton variant="secondary">Save note</SubmitButton>
              </ActionForm>
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          <Card title="Who did what — responsibilities">
            {event.responsibilities.length === 0 ? <EmptyState>No responsibilities yet.</EmptyState> : null}
            <ul className="divide-y divide-ink-900/5 text-sm">
              {event.responsibilities.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">{item.title}</span> — {item.member.fullName}
                    {item.notes ? <span className="block text-xs text-ink-500">{item.notes}</span> : null}
                  </span>
                  {manage || item.memberId === viewer.memberId ? (
                    <ActionForm action={setResponsibilityStatusAction}>
                      <input type="hidden" name="responsibilityId" value={item.id} />
                      <select name="status" defaultValue={item.status} aria-label={`Status of ${item.title}`} className="rounded-xl border border-ink-900/10 bg-white px-2 py-1 text-xs">
                        {['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED'].map((status) => (
                          <option key={status} value={status}>
                            {humanize(status)}
                          </option>
                        ))}
                      </select>
                      <SubmitButton variant="outline" className="ml-1 !px-2 !py-1 text-xs">
                        Set
                      </SubmitButton>
                    </ActionForm>
                  ) : (
                    <Badge tone={TASK_STATUS_TONE[item.status]}>{humanize(item.status)}</Badge>
                  )}
                </li>
              ))}
            </ul>
            {manage ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-forest-700">+ Add responsibility</summary>
                <ActionForm action={addResponsibilityAction} className="mt-3 grid gap-2 sm:grid-cols-2" resetOnSuccess>
                  <input type="hidden" name="eventId" value={event.id} />
                  <Field label="Member" name="memberId">
                    <select id="memberId" name="memberId" defaultValue="" required className="field">
                      <option value="" disabled>
                        Choose…
                      </option>
                      {members.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.fullName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Responsibility" name="title">
                    <input id="title" name="title" placeholder="Venue booking, Food, Registration desk…" required className="field" />
                  </Field>
                  <Field label="Notes" name="notes" className="sm:col-span-2">
                    <input id="notes" name="notes" className="field" />
                  </Field>
                  <SubmitButton variant="secondary">Add</SubmitButton>
                </ActionForm>
              </details>
            ) : null}
          </Card>

          <Card title="Who did what — tasks" actions={manage ? <Link href={`/portal/tasks/new?eventId=${event.id}&back=/portal/events/${event.id}`} className="text-sm font-medium text-forest-700">+ Task</Link> : null}>
            {event.tasks.length === 0 ? (
              <EmptyState>No tasks linked.</EmptyState>
            ) : (
              <ul className="divide-y divide-ink-900/5 text-sm">
                {event.tasks.map((task) => (
                  <li key={task.id} className="flex items-center justify-between gap-2 py-2">
                    <Link href={`/portal/tasks/${task.id}`} className="hover:text-forest-700">
                      {task.title} <span className="text-xs text-ink-500">— {task.assignee?.fullName ?? 'unassigned'}</span>
                    </Link>
                    <Badge tone={TASK_STATUS_TONE[task.status]}>{humanize(task.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Who did what — collection by member">
            {byMember.size === 0 ? (
              <EmptyState>No verified collections yet.</EmptyState>
            ) : (
              <ul className="space-y-1 text-sm">
                {[...byMember.values()]
                  .sort((a, b) => b.amount - a.amount)
                  .map((entry) => (
                    <li key={entry.name} className="flex justify-between">
                      <span>{entry.name}</span>
                      <span className="font-semibold">{formatPKR(entry.amount)}</span>
                    </li>
                  ))}
              </ul>
            )}
          </Card>

          <Card title={`Expenses (${event.expenses.length})`}>
            {event.expenses.length === 0 ? <EmptyState>No expenses yet.</EmptyState> : null}
            <ul className="divide-y divide-ink-900/5 text-sm">
              {event.expenses.map((expense) => {
                const own = expense.submittedById === viewer.memberId || expense.paidById === viewer.memberId
                return (
                  <li key={expense.id} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <span className="font-medium">{expense.title}</span>{' '}
                        <span className="text-xs text-ink-500">
                          {expense.category} · {formatDate(expense.spentAt)} · paid by {expense.paidBy.fullName} ·{' '}
                          <a href={`/api/portal/files/expense-receipt/${expense.id}`} target="_blank" rel="noreferrer" className="underline">
                            receipt
                          </a>
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="font-semibold">{formatPKR(expense.amount)}</span>
                        <Badge tone={EXPENSE_TONE[expense.status]}>{humanize(expense.status)}</Badge>
                      </span>
                    </div>
                    {expense.rejectionReason ? <p className="mt-1 text-xs text-clay-700">Rejected: {expense.rejectionReason}</p> : null}
                    {expense.reviewNote ? <p className="mt-1 text-xs text-ink-500">Note: {expense.reviewNote}</p> : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {canApprove && !own && expense.status === 'SUBMITTED' ? (
                        <ActionForm action={reviewExpenseAction} className="flex flex-wrap items-center gap-2">
                          <input type="hidden" name="expenseId" value={expense.id} />
                          <input name="note" placeholder={overBudget ? 'Note (required: over budget)' : 'Note / rejection reason'} aria-label="Review note" className="field !w-56 !py-1.5 text-xs" />
                          <SubmitButton name="decision" value="APPROVED" className="!px-3 !py-1.5 text-xs">
                            Approve
                          </SubmitButton>
                          <SubmitButton name="decision" value="REJECTED" variant="outline" className="!px-3 !py-1.5 text-xs">
                            Reject
                          </SubmitButton>
                        </ActionForm>
                      ) : null}
                      {canApprove && !own && expense.status === 'APPROVED' ? (
                        <ActionForm action={reimburseExpenseAction}>
                          <input type="hidden" name="expenseId" value={expense.id} />
                          <SubmitButton variant="outline" className="!px-3 !py-1.5 text-xs">
                            Mark reimbursed
                          </SubmitButton>
                        </ActionForm>
                      ) : null}
                      {viewer.isAdmin && ['APPROVED', 'REIMBURSED'].includes(expense.status) ? (
                        <ActionForm action={reopenExpenseAction} className="flex items-center gap-2" confirm="Reopen this approved expense?">
                          <input type="hidden" name="expenseId" value={expense.id} />
                          <input name="reason" placeholder="Reason to reopen" required aria-label="Reason to reopen" className="field !w-44 !py-1.5 text-xs" />
                          <SubmitButton variant="outline" className="!px-3 !py-1.5 text-xs">
                            Reopen
                          </SubmitButton>
                        </ActionForm>
                      ) : null}
                      {(expense.submittedById === viewer.memberId || manage) && ['SUBMITTED', 'REJECTED'].includes(expense.status) ? (
                        <ActionForm action={deleteExpenseAction} confirm="Withdraw this expense?">
                          <input type="hidden" name="expenseId" value={expense.id} />
                          <SubmitButton variant="outline" className="!px-3 !py-1.5 text-xs">
                            Withdraw
                          </SubmitButton>
                        </ActionForm>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
            {canExpense && event.status !== 'CANCELLED' ? (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-forest-700">+ Log an expense</summary>
                <ActionForm action={submitExpenseAction} className="mt-3 grid gap-3 sm:grid-cols-2" resetOnSuccess>
                  <input type="hidden" name="eventId" value={event.id} />
                  <Field label="What for" name="title" htmlFor="expense-title" className="sm:col-span-2">
                    <input id="expense-title" name="title" required className="field" />
                  </Field>
                  <Field label="Category" name="category">
                    <select id="category" name="category" defaultValue="" required className="field">
                      <option value="" disabled>
                        Choose…
                      </option>
                      {EXPENSE_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Amount (PKR)" name="amount">
                    <input id="amount" name="amount" type="number" min={1} inputMode="numeric" required className="field" />
                  </Field>
                  <Field label="Spent on" name="spentAt">
                    <input id="spentAt" name="spentAt" type="date" defaultValue={toDateInput(new Date())} required className="field" />
                  </Field>
                  <Field label="Paid by" name="paidById">
                    <select id="paidById" name="paidById" defaultValue={viewer.memberId} className="field">
                      {members.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.fullName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Receipt" name="receipt" hint="Required. JPG, PNG or PDF up to 5 MB." className="sm:col-span-2">
                    <input id="receipt" name="receipt" type="file" accept="image/jpeg,image/png,application/pdf" required className="field" />
                  </Field>
                  <SubmitButton variant="secondary">Submit for approval</SubmitButton>
                </ActionForm>
              </details>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  )
}
