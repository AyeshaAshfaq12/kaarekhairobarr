import type { Metadata } from 'next'
import Link from 'next/link'
import AuthCard from '@/components/portal/AuthCard'
import { ActionForm, Field, SubmitButton } from '@/components/portal/ActionForm'
import { findValidToken } from '@/lib/portal/auth'
import { getSettings } from '@/lib/portal/settings'
import { signupAction } from '../actions'

export const metadata: Metadata = { title: 'Apply to join | KKB Portal' }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-forest-700">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  )
}

export default async function SignupPage({ searchParams }: { searchParams: { invite?: string } }) {
  const invite = searchParams.invite ? await findValidToken(searchParams.invite, 'INVITE') : null
  const invitePayload = (invite?.payload ?? {}) as { fullName?: string }
  const { minimumAge } = await getSettings()

  return (
    <AuthCard
      wide
      title="Apply to join KKB"
      subtitle={
        <>
          After you confirm your email you&apos;ll sign the member agreement, then an admin reviews your application.
          Already a member?{' '}
          <Link href="/portal/login" className="font-medium text-forest-700 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {searchParams.invite && !invite ? (
        <p className="mb-4 rounded-2xl bg-cream-100 px-4 py-3 text-sm text-cream-800">
          This invite link has expired or was already used. You can still apply below.
        </p>
      ) : null}
      <ActionForm action={signupAction} className="space-y-8">
        {invite ? <input type="hidden" name="inviteToken" value={searchParams.invite} /> : null}

        <Section title="Account">
          <Field label="Email" name="email">
            <input id="email" name="email" type="email" autoComplete="email" required defaultValue={invite?.email} className="field" />
          </Field>
          <div className="hidden sm:block" />
          <Field label="Password" name="password" hint="At least 8 characters.">
            <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required className="field" />
          </Field>
          <Field label="Confirm password" name="confirmPassword">
            <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required className="field" />
          </Field>
        </Section>

        <Section title="About you">
          <Field label="Full name" name="fullName" hint="As on your CNIC. You'll type it again to sign the agreement.">
            <input id="fullName" name="fullName" autoComplete="name" required defaultValue={invitePayload.fullName} className="field" />
          </Field>
          <Field label="Father's name" name="fatherName">
            <input id="fatherName" name="fatherName" className="field" />
          </Field>
          <Field label="Gender" name="gender">
            <select id="gender" name="gender" required defaultValue="" className="field">
              <option value="" disabled>
                Select…
              </option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
            </select>
          </Field>
          <Field label="Date of birth" name="dateOfBirth" hint={`You must be at least ${minimumAge}.`}>
            <input id="dateOfBirth" name="dateOfBirth" type="date" required className="field" />
          </Field>
          <Field label="CNIC" name="cnic" hint="Format 35202-1234567-1. Stored encrypted; only you and admins can see it.">
            <input id="cnic" name="cnic" inputMode="numeric" placeholder="35202-1234567-1" pattern="\d{5}-\d{7}-\d" required className="field" />
          </Field>
          <Field label="Photo" name="photo" hint="Optional. JPG or PNG, up to 5 MB.">
            <input id="photo" name="photo" type="file" accept="image/jpeg,image/png" className="field file:mr-3 file:rounded-full file:border-0 file:bg-cream-100 file:px-3 file:py-1" />
          </Field>
        </Section>

        <Section title="Contact">
          <Field label="Phone" name="phone">
            <input id="phone" name="phone" type="tel" autoComplete="tel" placeholder="0300 1234567" required className="field" />
          </Field>
          <Field label="WhatsApp" name="whatsapp" hint="If different from your phone.">
            <input id="whatsapp" name="whatsapp" type="tel" placeholder="0300 1234567" className="field" />
          </Field>
          <Field label="City" name="city">
            <input id="city" name="city" autoComplete="address-level2" required className="field" />
          </Field>
          <Field label="Address" name="address">
            <input id="address" name="address" autoComplete="street-address" required className="field" />
          </Field>
          <Field label="Emergency contact name" name="emergencyName">
            <input id="emergencyName" name="emergencyName" required className="field" />
          </Field>
          <Field label="Emergency contact phone" name="emergencyPhone">
            <input id="emergencyPhone" name="emergencyPhone" type="tel" required className="field" />
          </Field>
        </Section>

        <Section title="Volunteering">
          <Field label="Institution or job" name="institutionOrJob">
            <input id="institutionOrJob" name="institutionOrJob" className="field" />
          </Field>
          <Field label="Hours available per week" name="availabilityHoursPerWeek">
            <input id="availabilityHoursPerWeek" name="availabilityHoursPerWeek" type="number" min={0} max={80} className="field" />
          </Field>
          <Field label="Skills" name="skills" hint="Comma separated, e.g. design, writing, fundraising.">
            <input id="skills" name="skills" className="field" />
          </Field>
          <Field label="How did you hear about KKB?" name="howHeard">
            <input id="howHeard" name="howHeard" className="field" />
          </Field>
          <Field label="Referred by (member's email)" name="referrerEmail">
            <input id="referrerEmail" name="referrerEmail" type="email" className="field" />
          </Field>
        </Section>

        <SubmitButton className="w-full sm:w-auto">Submit application</SubmitButton>
      </ActionForm>
    </AuthCard>
  )
}
