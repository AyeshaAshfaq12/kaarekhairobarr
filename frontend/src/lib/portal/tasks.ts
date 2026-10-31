import 'server-only'
import type { Prisma, Task } from '@prisma/client'
import { prisma } from './db'
import { getSubtreeIds } from './hierarchy'
import { notify, notifyMany } from './notify'
import { scopeFor, type Viewer } from './rbac'
import { dayRange, monthKey, monthRange } from './time'

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE', 'CANCELLED'] as const
export const OPEN_STATUSES = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED'] as const

export async function ledTeamIds(memberId: string) {
  const rows = await prisma.teamMembership.findMany({ where: { memberId, isLead: true }, select: { teamId: true } })
  return rows.map((row) => row.teamId)
}

/**
 * Tasks visibility: own = assigned to me or created by me; team = plus every task in teams I
 * lead (§3.1: a team lead sees tasks of that team's members); subtree = plus tasks assigned to
 * my subtree; all = everything.
 */
export async function taskWhere(viewer: Viewer): Promise<Prisma.TaskWhereInput> {
  const scope = scopeFor(viewer, 'tasks', 'view')
  const me = viewer.memberId ?? ''
  if (!scope) return { id: '__none__' }
  if (scope === 'all') return { deletedAt: null }
  const or: Prisma.TaskWhereInput[] = [{ assigneeId: me }, { createdById: me }]
  if (scope === 'team' || scope === 'subtree') or.push({ teamId: { in: await ledTeamIds(me) } })
  if (scope === 'subtree') or.push({ assigneeId: { in: [...(await getSubtreeIds(me))] } })
  return { deletedAt: null, OR: or }
}

export type TaskPermissions = { canView: boolean; canEdit: boolean; canChangeStatus: boolean; canComment: boolean; isTeamLead: boolean }

/** The lead edits everything; the assignee changes status and comments (§6.2). */
export async function taskPermissions(viewer: Viewer, task: Pick<Task, 'id' | 'teamId' | 'assigneeId' | 'createdById'>): Promise<TaskPermissions> {
  const visible = (await prisma.task.count({ where: { AND: [{ id: task.id }, await taskWhere(viewer)] } })) > 0
  const isTeamLead = !!viewer.memberId && (await prisma.teamMembership.count({ where: { teamId: task.teamId, memberId: viewer.memberId, isLead: true } })) > 0
  const editScope = scopeFor(viewer, 'tasks', 'edit')
  const isAssignee = task.assigneeId === viewer.memberId
  const isCreator = task.createdById === viewer.memberId
  const canEdit = visible && (viewer.isAdmin || editScope === 'all' || (isTeamLead && !!editScope) || isCreator)
  return { canView: visible, canEdit, canChangeStatus: canEdit || (visible && isAssignee), canComment: visible && (canEdit || isAssignee || isTeamLead), isTeamLead: isTeamLead || viewer.isAdmin }
}

/** IN_REVIEW → DONE is only for a team lead (e.g. approving a design poster). */
export function statusChangeError(from: string, to: string, isTeamLead: boolean) {
  if (from === 'IN_REVIEW' && to === 'DONE' && !isTeamLead) return 'Only a team lead can move a task from review to done.'
  return null
}

/** Moving to DONE sets completedAt; leaving DONE clears it. */
export function completionFields(from: string, to: string) {
  if (to === 'DONE' && from !== 'DONE') return { completedAt: new Date() }
  if (to !== 'DONE' && from === 'DONE') return { completedAt: null }
  return {}
}

// ---------- Jobs ----------

function sameDayInMonth(due: Date, month: string) {
  const [year, m] = month.split('-').map(Number)
  const { start } = monthRange(month)
  // Day-of-month of the original due date in Karachi, clamped to the target month's length.
  const day = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', day: '2-digit' }).format(due))
  const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate()
  const hours = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', hourCycle: 'h23' }).format(due))
  return new Date(start.getTime() + (Math.min(day, lastDay) - 1) * 86_400_000 + hours * 3_600_000)
}

/**
 * Recurring tasks (§6.2): each month the latest task of a monthly series is cloned with the
 * same day-of-month due date. Idempotent: a month that already has its clone is skipped.
 */
export async function runMonthlyTaskJobs(now = new Date()) {
  const month = monthKey(now)
  const { start } = monthRange(month)
  const series = await prisma.task.findMany({ where: { recurringMonthly: true, deletedAt: null, dueAt: { lt: start } } })
  let created = 0
  for (const task of series) {
    const rootId = task.recurrenceSourceId ?? task.id
    const exists = await prisma.task.count({ where: { OR: [{ id: rootId }, { recurrenceSourceId: rootId }], dueAt: { gte: start } } })
    if (exists) continue
    await prisma.$transaction(async (tx) => {
      const clone = await tx.task.create({
        data: {
          title: task.title,
          description: task.description,
          teamId: task.teamId,
          assigneeId: task.assigneeId,
          createdById: task.createdById,
          dueAt: sameDayInMonth(task.dueAt!, month),
          priority: task.priority,
          eventId: task.eventId,
          caseId: task.caseId,
          recurringMonthly: true,
          recurrenceSourceId: rootId,
        },
      })
      // Only the newest task in a series carries the recurrence forward.
      await tx.task.update({ where: { id: task.id }, data: { recurringMonthly: false } })
      await tx.auditLog.create({ data: { action: 'recur', entity: 'Task', entityId: clone.id, after: { from: task.id, dueAt: clone.dueAt?.toISOString() } } })
    })
    created += 1
  }
  return { created }
}

/** "Task due tomorrow" to the assignee; "overdue" to the assignee and the team's leads (§11.2). */
export async function runTaskReminders(now = new Date()) {
  const tomorrow = dayRange(new Date(now.getTime() + 86_400_000))
  const dueTomorrow = await prisma.task.findMany({
    where: { deletedAt: null, status: { in: [...OPEN_STATUSES] }, assigneeId: { not: null }, dueReminderSentAt: null, dueAt: { gte: tomorrow.start, lt: tomorrow.end } },
    include: { assignee: { select: { userId: true } } },
  })
  for (const task of dueTomorrow) {
    await notify(task.assignee!.userId, 'TASK_DUE', { title: `Due tomorrow: ${task.title}`, href: `/portal/tasks/${task.id}` })
  }
  await prisma.task.updateMany({ where: { id: { in: dueTomorrow.map((task) => task.id) } }, data: { dueReminderSentAt: now } })

  const overdue = await prisma.task.findMany({
    where: { deletedAt: null, status: { in: [...OPEN_STATUSES] }, overdueNotifiedAt: null, dueAt: { lt: now } },
    include: { assignee: { select: { userId: true, fullName: true } }, team: { include: { memberships: { where: { isLead: true }, include: { member: { select: { userId: true } } } } } } },
  })
  for (const task of overdue) {
    if (task.assignee) await notify(task.assignee.userId, 'TASK_DUE', { title: `Overdue: ${task.title}`, href: `/portal/tasks/${task.id}` })
    await notifyMany(
      task.team.memberships.map((membership) => membership.member.userId).filter((userId) => userId !== task.assignee?.userId),
      'TASK_DUE',
      { title: `Overdue in ${task.team.name}: ${task.title}`, body: task.assignee ? `Assigned to ${task.assignee.fullName}.` : 'Unassigned.', href: `/portal/tasks/${task.id}` }
    )
  }
  await prisma.task.updateMany({ where: { id: { in: overdue.map((task) => task.id) } }, data: { overdueNotifiedAt: now } })
  return { dueTomorrow: dueTomorrow.length, overdue: overdue.length }
}
