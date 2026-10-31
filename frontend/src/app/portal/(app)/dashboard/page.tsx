import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@/lib/portal/db'
import { getSubtreeIds } from '@/lib/portal/hierarchy'
import { can, requireActiveViewer } from '@/lib/portal/rbac'
import { monthKey } from '@/lib/portal/time'
import Checklist, { loadChecklist } from '@/components/portal/Checklist'
import NewMembersWidget from '@/components/portal/NewMembersWidget'
import {
  AdminPanel,
  CasesOverview,
  FinancePanel,
  FollowUpsDue,
  MyCases,
  MyMonth,
  MyTasks,
  MyTeams,
  PendingFromSubtree,
  SubtreeTable,
  SubtreeTrend,
  TeamKanbanSummary,
} from '@/components/portal/DashboardWidgets'
import EventLeadPanel from '@/components/portal/EventLeadPanel'
import { Card, PageHeader } from '@/components/portal/ui'

export const metadata: Metadata = { title: 'Dashboard | KKB Portal' }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-forest-700">{title}</h2>
      <div className="grid gap-5 lg:grid-cols-2">{children}</div>
    </section>
  )
}

// One route; widgets depend on the viewer's permissions (§10.1). Every number is scoped.
export default async function DashboardPage() {
  const viewer = await requireActiveViewer()
  const month = monthKey()
  const [checklist, subtree, ledEvents] = await Promise.all([
    loadChecklist(viewer.memberId),
    getSubtreeIds(viewer.memberId),
    prisma.event.count({ where: { deletedAt: null, status: { in: ['PLANNING', 'LIVE'] }, OR: [{ leadId: viewer.memberId }, { responsibilities: { some: { memberId: viewer.memberId } } }] } }),
  ])
  const isLead = subtree.size > 1
  const isFinance = can(viewer, 'donations', 'verify') && !viewer.isAdmin
  const checklistIncomplete = checklist.some((row) => !row.doneAt)

  return (
    <>
      <PageHeader title={`Assalam o Alaikum, ${viewer.fullName.split(' ')[0]}`} description={`Your overview for ${month}.`} />

      {viewer.isAdmin ? (
        <Section title="Organisation">
          <AdminPanel month={month} />
          <CasesOverview />
        </Section>
      ) : null}

      {isFinance ? (
        <Section title="Finance">
          <FinancePanel viewer={viewer} month={month} />
        </Section>
      ) : null}

      <Section title="Me">
        <MyMonth viewer={viewer} month={month} />
        {checklistIncomplete ? (
          <Card title="Getting started" actions={<Link href="/portal/onboarding" className="text-sm font-medium text-forest-700">Open</Link>}>
            <Checklist viewer={viewer} memberId={viewer.memberId} rows={checklist} />
          </Card>
        ) : null}
        <FollowUpsDue viewer={viewer} />
        <MyTasks viewer={viewer} />
        <MyCases viewer={viewer} />
        <MyTeams viewer={viewer} month={month} />
      </Section>

      {ledEvents ? (
        <Section title="My events">
          <EventLeadPanel viewer={viewer} />
        </Section>
      ) : null}

      {isLead ? (
        <Section title="My subtree">
          <SubtreeTable viewer={viewer} month={month} />
          <SubtreeTrend viewer={viewer} month={month} />
          <PendingFromSubtree viewer={viewer} />
          <NewMembersWidget viewer={viewer} />
          <TeamKanbanSummary viewer={viewer} />
        </Section>
      ) : null}
    </>
  )
}
