import type { Metadata } from 'next'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/portal/db'
import { getRequestMeta } from '@/lib/portal/auth'
import { writeAudit } from '@/lib/portal/audit'
import { requireActiveViewer } from '@/lib/portal/rbac'
import type { NotificationPayload } from '@/lib/portal/notify'
import { formatDateTime } from '@/lib/portal/time'
import { Card, EmptyState, PageHeader } from '@/components/portal/ui'

export const metadata: Metadata = { title: 'Notifications | KKB Portal' }

async function markAllRead() {
  'use server'
  const viewer = await requireActiveViewer()
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.notification.updateMany({ where: { userId: viewer.userId, readAt: null }, data: { readAt: new Date() } })
    await writeAudit(tx, { actorId: viewer.userId, action: 'mark_read', entity: 'Notification', entityId: viewer.userId, after: { count }, ip: getRequestMeta().ip })
  })
  revalidatePath('/portal', 'layout')
}

export default async function NotificationsPage() {
  const viewer = await requireActiveViewer()
  const notifications = await prisma.notification.findMany({ where: { userId: viewer.userId }, orderBy: { createdAt: 'desc' }, take: 100 })
  const unread = notifications.filter((notification) => !notification.readAt).length

  return (
    <>
      <PageHeader
        title="Notifications"
        description={unread ? `${unread} unread` : 'All caught up'}
        actions={
          unread ? (
            <form action={markAllRead}>
              <button className="btn-secondary">Mark all read</button>
            </form>
          ) : null
        }
      />
      <Card className="p-0 sm:p-0">
        {notifications.length === 0 ? (
          <div className="p-4">
            <EmptyState>No notifications yet.</EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-ink-900/5">
            {notifications.map((notification) => {
              const payload = notification.payload as unknown as NotificationPayload
              const body = (
                <>
                  <p className={`text-sm ${notification.readAt ? 'text-ink-700' : 'font-semibold text-ink-900'}`}>
                    {!notification.readAt ? <span className="mr-2 inline-block h-2 w-2 rounded-full bg-clay-500 align-middle" /> : null}
                    {payload.title}
                  </p>
                  {payload.body ? <p className="mt-0.5 whitespace-pre-line text-sm text-ink-500">{payload.body}</p> : null}
                  <p className="mt-1 text-xs text-ink-400">{formatDateTime(notification.createdAt)}</p>
                </>
              )
              return (
                <li key={notification.id} className="px-4 py-3 sm:px-6">
                  {payload.href ? (
                    <Link href={payload.href} className="block hover:opacity-80">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </>
  )
}
