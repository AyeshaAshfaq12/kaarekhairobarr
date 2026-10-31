import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@/lib/portal/db'
import { raisedByGroup, raisedByMember, targetsByMember } from '@/lib/portal/metrics'
import { can, requireActiveViewer } from '@/lib/portal/rbac'
import { formatDateTime, formatPKR, monthKey } from '@/lib/portal/time'
import type { NotificationPayload } from '@/lib/portal/notify'
import Checklist, { loadChecklist } from '@/components/portal/Checklist'
import NewMembersWidget from '@/components/portal/NewMembersWidget'
import { Card, EmptyState, PageHeader, ProgressBar, Stat } from '@/components/portal/ui'

export const metadata: Metadata = { title: 'Dashboard | KKB Portal' }

// One route; widgets depend on the viewer's permissions (§10.1). Every number is scoped.
export default async function DashboardPage() {
  const viewer = await requireActiveViewer()
  const month = monthKey()

  const [checklist, raised, targets, teams, notifications] = await Promise.all([
    loadChecklist(viewer.memberId),
    raisedByMember([viewer.memberId], month),
    targetsByMember([viewer.memberId], month),
    prisma.team.findMany({
      where: { memberships: { some: { memberId: viewer.memberId } }, isGeneral: false },
      include: { memberships: { where: { member: { status: 'ACTIVE' } }, select: { memberId: true } } },
    }),
    prisma.notification.findMany({ where: { userId: viewer.userId }, orderBy: { createdAt: 'desc' }, take: 5 }),
  ])
  const checklistIncomplete = checklist.some((row) => !row.doneAt)
  const myRaised = raised.get(viewer.memberId) ?? 0
  const myTarget = targets.get(viewer.memberId)
  const teamTotals = await Promise.all(
    teams.map(async (team) => ({ id: team.id, name: team.name, raised: await raisedByGroup(team.memberships.map((m) => m.memberId), month) }))
  )

  return (
    <>
      <PageHeader title={`Assalam o Alaikum, ${viewer.fullName.split(' ')[0]}`} description={`Your overview for ${month}.`} />

      {viewer.isAdmin ? <AdminStrip /> : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="My month">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Raised" value={formatPKR(myRaised)} hint="Verified only" />
            <Stat label="Target" value={myTarget !== undefined ? formatPKR(myTarget) : '—'} hint={myTarget ? `${Math.round((myRaised / myTarget) * 100)}% achieved` : 'No target set'} />
          </div>
          {myTarget ? <ProgressBar value={myRaised} max={myTarget} className="mt-4" /> : null}
          {teamTotals.length ? (
            <div className="mt-5 border-t border-ink-900/5 pt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">My teams this month</p>
              <ul className="space-y-1 text-sm">
                {teamTotals.map((team) => (
                  <li key={team.id} className="flex justify-between">
                    <Link href={`/portal/teams/${team.id}`} className="text-ink-700 hover:text-forest-700">
                      {team.name}
                    </Link>
                    <span className="font-semibold">{formatPKR(team.raised)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>

        {checklistIncomplete ? (
          <Card title="Getting started" actions={<Link href="/portal/onboarding" className="text-sm font-medium text-forest-700">Open</Link>}>
            <Checklist viewer={viewer} memberId={viewer.memberId} rows={checklist} />
          </Card>
        ) : null}

        <NewMembersWidget viewer={viewer} />

        <Card title="Recent notifications" actions={<Link href="/portal/notifications" className="text-sm font-medium text-forest-700">All</Link>}>
          {notifications.length === 0 ? (
            <EmptyState>Nothing new.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {notifications.map((notification) => {
                const payload = notification.payload as unknown as NotificationPayload
                return (
                  <li key={notification.id} className="text-sm">
                    <p className={notification.readAt ? 'text-ink-700' : 'font-semibold text-ink-900'}>{payload.title}</p>
                    <p className="text-xs text-ink-400">{formatDateTime(notification.createdAt)}</p>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  )

  async function AdminStrip() {
    const [pending, active, inactive, orgRaised] = await Promise.all([
      prisma.member.count({ where: { status: 'PENDING_APPROVAL' } }),
      prisma.member.count({ where: { status: 'ACTIVE' } }),
      prisma.member.count({ where: { status: 'INACTIVE' } }),
      can(viewer, 'donations', 'view') ? raisedByGroup('all', month) : Promise.resolve(null),
    ])
    return (
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Link href="/portal/members/pending" className="block">
          <Stat label="Awaiting approval" value={pending} hint={pending ? 'Review now →' : 'Queue empty'} />
        </Link>
        <Stat label="Active members" value={active} />
        <Stat label="Paused" value={inactive} />
        <Stat label="Org raised" value={orgRaised === null ? '—' : formatPKR(orgRaised)} hint="This month, verified" />
      </div>
    )
  }
}
