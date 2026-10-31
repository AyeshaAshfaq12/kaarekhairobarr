'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { prisma } from '@/lib/portal/db'
import { getRequestMeta } from '@/lib/portal/auth'
import { writeAudit } from '@/lib/portal/audit'
import { EXPENSE_CATEGORIES, canManageEvent, canSubmitExpense, eventSummary } from '@/lib/portal/events'
import { refreshCaseFunding } from '@/lib/portal/money'
import { notify, notifyMany } from '@/lib/portal/notify'
import { ForbiddenError, can, requireActiveViewer } from '@/lib/portal/rbac'
import { SYSTEM_ROLE } from '@/lib/portal/rbac/model'
import { storeUpload } from '@/lib/portal/storage'
import { parseKarachiDate } from '@/lib/portal/time'
import { runAction, UserError } from '@/lib/portal/action-utils'
import { formDataToObject, reasonSchema, type ActionState } from '@/lib/portal/validation'

const optional = z.string().trim().optional().transform((value) => value || null)
const rupees = (label: string) => z.coerce.number({ invalid_type_error: `Enter ${label}` }).int('Whole rupees only').min(0, `${label} can't be negative`)

const eventSchema = z.object({
  name: z.string().trim().min(3, 'Name is required').max(150),
  description: optional,
  startsAt: z.string().min(1, 'When is it?').transform((value) => new Date(`${value}:00+05:00`)),
  venue: optional,
  leadId: z.string().min(1, 'Choose the event lead'),
  budget: rupees('a budget'),
  collectionTarget: rupees('a collection target'),
})

async function loadManagedEvent(eventId: string) {
  const viewer = await requireActiveViewer()
  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { case: true } })
  if (!event || event.deletedAt) throw new UserError('Event not found.')
  if (!(await canManageEvent(viewer, event))) throw new ForbiddenError('Only the event lead or an Admin can do that.')
  return { viewer, event }
}

/** Creating an event creates its EVENT case in the same transaction (§4, §8.1). */
export async function saveEventAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const eventId = String(formData.get('eventId') ?? '')
    const input = eventSchema.parse(formDataToObject(formData))
    const lead = await prisma.member.findUnique({ where: { id: input.leadId }, select: { id: true, status: true, userId: true } })
    if (!lead || lead.status !== 'ACTIVE') return { ok: false, fieldErrors: { leadId: ['Choose an active member'] } }
    const { ip } = getRequestMeta()

    if (!eventId) {
      const viewer = await requireActiveViewer()
      if (!viewer.isAdmin && !can(viewer, 'events', 'create')) throw new ForbiddenError()
      const event = await prisma.$transaction(async (tx) => {
        const created = await tx.event.create({
          data: { name: input.name, description: input.description, startsAt: input.startsAt, venue: input.venue, leadId: lead.id, budget: input.budget },
        })
        const kase = await tx.case.create({
          data: {
            title: input.name,
            category: 'EVENT',
            description: input.description ?? `Collections for ${input.name}.`,
            targetAmount: input.collectionTarget,
            status: 'OPEN',
            startDate: input.startsAt,
            createdById: viewer.memberId,
            eventId: created.id,
          },
        })
        await writeAudit(tx, { actorId: viewer.userId, action: 'create', entity: 'Event', entityId: created.id, after: { ...created, caseId: kase.id, collectionTarget: input.collectionTarget }, ip })
        return created
      })
      if (lead.id !== viewer.memberId) await notify(lead.userId, 'ASSIGNED', { title: `You are the lead for "${event.name}"`, href: `/portal/events/${event.id}` })
      redirect(`/portal/events/${event.id}`)
    }

    const { viewer, event } = await loadManagedEvent(eventId)
    // Changing who leads the event is an Admin decision.
    if (input.leadId !== event.leadId && !viewer.isAdmin) throw new ForbiddenError('Only an Admin can change the event lead.')
    await prisma.$transaction(async (tx) => {
      const after = await tx.event.update({
        where: { id: event.id },
        data: { name: input.name, description: input.description, startsAt: input.startsAt, venue: input.venue, leadId: input.leadId, budget: input.budget },
      })
      // Editing the collection target updates the case (§8.1).
      if (event.case) {
        await tx.case.update({ where: { id: event.case.id }, data: { targetAmount: input.collectionTarget, title: input.name } })
        await refreshCaseFunding(tx, event.case.id)
      }
      await writeAudit(tx, {
        actorId: viewer.userId,
        action: 'update',
        entity: 'Event',
        entityId: event.id,
        before: { ...event, case: undefined, collectionTarget: event.case?.targetAmount },
        after: { ...after, collectionTarget: input.collectionTarget },
        ip,
      })
    })
    if (input.leadId !== event.leadId) await notify(lead.userId, 'ASSIGNED', { title: `You are now the lead for "${input.name}"`, href: `/portal/events/${event.id}` })
    revalidatePath(`/portal/events/${event.id}`)
    return { ok: true, message: 'Event saved.' }
  })
}

