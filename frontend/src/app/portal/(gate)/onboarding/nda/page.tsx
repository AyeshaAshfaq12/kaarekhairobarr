import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/portal/db'
import { sha256 } from '@/lib/portal/crypto'
import { getOutstandingNda, requireViewer } from '@/lib/portal/rbac'
import NdaSignForm from './NdaSignForm'

export const metadata: Metadata = { title: 'Member agreement | KKB Portal' }

export default async function NdaPage() {
  const viewer = await requireViewer()
  if (!viewer.memberId) redirect('/portal/onboarding/pending')

  const member = await prisma.member.findUniqueOrThrow({ where: { id: viewer.memberId } })
  const nda = await getOutstandingNda(member.id)
  if (!nda) redirect(member.status === 'ACTIVE' ? '/portal/dashboard' : '/portal/onboarding/pending')
  if (!['PENDING_NDA', 'ACTIVE'].includes(member.status)) redirect('/portal/onboarding/pending')

  const resign = member.status === 'ACTIVE'

  return (
    <div className="mx-auto max-w-3xl">
      <p className="eyebrow mb-3">{resign ? 'Updated agreement' : 'Step 2 of 3'}</p>
      <h1 className="font-display text-2xl font-semibold text-ink-900 sm:text-3xl">{nda.title}</h1>
      <p className="mb-6 mt-2 text-sm text-ink-500">
        {resign
          ? `KKB published version ${nda.version} of the agreement. Please read and sign it to continue using the portal.`
          : 'Please read the whole agreement. After you sign, an admin will review your application.'}
      </p>
      <NdaSignForm ndaVersionId={nda.id} bodySha256={sha256(nda.body)} body={nda.body} fullName={member.fullName} />
    </div>
  )
}
