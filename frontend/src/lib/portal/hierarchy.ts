import 'server-only'
import { requestCache as cache } from './request-cache'
import { prisma, type Tx } from './db'

// Subtree(u) = u plus every member below u (§3.1), resolved with a recursive CTE.
export async function fetchSubtreeIds(memberId: string, client: Tx | typeof prisma = prisma) {
  const rows = await client.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE subtree AS (
      SELECT id FROM "Member" WHERE id = ${memberId}
      UNION
      SELECT m.id FROM "Member" m JOIN subtree s ON m."reportsToId" = s.id
    )
    SELECT id FROM subtree
  `
  return rows.map((row) => row.id)
}

// Cached per request.
export const getSubtreeIds = cache(async (memberId: string) => new Set(await fetchSubtreeIds(memberId)))

// Lead chain above a member, nearest first.
export async function fetchAncestorIds(memberId: string, client: Tx | typeof prisma = prisma) {
  const rows = await client.$queryRaw<{ id: string; depth: number }[]>`
    WITH RECURSIVE chain AS (
      SELECT "reportsToId" AS id, 1 AS depth FROM "Member" WHERE id = ${memberId}
      UNION
      SELECT m."reportsToId", c.depth + 1 FROM "Member" m JOIN chain c ON m.id = c.id
      WHERE c.depth < 100
    )
    SELECT id, depth FROM chain WHERE id IS NOT NULL ORDER BY depth
  `
  return rows.map((row) => row.id)
}

// Making newLeadId the lead of memberId creates a cycle if newLeadId sits in memberId's subtree.
export async function wouldCreateCycle(memberId: string, newLeadId: string, client: Tx | typeof prisma = prisma) {
  if (memberId === newLeadId) return true
  const subtree = await fetchSubtreeIds(memberId, client)
  return subtree.includes(newLeadId)
}

// Members of teams the given member leads (team scope, §3.2).
export const getLedTeamMemberIds = cache(async (memberId: string) => {
  const rows = await prisma.teamMembership.findMany({
    where: { team: { memberships: { some: { memberId, isLead: true } } } },
    select: { memberId: true },
  })
  return new Set(rows.map((row) => row.memberId))
})

export type TreeNode = { id: string; fullName: string; status: string; children: TreeNode[] }

export function buildTree(rows: { id: string; fullName: string; status: string; reportsToId: string | null }[], rootIds: string[]) {
  const byParent = new Map<string | null, typeof rows>()
  for (const row of rows) {
    const list = byParent.get(row.reportsToId) ?? []
    list.push(row)
    byParent.set(row.reportsToId, list)
  }
  const byId = new Map(rows.map((row) => [row.id, row]))
  const build = (id: string, seen: Set<string>): TreeNode | null => {
    const row = byId.get(id)
    if (!row || seen.has(id)) return null
    seen.add(id)
    const children = (byParent.get(id) ?? [])
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .map((child) => build(child.id, seen))
      .filter((node): node is TreeNode => node !== null)
    return { id: row.id, fullName: row.fullName, status: row.status, children }
  }
  const seen = new Set<string>()
  return rootIds.map((id) => build(id, seen)).filter((node): node is TreeNode => node !== null)
}