const NEXT_STATUS: Record<string, string[]> = { PLANNING: ['LIVE', 'CANCELLED'], LIVE: ['COMPLETED', 'CANCELLED'], COMPLETED: [], CANCELLED: [] }

export async function setEventStatusAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { viewer, event } = await loadManagedEvent(String(formData.get('eventId')))
    const status = z.enum(['LIVE', 'COMPLETED', 'CANCELLED']).parse(formData.get('status'))
    if (!NEXT_STATUS[event.status].includes(status)) throw new UserError(`A ${event.status.toLowerCase()} event can't become ${status.toLowerCase()}.`)
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      await tx.event.update({ where: { id: event.id }, data: { status } })
      // Ending the event ends its collection case too.
      if (event.case && status !== 'LIVE') await tx.case.update({ where: { id: event.case.id }, data: { status: status === 'COMPLETED' ? 'CLOSED' : 'CANCELLED', cancelReason: status === 'CANCELLED' ? 'Event cancelled' : null } })
      await writeAudit(tx, { actorId: viewer.userId, action: `status_${status.toLowerCase()}`, entity: 'Event', entityId: event.id, before: { status: event.status }, after: { status }, ip })
    })
    revalidatePath(`/portal/events/${event.id}`)
    return { ok: true, message: 'Status updated.' }
  })
}

/** Surplus handling is manual: Admin records a note (§8.4). */
export async function saveSurplusNoteAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    if (!viewer.isAdmin) throw new ForbiddenError()
    const eventId = String(formData.get('eventId'))
    const note = String(formData.get('surplusNote') ?? '').trim() || null
    const before = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { surplusNote: true } })
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      await tx.event.update({ where: { id: eventId }, data: { surplusNote: note } })
      await writeAudit(tx, { actorId: viewer.userId, action: 'surplus_note', entity: 'Event', entityId: eventId, before, after: { surplusNote: note }, ip })
    })
    revalidatePath(`/portal/events/${eventId}`)
    return { ok: true, message: 'Note saved.' }
  })
}

// ---------- Responsibilities (§8.2) ----------

export async function addResponsibilityAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { viewer, event } = await loadManagedEvent(String(formData.get('eventId')))
    const input = z
      .object({ memberId: z.string().min(1, 'Choose a member'), title: z.string().trim().min(2, 'What are they responsible for?').max(120), notes: optional })
      .parse(formDataToObject(formData))
    const member = await prisma.member.findUnique({ where: { id: input.memberId }, select: { status: true, userId: true } })
    if (member?.status !== 'ACTIVE') return { ok: false, fieldErrors: { memberId: ['Choose an active member'] } }
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      const created = await tx.eventResponsibility.create({ data: { eventId: event.id, ...input } })
      await writeAudit(tx, { actorId: viewer.userId, action: 'create', entity: 'EventResponsibility', entityId: created.id, after: created, ip })
    })
    if (input.memberId !== viewer.memberId) await notify(member.userId, 'ASSIGNED', { title: `"${input.title}" for ${event.name}`, body: input.notes ?? undefined, href: `/portal/events/${event.id}` })
    revalidatePath(`/portal/events/${event.id}`)
    return { ok: true, message: 'Responsibility added.' }
  })
}

export async function setResponsibilityStatusAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const item = await prisma.eventResponsibility.findUniqueOrThrow({ where: { id: String(formData.get('responsibilityId')) }, include: { event: true } })
    if (item.memberId !== viewer.memberId && !(await canManageEvent(viewer, item.event))) throw new ForbiddenError()
    const status = z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE', 'CANCELLED']).parse(formData.get('status'))
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      await tx.eventResponsibility.update({ where: { id: item.id }, data: { status } })
      await writeAudit(tx, { actorId: viewer.userId, action: 'status', entity: 'EventResponsibility', entityId: item.id, before: { status: item.status }, after: { status }, ip })
    })
    revalidatePath(`/portal/events/${item.eventId}`)
    return { ok: true }
  })
}

