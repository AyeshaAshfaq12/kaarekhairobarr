import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/portal/db'
import { can, requireActiveViewer, scopeFor } from '@/lib/portal/rbac'
import { ActionForm, Field, SubmitButton } from '@/components/portal/ActionForm'
import { Badge, Card, EmptyState, PageHeader } from '@/components/portal/ui'
import { saveTeamAction } from './actions'

export const metadata: Metadata = { title: 'Teams | KKB Portal' }

export default async function TeamsPage() {
  const viewer = await requireActiveViewer()
  const scope = scopeFor(viewer, 'teams', 'view')
  if (!scope) notFound()

  // Scope all → every team; narrower scopes → teams the viewer belongs to (which includes those they lead).
  const teams = await prisma.team.findMany({
    where: scope === 'all' ? {} : { memberships: { some: { memberId: viewer.memberId } } },
    orderBy: [{ isGeneral: 'desc' }, { name: 'asc' }],
    include: {
      memberships: { where: { member: { status: 'ACTIVE' } }, include: { member: { select: { fullName: true } } } },
      _count: { select: { tasks: { where: { deletedAt: null, status: { notIn: ['DONE', 'CANCELLED'] } } } } },
    },
  })

  return (
    <>
      <PageHeader title="Teams" description="Teams group people for work. Everyone is in General." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {teams.map((team) => {
          const leads = team.memberships.filter((membership) => membership.isLead)
          return (
            <Link key={team.id} href={`/portal/teams/${team.id}`} className="block rounded-3xl border border-ink-900/5 bg-white/85 p-5 shadow-soft transition hover:-translate-y-0.5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-lg font-semibold text-ink-900">{team.name}</h2>
                {team.isGeneral ? <Badge tone="green">General</Badge> : null}
              </div>
              {team.description ? <p className="mt-1 line-clamp-2 text-sm text-ink-500">{team.description}</p> : null}
              <p className="mt-3 text-sm text-ink-600">
                {team.memberships.length} members · {team._count.tasks} open tasks
              </p>
              <p className="mt-1 text-xs text-ink-500">Leads: {leads.map((membership) => membership.member.fullName).join(', ') || '—'}</p>
            </Link>
          )
        })}
      </div>
      {teams.length === 0 ? <EmptyState>You aren&apos;t in any teams yet.</EmptyState> : null}

      {viewer.isAdmin && can(viewer, 'teams', 'create') ? (
        <Card title="New team" className="mt-6 max-w-lg">
          <ActionForm action={saveTeamAction} className="space-y-4">
            <Field label="Name" name="name">
              <input id="name" name="name" required className="field" />
            </Field>
            <Field label="Description" name="description">
              <textarea id="description" name="description" rows={2} className="field" />
            </Field>
            <SubmitButton>Create team</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
    </>
  )
}
