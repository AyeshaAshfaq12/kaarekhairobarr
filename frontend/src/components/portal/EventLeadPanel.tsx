import Link from 'next/link'
import React from 'react'
import { prisma } from '@/lib/portal/db'
import { eventSummary } from '@/lib/portal/events'
import type { Viewer } from '@/lib/portal/rbac'
import { formatDate, formatPKR } from '@/lib/portal/time'
import { Card, ProgressBar } from './ui'

/** Event Lead dashboard (§10.1): collected vs target, spent vs budget, open work, expenses waiting. */
export default async function EventLeadPanel({ viewer }: { viewer: Viewer & { memberId: string } }) {
  const events = await prisma.event.findMany({
    where: { deletedAt: null, status: { in: ['PLANNING', 'LIVE'] }, OR: [{ leadId: viewer.memberId }, { responsibilities: { some: { memberId: viewer.memberId } } }] },
    include: {
      responsibilities: { where: { status: { notIn: ['DONE', 'CANCELLED'] } }, select: { id: true } },
      expenses: { where: { status: 'SUBMITTED' }, select: { id: true } },
    },
    orderBy: { startsAt: 'asc' },
  })
  const summaries = await Promise.all(events.map((event) => eventSummary(event.id)))
  return (
    <>
      {events.map((event, index) => {
        const s = summaries[index]
        return (
          <Card key={event.id} title={<Link href={`/portal/events/${event.id}`} className="hover:text-forest-700">{event.name}</Link>} actions={<span className="text-xs text-ink-500">{formatDate(event.startsAt)}</span>}>
            <div className="space-y-3 text-sm">
              <div>
                <div className="flex justify-between">
                  <span>Collected</span>
                  <span className="font-semibold">
                    {formatPKR(s.collected)} / {formatPKR(s.collectionTarget)}
                  </span>
                </div>
                <ProgressBar value={s.collected} max={s.collectionTarget} className="mt-1" />
              </div>
              <div>
                <div className="flex justify-between">
                  <span>Spent</span>
                  <span className={`font-semibold ${s.spent + s.awaitingApproval > s.budget ? 'text-clay-600' : ''}`}>
                    {formatPKR(s.spent)} / {formatPKR(s.budget)}
                  </span>
                </div>
                <ProgressBar value={s.spent} max={s.budget} className="mt-1" />
              </div>
              <p className="text-xs text-ink-500">
                {event.responsibilities.length} open responsibilities · {event.expenses.length} expenses awaiting approval
              </p>
            </div>
          </Card>
        )
      })}
    </>
  )
}
