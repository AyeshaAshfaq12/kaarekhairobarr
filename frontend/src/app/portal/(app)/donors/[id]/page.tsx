import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/portal/db'
import { getSubtreeIds } from '@/lib/portal/hierarchy'
import { donationWhere, donorWhere, outreachWhere } from '@/lib/portal/money'
import { requireActiveViewer, scopeFor } from '@/lib/portal/rbac'
import { formatDate, formatPKR } from '@/lib/portal/time'
import { ActionForm, Field, SubmitButton } from '@/components/portal/ActionForm'
import { Badge, Card, DONATION_STATUS_TONE, EmptyState, KeyValue, PageHeader, Stat, humanize } from '@/components/portal/ui'
import { updateDonorAction } from '../actions'

export const metadata: Metadata = { title: 'Donor | KKB Portal' }

export default async function DonorPage({ params }: { params: { id: string } }) {
  const viewer = await requireActiveViewer()
  const donor = await prisma.donor.findFirst({
    where: { AND: [{ id: params.id }, await donorWhere(viewer)] },
    include: { links: { include: { member: { select: { id: true, fullName: true } } } } },
  })
  if (!donor) notFound()

  const [outreach, donations, canEdit] = await Promise.all([
    prisma.outreach.findMany({
      where: { AND: [{ donorId: donor.id }, await outreachWhere(viewer)] },
      include: { member: { select: { fullName: true } } },
      orderBy: { contactedAt: 'desc' },
    }),
    prisma.donation.findMany({
      where: { AND: [{ donorId: donor.id }, await donationWhere(viewer)] },
      include: { case: { select: { title: true } } },
      orderBy: { receivedAt: 'desc' },
    }),
    prisma.donor.count({ where: { AND: [{ id: donor.id }, await donorWhere(viewer, 'edit')] } }),
  ])

  // The creator's relation note is private to them and people above them (§7.2).
  const scope = scopeFor(viewer, 'donors', 'view')
  const seesNote =
    scope === 'all' || donor.createdById === viewer.memberId || (scope === 'subtree' && (await getSubtreeIds(viewer.memberId)).has(donor.createdById))
  const totalGiven = donations.filter((donation) => donation.status === 'VERIFIED').reduce((sum, donation) => sum + donation.amount, 0)

  return (
    <>
      <PageHeader
        title={donor.fullName}
        description={`Linked to ${donor.links.filter((link) => !link.historical).map((link) => link.member.fullName).join(', ') || 'no one'}`}
        actions={<Link href={`/portal/donations/new?donorId=${donor.id}`} className="btn-primary">Log donation</Link>}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Total given" value={formatPKR(totalGiven)} hint="Verified, that you can see" />
        <Stat label="Last contacted" value={outreach[0] ? formatDate(outreach[0].contactedAt) : '—'} />
        <Stat label="Outreach" value={outreach.length} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-5">
          <Card title="Donations">
            {donations.length === 0 ? (
              <EmptyState>No donations you can see.</EmptyState>
            ) : (
              <ul className="divide-y divide-ink-900/5 text-sm">
                {donations.map((donation) => (
                  <li key={donation.id}>
                    <Link href={`/portal/donations/${donation.id}`} className="flex justify-between gap-2 py-2.5 hover:opacity-80">
                      <span>
                        {donation.case.title}
                        <span className="block text-xs text-ink-500">{formatDate(donation.receivedAt)}</span>
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
          <Card title="Outreach">
            {outreach.length === 0 ? (
              <EmptyState>No outreach you can see.</EmptyState>
            ) : (
              <ul className="divide-y divide-ink-900/5 text-sm">
                {outreach.map((row) => (
                  <li key={row.id} className="py-2.5">
                    <div className="flex justify-between gap-2">
                      <span>
                        {formatDate(row.contactedAt)} · {humanize(row.channel)} · {row.member.fullName}
                      </span>
                      <Badge>{humanize(row.outcome)}</Badge>
                    </div>
                    {row.notes ? <p className="mt-1 text-xs text-ink-500">{row.notes}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card title="Contact details">
          {canEdit ? (
            <ActionForm action={updateDonorAction} className="space-y-3">
              <input type="hidden" name="donorId" value={donor.id} />
              <Field label="Name" name="fullName">
                <input id="fullName" name="fullName" defaultValue={donor.fullName} required className="field" />
              </Field>
              <Field label="Phone" name="phone">
                <input id="phone" name="phone" type="tel" defaultValue={donor.phone ?? ''} className="field" />
              </Field>
              <Field label="Email" name="email">
                <input id="email" name="email" type="email" defaultValue={donor.email ?? ''} className="field" />
              </Field>
              <Field label="City" name="city">
                <input id="city" name="city" defaultValue={donor.city ?? ''} className="field" />
              </Field>
              {seesNote ? (
                <Field label="How you know them" name="relationNote">
                  <input id="relationNote" name="relationNote" defaultValue={donor.relationNote ?? ''} className="field" />
                </Field>
              ) : null}
              <SubmitButton variant="secondary">Save</SubmitButton>
            </ActionForm>
          ) : (
            <KeyValue
              items={[
                { label: 'Phone', value: donor.phone },
                { label: 'Email', value: donor.email },
                { label: 'City', value: donor.city },
                ...(seesNote ? [{ label: 'Note', value: donor.relationNote }] : []),
              ]}
            />
          )}
        </Card>
      </div>
    </>
  )
}
