import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/portal/db'
import { donorWhere, loggableMemberIds, outreachWhere } from '@/lib/portal/money'
import { can, requireActiveViewer } from '@/lib/portal/rbac'
import { dayRange, formatDate, formatPKR } from '@/lib/portal/time'
import { ActionForm, Field, SubmitButton } from '@/components/portal/ActionForm'
import ExportLinks from '@/components/portal/ExportLinks'
import { Badge, Card, EmptyState, PageHeader, Pagination, humanize, pageHref } from '@/components/portal/ui'
import { bulkOutreachAction } from '../donors/actions'
import QuickAdd from './QuickAdd'

export const metadata: Metadata = { title: 'Outreach | KKB Portal' }

const PAGE_SIZE = 30

export default async function OutreachPage({ searchParams }: { searchParams: { page?: string } }) {
  const viewer = await requireActiveViewer()
  if (!can(viewer, 'donors', 'view')) notFound()
  const canLog = can(viewer, 'donors', 'create')
  const page = Math.max(1, Number(searchParams.page) || 1)
  const scopeWhere = await outreachWhere(viewer)
  const loggable = canLog ? await loggableMemberIds(viewer, 'donors') : []
  const { end: endOfToday } = dayRange()

  const [donors, cases, members, total, rows, followUps] = await Promise.all([
    canLog ? prisma.donor.findMany({ where: await donorWhere(viewer), select: { id: true, fullName: true, phoneNormalized: true }, orderBy: { fullName: 'asc' }, take: 2000 }) : [],
    prisma.case.findMany({ where: { status: { in: ['OPEN', 'FUNDED'] }, deletedAt: null }, select: { id: true, title: true }, orderBy: { title: 'asc' } }),
    loggable === 'all' || loggable.length > 1
      ? prisma.member.findMany({ where: { status: 'ACTIVE', ...(loggable === 'all' ? {} : { id: { in: loggable } }) }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } })
      : [],
    prisma.outreach.count({ where: scopeWhere }),
    prisma.outreach.findMany({
      where: scopeWhere,
      include: { donor: { select: { id: true, fullName: true } }, member: { select: { fullName: true } }, case: { select: { title: true } } },
      orderBy: { contactedAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.outreach.findMany({
      where: { memberId: viewer.memberId, followUpAt: { lt: endOfToday }, outcome: { notIn: ['DONATED', 'DECLINED'] } },
      include: { donor: { select: { id: true, fullName: true } } },
      orderBy: { followUpAt: 'asc' },
      take: 20,
    }),
  ])

  // Only follow-ups with no later contact or donation are still due.
  const due = (
    await Promise.all(
      followUps.map(async (row) => {
        const later = await prisma.outreach.count({ where: { donorId: row.donorId, contactedAt: { gt: row.contactedAt } } })
        const donated = await prisma.donation.count({ where: { donorId: row.donorId, receivedAt: { gt: row.contactedAt }, status: { not: 'REJECTED' } } })
        return later || donated ? null : row
      })
    )
  ).filter((row): row is (typeof followUps)[number] => row !== null)

  return (
    <>
      <PageHeader title="Outreach" description="Log every donor you reach. Follow-up dates send you a reminder that morning." />
      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        {canLog ? (
          <Card title="Quick add">
            <QuickAdd
              donors={donors.map((donor) => ({ id: donor.id, label: donor.fullName, hint: donor.phoneNormalized?.replace('+92', '0') }))}
              cases={cases.map((kase) => ({ id: kase.id, label: kase.title }))}
              members={members.map((member) => ({ id: member.id, label: member.id === viewer.memberId ? `${member.fullName} (me)` : member.fullName }))}
              selfId={viewer.memberId}
            />
          </Card>
        ) : null}
        <div className="space-y-5">
          <Card title={`Follow-ups due (${due.length})`}>
            {due.length === 0 ? (
              <EmptyState>Nothing due. Nice.</EmptyState>
            ) : (
              <ul className="space-y-2 text-sm">
                {due.map((row) => (
                  <li key={row.id} className="flex justify-between gap-2">
                    <Link href={`/portal/donors/${row.donor.id}`} className="font-medium hover:text-forest-700">
                      {row.donor.fullName}
                    </Link>
                    <span className={row.followUpAt! < dayRange().start ? 'font-semibold text-clay-600' : 'text-ink-500'}>{formatDate(row.followUpAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {canLog ? (
            <Card title="Bulk add">
              <ActionForm action={bulkOutreachAction} className="space-y-3" resetOnSuccess>
                <Field label="Contacts (one per line: name, phone, outcome)" name="csv" hint="Outcome: contacted, promised, donated, declined or no_response. Phones dedupe donors.">
                  <textarea id="csv" name="csv" rows={5} placeholder={'Ahmed Raza, 0300 1234567, contacted\nSara Khan, 0321 7654321, promised'} className="field font-mono text-xs" />
                </Field>
                <Field label="…or upload a CSV" name="file">
                  <input id="file" name="file" type="file" accept=".csv,text/csv,text/plain" className="field" />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <select name="channel" defaultValue="WHATSAPP" className="field" aria-label="Channel">
                    {['WHATSAPP', 'CALL', 'IN_PERSON', 'SOCIAL', 'OTHER'].map((value) => (
                      <option key={value} value={value}>
                        {humanize(value)}
                      </option>
                    ))}
                  </select>
                  <SubmitButton variant="secondary">Import</SubmitButton>
                </div>
              </ActionForm>
            </Card>
          ) : null}
        </div>
      </div>

      <div className="mt-5">{can(viewer, 'donors', 'export') ? <ExportLinks report="outreach" params={{}} /> : null}</div>
      <Card title={`Recent outreach (${total})`}>
        {rows.length === 0 ? (
          <EmptyState>No outreach logged yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-ink-900/5 text-sm">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <Link href={`/portal/donors/${row.donor.id}`} className="font-medium text-ink-900 hover:text-forest-700">
                    {row.donor.fullName}
                  </Link>
                  <p className="text-xs text-ink-500">
                    {formatDate(row.contactedAt)} · {humanize(row.channel)}
                    {row.memberId !== viewer.memberId ? ` · ${row.member.fullName}` : ''}
                    {row.case ? ` · ${row.case.title}` : ''}
                    {row.promisedAmount ? ` · promised ${formatPKR(row.promisedAmount)}` : ''}
                  </p>
                </div>
                <Badge tone={row.outcome === 'DONATED' ? 'green' : row.outcome === 'PROMISED' ? 'amber' : row.outcome === 'DECLINED' ? 'red' : 'neutral'}>{humanize(row.outcome)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Pagination page={page} pages={Math.ceil(total / PAGE_SIZE)} href={pageHref('/portal/outreach', {})} />
    </>
  )
}
