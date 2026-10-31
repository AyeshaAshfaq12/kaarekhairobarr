import React from 'react'
import { prisma } from '@/lib/portal/db'
import type { ActiveViewer } from '@/lib/portal/rbac'
import { toDateInput } from '@/lib/portal/time'
import { ActionForm, Field, SubmitButton } from '@/components/portal/ActionForm'
import { createTaskAction, updateTaskAction } from './actions'

type TaskValues = {
  id: string
  title: string
  description: string | null
  teamId: string
  assigneeId: string | null
  dueAt: Date | null
  priority: string
  eventId: string | null
  caseId: string | null
  recurringMonthly: boolean
}

/** Options are limited to teams the viewer belongs to (Admin: all); the server re-checks. */
export default async function TaskForm({ viewer, task, defaults = {}, back }: { viewer: ActiveViewer; task?: TaskValues; defaults?: Partial<TaskValues>; back?: string }) {
  const teams = await prisma.team.findMany({
    where: viewer.isAdmin ? {} : { memberships: { some: { memberId: viewer.memberId } } },
    include: { memberships: { where: { member: { status: 'ACTIVE' } }, include: { member: { select: { id: true, fullName: true } } } } },
    orderBy: { name: 'asc' },
  })
  const ledTeamIds = new Set(teams.filter((team) => team.memberships.some((m) => m.memberId === viewer.memberId && m.isLead)).map((team) => team.id))
  const assignable = new Map<string, string>([[viewer.memberId, `${viewer.fullName} (me)`]])
  for (const team of teams) {
    if (viewer.isAdmin || ledTeamIds.has(team.id)) for (const m of team.memberships) if (!assignable.has(m.member.id)) assignable.set(m.member.id, m.member.fullName)
  }
  const [events, cases] = await Promise.all([
    prisma.event.findMany({ where: { deletedAt: null, status: { in: ['PLANNING', 'LIVE'] } }, select: { id: true, name: true }, orderBy: { startsAt: 'asc' } }),
    prisma.case.findMany({ where: { deletedAt: null, status: { in: ['OPEN', 'FUNDED'] } }, select: { id: true, title: true }, orderBy: { title: 'asc' } }),
  ])
  const values = { ...defaults, ...task }

  return (
    <ActionForm action={task ? updateTaskAction : createTaskAction} className="grid gap-4 sm:grid-cols-2">
      {task ? <input type="hidden" name="taskId" value={task.id} /> : null}
      {back ? <input type="hidden" name="back" value={back} /> : null}
      <Field label="Title" name="title" className="sm:col-span-2">
        <input id="title" name="title" defaultValue={values.title} required className="field" />
      </Field>
      <Field label="Team" name="teamId">
        <select id="teamId" name="teamId" defaultValue={values.teamId ?? ''} required className="field">
          <option value="" disabled>
            Choose…
          </option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
              {ledTeamIds.has(team.id) ? ' (you lead)' : ''}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Assignee" name="assigneeId" hint="Leads can assign anyone in their team; members only themselves.">
        <select id="assigneeId" name="assigneeId" defaultValue={values.assigneeId ?? (task ? '' : viewer.memberId)} className="field">
          <option value="">Unassigned</option>
          {[...assignable].map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Due date" name="dueAt">
        <input id="dueAt" name="dueAt" type="date" defaultValue={toDateInput(values.dueAt)} className="field" />
      </Field>
      <Field label="Priority" name="priority">
        <select id="priority" name="priority" defaultValue={values.priority ?? 'MEDIUM'} className="field">
          {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((priority) => (
            <option key={priority} value={priority}>
              {priority.charAt(0) + priority.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Event (optional)" name="eventId">
        <select id="eventId" name="eventId" defaultValue={values.eventId ?? ''} className="field">
          <option value="">None</option>
          {events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Case (optional)" name="caseId">
        <select id="caseId" name="caseId" defaultValue={values.caseId ?? ''} className="field">
          <option value="">None</option>
          {cases.map((kase) => (
            <option key={kase.id} value={kase.id}>
              {kase.title}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Description" name="description" className="sm:col-span-2">
        <textarea id="description" name="description" rows={3} defaultValue={values.description ?? ''} className="field" />
      </Field>
      <label className="flex items-center gap-2 text-sm text-ink-700 sm:col-span-2">
        <input type="checkbox" name="recurringMonthly" defaultChecked={values.recurringMonthly} className="h-4 w-4 accent-forest-600" />
        Repeat monthly (e.g. &quot;Monthly goals poster&quot; due on the 3rd)
      </label>
      <div className="sm:col-span-2">
        <SubmitButton>{task ? 'Save task' : 'Create task'}</SubmitButton>
      </div>
    </ActionForm>
  )
}
