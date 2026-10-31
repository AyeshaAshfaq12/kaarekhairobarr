import { PrismaClient } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { fetchAncestorIds, fetchSubtreeIds, wouldCreateCycle } from '@/lib/portal/hierarchy'

// Exercises the recursive CTEs against a real Postgres. Runs only when TEST_DATABASE_URL
// points at a migrated database; every write is rolled back.
const url = process.env.TEST_DATABASE_URL
const ROLLBACK = new Error('rollback')

describe.skipIf(!url)('hierarchy CTEs (Postgres)', () => {
  let client: PrismaClient | null = null

  async function withTree(test: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0], ids: Record<string, string>) => Promise<void>) {
    client ??= new PrismaClient({ datasources: { db: { url } } })
    await client
      .$transaction(async (tx) => {
        const ids: Record<string, string> = {}
        const tree: [string, string | null][] = [
          ['root', null],
          ['lead1', 'root'],
          ['sub1', 'lead1'],
          ['m4', 'sub1'],
          ['m1', 'lead1'],
          ['lead2', 'root'],
          ['m7', 'lead2'],
        ]
        for (const [key, parent] of tree) {
          const user = await tx.user.create({ data: { email: `${key}-${Date.now()}-${Math.random()}@cte.test`, passwordHash: 'x' } })
          const member = await tx.member.create({
            data: {
              userId: user.id,
              fullName: key,
              gender: 'OTHER',
              dateOfBirth: new Date('2000-01-01'),
              phone: '+923000000000',
              city: 'Lahore',
              address: 'x',
              cnicEncrypted: 'x',
              cnicLast4: '0000',
              emergencyName: 'x',
              emergencyPhone: '+923000000000',
              status: 'ACTIVE',
              reportsToId: parent ? ids[parent] : null,
            },
          })
          ids[key] = member.id
        }
        await test(tx, ids)
        throw ROLLBACK
      })
      .catch((error) => {
        if (error !== ROLLBACK) throw error
      })
  }

  it('subtree includes self and every depth, nothing above or beside', async () => {
    await withTree(async (tx, ids) => {
      const subtree = new Set(await fetchSubtreeIds(ids.lead1, tx))
      expect(subtree).toEqual(new Set([ids.lead1, ids.sub1, ids.m4, ids.m1]))
      expect(new Set(await fetchSubtreeIds(ids.sub1, tx))).toEqual(new Set([ids.sub1, ids.m4]))
    })
  })

  it('ancestors walk up the lead chain nearest first', async () => {
    await withTree(async (tx, ids) => {
      expect(await fetchAncestorIds(ids.m4, tx)).toEqual([ids.sub1, ids.lead1, ids.root])
    })
  })

  it('rejects cycles', async () => {
    await withTree(async (tx, ids) => {
      expect(await wouldCreateCycle(ids.lead1, ids.m4, tx)).toBe(true)
      expect(await wouldCreateCycle(ids.lead1, ids.lead1, tx)).toBe(true)
      expect(await wouldCreateCycle(ids.m4, ids.lead2, tx)).toBe(false)
    })
  })
})
