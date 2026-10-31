import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/portal/db'
import { isOverdue } from '@/lib/portal/metrics-core'
import { requireActiveViewer } from '@/lib/portal/rbac'
import { TASK_STATUSES, taskPermissions } from '@/lib/portal/tasks'
import { formatDate, formatDateTime } from '@/lib/portal/time'
import { ActionForm, Field, SubmitButton } from '@/components/portal/ActionForm'
import { Badge, Card, EmptyState, KeyValue, PageHeader, TASK_STATUS_TONE, humanize } from '@/components/portal/ui'
import TaskForm from '../TaskForm'
import { addCommentAction, deleteTaskAction, setTaskStatusAction } from '../actions'

export const metadata: Metadata = { title: 'Task | KKB Portal' }

export default async function TaskPage({ params, searchParams }: { params: { id: string }; searchParams: { edit?: string } }) {
  const viewer = await requireActiveViewer()
  const task = await prisma.task.findUnique({
    where: { id: params.id },
    include: {
      team: { select: { id: true, name: true } },
      assignee: { select: { id: true, fullName: true } },
      event: { select: { id: true, name: true } },
      case: { select: { id: true, title: true } },
      comments: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!task || task.deletedAt) notFound()
  const perms = await taskPermissions(viewer, task)
  if (!perms.canView) notFound()

  const authorIds = [...new Set([task.createdById, ...task.comments.map((comment) => comment.authorId)])]
  const authors = new Map((await prisma.member.findMany({ where: { id: { in: authorIds } }, select: { id: true, fullName: true } })).map((m) => [m.id, m.fullName]))

  if (searchParams.edit && perms.canEdit) {
    return (
      <>
        <PageHeader title={`Edit: ${task.title}`} actions={<Link href={`/portal/tasks/${task.id}`} className="btn-outline">Cancel</Link>} />
        <Card className="max-w-3xl">
          <TaskForm viewer={viewer} task={task} />
        </Card>
      </>
    )
  }

  const nextStatuses = TASK_STATUSES.filter((status) => status !== task.status && !(task.status === 'IN_REVIEW' && status === 'DONE' && !perms.isTeamLead))

  return (
    <>
      <PageHeader
        title={task.title}
        eyebrow={task.team.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={TASK_STATUS_TONE[task.status]}>{humanize(task.status)}</Badge>
            <Badge>{humanize(task.priority)}</Badge>
            {task.recurringMonthly || task.recurrenceSourceId ? <Badge tone="blue">Monthly</Badge> : null}
          </span>
        }
        actions={perms.canEdit ? <Link href={`/portal/tasks/${task.id}?edit=1`} className="btn-outline">Edit</Link> : null}
      />
      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-5">
          <Card>
            {task.description ? <p className="mb-4 whitespace-pre-line text-sm text-ink-700">{task.description}</p> : null}
            <KeyValue
              items={[
                { label: 'Assignee', value: task.assignee?.fullName ?? 'Unassigned' },
                { label: 'Due', value: task.dueAt ? <span className={isOverdue(task) ? 'font-semibold text-clay-600' : ''}>{formatDate(task.dueAt)}{isOverdue(task) ? ' (overdue)' : ''}</span> : '—' },
                { label: 'Created by', value: authors.get(task.createdById) ?? '—' },
                { label: 'Completed', value: task.completedAt ? formatDateTime(task.completedAt) : '—' },
                ...(task.event ? [{ label: 'Event', value: <Link href={`/portal/events/${task.event.id}`} className="underline">{task.event.name}</Link> }] : []),
                ...(task.case ? [{ label: 'Case', value: <Link href={`/portal/cases/${task.case.id}`} className="underline">{task.case.title}</Link> }] : []),
              ]}
            />
          </Card>
          <Card title={`Comments (${task.comments.length})`}>
            {task.comments.length === 0 ? <EmptyState>No comments yet.</EmptyState> : null}
            <ul className="space-y-4">
              {task.comments.map((comment) => (
                <li key={comment.id} className="text-sm">
                  <p>
                    <span className="font-semibold">{authors.get(comment.authorId) ?? 'Someone'}</span> <span className="text-xs text-ink-400">{formatDateTime(comment.createdAt)}</span>
                  </p>
                  {comment.body ? <p className="mt-1 whitespace-pre-line text-ink-700">{comment.body}</p> : null}
                  {comment.attachmentKeys.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {comment.attachmentKeys.map((key, index) =>
                        key.endsWith('.pdf') ? (
                          <a key={key} href={`/api/portal/files/task-attachment/${comment.id}/${index}`} target="_blank" rel="noreferrer" className="btn-outline !px-3 !py-1 text-xs">
                            PDF {index + 1}
                          </a>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <a key={key} href={`/api/portal/files/task-attachment/${comment.id}/${index}`} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked file route; next/image can't optimise it */}
                            <img src={`/api/portal/files/task-attachment/${comment.id}/${index}`} alt={`Attachment ${index + 1}`} className="h-24 w-24 rounded-xl object-cover" />
                          </a>
                        )
                      )}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
            {perms.canComment ? (
              <ActionForm action={addCommentAction} className="mt-5 space-y-3 border-t border-ink-900/5 pt-4" resetOnSuccess>
                <input type="hidden" name="taskId" value={task.id} />
                <Field label="Add a comment" name="body">
                  <textarea id="body" name="body" rows={3} className="field" />
                </Field>
                <Field label="Attachments (e.g. poster drafts)" name="attachments" hint="Up to 5 files: JPG, PNG or PDF, 5 MB each.">
                  <input id="attachments" name="attachments" type="file" multiple accept="image/jpeg,image/png,application/pdf" className="field" />
                </Field>
                <SubmitButton variant="secondary">Post comment</SubmitButton>
              </ActionForm>
            ) : null}
          </Card>
        </div>
        <div className="space-y-5">
          {perms.canChangeStatus ? (
            <Card title="Move to">
              {/* One form for all moves, so the confirmation survives the re-render. */}
              <ActionForm action={setTaskStatusAction} className="flex flex-wrap gap-2">
                <input type="hidden" name="taskId" value={task.id} />
                {nextStatuses.map((status) => (
                  <SubmitButton key={status} name="status" value={status} variant={status === 'DONE' ? 'primary' : 'outline'} className="!px-3 !py-1.5 text-xs">
                    {humanize(status)}
                  </SubmitButton>
                ))}
              </ActionForm>
              {task.status === 'IN_REVIEW' && !perms.isTeamLead ? <p className="mt-3 text-xs text-ink-500">A team lead marks reviewed work as done.</p> : null}
            </Card>
          ) : null}
          {perms.canEdit ? (
            <Card title="Delete">
              <ActionForm action={deleteTaskAction} confirm="Delete this task?">
                <input type="hidden" name="taskId" value={task.id} />
                <SubmitButton variant="outline">Delete task</SubmitButton>
              </ActionForm>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  )
}
