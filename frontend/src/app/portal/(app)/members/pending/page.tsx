import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/portal/db'
import { decryptString } from '@/lib/portal/crypto'
import { SYSTEM_ROLE, can, requireActiveViewer } from '@/lib/portal/rbac'
import { ageOn, formatDate, formatDateTime } from '@/lib/portal/time'
import { ActionForm, Field, SubmitButton } from '@/components/portal/ActionForm'
import { Card, EmptyState, KeyValue, PageHeader } from '@/components/portal/ui'
import { approveMemberAction, rejectMemberAction } from '../actions'

export const metadata: Metadata = { title: 'Pending approvals | KKB Portal' }

export default async function PendingApprovalsPage({ searchParams }: { searchParams: { approved?: string; rejected?: string } }) {
  const viewer = await requireActiveViewer()
  if (!viewer.isAdmin || !can(viewer, 'members', 'approve')) notFound()

  // The confirmation is built from the member record, never from free text in the URL.
  const decidedId = searchParams.approved ?? searchParams.rejected
  const decided = decidedId
    ? await prisma.member.findUnique({ where: { id: decidedId }, select: { fullName: true, status: true } })
    : null
  const notice =
    decided && searchParams.approved && decided.status === 'ACTIVE'
      ? `${decided.fullName} approved.`
      : decided && searchParams.rejected && decided.status === 'REJECTED'
        ? `${decided.fullName} rejected.`
        : null

  const [applicants, leads, teams, roles] = await Promise.all([
    prisma.member.findMany({
      where: { status: 'PENDING_APPROVAL' },
      orderBy: { updatedAt: 'asc' },
      include: {
        user: { select: { email: true } },
        referredBy: { select: { fullName: true } },
        ndaSignatures: { orderBy: { signedAt: 'desc' }, take: 1, include: { ndaVersion: { select: { version: true } } } },
      },
    }),
    prisma.member.findMany({ where: { status: 'ACTIVE' }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true } }),
    prisma.team.findMany({ orderBy: [{ isGeneral: 'desc' }, { name: 'asc' }] }),
    prisma.role.findMany({ orderBy: { name: 'asc' } }),
  ])

  return (
    <>
      <PageHeader title="Pending approvals" description="Applicants who verified their email and signed the agreement." />
      {notice ? (
        <p role="status" className="mb-5 rounded-2xl bg-forest-50 px-4 py-3 text-sm font-medium text-forest-700">
          {notice}
        </p>
      ) : null}
      {applicants.length === 0 ? <EmptyState>No one is waiting for approval.</EmptyState> : null}
      <div className="space-y-5">
        {applicants.map((applicant) => {
          const signature = applicant.ndaSignatures[0]
          return (
            <Card key={applicant.id} title={applicant.fullName}>
              <KeyValue
                items={[
                  { label: 'Email', value: applicant.user.email },
                  { label: 'Phone / WhatsApp', value: `${applicant.phone}${applicant.whatsapp ? ` / ${applicant.whatsapp}` : ''}` },
                  { label: "Father's name", value: applicant.fatherName },
                  { label: 'Gender, age', value: `${applicant.gender.toLowerCase()}, ${ageOn(applicant.dateOfBirth)} (born ${formatDate(applicant.dateOfBirth)})` },
                  { label: 'CNIC', value: decryptString(applicant.cnicEncrypted) },
                  { label: 'City', value: applicant.city },
                  { label: 'Address', value: applicant.address },
                  { label: 'Emergency contact', value: `${applicant.emergencyName}, ${applicant.emergencyPhone}` },
                  { label: 'Institution / job', value: applicant.institutionOrJob },
                  { label: 'Skills', value: applicant.skills.join(', ') || '—' },
                  { label: 'Hours per week', value: applicant.availabilityHoursPerWeek ?? '—' },
                  { label: 'How they heard', value: applicant.howHeard },
                  { label: 'Referred by', value: applicant.referredBy?.fullName },
                  { label: 'Agreement', value: signature ? `v${signature.ndaVersion.version} signed ${formatDateTime(signature.signedAt)}` : '—' },
                ]}
              />

              <div className="mt-6 grid gap-6 border-t border-ink-900/5 pt-6 lg:grid-cols-[2fr_1fr]">
                <ActionForm action={approveMemberAction} className="space-y-4">
                  <input type="hidden" name="memberId" value={applicant.id} />
                  <Field label="Lead (reports to)" name="reportsToId" htmlFor={`reportsToId-${applicant.id}`}>
                    <select id={`reportsToId-${applicant.id}`} name="reportsToId" required defaultValue="" className="field">
                      <option value="" disabled>
                        Choose a lead…
                      </option>
                      {leads.map((lead) => (
                        <option key={lead.id} value={lead.id}>
                          {lead.fullName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Teams" name="teamIds" hint="General is added automatically.">
                    <div className="flex flex-wrap gap-2">
                      {teams.map((team) => (
                        <label key={team.id} className="flex items-center gap-2 rounded-full border border-ink-900/10 bg-white px-3 py-1.5 text-sm">
                          <input type="checkbox" name="teamIds" value={team.id} defaultChecked={team.isGeneral} className="accent-forest-600" />
                          {team.name}
                        </label>
                      ))}
                    </div>
                  </Field>
                  <Field label="Roles" name="roleIds">
                    <div className="flex flex-wrap gap-2">
                      {roles
                        .filter((role) => viewer.isSuperAdmin || role.name !== SYSTEM_ROLE.SUPER_ADMIN)
                        .map((role) => (
                          <label key={role.id} className="flex items-center gap-2 rounded-full border border-ink-900/10 bg-white px-3 py-1.5 text-sm">
                            <input type="checkbox" name="roleIds" value={role.id} defaultChecked={role.name === SYSTEM_ROLE.MEMBER} className="accent-forest-600" />
                            {role.name}
                          </label>
                        ))}
                    </div>
                  </Field>
                  <Field label="Welcome note (optional)" name="welcomeNote" htmlFor={`welcomeNote-${applicant.id}`}>
                    <textarea id={`welcomeNote-${applicant.id}`} name="welcomeNote" rows={2} className="field" />
                  </Field>
                  <SubmitButton>Approve</SubmitButton>
                </ActionForm>

                <ActionForm action={rejectMemberAction} className="space-y-3 rounded-2xl bg-clay-50/50 p-4" confirm={`Reject ${applicant.fullName}?`}>
                  <input type="hidden" name="memberId" value={applicant.id} />
                  <Field label="Reject with reason" name="reason" htmlFor={`reason-${applicant.id}`}>
                    <textarea id={`reason-${applicant.id}`} name="reason" rows={3} required className="field" />
                  </Field>
                  <SubmitButton variant="danger">Reject</SubmitButton>
                </ActionForm>
              </div>
            </Card>
          )
        })}
      </div>
    </>
  )
}
