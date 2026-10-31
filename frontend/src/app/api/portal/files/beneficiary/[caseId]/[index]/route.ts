import { prisma } from '@/lib/portal/db'
import { fileResponse, notFoundResponse } from '@/lib/portal/file-response'
import { canSeeBeneficiary } from '@/lib/portal/money'
import { getViewer } from '@/lib/portal/rbac'

export async function GET(_: Request, { params }: { params: { caseId: string; index: string } }) {
  const viewer = await getViewer()
  if (!viewer || viewer.status !== 'ACTIVE') return notFoundResponse()
  const kase = await prisma.case.findUnique({ where: { id: params.caseId }, include: { beneficiary: true, assignments: { select: { memberId: true } } } })
  const key = kase?.beneficiary?.documentKeys[Number(params.index)]
  if (!kase || !key || !canSeeBeneficiary(viewer, kase)) return notFoundResponse()
  return fileResponse(key)
}
