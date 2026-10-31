import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { can, requireActiveViewer } from '@/lib/portal/rbac'
import { Card, PageHeader } from '@/components/portal/ui'
import RoleEditor from '../RoleEditor'

export const metadata: Metadata = { title: 'New role | KKB Portal' }

export default async function NewRolePage() {
  const viewer = await requireActiveViewer()
  if (!can(viewer, 'roles', 'create')) notFound()
  return (
    <>
      <PageHeader title="New role" />
      <Card>
        <RoleEditor viewer={viewer} />
      </Card>
    </>
  )
}
