import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import AuthCard from '@/components/portal/AuthCard'
import { ActionForm, Field, SubmitButton } from '@/components/portal/ActionForm'
import { getSessionUser } from '@/lib/portal/auth'
import { loginAction } from '../actions'

export const metadata: Metadata = { title: 'Sign in | KKB Portal' }

export default async function LoginPage({ searchParams }: { searchParams: { next?: string; reset?: string } }) {
  if (await getSessionUser()) redirect('/portal/dashboard')

  return (
    <AuthCard title="Sign in" subtitle="Members-only portal for outreach, donations and team work.">
      {searchParams.reset ? (
        <p className="mb-4 rounded-2xl bg-forest-50 px-4 py-3 text-sm text-forest-700">Password updated. Sign in with your new password.</p>
      ) : null}
      <ActionForm action={loginAction} className="space-y-4">
        <input type="hidden" name="next" value={searchParams.next ?? ''} />
        <Field label="Email" name="email">
          <input id="email" name="email" type="email" autoComplete="email" required className="field" />
        </Field>
        <Field label="Password" name="password">
          <input id="password" name="password" type="password" autoComplete="current-password" required className="field" />
        </Field>
        <SubmitButton className="w-full">Sign in</SubmitButton>
      </ActionForm>
      <div className="mt-5 flex flex-wrap justify-between gap-2 text-sm">
        <Link href="/portal/reset" className="font-medium text-forest-700 hover:underline">
          Forgot password?
        </Link>
        <Link href="/portal/signup" className="font-medium text-forest-700 hover:underline">
          New member? Apply to join
        </Link>
      </div>
    </AuthCard>
  )
}