// ---------- Expenses (§8.3) ----------

const expenseSchema = z.object({
  title: z.string().trim().min(2, 'What was it for?').max(150),
  category: z.enum(EXPENSE_CATEGORIES, { errorMap: () => ({ message: 'Choose a category' }) }),
  amount: z.coerce.number({ invalid_type_error: 'Enter an amount' }).int('Whole rupees only').positive('Amount must be above 0'),
  spentAt: z.string().min(1, 'When was it spent?').transform(parseKarachiDate),
  paidById: z.string().min(1, 'Who paid?'),
})

async function approverUserIds() {
  const rows = await prisma.userRole.findMany({
    where: { role: { name: { in: [SYSTEM_ROLE.SUPER_ADMIN, SYSTEM_ROLE.ADMIN, SYSTEM_ROLE.FINANCE] } }, user: { disabledAt: null, member: { status: 'ACTIVE' } } },
    select: { userId: true },
  })
  return rows.map((row) => row.userId)
}

export async function submitExpenseAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const event = await prisma.event.findUnique({ where: { id: String(formData.get('eventId')) } })
    if (!event || event.deletedAt) throw new UserError('Event not found.')
    if (!(await canSubmitExpense(viewer, event))) throw new ForbiddenError('Only the event lead or members with a responsibility on this event can log expenses.')
    if (event.status === 'CANCELLED') throw new UserError('This event was cancelled.')
    const input = expenseSchema.parse(formDataToObject(formData))
    const receipt = formData.get('receipt')
    if (!(receipt instanceof File) || receipt.size === 0) return { ok: false, fieldErrors: { receipt: ['A receipt is required'] } }
    const payer = await prisma.member.findUnique({ where: { id: input.paidById }, select: { status: true } })
    if (payer?.status !== 'ACTIVE') return { ok: false, fieldErrors: { paidById: ['Choose an active member'] } }
    const receiptKey = await storeUpload(receipt, { uploadedById: viewer.userId, purpose: 'expense-receipt' })
    const { ip } = getRequestMeta()
    const expense = await prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({ data: { ...input, eventId: event.id, receiptKey, submittedById: viewer.memberId } })
      await writeAudit(tx, { actorId: viewer.userId, action: 'create', entity: 'Expense', entityId: created.id, after: created, ip })
      return created
    })
    await notifyMany(
      (await approverUserIds()).filter((userId) => userId !== viewer.userId),
      'EXPENSE_UPDATE',
      { title: `Expense submitted: PKR ${expense.amount.toLocaleString('en-PK')} for ${event.name}`, body: expense.title, href: '/portal/expenses' }
    )
    revalidatePath(`/portal/events/${event.id}`)
    return { ok: true, message: 'Expense submitted for approval.' }
  })
}

async function loadExpenseForReview(expenseId: string) {
  const viewer = await requireActiveViewer()
  if (!can(viewer, 'expenses', 'approve')) throw new ForbiddenError()
  const expense = await prisma.expense.findUniqueOrThrow({ where: { id: expenseId }, include: { event: true } })
  // Hard rule: nobody approves their own expense (submitted or paid by them).
  if (expense.submittedById === viewer.memberId || expense.paidById === viewer.memberId) throw new ForbiddenError("You can't review your own expense.")
  return { viewer, expense }
}

async function notifyExpenseOwners(expense: { submittedById: string; paidById: string; title: string; eventId: string }, title: string, body?: string) {
  const members = await prisma.member.findMany({ where: { id: { in: [expense.submittedById, expense.paidById] } }, select: { userId: true } })
  await notifyMany(members.map((member) => member.userId), 'EXPENSE_UPDATE', { title, body, href: `/portal/events/${expense.eventId}` })
}

