import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { can, requireActiveViewer } from '@/lib/portal/rbac'
import { Card, PageHeader } from '@/components/portal/ui'
import EventForm from '../EventForm'

export const metadata: Metadata = { title: 'New event | KKB Portal' }

export default async function NewEventPage() {
  const viewer = await requireActiveViewer()
  if (!viewer.isAdmin && !can(viewer, 'events', 'create')) notFound()
  return (
    <>
      <PageHeader title="New event" description="An EVENT case is created with it to hold the collection target." />
      <Card className="max-w-3xl">
        <EventForm selfId={viewer.memberId} />
      </Card>
    </>
  )
}
