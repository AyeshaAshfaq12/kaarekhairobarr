import { prisma } from '@/lib/portal/db'
import { fileResponse, notFoundResponse } from '@/lib/portal/file-response'
import { anyOf, donationWhere } from '@/lib/portal/money'
import { getViewer } from '@/lib/portal/rbac'

// Proof images follow the same scope as the donation itself (view or verify).
export async function GET(_: Request, { params }: { params: { donationId: string } }) {
  const viewer = await getViewer()
  if (!viewer || viewer.status !== 'ACTIVE') return notFoundResponse()
  const donation = await prisma.donation.findFirst({
    where: { AND: [{ id: params.donationId }, anyOf(await donationWhere(viewer, 'view'), await donationWhere(viewer, 'verify'))] },
    select: { proofKey: true },
  })
  if (!donation?.proofKey) return notFoundResponse()
  return fileResponse(donation.proofKey)
}
