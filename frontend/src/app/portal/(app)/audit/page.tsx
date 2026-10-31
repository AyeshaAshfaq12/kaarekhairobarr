import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/portal/db'
import { can, requireActiveViewer } from '@/lib/portal/rbac'
import { formatDateTime } from '@/lib/portal/time'
import { Card, EmptyState, PageHeader, humanize } from '@/components/portal/ui'

export const metadata: Metadata = { title: 'Audit log | KKB Portal' }

const PAGE_SIZE = 50

type SearchParams = { actor?: string; entity?: string; action?: string; from?: string; to?: string; page?: string }

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requireActiveViewer()
  if (!can(viewer, 'audit', 'view')) notFound()

  const page = Math.max(1, Number(searchParams.page) || 1)
  const from = searchParams.from ? new Date(`${searchParams.from}T00:00:00+05:00`) : undefined
  const to = searchParams.to ? new Date(`${searchParams.to}T23:59:59.999+05:00`) : undefined
  const where: Prisma.AuditLogWhereInput = {
    ...(searchParams.entity ? { entity: searchParams.entity } : {}),
    ...(searchParams.action ? { action: searchParams.action } : {}),
    ...(from || to ? { at: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(searchParams.actor
      ? {
          actor: {
            OR: [
              { email: { contains: searchParams.actor, mode: 'insensitive' } },
              { member: { fullName: { contains: searchParams.actor, mode: 'insensitive' } } },
            ],
          },
        }
      : {}),
  }

  const [total, entries, entities, actions] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { at: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { actor: { select: { email: true, member: { select: { fullName: true } } } } },
    }),
    prisma.auditLog.findMany({ distinct: ['entity'], select: { entity: true }, orderBy: { entity: 'asc' } }),
    prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
  ])
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageHref = (target: number) =>
    `/portal/audit?${new URLSearchParams(Object.entries({ ...searchParams, page: String(target) }).filter(([, value]) => value) as [string, string][]).toString()}`

  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of every change, login and export." />
      <form action="/portal/audit" className="mb-4 grid gap-2 sm:grid-cols-6">
        <input name="actor" defaultValue={searchParams.actor} placeholder="Actor name or email" className="field sm:col-span-2" />
        <select name="entity" defaultValue={searchParams.entity ?? ''} className="field">
          <option value="">All entities</option>
          {entities.map((row) => (
            <option key={row.entity}>{row.entity}</option>
          ))}
        </select>
        <select name="action" defaultValue={searchParams.action ?? ''} className="field">
          <option value="">All actions</option>
          {actions.map((row) => (
            <option key={row.action}>{row.action}</option>
          ))}
        </select>
        <input type="date" name="from" defaultValue={searchParams.from} aria-label="From" className="field" />
        <div className="flex gap-2">
          <input type="date" name="to" defaultValue={searchParams.to} aria-label="To" className="field min-w-0" />
          <button className="btn-secondary shrink-0">Filter</button>
        </div>
      </form>

      <Card className="p-0 sm:p-0">
        {entries.length === 0 ? (
          <div className="p-4">
            <EmptyState>No entries match.</EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-ink-900/5">
            {entries.map((entry) => (
              <li key={entry.id} className="px-4 py-3 text-sm sm:px-6">
                <details>
                  <summary className="cursor-pointer list-none">
                    <span className="font-semibold text-ink-900">{entry.actor?.member?.fullName ?? entry.actor?.email ?? 'System / anonymous'}</span>{' '}
                    <span className="text-ink-600">{humanize(entry.action)}</span>{' '}
                    <span className="text-ink-500">
                      {entry.entity} {entry.entity === 'Member' ? <Link href={`/portal/members/${entry.entityId}`} className="underline">{entry.entityId.slice(-6)}</Link> : entry.entityId.slice(-10)}
                    </span>
                    <span className="block text-xs text-ink-400">
                      {formatDateTime(entry.at)}
                      {entry.ip ? ` · ${entry.ip}` : ''}
                      {entry.reason ? ` · ${entry.reason}` : ''}
                    </span>
                  </summary>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <pre className="overflow-x-auto rounded-xl bg-cream-50 p-3 text-xs">{JSON.stringify(entry.before, null, 2) ?? '—'}</pre>
                    <pre className="overflow-x-auto rounded-xl bg-forest-50 p-3 text-xs">{JSON.stringify(entry.after, null, 2) ?? '—'}</pre>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {pages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm">
          {page > 1 ? <Link href={pageHref(page - 1)} className="btn-outline">Newer</Link> : <span />}
          <span className="text-ink-500">
            Page {page} of {pages}
          </span>
          {page < pages ? <Link href={pageHref(page + 1)} className="btn-outline">Older</Link> : <span />}
        </div>
      ) : null}
    </>
  )
}
