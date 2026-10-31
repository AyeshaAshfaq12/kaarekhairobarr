import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Prisma, Priority, TaskStatus } from '@prisma/client'
import { prisma } from '@/lib/portal/db'
import { isOverdue } from '@/lib/portal/metrics-core'
import { can, requireActiveViewer } from '@/lib/portal/rbac'
import { TASK_STATUSES, ledTeamIds, taskWhere } from '@/lib/portal/tasks'
import { dayRange, formatDate } from '@/lib/portal/time'
import ExportLinks from '@/components/portal/ExportLinks'
import { Badge, Card, EmptyState, PageHeader, Pagination, TASK_STATUS_TONE, Tabs, humanize, pageHref } from '@/components/portal/ui'
import KanbanBoard from './KanbanBoard'

export const metadata: Metadata = { title: 'Tasks | KKB Portal' }

const PAGE_SIZE = 40
type SearchParams = { view?: string; teamId?: string; assigneeId?: string; status?: string; due?: string; priority?: string; mine?: string; page?: string }

function dueFilter(due?: string): Prisma.TaskWhereInput {
  const now = new Date()
  const today = dayRange(now)
  if (due === 'overdue') return { dueAt: { lt: now }, status: { notIn: ['DONE', 'CANCELLED'] } }
  if (due === 'today') return { dueAt: { gte: today.start, lt: today.end } }
  if (due === 'week') return { dueAt: { gte: today.start, lt: new Date(today.start.getTime() + 7 * 86_400_000) } }
  if (due === 'none') return { dueAt: null }
  return {}
}

