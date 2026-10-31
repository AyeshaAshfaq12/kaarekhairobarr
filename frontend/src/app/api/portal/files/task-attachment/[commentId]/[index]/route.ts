import { prisma } from '@/lib/portal/db'
import { fileResponse, notFoundResponse } from '@/lib/portal/file-response'
import { getViewer } from '@/lib/portal/rbac'
import { taskPermissions } from '@/lib/portal/tasks'

export async function GET(_: Request, { params }: { params: { commentId: string; index: string } }) {
  const viewer = await getViewer()
  if (!viewer || viewer.status !== 'ACTIVE') return notFoundResponse()
  const comment = await prisma.taskComment.findUnique({ where: { id: params.commentId }, include: { task: true } })
  const key = comment?.attachmentKeys[Number(params.index)]
  if (!comment || !key || !(await taskPermissions(viewer, comment.task)).canView) return notFoundResponse()
  return fileResponse(key)
}
