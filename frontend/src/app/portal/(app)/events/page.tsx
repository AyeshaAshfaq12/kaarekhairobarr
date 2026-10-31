import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@/lib/portal/db'
import { eventSummary, eventWhere } from '@/lib/portal/events'
import { can, requireActiveViewer } from '@/lib/portal/rbac'
import { formatDateTime, formatPKR } from '@/lib/portal/time'
import { Badge, Card, EmptyState, PageHeader, ProgressBar, humanize } from '@/components/portal/ui'

export const metadata: Metadata = { title: 'Events | KKB Portal' }

const STATUS_TONE = { PLANNING: 'blue', LIVE: 'green', COMPLETED: 'neutral', CANCELLED: 'red' } as const

export default async function EventsPage({ searchParams }: { searchParams: { past?: string } }) {
  const viewer = await requireActiveViewer()
  const events = await prisma.event.findMany({
    where: { AND: [await eventWhere(viewer), searchParams.past ? { status: { in: ['COMPLETED', 'CANCELLED'] } } : { status: { in: ['PLANNING', 'LIVE'] } }] },
    include: { lead: { select: { fullName: true } } },
    orderBy: { startsAt: searchParams.past ? 'desc' : 'asc' },
    take: 50,
  })
  const summaries = await Promise.all(events.map((event) => eventSummary(event.id)))

  return (
    <>
      <PageHeader
        title="Events"
        description="Each event has a lead, a budget, and a collection case."
        actions={
          <>
            <Link href={searchParams.past ? '/portal/events' : '/portal/events?past=1'} className="btn-outline">
              {searchParams.past ? 'Upcoming' : 'Past events'}
            </Link>
            {viewer.isAdmin || can(viewer, 'events', 'create') ? <Link href="/portal/events/new" className="btn-primary">New event</Link> : null}
          </>
        }
      />
      {events.length === 0 ? <EmptyState>No events to show.</EmptyState> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {events.map((event, index) => {
          const s = summaries[index]
          return (
            <Link key={event.id} href={`/portal/events/${event.id}`}>
              <Card className="h-full transition hover:-translate-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-display text-lg font-semibold">{event.name}</h2>
                  <Badge tone={STATUS_TONE[event.status]}>{humanize(event.status)}</Badge>
                </div>
                <p className="text-xs text-ink-500">
                  {formatDateTime(event.startsAt)}
                  {event.venue ? ` · ${event.venue}` : ''} · lead {event.lead.fullName}
                </p>
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Collected</span>
                    <span>
                      {formatPKR(s.collected)} / {formatPKR(s.collectionTarget)}
                    </span>
                  </div>
                  <ProgressBar value={s.collected} max={s.collectionTarget} />
                  <div className="flex justify-between">
                    <span>Spent</span>
                    <span className={s.spent + s.awaitingApproval > s.budget ? 'font-semibold text-clay-600' : ''}>
                      {formatPKR(s.spent)} / {formatPKR(s.budget)}
                    </span>
                  </div>
                </div>
              </Card>
            </Link>
          )
        })}
      </div>
    </>
  )
}
