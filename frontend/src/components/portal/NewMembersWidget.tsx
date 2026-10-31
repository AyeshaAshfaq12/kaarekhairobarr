import Link from 'next/link'
import React from 'react'
import { prisma } from '@/lib/portal/db'
import { memberIdFilter, scopeFor, visibleMemberIds, type Viewer } from '@/lib/portal/rbac'
import { daysBetween } from '@/lib/portal/time'
import { Card, EmptyState, ProgressBar } from './ui'

const WINDOW_DAYS = 60

/** Leads see checklist progress for everyone in their subtree who joined in the last 60 days (§5.4). */
export default async function NewMembersWidget({ viewer }: { viewer: Viewer }) {
  const scope = scopeFor(viewer, 'onboarding', 'view')
  if (!scope || scope === 'own' || scope === 'assigned') return null

  const visible = await visibleMemberIds(viewer, 'onboarding', 'view')
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
  const members = await prisma.member.findMany({
    where: { id: { ...memberIdFilter(visible), not: viewer.memberId ?? undefined }, status: 'ACTIVE', joinedAt: { gte: since } },
    orderBy: { joinedAt: 'desc' },
    select: {
      id: true,
      fullName: true,
      joinedAt: true,
      onboarding: { where: { item: { isActive: true } }, select: { doneAt: true } },
    },
  })

  return (
    <Card title="New members" actions={<span className="text-xs text-ink-500">Last {WINDOW_DAYS} days</span>}>
      {members.length === 0 ? (
        <EmptyState>No new members recently.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {members.map((member) => {
            const done = member.onboarding.filter((row) => row.doneAt).length
            return (
              <li key={member.id}>
                <Link href={`/portal/members/${member.id}?tab=onboarding`} className="block rounded-2xl px-1 py-1 hover:bg-cream-50">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-ink-900">{member.fullName}</span>
                    <span className="text-xs text-ink-500">
                      day {daysBetween(member.joinedAt!)} · {done}/{member.onboarding.length}
                    </span>
                  </div>
                  <ProgressBar value={done} max={member.onboarding.length} className="mt-1.5" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
