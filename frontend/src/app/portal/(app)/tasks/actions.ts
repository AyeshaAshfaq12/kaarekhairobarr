'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { prisma } from '@/lib/portal/db'
import { getRequestMeta } from '@/lib/portal/auth'
import { writeAudit } from '@/lib/portal/audit'
import { notify } from '@/lib/portal/notify'
import { ForbiddenError, can, requireActiveViewer, type ActiveViewer } from '@/lib/portal/rbac'
import { storeUpload } from '@/lib/portal/storage'
import { TASK_STATUSES, completionFields, statusChangeError, taskPermissions } from '@/lib/portal/tasks'
import { runAction, UserError } from '@/lib/portal/action-utils'
import { formDataToObject, type ActionState } from '@/lib/portal/validation'

const optional = z.string().trim().optional().transform((value) => value || null)

const taskSchema = z.object({
  title: z.string().trim().min(2, 'Title is required').max(200),
  description: optional,
  teamId: z.string().min(1, 'Choose a team'),
  assigneeId: optional,
  // Due at the end of the chosen day in Karachi, so "on time" means by midnight.
  dueAt: optional.transform((value) => (value ? new Date(`${value}T23:59:00+05:00`) : null)),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  eventId: optional,
  caseId: optional,
  recurringMonthly: optional.transform((value) => value === 'on' || value === '1'),
})

/**
 * Who may put a task in a team (§6.2): team leads and Admin assign anyone in the team; an event
 * lead may add event tasks in teams they lead; a member may create tasks for themselves in
 * teams they belong to.
 */
async function assertCanPlaceTask(viewer: ActiveViewer, teamId: string, assigneeId: string | null) {
  const memberships = await prisma.teamMembership.findMany({ where: { teamId, memberId: { in: [viewer.memberId, ...(assigneeId ? [assigneeId] : [])] } } })
  const mine = memberships.find((membership) => membership.memberId === viewer.memberId)
  if (assigneeId && !memberships.some((membership) => membership.memberId === assigneeId) && !viewer.isAdmin) {
    throw new UserError('The assignee must be a member of that team.')
  }
  if (viewer.isAdmin || mine?.isLead) return
  if (mine && can(viewer, 'tasks', 'create') && (!assigneeId || assigneeId === viewer.memberId)) return
  throw new ForbiddenError('Team leads assign tasks; members can create tasks only for themselves in their own teams.')
}

export async function createTaskAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const input = taskSchema.parse(formDataToObject(formData))
    if (input.recurringMonthly && !input.dueAt) return { ok: false, fieldErrors: { dueAt: ['Recurring tasks need a due date'] } }
    const assigneeId = input.assigneeId ?? (viewer.isAdmin ? null : viewer.memberId)
    await assertCanPlaceTask(viewer, input.teamId, assigneeId)
    const { ip } = getRequestMeta()
    const task = await prisma.$transaction(async (tx) => {
      const created = await tx.task.create({ data: { ...input, assigneeId, createdById: viewer.memberId } })
      await writeAudit(tx, { actorId: viewer.userId, action: 'create', entity: 'Task', entityId: created.id, after: created, ip })
      return created
    })
    if (assigneeId && assigneeId !== viewer.memberId) {
      const assignee = await prisma.member.findUniqueOrThrow({ where: { id: assigneeId }, select: { userId: true } })
      await notify(assignee.userId, 'ASSIGNED', { title: `New task: ${task.title}`, href: `/portal/tasks/${task.id}` })
    }
    const back = String(formData.get('back') ?? '')
    redirect(back.startsWith('/portal/') ? back : `/portal/tasks/${task.id}`)
  })
}

