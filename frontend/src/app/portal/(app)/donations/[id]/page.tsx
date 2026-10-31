import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/portal/db'
import { getSubtreeIds } from '@/lib/portal/hierarchy'
import { anyOf, donationPeople, donationWhere } from '@/lib/portal/money'
import { requireActiveViewer } from '@/lib/portal/rbac'
import { formatDate, formatDateTime, formatPKR, toDateInput } from '@/lib/portal/time'
import { ActionForm, Field, SubmitButton } from '@/components/portal/ActionForm'
import { Badge, Card, DONATION_STATUS_TONE, KeyValue, PageHeader, humanize } from '@/components/portal/ui'
import DonationForm from '../DonationForm'
import { deleteDonationAction, rejectDonationAction, reopenDonationAction, updateDonationAction, verifyDonationAction } from '../actions'
import { donationFormOptions } from '../options'

export const metadata: Metadata = { title: 'Donation | KKB Portal' }

export default async function DonationPage({ params, searchParams }: { params: { id: string }; searchParams: { logged?: string } }) {
  const viewer = await requireActiveViewer()
  const [viewWhere, verifyWhere] = await Promise.all([donationWhere(viewer, 'view'), donationWhere(viewer, 'verify')])
  const donation = await prisma.donation.findFirst({
    where: { AND: [{ id: params.id }, anyOf(viewWhere, verifyWhere)] },
    include: {
      donor: { select: { id: true, fullName: true } },
      case: { select: { id: true, title: true } },
      credits: { include: { member: { select: { id: true, fullName: true } } } },
    },
  })
  if (!donation) notFound()

  const people = donationPeople(donation)
  const [logger, verifier, canVerifyScope] = await Promise.all([
    prisma.member.findUnique({ where: { id: donation.loggedById }, select: { fullName: true } }),
    donation.verifiedById ? prisma.member.findUnique({ where: { id: donation.verifiedById }, select: { fullName: true } }) : null,
    prisma.donation.count({ where: { AND: [{ id: donation.id }, verifyWhere] } }),
  ])
  const subtree = await getSubtreeIds(viewer.memberId)
  const canChange = donation.status !== 'VERIFIED' && (viewer.isAdmin || people.some((id) => id === viewer.memberId || subtree.has(id)))
  const canVerify = donation.status === 'PENDING' && canVerifyScope > 0 && !people.includes(viewer.memberId)
  const options = canChange ? await donationFormOptions(viewer, donation.caseId) : null
  const isImage = donation.proofKey && !donation.proofKey.endsWith('.pdf')

  return (
    <>
      <PageHeader
        title={`${formatPKR(donation.amount)} from ${donation.donor.fullName}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={DONATION_STATUS_TONE[donation.status]}>{humanize(donation.status)}</Badge>
            <Link href={`/portal/cases/${donation.case.id}`} className="underline">
              {donation.case.title}
            </Link>
          </span>
        }
      />
      {searchParams.logged ? (
        <p role="status" className="mb-5 rounded-2xl bg-forest-50 px-4 py-3 text-sm font-medium text-forest-700">
          Donation logged. It counts once Finance or an Admin verifies it.
        </p>
      ) : null}
      {donation.status === 'REJECTED' ? (
        <p className="mb-5 rounded-2xl bg-clay-50 px-4 py-3 text-sm text-clay-700">Rejected: {donation.rejectionReason}. Fix the details below and save to resubmit.</p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-5">
          <Card title="Details">
            <KeyValue
              items={[
                { label: 'Donor', value: <Link href={`/portal/donors/${donation.donor.id}`} className="underline">{donation.donor.fullName}</Link> },
                { label: 'Received', value: formatDate(donation.receivedAt) },
                { label: 'Method', value: humanize(donation.method) },
                { label: 'Transaction ref', value: donation.transactionRef },
                ...(donation.method === 'CASH' ? [{ label: 'Cash received by', value: donation.cashReceivedNote }] : []),
                { label: 'Credited to', value: donation.credits.map((credit) => credit.member.fullName).join(', ') },
                { label: 'Logged by', value: `${logger?.fullName ?? '—'} · ${formatDateTime(donation.createdAt)}` },
                ...(verifier ? [{ label: donation.status === 'REJECTED' ? 'Rejected by' : 'Verified by', value: `${verifier.fullName} · ${formatDateTime(donation.verifiedAt)}` }] : []),
              ]}
            />
          </Card>
          {canChange && options ? (
            <Card title={donation.status === 'REJECTED' ? 'Fix and resubmit' : 'Edit (only while pending)'}>
              <DonationForm
                action={updateDonationAction}
                donors={options.donors}
                cases={options.cases}
                members={options.creditFor}
                coCredit={options.coCredit}
                selfId={donation.credits[0]?.memberId ?? viewer.memberId}
                defaults={{
                  id: donation.id,
                  caseId: donation.caseId,
                  amount: donation.amount,
                  receivedAt: toDateInput(donation.receivedAt),
                  method: donation.method,
                  transactionRef: donation.transactionRef,
                  cashReceivedNote: donation.cashReceivedNote,
                  coCreditIds: donation.credits.slice(1).map((credit) => credit.memberId),
                  hasProof: !!donation.proofKey,
                }}
                submitLabel={donation.status === 'REJECTED' ? 'Resubmit' : 'Save changes'}
              />
              <ActionForm action={deleteDonationAction} className="mt-4 border-t border-ink-900/5 pt-4" confirm="Delete this donation?">
                <input type="hidden" name="donationId" value={donation.id} />
                <SubmitButton variant="outline">Delete donation</SubmitButton>
              </ActionForm>
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          <Card title="Proof">
            {donation.proofKey ? (
              isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <a href={`/api/portal/files/donation-proof/${donation.id}`} target="_blank" rel="noreferrer">
                  <img src={`/api/portal/files/donation-proof/${donation.id}`} alt="Payment proof" className="max-h-[480px] w-full rounded-2xl object-contain" />
                </a>
              ) : (
                <a href={`/api/portal/files/donation-proof/${donation.id}`} target="_blank" rel="noreferrer" className="btn-outline">
                  Open proof (PDF)
                </a>
              )
            ) : (
              <p className="text-sm text-ink-500">{donation.method === 'CASH' ? 'Cash donation — no screenshot.' : 'No proof attached.'}</p>
            )}
          </Card>
          {canVerify ? (
            <Card title="Verify">
              <ActionForm action={verifyDonationAction}>
                <input type="hidden" name="donationId" value={donation.id} />
                <SubmitButton>Verify</SubmitButton>
              </ActionForm>
              <ActionForm action={rejectDonationAction} className="mt-4 space-y-2 border-t border-ink-900/5 pt-4">
                <input type="hidden" name="donationId" value={donation.id} />
                <Field label="Reject with reason" name="reason">
                  <input id="reason" name="reason" required className="field" />
                </Field>
                <SubmitButton variant="danger">Reject</SubmitButton>
              </ActionForm>
            </Card>
          ) : null}
          {donation.status === 'VERIFIED' && viewer.isAdmin ? (
            <Card title="Reopen (Admin)">
              <ActionForm action={reopenDonationAction} className="space-y-2" confirm="Reopen this verified donation? It stops counting until verified again.">
                <input type="hidden" name="donationId" value={donation.id} />
                <Field label="Reason" name="reason">
                  <input id="reason" name="reason" required className="field" />
                </Field>
                <SubmitButton variant="outline">Reopen</SubmitButton>
              </ActionForm>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  )
}
