import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/portal/db'
import { donorWhere, loggableMemberIds } from '@/lib/portal/money'
import { can, requireActiveViewer } from '@/lib/portal/rbac'
import { formatDate } from '@/lib/portal/time'
import { normalizePhone } from '@/lib/portal/validation'
import { ActionForm, Field, SubmitButton } from '@/components/portal/ActionForm'
import ExportLinks from '@/components/portal/ExportLinks'
import { Card, EmptyState, PageHeader, Pagination, pageHref } from '@/components/portal/ui'
import { createDonorAction } from './actions'

export const metadata: Metadata = { title: 'Donors | KKB Portal' }

const PAGE_SIZE = 30

export default async function DonorsPage({ searchParams }: { searchParams: { q?: string; page?: string } }) {
  const viewer = await requireActiveViewer()
  if (!can(viewer, 'donors', 'view')) notFound()
  const page = Math.max(1, Number(searchParams.page) || 1)
  const q = searchParams.q?.trim()
  const phone = q ? normalizePhone(q) : null
  const where: Prisma.DonorWhereInput = {
    AND: [
      await donorWhere(viewer),
      q ? { OR: [{ fullName: { contains: q, mode: 'insensitive' } }, ...(phone ? [{ phoneNormalized: phone }] : [])] } : {},
    ],
  }
  const loggable = can(viewer, 'donors', 'create') ? await loggableMemberIds(viewer, 'donors') : []
  const [total, donors, members] = await Promise.all([
    prisma.donor.count({ where }),
    prisma.donor.findMany({
      where,
      orderBy: { fullName: 'asc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        links: { where: { historical: false }, include: { member: { select: { fullName: true } } } },
        outreach: { orderBy: { contactedAt: 'desc' }, take: 1, select: { contactedAt: true } },
      },
    }),
    loggable === 'all' || loggable.length > 1
      ? prisma.member.findMany({ where: { status: 'ACTIVE', ...(loggable === 'all' ? {} : { id: { in: loggable } }) }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } })
      : [],
  ])

  return (
    <>
      <PageHeader title="Donors" description={`${total} donors you can see. Adding a phone number that already exists links that donor to you instead of duplicating it.`} />
      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <div>
          <form action="/portal/donors" className="mb-3 flex gap-2">
            <input name="q" defaultValue={q} placeholder="Search name or phone" className="field" />
            <button className="btn-secondary shrink-0">Search</button>
          </form>
          {can(viewer, 'donors', 'export') ? <ExportLinks report="donors" params={{ q }} /> : null}
          <Card className="p-0 sm:p-0">
            {donors.length === 0 ? (
              <div className="p-4">
                <EmptyState>No donors found.</EmptyState>
              </div>
            ) : (
              <ul className="divide-y divide-ink-900/5">
                {donors.map((donor) => (
                  <li key={donor.id}>
                    <Link href={`/portal/donors/${donor.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-cream-50/60 sm:px-6">
                      <span>
                        <span className="font-semibold text-ink-900">{donor.fullName}</span>
                        <span className="block text-xs text-ink-500">{donor.links.map((link) => link.member.fullName).join(', ') || '—'}</span>
                      </span>
                      <span className="text-xs text-ink-500">{donor.outreach[0] ? `Last contact ${formatDate(donor.outreach[0].contactedAt)}` : 'Not contacted'}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Pagination page={page} pages={Math.ceil(total / PAGE_SIZE)} href={pageHref('/portal/donors', { q })} />
        </div>
        {can(viewer, 'donors', 'create') ? (
          <Card title="Add donor">
            <ActionForm action={createDonorAction} className="space-y-3" resetOnSuccess>
              <Field label="Name" name="fullName">
                <input id="fullName" name="fullName" required className="field" />
              </Field>
              <Field label="Phone" name="phone">
                <input id="phone" name="phone" type="tel" placeholder="0300 1234567" className="field" />
              </Field>
              <Field label="Email" name="email">
                <input id="email" name="email" type="email" className="field" />
              </Field>
              <Field label="City" name="city">
                <input id="city" name="city" className="field" />
              </Field>
              <Field label="How you know them" name="relationNote">
                <input id="relationNote" name="relationNote" className="field" />
              </Field>
              {members.length > 1 ? (
                <Field label="Donor of" name="memberId">
                  <select id="memberId" name="memberId" defaultValue={viewer.memberId} className="field">
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.fullName}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              <SubmitButton>Add donor</SubmitButton>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  )
}
