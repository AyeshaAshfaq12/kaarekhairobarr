import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { can, requireActiveViewer } from '@/lib/portal/rbac'
import { toDateInput } from '@/lib/portal/time'
import { Card, PageHeader } from '@/components/portal/ui'
import DonationForm from '../DonationForm'
import { logDonationAction } from '../actions'
import { donationFormOptions } from '../options'

export const metadata: Metadata = { title: 'Log donation | KKB Portal' }

export default async function NewDonationPage({ searchParams }: { searchParams: { caseId?: string; donorId?: string } }) {
  const viewer = await requireActiveViewer()
  if (!can(viewer, 'donations', 'create')) notFound()
  const options = await donationFormOptions(viewer)

  return (
    <>
      <PageHeader title="Log a donation" description="It stays pending until Finance or an Admin verifies it against the proof." />
      <Card className="max-w-3xl">
        <DonationForm
          action={logDonationAction}
          donors={options.donors}
          cases={options.cases}
          members={options.creditFor}
          coCredit={options.coCredit}
          selfId={viewer.memberId}
          defaults={{ caseId: searchParams.caseId, donorId: searchParams.donorId, receivedAt: toDateInput(new Date()) }}
          submitLabel="Log donation"
        />
      </Card>
    </>
  )
}
