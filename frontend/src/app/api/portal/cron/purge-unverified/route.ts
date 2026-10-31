import { NextResponse } from 'next/server'
import { prisma } from '@/lib/portal/db'
import { writeAudit } from '@/lib/portal/audit'

// Unverified accounts are purged after 7 days (§5.1). Called daily by Vercel Cron with
// Authorization: Bearer $CRON_SECRET.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const stale = await prisma.user.findMany({
    where: { emailVerifiedAt: null, createdAt: { lt: cutoff } },
    select: { id: true, email: true },
  })

  await prisma.$transaction(async (tx) => {
    for (const user of stale) {
      await writeAudit(tx, { actorId: null, action: 'purge_unverified', entity: 'User', entityId: user.id, before: { email: user.email } })
    }
    await tx.user.deleteMany({ where: { id: { in: stale.map((user) => user.id) } } })
    await tx.authToken.deleteMany({ where: { expiresAt: { lt: cutoff } } })
    await tx.loginAttempt.deleteMany({ where: { at: { lt: cutoff } } })
    await tx.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  })

  return NextResponse.json({ purged: stale.length })
}
