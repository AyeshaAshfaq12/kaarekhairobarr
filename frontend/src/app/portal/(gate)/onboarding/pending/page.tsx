import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Clock3, PauseCircle, XCircle } from 'lucide-react'
import { prisma } from '@/lib/portal/db'
import { requireViewer } from '@/lib/portal/rbac'

export const metadata: Metadata = { title: 'Application status | KKB Portal' }

export default async function PendingPage() {
  const viewer = await requireViewer()
  const member = viewer.memberId ? await prisma.member.findUnique({ where: { id: viewer.memberId } }) : null

  if (member?.status === 'ACTIVE') redirect('/portal/dashboard')
  if (member?.status === 'PENDING_NDA') redirect('/portal/onboarding/nda')

  const content =
    member?.status === 'REJECTED'
      ? {
          icon: XCircle,
          title: 'Your application was not approved',
          body: member.rejectionReason ? `Reason: ${member.rejectionReason}` : 'Contact a KKB admin if you have questions.',
        }
      : member?.status === 'INACTIVE'
        ? {
            icon: PauseCircle,
            title: 'Your membership is paused',
            body: 'An admin has paused your account. Contact your lead or a KKB admin to reactivate it.',
          }
        : {
            icon: Clock3,
            title: 'Awaiting approval',
            body: "Thank you for signing the agreement. An admin will review your application and assign your lead and teams. We'll email you as soon as you're approved.",
          }

  const Icon = content.icon
  return (
    <div className="surface-panel mx-auto max-w-lg p-6 text-center sm:p-10">
      <Icon className="mx-auto h-12 w-12 text-forest-600" />
      <h1 className="mt-4 font-display text-2xl font-semibold text-ink-900">{content.title}</h1>
      <p className="mt-3 text-sm text-ink-600">{content.body}</p>
    </div>
  )
}