export async function updateTaskAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const before = await prisma.task.findUniqueOrThrow({ where: { id: String(formData.get('taskId')) } })
    const perms = await taskPermissions(viewer, before)
    if (!perms.canEdit) throw new ForbiddenError('Only the team lead or the task creator can edit this task.')
    const input = taskSchema.parse(formDataToObject(formData))
    if (input.recurringMonthly && !input.dueAt) return { ok: false, fieldErrors: { dueAt: ['Recurring tasks need a due date'] } }
    if (input.teamId !== before.teamId || input.assigneeId !== before.assigneeId) await assertCanPlaceTask(viewer, input.teamId, input.assigneeId)
    const { ip } = getRequestMeta()
    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.task.update({
        where: { id: before.id },
        data: {
          ...input,
          // A new due date re-arms the reminders.
          ...(input.dueAt?.getTime() !== before.dueAt?.getTime() ? { dueReminderSentAt: null, overdueNotifiedAt: null } : {}),
        },
      })
      await writeAudit(tx, { actorId: viewer.userId, action: 'update', entity: 'Task', entityId: before.id, before, after: updated, ip })
      return updated
    })
    if (after.assigneeId && after.assigneeId !== before.assigneeId && after.assigneeId !== viewer.memberId) {
      const assignee = await prisma.member.findUniqueOrThrow({ where: { id: after.assigneeId }, select: { userId: true } })
      await notify(assignee.userId, 'ASSIGNED', { title: `Task assigned to you: ${after.title}`, href: `/portal/tasks/${after.id}` })
    }
    revalidatePath(`/portal/tasks/${before.id}`)
    return { ok: true, message: 'Task saved.' }
  })
}

export async function setTaskStatusAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const task = await prisma.task.findUniqueOrThrow({ where: { id: String(formData.get('taskId')) } })
    const status = z.enum(TASK_STATUSES).parse(formData.get('status'))
    if (status === task.status) return { ok: true }
    const perms = await taskPermissions(viewer, task)
    if (!perms.canChangeStatus) throw new ForbiddenError('Only the assignee or the team lead can move this task.')
    const blocked = statusChangeError(task.status, status, perms.isTeamLead)
    if (blocked) throw new UserError(blocked)
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      await tx.task.update({ where: { id: task.id }, data: { status, ...completionFields(task.status, status) } })
      await writeAudit(tx, { actorId: viewer.userId, action: 'status', entity: 'Task', entityId: task.id, before: { status: task.status }, after: { status }, ip })
    })
    revalidatePath('/portal/tasks')
    revalidatePath(`/portal/tasks/${task.id}`)
    return { ok: true, message: `Moved to ${status.replace('_', ' ').toLowerCase()}.` }
  })
}

/** Used by the Kanban board's drag and drop. */
export async function moveTaskAction(taskId: string, status: string): Promise<ActionState> {
  const formData = new FormData()
  formData.set('taskId', taskId)
  formData.set('status', status)
  return setTaskStatusAction({}, formData)
}

export async function addCommentAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const task = await prisma.task.findUniqueOrThrow({ where: { id: String(formData.get('taskId')) } })
    if (!(await taskPermissions(viewer, task)).canComment) throw new ForbiddenError()
    const body = String(formData.get('body') ?? '').trim()
    const files = formData.getAll('attachments').filter((file): file is File => file instanceof File && file.size > 0)
    if (!body && files.length === 0) return { ok: false, fieldErrors: { body: ['Write a comment or attach a file'] } }
    if (files.length > 5) throw new UserError('Attach up to 5 files at a time.')
    const attachmentKeys: string[] = []
    for (const file of files) attachmentKeys.push(await storeUpload(file, { uploadedById: viewer.userId, purpose: 'task-attachment' }))
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      const comment = await tx.taskComment.create({ data: { taskId: task.id, authorId: viewer.memberId, body, attachmentKeys } })
      await writeAudit(tx, { actorId: viewer.userId, action: 'comment', entity: 'Task', entityId: task.id, after: { commentId: comment.id, attachments: attachmentKeys.length }, ip })
    })
    // Let the other party know.
    const notifyId = task.assigneeId && task.assigneeId !== viewer.memberId ? task.assigneeId : task.createdById !== viewer.memberId ? task.createdById : null
    if (notifyId) {
      const member = await prisma.member.findUnique({ where: { id: notifyId }, select: { userId: true } })
      if (member) await notify(member.userId, 'ASSIGNED', { title: `New comment on "${task.title}"`, body: body.slice(0, 140), href: `/portal/tasks/${task.id}` })
    }
    revalidatePath(`/portal/tasks/${task.id}`)
    return { ok: true, message: 'Comment added.' }
  })
}

export async function deleteTaskAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const task = await prisma.task.findUniqueOrThrow({ where: { id: String(formData.get('taskId')) } })
    if (!(await taskPermissions(viewer, task)).canEdit) throw new ForbiddenError()
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      await tx.task.update({ where: { id: task.id }, data: { deletedAt: new Date(), recurringMonthly: false } })
      await writeAudit(tx, { actorId: viewer.userId, action: 'delete', entity: 'Task', entityId: task.id, before: task, ip })
    })
    redirect('/portal/tasks')
  })
}