export async function reviewExpenseAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { viewer, expense } = await loadExpenseForReview(String(formData.get('expenseId')))
    const decision = z.enum(['APPROVED', 'REJECTED']).parse(formData.get('decision'))
    if (expense.status !== 'SUBMITTED') throw new UserError('This expense was already reviewed.')
    const note = String(formData.get('note') ?? '').trim() || null
    let reason: string | null = null
    if (decision === 'REJECTED') {
      const parsed = reasonSchema.safeParse(formData.get('note'))
      if (!parsed.success) return { ok: false, fieldErrors: { note: ['A reason is required to reject'] } }
      reason = parsed.data
    } else {
      // Approval is still allowed over budget, but needs a note (§8.3).
      const summary = await eventSummary(expense.eventId)
      if (summary.spent + summary.awaitingApproval > summary.budget && !note) {
        return { ok: false, message: 'This event is over budget. Add a note explaining the approval.', fieldErrors: { note: ['Required when over budget'] } }
      }
    }
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      await tx.expense.update({
        where: { id: expense.id },
        data: { status: decision, reviewedById: viewer.memberId, reviewedAt: new Date(), rejectionReason: reason, reviewNote: decision === 'APPROVED' ? note : null },
      })
      await writeAudit(tx, { actorId: viewer.userId, action: decision === 'APPROVED' ? 'approve' : 'reject', entity: 'Expense', entityId: expense.id, before: { status: 'SUBMITTED' }, after: { status: decision }, reason: reason ?? note, ip })
    })
    await notifyExpenseOwners(expense, decision === 'APPROVED' ? `Expense approved: ${expense.title}` : `Expense rejected: ${expense.title}`, reason ?? note ?? undefined)
    revalidatePath(`/portal/events/${expense.eventId}`)
    revalidatePath('/portal/expenses')
    return { ok: true, message: decision === 'APPROVED' ? 'Approved.' : 'Rejected.' }
  })
}

export async function reimburseExpenseAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { viewer, expense } = await loadExpenseForReview(String(formData.get('expenseId')))
    if (expense.status !== 'APPROVED') throw new UserError('Only approved expenses can be marked reimbursed.')
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      await tx.expense.update({ where: { id: expense.id }, data: { status: 'REIMBURSED', reimbursedAt: new Date() } })
      await writeAudit(tx, { actorId: viewer.userId, action: 'reimburse', entity: 'Expense', entityId: expense.id, before: { status: 'APPROVED' }, after: { status: 'REIMBURSED' }, ip })
    })
    await notifyExpenseOwners(expense, `Reimbursed: ${expense.title}`)
    revalidatePath(`/portal/events/${expense.eventId}`)
    return { ok: true, message: 'Marked as reimbursed.' }
  })
}

/** Approved expenses are locked; only Admin can reopen them, with a reason (§3.4). */
export async function reopenExpenseAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    if (!viewer.isAdmin) throw new ForbiddenError('Only an Admin can reopen an approved expense.')
    const reason = reasonSchema.safeParse(formData.get('reason'))
    if (!reason.success) return { ok: false, fieldErrors: { reason: ['A reason is required'] } }
    const expense = await prisma.expense.findUniqueOrThrow({ where: { id: String(formData.get('expenseId')) } })
    if (!['APPROVED', 'REIMBURSED'].includes(expense.status)) throw new UserError('Only approved or reimbursed expenses can be reopened.')
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      await tx.expense.update({ where: { id: expense.id }, data: { status: 'SUBMITTED', reviewedById: null, reviewedAt: null, reimbursedAt: null } })
      await writeAudit(tx, { actorId: viewer.userId, action: 'reopen', entity: 'Expense', entityId: expense.id, before: { status: expense.status }, after: { status: 'SUBMITTED' }, reason: reason.data, ip })
    })
    revalidatePath(`/portal/events/${expense.eventId}`)
    return { ok: true, message: 'Reopened for review.' }
  })
}

/** Unapproved expenses can be withdrawn by whoever submitted them or the event lead. */
export async function deleteExpenseAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const expense = await prisma.expense.findUniqueOrThrow({ where: { id: String(formData.get('expenseId')) }, include: { event: true } })
    if (['APPROVED', 'REIMBURSED'].includes(expense.status)) throw new UserError('Approved expenses are locked.')
    if (expense.submittedById !== viewer.memberId && !(await canManageEvent(viewer, expense.event))) throw new ForbiddenError()
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      await tx.expense.delete({ where: { id: expense.id } })
      await writeAudit(tx, { actorId: viewer.userId, action: 'delete', entity: 'Expense', entityId: expense.id, before: expense, ip })
    })
    revalidatePath(`/portal/events/${expense.eventId}`)
    return { ok: true, message: 'Expense withdrawn.' }
  })
}
