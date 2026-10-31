import type { Metadata } from 'next'
import Link from 'next/link'
import type { CaseCategory, CaseStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/portal/db'
import { caseProgress, caseWhere } from '@/lib/portal/money'
import { can, requireActiveViewer } from '@/lib/portal/rbac'
import { formatPKR } from '@/lib/portal/time'
import { Badge, CASE_STATUS_TONE, Card, EmptyState, PageHeader, SplitProgress, humanize } from '@/components/portal/ui'

export const metadata: Metadata = { title: 'Cases | KKB Portal' }

const STATUSES: CaseStatus[] = ['DRAFT', 'OPEN', 'FUNDED', 'CLOSED', 'CANCELLED']
const CATEGORIES: CaseCategory[] = ['RATION', 'DIALYSIS', 'CANCER', 'DEBT', 'EDUCATION', 'EVENT', 'OTHER']

export default async function CasesPage({ searchParams }: { searchParams: { status?: string; category?: string; mine?: string } }) {
  const viewer = await requireActiveViewer()
  const status = STATUSES.includes(searchParams.status as CaseStatus) ? (searchParams.status as CaseStatus) : undefined
  const category = CATEGORIES.includes(searchParams.category as CaseCategory) ? (searchParams.category as CaseCategory) : undefined
  const where: Prisma.CaseWhereInput = {
    AND: [
      await caseWhere(viewer),
      status ? { status } : { status: { in: ['DRAFT', 'OPEN', 'FUNDED'] } },
      category ? { category } : {},
      searchParams.mine ? { assignments: { some: { memberId: viewer.memberId } } } : {},
    ],
  }
  const cases = await prisma.case.findMany({ where, orderBy: [{ status: 'asc' }, { startDate: 'desc' }], take: 100 })
  const progress = await caseProgress(cases.map((kase) => kase.id))

  return (
    <>
      <PageHeader
        title="Cases"
        description="Open cases everyone can raise money for. Pending money shows as the lighter part of each bar."
        actions={can(viewer, 'cases', 'create') ? <Link href="/portal/cases/new" className="btn-primary">New case</Link> : null}
      />
      <form action="/portal/cases" className="mb-4 grid grid-cols-2 gap-2 sm:flex">
        <select name="status" defaultValue={searchParams.status ?? ''} className="field sm:w-44">
          <option value="">Active</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {humanize(value)}
            </option>
          ))}
        </select>
        <select name="category" defaultValue={searchParams.category ?? ''} className="field sm:w-44">
          <option value="">All categories</option>
          {CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {humanize(value)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" name="mine" value="1" defaultChecked={!!searchParams.mine} className="h-4 w-4 accent-forest-600" /> Assigned to me
        </label>
        <button className="btn-secondary">Filter</button>
      </form>
      {cases.length === 0 ? <EmptyState>No cases match.</EmptyState> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cases.map((kase) => {
          const p = progress.get(kase.id)!
          return (
            <Link key={kase.id} href={`/portal/cases/${kase.id}`} className="block">
              <Card className="h-full transition hover:-translate-y-0.5">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge tone={CASE_STATUS_TONE[kase.status]}>{humanize(kase.status)}</Badge>
                  <Badge>{humanize(kase.category)}</Badge>
                </div>
                <h2 className="font-display text-lg font-semibold text-ink-900">
                  <span className="text-ink-400">#{kase.number}</span> {kase.title}
                </h2>
                <SplitProgress verified={p.verified} pending={p.pending} target={kase.targetAmount} className="mt-3" />
                <p className="mt-2 text-sm text-ink-600">
                  <span className="font-semibold text-ink-900">{formatPKR(p.verified)}</span> of {formatPKR(kase.targetAmount)}
                  {p.pending ? <span className="text-ink-400"> · {formatPKR(p.pending)} pending</span> : null}
                </p>
              </Card>
            </Link>
          )
        })}
      </div>
    </>
  )
}
