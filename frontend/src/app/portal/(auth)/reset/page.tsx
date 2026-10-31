import type { Metadata } from 'next'
import Link from 'next/link'
import AuthCard from '@/components/portal/AuthCard'
import { ActionForm, Field, SubmitButton } from '@/components/portal/ActionForm'
import { requestResetAction, resetPasswordAction } from '../actions'

export const metadata: Metadata = { title: 'Reset password | KKB Portal' }

export default function ResetPage({ searchParams }: { searchParams: { token?: string } }) {
  if (searchParams.token) {
    return (
      <AuthCard title="Choose a new password" subtitle="This signs you out on every device.">
        <ActionForm action={resetPasswordAction} className="space-y-4">
          <input type="hidden" name="token" value={searchParams.token} />
          <Field label="New password" name="password" hint="At least 8 characters.">
            <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required className="field" />
          </Field>
          <Field label="Confirm new password" name="confirmPassword">
            <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required className="field" />
          </Field>
          <SubmitButton className="w-full">Update password</SubmitButton>
        </ActionForm>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Reset your password" subtitle="We'll email you a link that works once, for 1 hour.">
      <ActionForm action={requestResetAction} className="space-y-4">
        <Field label="Email" name="email">
          <input id="email" name="email" type="email" autoComplete="email" required className="field" />
        </Field>
        <SubmitButton className="w-full">Send reset link</SubmitButton>
      </ActionForm>
      <Link href="/portal/login" className="mt-5 inline-block text-sm font-medium text-forest-700 hover:underline">
        Back to sign in
      </Link>
    </AuthCard>
  )
}
