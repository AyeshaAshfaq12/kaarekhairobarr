import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/portal/db'
import { getSubtreeIds } from '@/lib/portal/hierarchy'
import { raisedByGroup } from '@/lib/portal/metrics'
import { requireActiveViewer, scopeFor } from '@/lib/portal/rbac'
import { formatDateTime, formatPKR, monthKey } from '@/lib/portal/time'
import { ActionForm, Field, SubmitButton } from '@/components/portal/ActionForm'
import { Badge, Card, EmptyState, PageHeader, ProgressBar, Stat, humanize } from '@/components/portal/ui'
import { addTeamMemberAction, deleteTeamAction, removeTeamMemberAction, saveTeamAction, setTeamLeadAction } from '../actions'

export const metadata: Metadata = { title: 'Team | KKB Portal' }

const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED'] as const

export default async function TeamPage({ params }: { params: { id: string } }) {
  const viewer = await requireActiveViewer()
  const scope = scopeFor(viewer, 'teams', 'view')
  const team = await prisma.team.findUnique({
    where: { id: params.id },
    include: {
      memberships: {
        where: { member: { status: 'ACTIVE' } },
        include: { member: { select: { id: true, fullName: true } } },
        orderBy: [{ isLead: 'desc' }, { member: { fullName: 'asc' } }],
      },
    },
  })
  const isMember = team?.memberships.some((membership) => membership.memberId === viewer.memberId)
  if (!team || !scope || (scope !== 'all' && !isMember)) notFound()

  const isTeamLead = team.memberships.some((membership) => membership.memberId === viewer.memberId && membership.isLead)
  const canManage = viewer.isAdmin || (isTeamLead && !!scopeFor(viewer, 'teams', 'assign'))
  const subtree = !viewer.isAdmin && canManage ? await getSubtreeIds(viewer.memberId) : null
  const memberIds = team.memberships.map((membership) => membership.memberId)
  const month = monthKey()

  const [taskCounts, target, raised, candidates, activity] = await Promise.all([
    prisma.task.groupBy({ by: ['status'], where: { teamId: team.id, deletedAt: null, status: { in: [...TASK_STATUSES] } }, _count: true }),
    prisma.target.findUnique({ where: { month_teamId: { month, teamId: team.id } } }),
    raisedByGroup(memberIds, month),
    canManage
      ? prisma.member.findMany({
          where: {
            status: 'ACTIVE',
            id: { notIn: memberIds, ...(subtree ? { in: [...subtree] } : {}) },
          },
          orderBy: { fullName: 'asc' },
          select: { id: true, fullName: true },
        })
      : Promise.resolve([]),
    prisma.auditLog.findMany({
      where: { entity: 'Team', entityId: team.id },
      include: { actor: { select: { member: { select: { fullName: true } } } } },
      orderBy: { at: 'desc' },
      take: 10,
    }),
  ])
  const countFor = (status: string) => taskCounts.find((row) => row.status === status)?._count ?? 0

  return (
    <>
      <PageHeader title={team.name} description={team.description ?? undefined} eyebrow={team.isGeneral ? 'Everyone' : 'Team'} />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {TASK_STATUSES.map((status) => (
          <Stat key={status} label={humanize(status)} value={countFor(status)} hint="open tasks" />
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-5">
          <Card title={`Members (${team.memberships.length})`}>
            <ul className="divide-y divide-ink-900/5">
              {team.memberships.map((membership) => {
                const removable = canManage && !team.isGeneral && (!subtree || subtree.has(membership.memberId))
                return (
                  <li key={membership.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <span className="flex items-center gap-2 font-medium text-ink-900">
                      {membership.member.fullName}
                      {membership.isLead ? <Badge tone="green">Lead</Badge> : null}
                    </span>
                    <span className="flex gap-2">
                      {viewer.isAdmin ? (
                        <ActionForm action={setTeamLeadAction}>
                          <input type="hidden" name="teamId" value={team.id} />
                          <input type="hidden" name="memberId" value={membership.memberId} />
                          <input type="hidden" name="isLead" value={membership.isLead ? 'false' : 'true'} />
                          <SubmitButton variant="outline" className="!px-3 !py-1.5 text-xs">
                            {membership.isLead ? 'Remove lead' : 'Make lead'}
                          </SubmitButton>
                        </ActionForm>
                      ) : null}
                      {removable ? (
                        <ActionForm action={removeTeamMemberAction} confirm={`Remove ${membership.member.fullName} from ${team.name}?`}>
                          <input type="hidden" name="teamId" value={team.id} />
                          <input type="hidden" name="memberId" value={membership.memberId} />
                          <SubmitButton variant="outline" className="!px-3 !py-1.5 text-xs">
                            Remove
                          </SubmitButton>
                        </ActionForm>
                      ) : null}
                    </span>
                  </li>
                )
              })}
            </ul>
            {canManage && !team.isGeneral && candidates.length ? (
              <ActionForm action={addTeamMemberAction} className="mt-4 flex flex-col gap-2 border-t border-ink-900/5 pt-4 sm:flex-row" resetOnSuccess>
                <input type="hidden" name="teamId" value={team.id} />
                <Field label="Add a member" name="memberId" className="flex-1">
                  <select id="memberId" name="memberId" defaultValue="" className="field">
                    <option value="" disabled>
                      Choose…
                    </option>
                    {candidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.fullName}
                      </option>
                    ))}
                  </select>
                </Field>
                <SubmitButton variant="secondary" className="self-end">
                  Add
                </SubmitButton>
              </ActionForm>
            ) : null}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="This month">
            {target ? (
              <>
                <p className="text-sm text-ink-600">
                  <span className="text-xl font-semibold text-ink-900">{formatPKR(raised)}</span> of {formatPKR(target.amountTarget)}
                </p>
                <ProgressBar value={raised} max={target.amountTarget} className="mt-3" />
              </>
            ) : (
              <p className="text-sm text-ink-600">
                Raised <span className="font-semibold text-ink-900">{formatPKR(raised)}</span>. No team target set.
              </p>
            )}
          </Card>
          <Card title="Recent activity">
            {activity.length === 0 ? (
              <EmptyState>Nothing yet.</EmptyState>
            ) : (
              <ul className="space-y-2 text-sm">
                {activity.map((entry) => (
                  <li key={entry.id}>
                    <span className="font-medium">{entry.actor?.member?.fullName ?? 'System'}</span> <span className="text-ink-600">{humanize(entry.action)}</span>
                    <p className="text-xs text-ink-500">{formatDateTime(entry.at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {viewer.isAdmin ? (
            <Card title="Edit team">
              <ActionForm action={saveTeamAction} className="space-y-3">
                <input type="hidden" name="teamId" value={team.id} />
                <Field label="Name" name="name">
                  <input id="name" name="name" defaultValue={team.name} required className="field" />
                </Field>
                <Field label="Description" name="description">
                  <textarea id="description" name="description" rows={2} defaultValue={team.description ?? ''} className="field" />
                </Field>
                <SubmitButton variant="secondary">Save</SubmitButton>
              </ActionForm>
              {!team.isGeneral ? (
                <ActionForm action={deleteTeamAction} className="mt-4 border-t border-ink-900/5 pt-4" confirm={`Delete ${team.name}?`}>
                  <input type="hidden" name="teamId" value={team.id} />
                  <SubmitButton variant="danger">Delete team</SubmitButton>
                </ActionForm>
              ) : null}
            </Card>
          ) : null}
        </div>
      </div>
    </>
  )
}
