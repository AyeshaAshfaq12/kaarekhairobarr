import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { PayMethod, Prisma } from '@prisma/client'
import { prisma } from '@/lib/portal/db'
import { donationWhere } from '@/lib/portal/money'
import { can, requireActiveViewer } from '@/lib/portal/rbac'
import { daysBetween, formatDate, formatPKR, parseKarachiDate } from '@/lib/portal/time'
import { ActionForm, Field, SubmitButton } from '@/components/portal/ActionForm'
import { Badge, Card, EmptyState, KeyValue, PageHeader, humanize } from '@/components/portal/ui'
import { bulkVerifyAction, rejectDonationAction, verifyDonationAction } from '../actions'
import Shortcuts from './Shortcuts'

export const metadata: Metadata = { title: 'Verify donations | KKB Portal' }

const METHODS: PayMethod[] = ['EASYPAISA', 'JAZZCASH', 'BANK', 'CASH', 'OTHER']
type SearchParams = { caseId?: string; method?: string; from?: string; to?: string; memberId?: string; proof?: string; skip?: string }

export default async function VerifyQueuePage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requireActiveViewer()
  if (!can(viewer, 'donations', 'verify')) notFound()

  const method = METHODS.includes(searchParams.method as PayMethod) ? (searchParams.method as PayMethod) : undefined
  const where: Prisma.DonationWhereInput = {
    AND: [
      { status: 'PENDING' },
      await donationWhere(viewer, 'verify'),
      // Hard rule: your own donations go to someone else.
      { loggedById: { not: viewer.memberId } },
      { credits: { none: { memberId: viewer.memberId } } },
      searchParams.caseId ? { caseId: searchParams.caseId } : {},
      method ? { method } : {},
      searchParams.from ? { receivedAt: { gte: parseKarachiDate(searchParams.from) } } : {},
      searchParams.to ? { receivedAt: { lte: new Date(parseKarachiDate(searchParams.to).getTime() + 12 * 3_600_000) } } : {},
      searchParams.memberId ? { credits: { some: { memberId: searchParams.memberId } } } : {},
      searchParams.proof === 'yes' ? { proofKey: { not: null } } : searchParams.proof === 'no' ? { proofKey: null } : {},
    ],
  }
  const skip = Math.max(0, Number(searchParams.skip) || 0)
  const [queue, cases, members] = await Promise.all([
    prisma.donation.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: {
        donor: { select: { fullName: true } },
        case: { select: { id: true, title: true } },
        credits: { include: { member: { select: { fullName: true } } } },
      },
      take: 200,
    }),
    prisma.case.findMany({ where: { deletedAt: null, status: { not: 'DRAFT' } }, select: { id: true, title: true }, orderBy: { title: 'asc' } }),
    prisma.member.findMany({ where: { status: 'ACTIVE' }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } }),
  ])
  const refs = queue.map((donation) => donation.transactionRef).filter((ref): ref is string => !!ref)
  const refCounts = refs.length
    ? await prisma.donation.groupBy({ by: ['transactionRef'], where: { transactionRef: { in: refs }, status: { not: 'REJECTED' } }, _count: true })
    : []
  const uniqueRef = (ref: string | null) => !!ref && (refCounts.find((row) => row.transactionRef === ref)?._count ?? 0) === 1

  const current = queue[Math.min(skip, Math.max(0, queue.length - 1))]
  const filters = Object.fromEntries(Object.entries(searchParams).filter(([key, value]) => key !== 'skip' && value)) as Record<string, string>
  const hrefWith = (extra: Record<string, string>) => `/portal/donations/verify?${new URLSearchParams({ ...filters, ...extra }).toString()}`
  const back = hrefWith(skip ? { skip: String(skip) } : {})
  const nextHref = skip + 1 < queue.length ? hrefWith({ skip: String(skip + 1) }) : null
  const isImage = current?.proofKey && !current.proofKey.endsWith('.pdf')

  return (
    <>
      <PageHeader
        title="Verify donations"
        description={`${queue.length} pending, oldest first. Shortcuts: V verify · R reject · N next.`}
        actions={<Link href="/portal/donations" className="btn-outline">All donations</Link>}
      />
      <details className="mb-4">
        <summary className="cursor-pointer text-sm font-medium text-forest-700">Filters</summary>
        <form action="/portal/donations/verify" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-6">
          <select name="caseId" defaultValue={searchParams.caseId ?? ''} className="field col-span-2">
            <option value="">Any case</option>
            {cases.map((kase) => (
              <option key={kase.id} value={kase.id}>
                {kase.title}
              </option>
            ))}
          </select>
          <select name="method" defaultValue={searchParams.method ?? ''} className="field">
            <option value="">Any method</option>
            {METHODS.map((value) => (
              <option key={value} value={value}>
                {humanize(value)}
              </option>
            ))}
          </select>
          <select name="memberId" defaultValue={searchParams.memberId ?? ''} className="field">
            <option value="">Any member</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.fullName}
              </option>
            ))}
          </select>
          <select name="proof" defaultValue={searchParams.proof ?? ''} className="field">
            <option value="">Proof: any</option>
            <option value="yes">Has proof</option>
            <option value="no">No proof</option>
          </select>
          <input type="date" name="from" defaultValue={searchParams.from} aria-label="From" className="field" />
          <input type="date" name="to" defaultValue={searchParams.to} aria-label="To" className="field" />
          <button className="btn-secondary">Apply</button>
        </form>
      </details>

      {!current ? (
        <EmptyState>The queue is empty. Nicely done.</EmptyState>
      ) : (
        <Card className="mb-6" title={`${formatPKR(current.amount)} · ${current.donor.fullName}`} actions={<span className="text-xs text-ink-500">{skip + 1} of {queue.length}</span>}>
          <Shortcuts nextHref={nextHref} />
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              {current.proofKey ? (
                isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/portal/files/donation-proof/${current.id}`} alt="Payment proof" className="max-h-[420px] w-full rounded-2xl bg-cream-50 object-contain" />
                ) : (
                  <a href={`/api/portal/files/donation-proof/${current.id}`} target="_blank" rel="noreferrer" className="btn-outline">
                    Open proof (PDF)
                  </a>
                )
              ) : (
                <p className="rounded-2xl bg-cream-100 p-4 text-sm text-cream-800">
                  {current.method === 'CASH' ? `Cash, received by: ${current.cashReceivedNote}` : 'No proof attached.'}
                </p>
              )}
            </div>
            <div className="space-y-4">
              <KeyValue
                items={[
                  { label: 'Amount', value: formatPKR(current.amount) },
                  { label: 'Ref', value: current.transactionRef },
                  { label: 'Method', value: humanize(current.method) },
                  { label: 'Received', value: formatDate(current.receivedAt) },
                  { label: 'Case', value: current.case.title },
                  { label: 'Credited', value: current.credits.map((credit) => credit.member.fullName).join(', ') },
                  { label: 'Waiting', value: `${daysBetween(current.createdAt)} day(s)` },
                ]}
              />
              <div className="flex flex-wrap items-start gap-2">
                <ActionForm action={verifyDonationAction}>
                  <input type="hidden" name="donationId" value={current.id} />
                  <input type="hidden" name="back" value={back} />
                  <button id="verify-submit" type="submit" className="hidden" aria-hidden tabIndex={-1} />
                  <SubmitButton>Verify (V)</SubmitButton>
                </ActionForm>
                {nextHref ? (
                  <Link href={nextHref} className="btn-outline">
                    Skip (N)
                  </Link>
                ) : null}
              </div>
              <ActionForm action={rejectDonationAction} className="space-y-2 border-t border-ink-900/5 pt-4">
                <input type="hidden" name="donationId" value={current.id} />
                <input type="hidden" name="back" value={back} />
                <Field label="Reject with reason (R)" name="reason" htmlFor="reject-reason">
                  <input id="reject-reason" name="reason" required className="field" placeholder="e.g. amount doesn't match screenshot" />
                </Field>
                <SubmitButton variant="danger">Reject</SubmitButton>
              </ActionForm>
            </div>
          </div>
        </Card>
      )}

      {queue.length > 1 ? (
        <Card title="Bulk verify" className="p-0 sm:p-0">
          <p className="px-4 pt-1 text-xs text-ink-500 sm:px-6">Only donations with a transaction ref used by no other donation can be bulk verified.</p>
          <ActionForm action={bulkVerifyAction} confirm="Verify all selected donations?">
            <ul className="mt-3 divide-y divide-ink-900/5">
              {queue.map((donation) => {
                const eligible = uniqueRef(donation.transactionRef)
                return (
                  <li key={donation.id} className="flex items-center gap-3 px-4 py-2.5 text-sm sm:px-6">
                    <input type="checkbox" name="donationIds" value={donation.id} disabled={!eligible} aria-label={`Select ${donation.donor.fullName}`} className="h-4 w-4 accent-forest-600" />
                    <Link href={`/portal/donations/${donation.id}`} className="min-w-0 flex-1 truncate hover:text-forest-700">
                      {donation.donor.fullName} · {donation.case.title}
                    </Link>
                    <span className="hidden text-xs text-ink-500 sm:inline">{donation.transactionRef ?? 'no ref'}</span>
                    {!eligible ? <Badge>single only</Badge> : null}
                    <span className="font-semibold">{formatPKR(donation.amount)}</span>
                  </li>
                )
              })}
            </ul>
            <div className="p-4 sm:px-6">
              <SubmitButton variant="secondary">Verify selected</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      ) : null}
    </>
  )
}
