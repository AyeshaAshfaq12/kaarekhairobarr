import type { Metadata } from 'next'
import AuthCard from '@/components/portal/AuthCard'
import { ActionForm, Field, SubmitButton } from '@/components/portal/ActionForm'
import { resendVerificationAction, verifyEmailAction } from '../actions'

export const metadata: Metadata = { title: 'Confirm your email | KKB Portal' }

// Confirmation is a button press, not a GET, so link scanners can't consume the token.
export default function VerifyPage({ searchParams }: { searchParams: { token?: string; sent?: string } }) {
  if (searchParams.token) {
    return (
      <AuthCard title="Confirm your email" subtitle="One tap and you're on to the member agreement.">
        <ActionForm action={verifyEmailAction}>
          <input type="hidden" name="token" value={searchParams.token} />
          <SubmitButton className="w-full">Confirm my email</SubmitButton>
        </ActionForm>
        <ResendForm />
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Check your inbox"
      subtitle={
        searchParams.sent
          ? `We sent a confirmation link to ${searchParams.sent}. It expires in 24 hours.`
          : 'Open the confirmation link we emailed you. It expires in 24 hours.'
      }
    >
      <ResendForm defaultEmail={searchParams.sent} />
    </AuthCard>
  )
}

function ResendForm({ defaultEmail }: { defaultEmail?: string }) {
  return (
    <ActionForm action={resendVerificationAction} className="mt-6 space-y-3 border-t border-ink-900/5 pt-5">
      <p className="text-sm text-ink-500">Didn&apos;t get it, or the link expired?</p>
      <Field label="Email" name="email">
        <input id="email" name="email" type="email" required defaultValue={defaultEmail} className="field" />
      </Field>
      <SubmitButton variant="secondary">Send a new link</SubmitButton>
    </ActionForm>
  )
}
