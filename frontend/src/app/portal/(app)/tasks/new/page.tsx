import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { can, requireActiveViewer } from '@/lib/portal/rbac'
import { Card, PageHeader } from '@/components/portal/ui'
import TaskForm from '../TaskForm'

export const metadata: Metadata = { title: 'New task | KKB Portal' }

export default async function NewTaskPage({ searchParams }: { searchParams: { teamId?: string; eventId?: string; caseId?: string; back?: string } }) {
  const viewer = await requireActiveViewer()
  if (!can(viewer, 'tasks', 'create') && !viewer.isAdmin) notFound()
  return (
    <>
      <PageHeader title="New task" />
      <Card className="max-w-3xl">
        <TaskForm viewer={viewer} defaults={{ teamId: searchParams.teamId, eventId: searchParams.eventId, caseId: searchParams.caseId }} back={searchParams.back} />
      </Card>
    </>
  )
}
