import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/portal/db'
import { decryptString } from '@/lib/portal/crypto'
import { getSubtreeIds } from '@/lib/portal/hierarchy'
import { canSeeBeneficiary, caseProgress, caseWhere, donationWhere } from '@/lib/portal/money'
import { requireActiveViewer, scopeFor } from '@/lib/portal/rbac'
import { formatDate, formatPKR } from '@/lib/portal/time'
import { ActionForm, Field, SubmitButton } from '@/components/portal/ActionForm'
import {
  Badge,
  CASE_STATUS_TONE,
  Card,
  DONATION_STATUS_TONE,
  EmptyState,
  KeyValue,
  PageHeader,
  SplitProgress,
  Stat,
  TASK_STATUS_TONE,
  humanize,
} from '@/components/portal/ui'
import CaseForm from '../CaseForm'
import { assignCaseMembersAction, deleteCaseAction, setCaseStatusAction } from '../actions'

export const metadata: Metadata = { title: 'Case | KKB Portal' }

export default async function CasePage({ params, searchParams }: { params: { id: string }; searchParams: { edit?: string } }) {
  const viewer = await requireActiveViewer()
  const kase = await prisma.case.findFirst({
    where: { AND: [{ id: params.id }, await caseWhere(viewer)] },
    include: {
      beneficiary: true,
      event: { select: { id: true, name: true } },
      assignments: { include: { member: { select: { id: true, fullName: true } } } },
      tasks: { where: { deletedAt: null }, include: { assignee: { select: { fullName: true } } }, orderBy: { dueAt: 'asc' } },
    },
  })
  if (!kase) notFound()

  const [progress, donations, creator] = await Promise.all([
    caseProgress([kase.id]),
    prisma.donation.findMany({
      where: { AND: [{ caseId: kase.id }, await donationWhere(viewer)] },
      include: { donor: { select: { fullName: true } }, credits: { include: { member: { select: { id: true, fullName: true } } } } },
      orderBy: { receivedAt: 'desc' },
      take: 200,
    }),
    prisma.member.findUnique({ where: { id: kase.createdById }, select: { fullName: true } }),
  ])
  const p = progress.get(kase.id)!
  const canEdit = viewer.isAdmin || kase.createdById === viewer.memberId
  const showBeneficiary = canSeeBeneficiary(viewer, kase)

  // Top contributors among the donations this viewer may see (each credited member counts in full).
  const contributors = new Map<string, { name: string; amount: number }>()
  for (const donation of donations.filter((d) => d.status === 'VERIFIED')) {
    for (const credit of donation.credits) {
      const entry = contributors.get(credit.member.id) ?? { name: credit.member.fullName, amount: 0 }
      entry.amount += donation.amount
      contributors.set(credit.member.id, entry)
    }
  }
  const top = [...contributors.values()].sort((a, b) => b.amount - a.amount).slice(0, 5)

  const assignScope = scopeFor(viewer, 'cases', 'assign')
  const assignable = assignScope
    ? await prisma.member.findMany({
        where: { status: 'ACTIVE', ...(assignScope === 'all' ? {} : { id: { in: [...(await getSubtreeIds(viewer.memberId))] } }) },
        orderBy: { fullName: 'asc' },
        select: { id: true, fullName: true },
      })
    : []
  const assignedIds = new Set(kase.assignments.map((assignment) => assignment.memberId))

  if (searchParams.edit && canEdit && kase.category !== 'EVENT') {
    return (
      <>
        <PageHeader title={`Edit: ${kase.title}`} actions={<Link href={`/portal/cases/${kase.id}`} className="btn-outline">Cancel</Link>} />
        <Card>
          <CaseForm kase={kase} showBeneficiary={showBeneficiary} />
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title={kase.title}
        eyebrow={humanize(kase.category)}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={CASE_STATUS_TONE[kase.status]}>{humanize(kase.status)}</Badge>
            <span>
              {formatDate(kase.startDate)}
              {kase.endDate ? ` – ${formatDate(kase.endDate)}` : ''} · created by {creator?.fullName ?? '—'}
            </span>
          </span>
        }
        actions={
          <>
            {['OPEN', 'FUNDED'].includes(kase.status) ? (
              <Link href={`/portal/donations/new?caseId=${kase.id}`} className="btn-primary">
                Log donation
              </Link>
            ) : null}
            {canEdit && kase.category !== 'EVENT' ? (
              <Link href={`/portal/cases/${kase.id}?edit=1`} className="btn-outline">
                Edit
              </Link>
            ) : null}
            {kase.event ? (
              <Link href={`/portal/events/${kase.event.id}`} className="btn-outline">
                Open event
              </Link>
            ) : null}
          </>
        }
      />

      <Card className="mb-5">
        <SplitProgress verified={p.verified} pending={p.pending} target={kase.targetAmount} />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Verified" value={formatPKR(p.verified)} hint={`${Math.round((p.verified / kase.targetAmount) * 100)}% of target`} />
          <Stat label="Pending" value={formatPKR(p.pending)} hint="Not counted yet" />
          <Stat label="Target" value={formatPKR(kase.targetAmount)} />
          <Stat label="Donors" value={p.donors} />
        </div>
        {kase.cancelReason ? <p className="mt-3 text-sm text-clay-700">Cancelled: {kase.cancelReason}</p> : null}
        <p className="mt-4 whitespace-pre-line text-sm text-ink-700">{kase.description}</p>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-5">
          <Card title="Donations">
            {donations.length === 0 ? (
              <EmptyState>No donations you can see yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-ink-900/5 text-sm">
                {donations.map((donation) => (
                  <li key={donation.id}>
                    <Link href={`/portal/donations/${donation.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 hover:opacity-80">
                      <span>
                        <span className="font-medium text-ink-900">{donation.donor.fullName}</span>
                        <span className="block text-xs text-ink-500">
                          {formatDate(donation.receivedAt)} · {donation.credits.map((credit) => credit.member.fullName).join(', ')}
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
          <Card title="Linked tasks">
            {kase.tasks.length === 0 ? (
              <EmptyState>No tasks linked to this case.</EmptyState>
            ) : (
              <ul className="divide-y divide-ink-900/5 text-sm">
                {kase.tasks.map((task) => (
                  <li key={task.id} className="flex items-center justify-between gap-2 py-2">
                    <Link href={`/portal/tasks/${task.id}`} className="font-medium hover:text-forest-700">
                      {task.title}
                    </Link>
                    <span className="flex items-center gap-2 text-xs text-ink-500">
                      {task.assignee?.fullName ?? 'Unassigned'}
                      <Badge tone={TASK_STATUS_TONE[task.status]}>{humanize(task.status)}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Top contributors">
            {top.length === 0 ? (
              <EmptyState>No verified donations yet.</EmptyState>
            ) : (
              <ol className="space-y-1 text-sm">
                {top.map((entry, index) => (
                  <li key={entry.name} className="flex justify-between">
                    <span>
                      {index + 1}. {entry.name}
                    </span>
                    <span className="font-semibold">{formatPKR(entry.amount)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card title={`Assigned members (${kase.assignments.length})`}>
            <p className="text-sm text-ink-700">{kase.assignments.map((assignment) => assignment.member.fullName).join(', ') || 'No one yet.'}</p>
            {assignable.length ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-forest-700">Change assignments</summary>
                <ActionForm action={assignCaseMembersAction} className="mt-3 space-y-3">
                  <input type="hidden" name="caseId" value={kase.id} />
                  {/* Keep assignments the viewer can't change (outside their subtree). */}
                  {[...assignedIds]
                    .filter((id) => !assignable.some((member) => member.id === id))
                    .map((id) => (
                      <input key={id} type="hidden" name="memberIds" value={id} />
                    ))}
                  <div className="max-h-56 space-y-1 overflow-y-auto">
                    {assignable.map((member) => (
                      <label key={member.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="memberIds" value={member.id} defaultChecked={assignedIds.has(member.id)} className="h-4 w-4 accent-forest-600" />
                        {member.fullName}
                      </label>
                    ))}
                  </div>
                  <SubmitButton variant="secondary">Save assignments</SubmitButton>
                </ActionForm>
              </details>
            ) : null}
          </Card>

          {showBeneficiary && kase.beneficiary ? (
            <Card title="Beneficiary (restricted)">
              <KeyValue
                items={[
                  { label: 'Name', value: kase.beneficiary.fullName },
                  { label: 'Phone', value: kase.beneficiary.phone },
                  { label: 'CNIC', value: kase.beneficiary.cnicEncrypted ? decryptString(kase.beneficiary.cnicEncrypted) : '—' },
                  { label: 'City', value: kase.beneficiary.city },
                  { label: 'Condition', value: kase.beneficiary.condition },
                  { label: 'Notes', value: kase.beneficiary.notes },
                ]}
              />
              {kase.beneficiary.documentKeys.length ? (
                <ul className="mt-4 space-y-1 text-sm">
                  {kase.beneficiary.documentKeys.map((key, index) => (
                    <li key={key}>
                      <a href={`/api/portal/files/beneficiary/${kase.id}/${index}`} target="_blank" rel="noreferrer" className="font-medium text-forest-700 underline">
                        Document {index + 1}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ) : null}

          {canEdit && kase.category !== 'EVENT' ? (
            <Card title="Status">
              <div className="flex flex-wrap gap-2">
                {kase.status === 'DRAFT' || kase.status === 'CLOSED' ? (
                  <ActionForm action={setCaseStatusAction}>
                    <input type="hidden" name="caseId" value={kase.id} />
                    <input type="hidden" name="status" value="OPEN" />
                    <SubmitButton variant="secondary">{kase.status === 'DRAFT' ? 'Publish (open)' : 'Re-open'}</SubmitButton>
                  </ActionForm>
                ) : null}
                {kase.status === 'OPEN' || kase.status === 'FUNDED' ? (
                  <ActionForm action={setCaseStatusAction} confirm="Close this case? No new donations will be expected.">
                    <input type="hidden" name="caseId" value={kase.id} />
                    <input type="hidden" name="status" value="CLOSED" />
                    <SubmitButton variant="outline">Close case</SubmitButton>
                  </ActionForm>
                ) : null}
                {donations.length === 0 && kase.status === 'DRAFT' ? (
                  <ActionForm action={deleteCaseAction} confirm="Delete this draft?">
                    <input type="hidden" name="caseId" value={kase.id} />
                    <SubmitButton variant="outline">Delete draft</SubmitButton>
                  </ActionForm>
                ) : null}
              </div>
              {kase.status !== 'CANCELLED' && kase.status !== 'CLOSED' ? (
                <ActionForm action={setCaseStatusAction} className="mt-4 space-y-2 border-t border-ink-900/5 pt-4" confirm="Cancel this case?">
                  <input type="hidden" name="caseId" value={kase.id} />
                  <input type="hidden" name="status" value="CANCELLED" />
                  <Field label="Cancel with reason" name="reason">
                    <input id="reason" name="reason" required className="field" />
                  </Field>
                  <SubmitButton variant="danger">Cancel case</SubmitButton>
                </ActionForm>
              ) : null}
            </Card>
          ) : null}
        </div>
      </div>
    </>
  )
}
