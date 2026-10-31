import Link from 'next/link'
import React from 'react'
import { prisma } from '@/lib/portal/db'
import { getSubtreeIds } from '@/lib/portal/hierarchy'
import {
  followUpsOverdue,
  formatRatio,
  groupMetrics,
  isOverdue,
  memberMetrics,
  statusBand,
  taskMetrics,
  trend,
} from '@/lib/portal/metrics'
import { caseProgress, donationWhere } from '@/lib/portal/money'
import type { Viewer } from '@/lib/portal/rbac'
import { getSettings } from '@/lib/portal/settings'
import { dayRange, daysBetween, formatDate, formatPKR } from '@/lib/portal/time'
import TrendChart from './TrendChart'
import { BandBadge, Badge, Card, EmptyState, ProgressBar, SplitProgress, Stat, TASK_STATUS_TONE, humanize } from './ui'

type ActiveViewer = Viewer & { memberId: string }

async function thresholds() {
  const settings = await getSettings()
  return { onTrack: settings.bandOnTrack, close: settings.bandClose }
}

// ---------- Member ----------

export async function MyMonth({ viewer, month }: { viewer: ActiveViewer; month: string }) {
  const [metrics, overdue, bands] = await Promise.all([memberMetrics([viewer.memberId], month), followUpsOverdue([viewer.memberId]), thresholds()])
  const m = metrics.get(viewer.memberId)!
  return (
    <Card title="My month" actions={<BandBadge band={statusBand(m.achievement, bands)} />}>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Raised" value={formatPKR(m.raised)} hint={m.amountTarget != null ? `of ${formatPKR(m.amountTarget)} · ${formatRatio(m.achievement)}` : 'No target set'} />
        <Stat label="Pending" value={formatPKR(m.pending)} hint="Awaiting verification" />
        <Stat label="Conversion" value={formatRatio(m.conversionRate)} hint={`${m.converted} of ${m.reached} reached gave`} />
        <Stat label="Follow-ups overdue" value={overdue.get(viewer.memberId) ?? 0} />
      </div>
      {m.amountTarget ? <ProgressBar value={m.raised} max={m.amountTarget} className="mt-4" /> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/portal/outreach" className="btn-primary">
          Log outreach
        </Link>
        <Link href="/portal/donations/new" className="btn-secondary">
          Log donation
        </Link>
      </div>
    </Card>
  )
}

export async function FollowUpsDue({ viewer }: { viewer: ActiveViewer }) {
  const { end } = dayRange()
  const rows = await prisma.outreach.findMany({
    where: { memberId: viewer.memberId, followUpAt: { lt: end }, outcome: { notIn: ['DONATED', 'DECLINED'] } },
    include: { donor: { select: { id: true, fullName: true } } },
    orderBy: { followUpAt: 'asc' },
    take: 25,
  })
  const due = []
  for (const row of rows) {
    const later = await prisma.outreach.count({ where: { donorId: row.donorId, contactedAt: { gt: row.contactedAt } } })
    const donated = await prisma.donation.count({ where: { donorId: row.donorId, receivedAt: { gt: row.contactedAt }, status: { not: 'REJECTED' } } })
    if (!later && !donated) due.push(row)
    if (due.length === 5) break
  }
  return (
    <Card title="My follow-ups due" actions={<Link href="/portal/outreach" className="text-sm font-medium text-forest-700">All</Link>}>
      {due.length === 0 ? (
        <EmptyState>No follow-ups due.</EmptyState>
      ) : (
        <ul className="space-y-2 text-sm">
          {due.map((row) => (
            <li key={row.id} className="flex justify-between gap-2">
              <Link href={`/portal/donors/${row.donor.id}`} className="font-medium hover:text-forest-700">
                {row.donor.fullName}
              </Link>
              <span className={row.followUpAt! < dayRange().start ? 'font-semibold text-clay-600' : 'text-ink-500'}>{formatDate(row.followUpAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

export async function MyTasks({ viewer }: { viewer: ActiveViewer }) {
  const soon = new Date(Date.now() + 7 * 86_400_000)
  const tasks = await prisma.task.findMany({
    where: { assigneeId: viewer.memberId, deletedAt: null, status: { notIn: ['DONE', 'CANCELLED'] }, OR: [{ dueAt: { lte: soon } }, { dueAt: null }] },
    include: { team: { select: { name: true } } },
    orderBy: [{ dueAt: 'asc' }],
    take: 8,
  })
  return (
    <Card title="My tasks" actions={<Link href="/portal/tasks?mine=1" className="text-sm font-medium text-forest-700">All</Link>}>
      {tasks.length === 0 ? (
        <EmptyState>Nothing due this week.</EmptyState>
      ) : (
        <ul className="space-y-2 text-sm">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-center justify-between gap-2">
              <Link href={`/portal/tasks/${task.id}`} className="min-w-0 truncate font-medium hover:text-forest-700">
                {task.title}
              </Link>
              <span className={`shrink-0 text-xs ${isOverdue(task) ? 'font-semibold text-clay-600' : 'text-ink-500'}`}>{task.dueAt ? formatDate(task.dueAt) : task.team.name}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

export async function MyCases({ viewer }: { viewer: ActiveViewer }) {
  const cases = await prisma.case.findMany({
    where: { deletedAt: null, status: { in: ['OPEN', 'FUNDED'] }, assignments: { some: { memberId: viewer.memberId } } },
    orderBy: { startDate: 'desc' },
    take: 6,
  })
  if (cases.length === 0) return null
  const progress = await caseProgress(cases.map((kase) => kase.id))
  return (
    <Card title="Cases assigned to me">
      <ul className="space-y-3">
        {cases.map((kase) => {
          const p = progress.get(kase.id)!
          return (
            <li key={kase.id}>
              <Link href={`/portal/cases/${kase.id}`} className="block text-sm hover:opacity-80">
                <span className="flex justify-between gap-2">
                  <span className="font-medium">{kase.title}</span>
                  <span className="text-xs text-ink-500">
                    {formatPKR(p.verified)} / {formatPKR(kase.targetAmount)}
                  </span>
                </span>
                <SplitProgress verified={p.verified} pending={p.pending} target={kase.targetAmount} className="mt-1.5" />
              </Link>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/** A member sees their own numbers plus their teams' totals, never other members' figures (§9.3). */
export async function MyTeams({ viewer, month }: { viewer: ActiveViewer; month: string }) {
  const teams = await prisma.team.findMany({
    where: { isGeneral: false, memberships: { some: { memberId: viewer.memberId } } },
    include: { memberships: { where: { member: { status: 'ACTIVE' } }, select: { memberId: true } }, targets: { where: { month } } },
  })
  if (teams.length === 0) return null
  const totals = await Promise.all(teams.map((team) => groupMetrics(team.memberships.map((m) => m.memberId), month, team.targets[0]?.amountTarget ?? null)))
  return (
    <Card title="My teams this month">
      <ul className="space-y-3 text-sm">
        {teams.map((team, index) => (
          <li key={team.id}>
            <div className="flex justify-between">
              <Link href={`/portal/teams/${team.id}`} className="font-medium hover:text-forest-700">
                {team.name}
              </Link>
              <span>
                <span className="font-semibold">{formatPKR(totals[index].raised)}</span>
                {team.targets[0] ? <span className="text-ink-500"> / {formatPKR(team.targets[0].amountTarget)}</span> : null}
              </span>
            </div>
            {team.targets[0] ? <ProgressBar value={totals[index].raised} max={team.targets[0].amountTarget} className="mt-1.5" /> : null}
          </li>
        ))}
      </ul>
    </Card>
  )
}

// ---------- Lead ----------

export async function SubtreeTable({ viewer, month }: { viewer: ActiveViewer; month: string }) {
  const ids = [...(await getSubtreeIds(viewer.memberId))]
  const [members, metrics, overdueTasks, bands] = await Promise.all([
    prisma.member.findMany({ where: { id: { in: ids }, status: 'ACTIVE' }, select: { id: true, fullName: true } }),
    memberMetrics(ids, month),
    prisma.task.groupBy({ by: ['assigneeId'], where: { assigneeId: { in: ids }, deletedAt: null, status: { notIn: ['DONE', 'CANCELLED'] }, dueAt: { lt: new Date() } }, _count: true }),
    thresholds(),
  ])
  const overdue = new Map(overdueTasks.map((row) => [row.assigneeId, row._count]))
  // Leaderboard within the viewer's own subtree only.
  const rows = members.map((member) => ({ member, m: metrics.get(member.id)! })).sort((a, b) => b.m.raised - a.m.raised)
  return (
    <Card title="My subtree this month" className="lg:col-span-2 p-0 sm:p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-cream-50 text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-2.5">Member</th>
              <th className="px-3 py-2.5 text-right">Reached</th>
              <th className="px-3 py-2.5 text-right">Converted</th>
              <th className="px-3 py-2.5 text-right">Conv.</th>
              <th className="px-3 py-2.5 text-right">Raised</th>
              <th className="px-3 py-2.5 text-right">Target</th>
              <th className="px-3 py-2.5 text-right">Achv.</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-4 py-2.5 text-right">Overdue tasks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-900/5">
            {rows.map(({ member, m }) => (
              <tr key={member.id}>
                <td className="px-4 py-2.5">
                  <Link href={`/portal/members/${member.id}`} className="font-medium hover:text-forest-700">
                    {member.fullName}
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-right">{m.reached}</td>
                <td className="px-3 py-2.5 text-right">{m.converted}</td>
                <td className="px-3 py-2.5 text-right">{formatRatio(m.conversionRate)}</td>
                <td className="px-3 py-2.5 text-right font-semibold">{formatPKR(m.raised)}</td>
                <td className="px-3 py-2.5 text-right">{m.amountTarget != null ? formatPKR(m.amountTarget) : '—'}</td>
                <td className="px-3 py-2.5 text-right">{formatRatio(m.achievement)}</td>
                <td className="px-3 py-2.5">
                  <BandBadge band={statusBand(m.achievement, bands)} />
                </td>
                <td className={`px-4 py-2.5 text-right ${overdue.get(member.id) ? 'font-semibold text-clay-600' : ''}`}>{overdue.get(member.id) ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

export async function SubtreeTrend({ viewer, month }: { viewer: ActiveViewer; month: string }) {
  const ids = [...(await getSubtreeIds(viewer.memberId))]
  const data = await trend(ids, month, 6, { kind: 'live' })
  return (
    <Card title="Subtree trend (6 months)">
      <TrendChart data={data} />
    </Card>
  )
}

export async function PendingFromSubtree({ viewer }: { viewer: ActiveViewer }) {
  const ids = [...(await getSubtreeIds(viewer.memberId))]
  const rows = await prisma.donation.findMany({
    where: { status: 'PENDING', credits: { some: { memberId: { in: ids } } } },
    include: { donor: { select: { fullName: true } }, credits: { include: { member: { select: { fullName: true } } } } },
    orderBy: { createdAt: 'asc' },
    take: 6,
  })
  const total = await prisma.donation.aggregate({ where: { status: 'PENDING', credits: { some: { memberId: { in: ids } } } }, _sum: { amount: true }, _count: true })
  return (
    <Card title={`Pending donations from my subtree (${total._count})`} actions={<span className="text-sm font-semibold">{formatPKR(total._sum.amount ?? 0)}</span>}>
      {rows.length === 0 ? (
        <EmptyState>Nothing pending.</EmptyState>
      ) : (
        <ul className="space-y-2 text-sm">
          {rows.map((donation) => (
            <li key={donation.id} className="flex justify-between gap-2">
              <Link href={`/portal/donations/${donation.id}`} className="min-w-0 truncate hover:text-forest-700">
                {donation.donor.fullName} · {donation.credits.map((credit) => credit.member.fullName).join(', ')}
              </Link>
              <span className="shrink-0 font-semibold">{formatPKR(donation.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

export async function TeamKanbanSummary({ viewer }: { viewer: ActiveViewer }) {
  const teams = await prisma.team.findMany({ where: { memberships: { some: { memberId: viewer.memberId, isLead: true } } }, select: { id: true, name: true } })
  if (teams.length === 0) return null
  const counts = await prisma.task.groupBy({ by: ['teamId', 'status'], where: { teamId: { in: teams.map((team) => team.id) }, deletedAt: null, status: { not: 'CANCELLED' } }, _count: true })
  return (
    <Card title="Teams I lead — tasks">
      <ul className="space-y-3">
        {teams.map((team) => (
          <li key={team.id}>
            <Link href={`/portal/tasks?teamId=${team.id}&view=board`} className="text-sm font-medium hover:text-forest-700">
              {team.name}
            </Link>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE'].map((status) => (
                <Badge key={status} tone={TASK_STATUS_TONE[status]}>
                  {humanize(status)} {counts.find((row) => row.teamId === team.id && row.status === status)?._count ?? 0}
                </Badge>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

// ---------- Finance ----------

export async function FinancePanel({ viewer, month }: { viewer: ActiveViewer; month: string }) {
  const verifyWhere = await donationWhere(viewer, 'verify')
  const [queue, oldest, byCase, expensesWaiting, nearCases] = await Promise.all([
    prisma.donation.count({ where: { AND: [{ status: 'PENDING' }, verifyWhere] } }),
    prisma.donation.findFirst({ where: { AND: [{ status: 'PENDING' }, verifyWhere] }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    groupVerifiedByCase(month),
    prisma.expense.aggregate({ where: { status: 'SUBMITTED' }, _count: true, _sum: { amount: true } }),
    prisma.case.findMany({ where: { deletedAt: null, status: { in: ['OPEN', 'FUNDED'] } }, select: { id: true, title: true, targetAmount: true } }),
  ])
  const progress = await caseProgress(nearCases.map((kase) => kase.id))
  const near = nearCases
    .map((kase) => ({ ...kase, ...progress.get(kase.id)! }))
    .filter((kase) => kase.verified >= kase.targetAmount * 0.8)
    .sort((a, b) => b.verified / b.targetAmount - a.verified / a.targetAmount)
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:col-span-2">
        <Link href="/portal/donations/verify">
          <Stat label="Verification queue" value={queue} hint={oldest ? `Oldest ${daysBetween(oldest.createdAt)} day(s)` : 'Empty'} />
        </Link>
        <Link href="/portal/expenses">
          <Stat label="Expenses awaiting" value={expensesWaiting._count} hint={formatPKR(expensesWaiting._sum.amount ?? 0)} />
        </Link>
        <Stat label="Verified this month" value={formatPKR(byCase.reduce((sum, row) => sum + row.amount, 0))} />
        <Stat label="Cases ≥ 80% funded" value={near.length} />
      </div>
      <Card title="Verified this month by case">
        {byCase.length === 0 ? (
          <EmptyState>Nothing verified yet this month.</EmptyState>
        ) : (
          <ul className="space-y-1 text-sm">
            {byCase.map((row) => (
              <li key={row.caseId} className="flex justify-between">
                <Link href={`/portal/cases/${row.caseId}`} className="hover:text-forest-700">
                  {row.title}
                </Link>
                <span className="font-semibold">{formatPKR(row.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Cases near or over target">
        {near.length === 0 ? (
          <EmptyState>None yet.</EmptyState>
        ) : (
          <ul className="space-y-3 text-sm">
            {near.map((kase) => (
              <li key={kase.id}>
                <Link href={`/portal/cases/${kase.id}`} className="flex justify-between hover:opacity-80">
                  <span className="font-medium">{kase.title}</span>
                  <span>{Math.round((kase.verified / kase.targetAmount) * 100)}%</span>
                </Link>
                <SplitProgress verified={kase.verified} pending={kase.pending} target={kase.targetAmount} className="mt-1.5" />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}

async function groupVerifiedByCase(month: string) {
  const [year, m] = month.split('-').map(Number)
  const start = new Date(Date.UTC(year, m - 1, 1, -5))
  const end = new Date(Date.UTC(year, m, 1, -5))
  const rows = await prisma.donation.groupBy({ by: ['caseId'], where: { status: 'VERIFIED', receivedAt: { gte: start, lt: end } }, _sum: { amount: true } })
  const cases = await prisma.case.findMany({ where: { id: { in: rows.map((row) => row.caseId) } }, select: { id: true, title: true } })
  return rows
    .map((row) => ({ caseId: row.caseId, title: cases.find((kase) => kase.id === row.caseId)?.title ?? '—', amount: row._sum.amount ?? 0 }))
    .sort((a, b) => b.amount - a.amount)
}

// ---------- Admin ----------

export async function AdminPanel({ month }: { month: string }) {
  const [org, orgTrend, pendingApprovals, queue, teams, inactive] = await Promise.all([
    groupMetrics('all', month),
    trend('all', month, 12, { kind: 'org' }),
    prisma.member.count({ where: { status: 'PENDING_APPROVAL' } }),
    prisma.donation.count({ where: { status: 'PENDING' } }),
    prisma.team.findMany({ where: { isGeneral: false }, include: { memberships: { select: { memberId: true } }, targets: { where: { month } } }, orderBy: { name: 'asc' } }),
    inactiveMembers(),
  ])
  const teamRows = await Promise.all(
    teams.map(async (team) => {
      const ids = team.memberships.map((membership) => membership.memberId)
      const [money, tasks] = await Promise.all([groupMetrics(ids, month, team.targets[0]?.amountTarget ?? null), taskMetrics(ids, month)])
      return { team, money, tasks }
    })
  )
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:col-span-2">
        <Stat label="Org raised" value={formatPKR(org.raised)} hint={`${formatPKR(org.pending)} pending`} />
        <Stat label="Conversion" value={formatRatio(org.conversionRate)} hint={`${org.converted} of ${org.reached} donors`} />
        <Link href="/portal/members/pending">
          <Stat label="Awaiting approval" value={pendingApprovals} />
        </Link>
        <Link href="/portal/donations/verify">
          <Stat label="Verification queue" value={queue} />
        </Link>
      </div>
      <Card title="Org trend (12 months)">
        <TrendChart data={orgTrend} />
      </Card>
      <Card title="Teams compared" className="p-0 sm:p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-cream-50 text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2.5">Team</th>
                <th className="px-3 py-2.5 text-right">Raised</th>
                <th className="px-3 py-2.5 text-right">Tasks done</th>
                <th className="px-4 py-2.5 text-right">On time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-900/5">
              {teamRows.map(({ team, money, tasks }) => (
                <tr key={team.id}>
                  <td className="px-4 py-2.5">
                    <Link href={`/portal/teams/${team.id}`} className="font-medium hover:text-forest-700">
                      {team.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold">{formatPKR(money.raised)}</td>
                  <td className="px-3 py-2.5 text-right">
                    {tasks.completed}/{tasks.assigned}
                  </td>
                  <td className="px-4 py-2.5 text-right">{formatRatio(tasks.onTimeRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title={`Inactive 30+ days (${inactive.length})`}>
        {inactive.length === 0 ? (
          <EmptyState>Everyone has been active this month.</EmptyState>
        ) : (
          <ul className="space-y-1 text-sm">
            {inactive.slice(0, 12).map((member) => (
              <li key={member.id}>
                <Link href={`/portal/members/${member.id}`} className="hover:text-forest-700">
                  {member.fullName}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}

/** Active members with no outreach, credited donation or task update in 30 days. */
async function inactiveMembers() {
  const since = new Date(Date.now() - 30 * 86_400_000)
  return prisma.member.findMany({
    where: {
      status: 'ACTIVE',
      joinedAt: { lt: since },
      outreach: { none: { contactedAt: { gte: since } } },
      donationCredits: { none: { donation: { receivedAt: { gte: since } } } },
      tasksAssigned: { none: { updatedAt: { gte: since } } },
    },
    select: { id: true, fullName: true },
    orderBy: { fullName: 'asc' },
  })
}

export async function CasesOverview() {
  const cases = await prisma.case.findMany({ where: { deletedAt: null, status: { in: ['OPEN', 'FUNDED'] } }, orderBy: { startDate: 'desc' }, take: 8 })
  const progress = await caseProgress(cases.map((kase) => kase.id))
  return (
    <Card title="Cases" actions={<Link href="/portal/cases" className="text-sm font-medium text-forest-700">All</Link>}>
      <ul className="space-y-3 text-sm">
        {cases.map((kase) => {
          const p = progress.get(kase.id)!
          return (
            <li key={kase.id}>
              <Link href={`/portal/cases/${kase.id}`} className="flex justify-between gap-2 hover:opacity-80">
                <span className="font-medium">{kase.title}</span>
                <span className="text-xs text-ink-500">
                  {formatPKR(p.verified)} / {formatPKR(kase.targetAmount)}
                </span>
              </Link>
              <SplitProgress verified={p.verified} pending={p.pending} target={kase.targetAmount} className="mt-1.5" />
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
