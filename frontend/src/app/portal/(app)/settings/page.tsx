import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@/lib/portal/db'
import { NOTIFICATION_TYPES } from '@/lib/portal/notify'
import { can, requireActiveViewer } from '@/lib/portal/rbac'
import { formatDateTime } from '@/lib/portal/time'
import { ActionForm, Field, SubmitButton } from '@/components/portal/ActionForm'
import { Card, PageHeader } from '@/components/portal/ui'
import { changePasswordAction, updateEmailPrefsAction, updateProfileAction, updateWhatsappPrefsAction } from './actions'
import { isWhatsAppConfigured } from '@/lib/portal/whatsapp'
import { HELP_TEXT } from '@/lib/portal/whatsapp-commands'

export const metadata: Metadata = { title: 'Settings | KKB Portal' }

export default async function SettingsPage() {
  const viewer = await requireActiveViewer()
  const [member, user, signatures] = await Promise.all([
    prisma.member.findUniqueOrThrow({ where: { id: viewer.memberId } }),
    prisma.user.findUniqueOrThrow({ where: { id: viewer.userId }, select: { emailOptOuts: true, whatsappOptIn: true, whatsappOptOuts: true } }),
    prisma.ndaSignature.findMany({ where: { memberId: viewer.memberId }, include: { ndaVersion: true }, orderBy: { signedAt: 'desc' } }),
  ])

  return (
    <>
      <PageHeader
        title="Settings"
        actions={can(viewer, 'settings', 'edit') ? <Link href="/portal/settings/admin" className="btn-secondary">Organisation settings</Link> : null}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="My profile" className="lg:row-span-3">
          <ActionForm action={updateProfileAction} className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" name="fullName">
              <input id="fullName" name="fullName" defaultValue={member.fullName} required className="field" />
            </Field>
            <Field label="Father's name" name="fatherName">
              <input id="fatherName" name="fatherName" defaultValue={member.fatherName ?? ''} className="field" />
            </Field>
            <Field label="Phone" name="phone">
              <input id="phone" name="phone" type="tel" defaultValue={member.phone} required className="field" />
            </Field>
            <Field label="WhatsApp" name="whatsapp">
              <input id="whatsapp" name="whatsapp" type="tel" defaultValue={member.whatsapp ?? ''} className="field" />
            </Field>
            <Field label="City" name="city">
              <input id="city" name="city" defaultValue={member.city} required className="field" />
            </Field>
            <Field label="Address" name="address">
              <input id="address" name="address" defaultValue={member.address} required className="field" />
            </Field>
            <Field label="Institution or job" name="institutionOrJob">
              <input id="institutionOrJob" name="institutionOrJob" defaultValue={member.institutionOrJob ?? ''} className="field" />
            </Field>
            <Field label="Hours per week" name="availabilityHoursPerWeek">
              <input id="availabilityHoursPerWeek" name="availabilityHoursPerWeek" type="number" min={0} max={80} defaultValue={member.availabilityHoursPerWeek ?? ''} className="field" />
            </Field>
            <Field label="Skills" name="skills" hint="Comma separated" className="sm:col-span-2">
              <input id="skills" name="skills" defaultValue={member.skills.join(', ')} className="field" />
            </Field>
            <Field label="Emergency contact name" name="emergencyName">
              <input id="emergencyName" name="emergencyName" defaultValue={member.emergencyName} required className="field" />
            </Field>
            <Field label="Emergency contact phone" name="emergencyPhone">
              <input id="emergencyPhone" name="emergencyPhone" type="tel" defaultValue={member.emergencyPhone} required className="field" />
            </Field>
            <Field label="Photo" name="photo" hint="JPG or PNG, up to 5 MB" className="sm:col-span-2">
              <input id="photo" name="photo" type="file" accept="image/jpeg,image/png" className="field" />
            </Field>
            <p className="text-xs text-ink-500 sm:col-span-2">CNIC ending {member.cnicLast4}. To change your CNIC, contact an admin.</p>
            <div className="sm:col-span-2">
              <SubmitButton>Save profile</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card title="Password">
          <ActionForm action={changePasswordAction} className="space-y-3" resetOnSuccess>
            <Field label="Current password" name="currentPassword">
              <input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required className="field" />
            </Field>
            <Field label="New password" name="newPassword" hint="At least 8 characters">
              <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={8} required className="field" />
            </Field>
            <SubmitButton variant="secondary">Change password</SubmitButton>
          </ActionForm>
        </Card>

        <Card title="Email notifications">
          <p className="mb-3 text-xs text-ink-500">In-app notifications are always on. Untick to stop emails of that type.</p>
          <ActionForm action={updateEmailPrefsAction} className="space-y-3">
            <div className="space-y-2">
              {Object.entries(NOTIFICATION_TYPES).map(([type, label]) => (
                <label key={type} className="flex items-center gap-3 text-sm text-ink-700">
                  <input type="checkbox" name="email" value={type} defaultChecked={!user.emailOptOuts.includes(type)} className="h-4 w-4 accent-forest-600" />
                  {label}
                </label>
              ))}
            </div>
            <SubmitButton variant="secondary">Save preferences</SubmitButton>
          </ActionForm>
        </Card>

        <Card title="WhatsApp">
          {!isWhatsAppConfigured() ? (
            <p className="mb-3 rounded-2xl bg-cream-100 px-3 py-2 text-xs text-cream-800">WhatsApp isn&apos;t connected for KKB yet. You can save your choice now; it takes effect once an admin connects it.</p>
          ) : null}
          <p className="mb-3 text-xs text-ink-500">
            Uses {member.whatsapp ?? member.phone}. Turning this on lets you get notifications on WhatsApp and log outreach and donations by message.
          </p>
          <ActionForm action={updateWhatsappPrefsAction} className="space-y-3">
            <label className="flex items-center gap-3 text-sm font-medium text-ink-900">
              <input type="checkbox" name="whatsappOptIn" defaultChecked={user.whatsappOptIn} className="h-4 w-4 accent-forest-600" />
              Use WhatsApp with KKB
            </label>
            <details>
              <summary className="cursor-pointer text-xs font-medium text-forest-700">Which notifications</summary>
              <div className="mt-2 space-y-2">
                {Object.entries(NOTIFICATION_TYPES).map(([type, label]) => (
                  <label key={type} className="flex items-center gap-3 text-sm text-ink-700">
                    <input type="checkbox" name="whatsapp" value={type} defaultChecked={!user.whatsappOptOuts.includes(type)} className="h-4 w-4 accent-forest-600" />
                    {label}
                  </label>
                ))}
              </div>
            </details>
            <SubmitButton variant="secondary">Save WhatsApp settings</SubmitButton>
          </ActionForm>
          <details className="mt-4">
            <summary className="cursor-pointer text-xs font-medium text-forest-700">Quick-logging commands</summary>
            <pre className="mt-2 whitespace-pre-wrap rounded-2xl bg-cream-50 p-3 text-xs text-ink-700">{HELP_TEXT}</pre>
          </details>
        </Card>

        <Card title="My agreement and data">
          <ul className="space-y-2 text-sm">
            {signatures.map((signature) => (
              <li key={signature.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Agreement v{signature.ndaVersion.version} · signed {formatDateTime(signature.signedAt)}
                </span>
                <a href={`/api/portal/nda/${signature.id}`} className="font-medium text-forest-700 underline">
                  Download PDF
                </a>
              </li>
            ))}
          </ul>
          <a href="/api/portal/me/export" className="btn-outline mt-4">
            Download my data (PDF)
          </a>
        </Card>
      </div>
    </>
  )
}
