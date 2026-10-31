import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/portal/db'
import { offboardingPreview } from '@/lib/portal/members'
import { requireActiveViewer } from '@/lib/portal/rbac'
import { ActionForm, Field, SubmitButton } from '@/components/portal/ActionForm'
import { Card, PageHeader } from '@/components/portal/ui'
import { offboardAction } from '../../actions'

export const metadata: Metadata = { title: 'Offboard member | KKB Portal' }

export default async function OffboardPage({ params }: { params: { id: string } }) {
  const viewer = await requireActiveViewer()
  if (!viewer.isAdmin) notFound()
  const exists = await prisma.member.findUnique({ where: { id: params.id }, select: { status: true } })
  if (!exists || !['ACTIVE', 'INACTIVE'].includes(exists.status)) notFound()

  const preview = await offboardingPreview(params.id)
  const leadName = preview.lead?.fullName ?? 'their lead'
  const lines = [
    { count: preview.donorLinks.length, text: `donor contact(s) re-linked to ${leadName} (history kept)` },
    { count: preview.openTasks.length, text: `open task(s) unassigned; ${leadName} is notified` },
    { count: preview.caseAssignments.length, text: `case assignment(s) transferred to ${leadName}` },
    { count: preview.responsibilities.length, text: `open event responsibility(ies) transferred to ${leadName}` },
    { count: preview.ledEvents.length, text: `active event(s) they lead handed to ${leadName}` },
    { count: preview.directReports.length, text: `direct report(s) re-parented to ${leadName}` },
    { count: preview.futureTargets.length, text: 'future target(s) deleted' },
  ]

  return (
    <>
      <PageHeader title={`Mark ${preview.member.fullName} as left`} description="Past donations, credits and metrics stay untouched." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="What moves">
          {!preview.lead ? (
            <p className="text-sm text-clay-700">This member has no lead, so there is no one to hand their work to. Assign a lead first.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {lines.map((line) => (
                <li key={line.text} className="flex gap-3">
                  <span className="w-8 shrink-0 text-right font-semibold text-ink-900">{line.count}</span>
                  <span className="text-ink-600">{line.text}</span>
                </li>
              ))}
              {preview.directReports.length ? (
                <li className="pl-11 text-xs text-ink-500">{preview.directReports.map((report) => report.fullName).join(', ')}</li>
              ) : null}
            </ul>
          )}
        </Card>
        <Card title="Confirm">
          <ActionForm action={offboardAction} className="space-y-4" confirm="This disables their login and moves the records listed. Continue?">
            <input type="hidden" name="memberId" value={params.id} />
            <Field label="Reason for leaving" name="reason">
              <textarea id="reason" name="reason" rows={3} required className="field" />
            </Field>
            <SubmitButton variant="danger">Confirm and mark as left</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  )
}
