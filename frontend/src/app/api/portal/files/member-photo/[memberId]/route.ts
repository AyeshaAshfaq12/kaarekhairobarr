import { NextResponse } from 'next/server'
import { prisma } from '@/lib/portal/db'
import { authorize, getViewer } from '@/lib/portal/rbac'
import { readUpload } from '@/lib/portal/storage'

// Signed/streamed file access checked against the same authorize() as the parent record (§11.3).
export async function GET(_: Request, { params }: { params: { memberId: string } }) {
  const viewer = await getViewer()
  const member = await prisma.member.findUnique({ where: { id: params.memberId }, select: { id: true, photoKey: true } })
  const allowed =
    viewer &&
    member?.photoKey &&
    (viewer.memberId === member.id || (await authorize(viewer, 'members', 'view', { ownerIds: [member.id], memberIds: [member.id] })))
  if (!allowed || !member?.photoKey) return new NextResponse('Not found', { status: 404 })

  const file = await readUpload(member.photoKey)
  if ('redirect' in file) return NextResponse.redirect(file.redirect)
  return new NextResponse(new Uint8Array(file.bytes), {
    headers: { 'Content-Type': file.mime, 'Cache-Control': 'private, max-age=900', 'X-Content-Type-Options': 'nosniff' },
  })
}
