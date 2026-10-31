import { NextResponse } from 'next/server'
import { prisma } from '@/lib/portal/db'
import { renderNdaPdf } from '@/lib/portal/nda-pdf'
import { getViewer } from '@/lib/portal/rbac'

// A member can download their own signed agreement; Admins can download anyone's.
export async function GET(_: Request, { params }: { params: { signatureId: string } }) {
  const viewer = await getViewer()
  const signature = await prisma.ndaSignature.findUnique({ where: { id: params.signatureId }, include: { ndaVersion: true } })
  if (!viewer || !signature || (signature.memberId !== viewer.memberId && !viewer.isAdmin)) {
    return new NextResponse('Not found', { status: 404 })
  }

  const pdf = await renderNdaPdf({
    body: signature.ndaVersion.body,
    version: signature.ndaVersion.version,
    typedName: signature.typedName,
    signedAt: signature.signedAt,
    ip: signature.ip,
    bodySha256: signature.bodySha256,
  })
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="KKB-agreement-v${signature.ndaVersion.version}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
