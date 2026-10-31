import { NextResponse } from 'next/server'
import { prisma } from '@/lib/portal/db'
import { getRequestMeta } from '@/lib/portal/auth'
import { writeAudit } from '@/lib/portal/audit'
import { renderMyDataPdf } from '@/lib/portal/my-data-pdf'
import { getViewer } from '@/lib/portal/rbac'
import { formatDate } from '@/lib/portal/time'

export async function GET() {
  const viewer = await getViewer()
  if (!viewer?.memberId) return new NextResponse('Not found', { status: 404 })

  const member = await prisma.member.findUniqueOrThrow({
    where: { id: viewer.memberId },
    include: {
      user: { select: { email: true } },
      reportsTo: { select: { fullName: true } },
      teams: { include: { team: { select: { name: true } } } },
      ndaSignatures: { include: { ndaVersion: { select: { version: true } } }, orderBy: { signedAt: 'asc' } },
      donationCredits: {
        include: { donation: { include: { donor: { select: { fullName: true } }, case: { select: { title: true } } } } },
        orderBy: { donation: { receivedAt: 'asc' } },
      },
    },
  })

  const pdf = await renderMyDataPdf({
    generatedFor: `${member.fullName} <${member.user.email}>`,
    profile: [
      { label: 'Full name', value: member.fullName },
      { label: "Father's name", value: member.fatherName ?? '' },
      { label: 'Date of birth', value: formatDate(member.dateOfBirth) },
      { label: 'Phone', value: member.phone },
      { label: 'WhatsApp', value: member.whatsapp ?? '' },
      { label: 'City', value: member.city },
      { label: 'Address', value: member.address },
      { label: 'CNIC', value: `ending ${member.cnicLast4}` },
      { label: 'Emergency contact', value: `${member.emergencyName}, ${member.emergencyPhone}` },
      { label: 'Institution / job', value: member.institutionOrJob ?? '' },
      { label: 'Skills', value: member.skills.join(', ') },
      { label: 'Status', value: member.status },
      { label: 'Joined', value: formatDate(member.joinedAt) },
      { label: 'Lead', value: member.reportsTo?.fullName ?? '' },
      { label: 'Teams', value: member.teams.map((membership) => membership.team.name).join(', ') },
    ],
    signatures: member.ndaSignatures.map((signature) => ({
      version: signature.ndaVersion.version,
      signedAt: signature.signedAt,
      typedName: signature.typedName,
      bodySha256: signature.bodySha256,
    })),
    donations: member.donationCredits.map(({ donation }) => ({
      receivedAt: donation.receivedAt,
      donor: donation.donor.fullName,
      caseTitle: donation.case.title,
      amount: donation.amount,
      status: donation.status,
    })),
  })

  await prisma.$transaction(async (tx) => {
    await writeAudit(tx, { actorId: viewer.userId, action: 'export', entity: 'Member', entityId: member.id, after: { report: 'my-data', format: 'pdf' }, ip: getRequestMeta().ip })
  })

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="KKB-my-data.pdf"',
      'Cache-Control': 'private, no-store',
    },
  })
}
