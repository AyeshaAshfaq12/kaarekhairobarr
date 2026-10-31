import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { can, requireActiveViewer } from '@/lib/portal/rbac'
import { Card, PageHeader } from '@/components/portal/ui'
import CaseForm from '../CaseForm'

export const metadata: Metadata = { title: 'New case | KKB Portal' }

export default async function NewCasePage() {
  const viewer = await requireActiveViewer()
  if (!can(viewer, 'cases', 'create')) notFound()
  return (
    <>
      <PageHeader title="New case" description="Event cases are created automatically with their event." />
      <Card>
        <CaseForm />
      </Card>
    </>
  )
}
