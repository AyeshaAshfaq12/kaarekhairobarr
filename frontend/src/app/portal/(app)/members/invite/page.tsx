import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { can, requireActiveViewer } from '@/lib/portal/rbac'
import { ActionForm, Field, SubmitButton } from '@/components/portal/ActionForm'
import { Card, PageHeader } from '@/components/portal/ui'
import { inviteAction } from '../actions'

export const metadata: Metadata = { title: 'Invite a member | KKB Portal' }

export default async function InvitePage() {
  const viewer = await requireActiveViewer()
  if (!viewer.isAdmin && !can(viewer, 'members', 'create')) notFound()

  return (
    <>
      <PageHeader title="Invite a member" description="They'll get a link (valid 7 days) that pre-fills the application form." />
      <Card className="max-w-lg">
        <ActionForm action={inviteAction} className="space-y-4" resetOnSuccess>
          <Field label="Full name" name="fullName">
            <input id="fullName" name="fullName" required className="field" />
          </Field>
          <Field label="Email" name="email">
            <input id="email" name="email" type="email" required className="field" />
          </Field>
          <SubmitButton>Send invite</SubmitButton>
        </ActionForm>
      </Card>
    </>
  )
}
