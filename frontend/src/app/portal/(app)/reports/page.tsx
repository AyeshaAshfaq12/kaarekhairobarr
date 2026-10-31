import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/portal/db'
import { eventWhere } from '@/lib/portal/events'
import { getSubtreeIds } from '@/lib/portal/hierarchy'
import { requireActiveViewer, scopeFor } from '@/lib/portal/rbac'
import { REPORTS, ReportNotFound, buildReport, formatCell, scopeOptions, type ReportKey } from '@/lib/portal/reports'
import { monthKey } from '@/lib/portal/time'
import ExportLinks from '@/components/portal/ExportLinks'
import { Card, EmptyState, PageHeader, Tabs } from '@/components/portal/ui'

export const metadata: Metadata = { title: 'Reports | KKB Portal' }

type SearchParams = { report?: string; month?: string; scope?: string; teamId?: string; memberId?: string; eventId?: string; caseId?: string }

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requireActiveViewer()
  const key = (searchParams.report && searchParams.report in REPORTS ? searchParams.report : 'impact') as keyof typeof REPORTS
  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? '') ? searchParams.month! : monthKey()
  const reportsScope = scopeFor(viewer, 'reports', 'view')

  // Pickers, limited to what the viewer can see.
  const [scopes, teams, members, events] = await Promise.all([
    scopeOptions(viewer),
    key === 'team' ? scopeOptions(viewer).then((options) => options.filter((o) => o.value.startsWith('team:'))) : Promise.resolve([]),
    key === 'member'
      ? prisma.member.findMany({
          where: { status: { in: ['ACTIVE', 'INACTIVE'] }, ...(reportsScope === 'all' ? {} : { id: { in: reportsScope === 'subtree' ? [...(await getSubtreeIds(viewer.memberId))] : [viewer.memberId] } }) },
          select: { id: true, fullName: true },
          orderBy: { fullName: 'asc' },
        })
      : Promise.resolve([]),
    key === 'event' ? prisma.event.findMany({ where: await eventWhere(viewer), select: { id: true, name: true }, orderBy: { startsAt: 'desc' } }) : Promise.resolve([]),
  ])
  const params: Record<string, string | undefined> = {
    month,
    scope: searchParams.scope,
    teamId: searchParams.teamId ?? teams[0]?.value.slice(5),
    memberId: searchParams.memberId,
    eventId: searchParams.eventId ?? events[0]?.id,
    caseId: searchParams.caseId,
  }

  let report
  try {
    const needsSubject = (key === 'team' && !params.teamId) || (key === 'event' && !params.eventId)
    report = needsSubject ? null : await buildReport(viewer, key as ReportKey, params, monthKey())
  } catch (error) {
    if (error instanceof ReportNotFound) notFound()
    throw error
  }

  const tabs = (Object.keys(REPORTS) as (keyof typeof REPORTS)[]).filter((k) => k !== 'onboarding' || viewer.isAdmin || scopeFor(viewer, 'onboarding', 'view') === 'all').map((k) => ({ key: k, label: REPORTS[k], href: `/portal/reports?report=${k}&month=${month}` }))
  const usesMonth = ['impact', 'team', 'member', 'onboarding', 'donations'].includes(key)

  return (
    <>
      <PageHeader title="Reports" description="Every number is limited to what you can see. Closed months read frozen snapshots." />
      <Tabs tabs={tabs} active={key} />

      <form action="/portal/reports" className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="report" value={key} />
        {usesMonth ? <input type="month" name="month" defaultValue={month} aria-label="Month" className="field !w-auto" /> : null}
        {key === 'impact' ? (
          <select name="scope" defaultValue={searchParams.scope ?? 'self'} aria-label="Scope" className="field !w-auto">
            {scopes.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : null}
        {key === 'team' ? (
          <select name="teamId" defaultValue={params.teamId} aria-label="Team" className="field !w-auto">
            {teams.map((option) => (
              <option key={option.value} value={option.value.slice(5)}>
                {option.label}
              </option>
            ))}
          </select>
        ) : null}
        {key === 'member' ? (
          <select name="memberId" defaultValue={searchParams.memberId ?? viewer.memberId} aria-label="Member" className="field !w-auto">
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.fullName}
              </option>
            ))}
          </select>
        ) : null}
        {key === 'event' ? (
          <select name="eventId" defaultValue={params.eventId} aria-label="Event" className="field !w-auto">
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name}
              </option>
            ))}
          </select>
        ) : null}
        <button className="btn-secondary">Show</button>
      </form>

      {!report ? (
        <EmptyState>{key === 'team' ? "You don't lead any team." : 'No events you can see.'}</EmptyState>
      ) : (
        <>
          <ExportLinks report={key} params={params} />
          <p className="mb-3 text-sm text-ink-600">
            <span className="font-semibold text-ink-900">{report.title}</span> · {report.scopeLabel} · {report.period}
          </p>
          {report.notes?.map((note) => (
            <p key={note} className="mb-3 text-sm text-ink-600">
              {note}
            </p>
          ))}
          <div className="space-y-5">
            {report.tables.map((table) => (
              <Card key={table.name} title={table.name} className="p-0 sm:p-0">
                {table.rows.length === 0 ? (
                  <div className="p-4">
                    <EmptyState>No rows.</EmptyState>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-cream-50 text-xs uppercase tracking-wide text-ink-500">
                        <tr>
                          {table.columns.map((column) => (
                            <th key={column.key} className={`whitespace-nowrap px-3 py-2.5 ${column.kind && column.kind !== 'text' ? 'text-right' : ''}`}>
                              {column.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ink-900/5">
                        {table.rows.map((row, index) => (
                          <tr key={index}>
                            {table.columns.map((column) => (
                              <td key={column.key} className={`whitespace-nowrap px-3 py-2 ${column.kind && column.kind !== 'text' ? 'text-right' : ''}`}>
                                {formatCell(row[column.key], column.kind)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  )
}
