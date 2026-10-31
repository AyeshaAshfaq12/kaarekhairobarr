import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from './db'
import { monthRange } from './time'

/**
 * Raised = sum of VERIFIED donations credited to each member, by the month they were
 * received (Asia/Karachi), not the month verified (§9.2). Co-credited donations count in
 * full for every credited member.
 */
export async function raisedByMember(memberIds: string[], month: string) {
  if (memberIds.length === 0) return new Map<string, number>()
  const { start, end } = monthRange(month)
  const rows = await prisma.$queryRaw<{ memberId: string; raised: bigint }[]>`
    SELECT dc."memberId", COALESCE(SUM(d.amount), 0)::bigint AS raised
    FROM "DonationCredit" dc
    JOIN "Donation" d ON d.id = dc."donationId"
    WHERE d.status = 'VERIFIED'
      AND d."receivedAt" >= ${start} AND d."receivedAt" < ${end}
      AND dc."memberId" IN (${Prisma.join(memberIds)})
    GROUP BY dc."memberId"
  `
  return new Map(rows.map((row) => [row.memberId, Number(row.raised)]))
}

export async function targetsByMember(memberIds: string[], month: string) {
  if (memberIds.length === 0) return new Map<string, number>()
  const rows = await prisma.target.findMany({
    where: { month, memberId: { in: memberIds } },
    select: { memberId: true, amountTarget: true },
  })
  return new Map(rows.map((row) => [row.memberId!, row.amountTarget]))
}

/** Team / org totals count each donation once, even when several members are credited (§9.3). */
export async function raisedByGroup(memberIds: string[] | 'all', month: string) {
  const { start, end } = monthRange(month)
  const memberFilter =
    memberIds === 'all'
      ? Prisma.empty
      : memberIds.length === 0
        ? Prisma.sql`AND FALSE`
        : Prisma.sql`AND EXISTS (SELECT 1 FROM "DonationCredit" dc WHERE dc."donationId" = d.id AND dc."memberId" IN (${Prisma.join(memberIds)}))`
  const [row] = await prisma.$queryRaw<{ raised: bigint }[]>`
    SELECT COALESCE(SUM(d.amount), 0)::bigint AS raised
    FROM "Donation" d
    WHERE d.status = 'VERIFIED' AND d."receivedAt" >= ${start} AND d."receivedAt" < ${end}
    ${memberFilter}
  `
  return Number(row?.raised ?? 0)
}
