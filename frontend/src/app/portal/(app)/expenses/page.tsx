import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/portal/db'
import { can, requireActiveViewer } from '@/lib/portal/rbac'
import { formatDate, formatPKR } from '@/lib/portal/time'
import { Card, EmptyState, PageHeader } from '@/components/portal/ui'

export const metadata: Metadata = { title: 'Expenses awaiting approval | KKB Portal' }

/** Approval queue for expenses.approve holders (seeded: Admin, Finance). */
export default async function ExpensesPage() {
  const viewer = await requireActiveViewer()
  if (!can(viewer, 'expenses', 'approve') && !can(viewer, 'expenses', 'view')) notFound()
  const expenses = await prisma.expense.findMany({
    where: { status: 'SUBMITTED' },
    include: { event: { select: { id: true, name: true } }, paidBy: { select: { fullName: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return (
    <>
      <PageHeader title="Expenses awaiting approval" description="Approve or reject from the event page, where the budget and receipts are shown." />
      <Card className="p-0 sm:p-0">
        {expenses.length === 0 ? (
          <div className="p-4">
            <EmptyState>Nothing waiting.</EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-ink-900/5">
            {expenses.map((expense) => (
              <li key={expense.id}>
                <Link href={`/portal/events/${expense.event.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-cream-50/60 sm:px-6">
                  <span>
                    <span className="font-semibold">{expense.title}</span>
                    <span className="block text-xs text-ink-500">
                      {expense.event.name} · {expense.category} · {formatDate(expense.spentAt)} · paid by {expense.paidBy.fullName}
                    </span>
                  </span>
                  <span className="font-semibold">{formatPKR(expense.amount)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
