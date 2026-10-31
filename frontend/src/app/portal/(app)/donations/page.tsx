import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { DonationStatus, PayMethod, Prisma } from '@prisma/client'
import { prisma } from '@/lib/portal/db'
import { donationWhere } from '@/lib/portal/money'
import { can, requireActiveViewer } from '@/lib/portal/rbac'
import { formatDate, formatPKR, parseKarachiDate } from '@/lib/portal/time'
import ExportLinks from '@/components/portal/ExportLinks'
import { Badge, Card, DONATION_STATUS_TONE, EmptyState, PageHeader, Pagination, humanize, pageHref } from '@/components/portal/ui'

export const metadata: Metadata = { title: 'Donations | KKB Portal' }

const PAGE_SIZE = 30
const STATUSES: DonationStatus[] = ['PENDING', 'VERIFIED', 'REJECTED']
const METHODS: PayMethod[] = ['EASYPAISA', 'JAZZCASH', 'BANK', 'CASH', 'OTHER']

type SearchParams = { status?: string; method?: string; caseId?: string; from?: string; to?: string; page?: string }

export default async function DonationsPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requireActiveViewer()
  if (!can(viewer, 'donations', 'view')) notFound()
  const page = Math.max(1, Number(searchParams.page) || 1)
  const status = STATUSES.includes(searchParams.status as DonationStatus) ? (searchParams.status as DonationStatus) : undefined
  const method = METHODS.includes(searchParams.method as PayMethod) ? (searchParams.method as PayMethod) : undefined
  const where: Prisma.DonationWhereInput = {
    AND: [
      await donationWhere(viewer),
      status ? { status } : {},
      method ? { method } : {},
      searchParams.caseId ? { caseId: searchParams.caseId } : {},
      searchParams.from ? { receivedAt: { gte: parseKarachiDate(searchParams.from) } } : {},
      searchParams.to ? { receivedAt: { lte: new Date(parseKarachiDate(searchParams.to).getTime() + 12 * 3_600_000) } } : {},
    ],
  }
  const [total, donations, cases, verifyCount] = await Promise.all([
    prisma.donation.count({ where }),
    prisma.donation.findMany({
      where,
      include: { donor: { select: { fullName: true } }, case: { select: { title: true } }, credits: { include: { member: { select: { fullName: true } } } } },
      orderBy: { receivedAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.case.findMany({ where: { deletedAt: null, status: { not: 'DRAFT' } }, select: { id: true, title: true }, orderBy: { title: 'asc' } }),
    can(viewer, 'donations', 'verify') ? prisma.donation.count({ where: { AND: [{ status: 'PENDING' }, await donationWhere(viewer, 'verify')] } }) : Promise.resolve(0),
  ])
  const params = { status: searchParams.status, method: searchParams.method, caseId: searchParams.caseId, from: searchParams.from, to: searchParams.to }

  return (
    <>
      <PageHeader
        title="Donations"
        description={`${total} donations you can see. Only verified donations count in metrics.`}
        actions={
          <>
            {can(viewer, 'donations', 'create') ? <Link href="/portal/donations/new" className="btn-primary">Log donation</Link> : null}
            {can(viewer, 'donations', 'verify') ? <Link href="/portal/donations/verify" className="btn-secondary">Verify ({verifyCount})</Link> : null}
          </>
        }
      />
      <form action="/portal/donations" className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-6">
        <select name="status" defaultValue={searchParams.status ?? ''} className="field">
          <option value="">Any status</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {humanize(value)}
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
        <select name="caseId" defaultValue={searchParams.caseId ?? ''} className="field col-span-2">
          <option value="">Any case</option>
          {cases.map((kase) => (
            <option key={kase.id} value={kase.id}>
              {kase.title}
            </option>
          ))}
        </select>
        <input type="date" name="from" defaultValue={searchParams.from} aria-label="From" className="field" />
        <div className="flex gap-2">
          <input type="date" name="to" defaultValue={searchParams.to} aria-label="To" className="field min-w-0" />
          <button className="btn-secondary shrink-0">Go</button>
        </div>
      </form>
      {can(viewer, 'donations', 'export') || can(viewer, 'reports', 'export') ? <ExportLinks report="donations" params={params} /> : null}
      <Card className="p-0 sm:p-0">
        {donations.length === 0 ? (
          <div className="p-4">
            <EmptyState>No donations match.</EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-ink-900/5">
            {donations.map((donation) => (
              <li key={donation.id}>
                <Link href={`/portal/donations/${donation.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-cream-50/60 sm:px-6">
                  <span className="min-w-0">
                    <span className="font-semibold text-ink-900">{donation.donor.fullName}</span>
                    <span className="block truncate text-xs text-ink-500">
                      {donation.case.title} · {formatDate(donation.receivedAt)} · {humanize(donation.method)} · {donation.credits.map((credit) => credit.member.fullName).join(', ')}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block font-semibold">{formatPKR(donation.amount)}</span>
                    <Badge tone={DONATION_STATUS_TONE[donation.status]}>{humanize(donation.status)}</Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Pagination page={page} pages={Math.ceil(total / PAGE_SIZE)} href={pageHref('/portal/donations', params)} />
    </>
  )
}
