import { prisma } from '@/lib/portal/db'
import { eventWhere } from '@/lib/portal/events'
import { fileResponse, notFoundResponse } from '@/lib/portal/file-response'
import { can, getViewer } from '@/lib/portal/rbac'

// Receipts: anyone who can see the event, plus expense approvers.
export async function GET(_: Request, { params }: { params: { expenseId: string } }) {
  const viewer = await getViewer()
  if (!viewer || viewer.status !== 'ACTIVE') return notFoundResponse()
  const expense = await prisma.expense.findUnique({ where: { id: params.expenseId }, select: { receiptKey: true, eventId: true } })
  if (!expense) return notFoundResponse()
  const visible = can(viewer, 'expenses', 'approve') || (await prisma.event.count({ where: { AND: [{ id: expense.eventId }, await eventWhere(viewer)] } })) > 0
  if (!visible) return notFoundResponse()
  return fileResponse(expense.receiptKey)
}