export default async function TasksPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requireActiveViewer()
  if (!can(viewer, 'tasks', 'view')) notFound()
  const visible = await taskWhere(viewer)
  const teams = await prisma.team.findMany({
    where: viewer.isAdmin ? {} : { OR: [{ memberships: { some: { memberId: viewer.memberId } } }, { tasks: { some: visible } }] },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
  const view = searchParams.view === 'board' ? 'board' : 'list'
  const led = new Set(await ledTeamIds(viewer.memberId))
  const filterParams = { teamId: searchParams.teamId, assigneeId: searchParams.assigneeId, status: searchParams.status, due: searchParams.due, priority: searchParams.priority, mine: searchParams.mine }
  const tabs = [
    { key: 'list', label: 'List', href: `/portal/tasks?${new URLSearchParams(Object.entries(filterParams).filter(([, v]) => v) as [string, string][])}` },
    { key: 'board', label: 'Board', href: `/portal/tasks?view=board&teamId=${searchParams.teamId ?? [...led][0] ?? teams[0]?.id ?? ''}` },
  ]
  const headerActions = <Link href="/portal/tasks/new" className="btn-primary">New task</Link>

  if (view === 'board') {
    const teamId = searchParams.teamId ?? [...led][0] ?? teams[0]?.id
    const tasks = teamId ? await prisma.task.findMany({ where: { AND: [visible, { teamId }] }, include: { assignee: { select: { fullName: true } } }, orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }] }) : []
    return (
      <>
        <PageHeader title="Tasks" actions={headerActions} />
        <Tabs tabs={tabs} active="board" />
        <div className="mb-4 flex flex-wrap gap-2">
          {teams.map((team) => (
            <Link key={team.id} href={`/portal/tasks?view=board&teamId=${team.id}`} className={`rounded-full px-3 py-1.5 text-sm ${team.id === teamId ? 'bg-forest-700 text-white' : 'bg-white/80 text-ink-700'}`}>
              {team.name}
            </Link>
          ))}
        </div>
        {tasks.length === 0 ? <EmptyState>No tasks in this team yet.</EmptyState> : null}
        <KanbanBoard
          key={teamId}
          tasks={tasks.map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            priority: task.priority,
            assignee: task.assignee?.fullName ?? null,
            due: task.dueAt ? formatDate(task.dueAt) : null,
            overdue: isOverdue(task),
            canMove: viewer.isAdmin || led.has(task.teamId) || task.assigneeId === viewer.memberId || task.createdById === viewer.memberId,
          }))}
        />
      </>
    )
  }

  const page = Math.max(1, Number(searchParams.page) || 1)
  const where: Prisma.TaskWhereInput = {
    AND: [
      visible,
      searchParams.teamId ? { teamId: searchParams.teamId } : {},
      searchParams.mine ? { assigneeId: viewer.memberId } : searchParams.assigneeId ? { assigneeId: searchParams.assigneeId } : {},
      TASK_STATUSES.includes(searchParams.status as TaskStatus) ? { status: searchParams.status as TaskStatus } : searchParams.status ? {} : { status: { notIn: ['DONE', 'CANCELLED'] } },
      ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(searchParams.priority ?? '') ? { priority: searchParams.priority as Priority } : {},
      dueFilter(searchParams.due),
    ],
  }
  const [total, tasks, assignees] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      include: { assignee: { select: { fullName: true } }, team: { select: { name: true } } },
      orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { priority: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.member.findMany({ where: { status: 'ACTIVE', tasksAssigned: { some: visible } }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } }),
  ])

  return (
    <>
      <PageHeader title="Tasks" description={`${total} tasks`} actions={headerActions} />
      <Tabs tabs={tabs} active="list" />
      <form action="/portal/tasks" className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-6">
        <select name="teamId" defaultValue={searchParams.teamId ?? ''} className="field">
          <option value="">All teams</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
        <select name="assigneeId" defaultValue={searchParams.assigneeId ?? ''} className="field">
          <option value="">Anyone</option>
          {assignees.map((member) => (
            <option key={member.id} value={member.id}>
              {member.fullName}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={searchParams.status ?? ''} className="field">
          <option value="">Open</option>
          <option value="ALL">Any status</option>
          {TASK_STATUSES.map((status) => (
            <option key={status} value={status}>
              {humanize(status)}
            </option>
          ))}
        </select>
        <select name="due" defaultValue={searchParams.due ?? ''} className="field">
          <option value="">Any due date</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due today</option>
          <option value="week">Next 7 days</option>
          <option value="none">No due date</option>
        </select>
        <select name="priority" defaultValue={searchParams.priority ?? ''} className="field">
          <option value="">Any priority</option>
          {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((priority) => (
            <option key={priority} value={priority}>
              {humanize(priority)}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <label className="flex items-center gap-1.5 text-xs text-ink-700">
            <input type="checkbox" name="mine" value="1" defaultChecked={!!searchParams.mine} className="accent-forest-600" /> Mine
          </label>
          <button className="btn-secondary shrink-0">Go</button>
        </div>
      </form>
      {can(viewer, 'tasks', 'export') || can(viewer, 'reports', 'export') ? <ExportLinks report="tasks" params={filterParams} /> : null}
      <Card className="p-0 sm:p-0">
        {tasks.length === 0 ? (
          <div className="p-4">
            <EmptyState>No tasks match.</EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-ink-900/5">
            {tasks.map((task) => (
              <li key={task.id}>
                <Link href={`/portal/tasks/${task.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-cream-50/60 sm:px-6">
                  <span className="min-w-0">
                    <span className="font-semibold text-ink-900">{task.title}</span>
                    <span className="block text-xs text-ink-500">
                      {task.team.name} · {task.assignee?.fullName ?? 'Unassigned'} · {humanize(task.priority)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {task.dueAt ? <span className={`text-xs ${isOverdue(task) ? 'font-semibold text-clay-600' : 'text-ink-500'}`}>{formatDate(task.dueAt)}</span> : null}
                    <Badge tone={TASK_STATUS_TONE[task.status]}>{humanize(task.status)}</Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Pagination page={page} pages={Math.ceil(total / PAGE_SIZE)} href={pageHref('/portal/tasks', filterParams)} />
    </>
  )
}
