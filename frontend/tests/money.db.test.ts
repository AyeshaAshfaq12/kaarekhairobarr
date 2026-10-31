import { PrismaClient } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { findOrLinkDonor } from '@/lib/portal/money'

// Donor dedupe (§4, §7.2) against a real database. Runs when TEST_DATABASE_URL is set; rolled back.
const url = process.env.TEST_DATABASE_URL
const ROLLBACK = new Error('rollback')

describe.skipIf(!url)('donor dedupe (Postgres)', () => {
  let client: PrismaClient | null = null

  async function inTx(test: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0], members: string[]) => Promise<void>) {
    client ??= new PrismaClient({ datasources: { db: { url } } })
    await client
      .$transaction(async (tx) => {
        const members: string[] = []
        for (const key of ['a', 'b']) {
          const user = await tx.user.create({ data: { email: `${key}-${Date.now()}-${Math.random()}@dedupe.test`, passwordHash: 'x' } })
          const member = await tx.member.create({
            data: { userId: user.id, fullName: key, gender: 'OTHER', dateOfBirth: new Date('2000-01-01'), phone: '+923000000000', city: 'x', address: 'x', cnicEncrypted: 'x', cnicLast4: '0000', emergencyName: 'x', emergencyPhone: '+923000000000', status: 'ACTIVE' },
          })
          members.push(member.id)
        }
        await test(tx, members)
        throw ROLLBACK
      })
      .catch((error) => {
        if (error !== ROLLBACK) throw error
      })
  }

  it('a donor with an existing phone number is linked, not duplicated', async () => {
    await inTx(async (tx, [a, b]) => {
      const phone = `0301${String(Date.now()).slice(-7)}`
      const first = await findOrLinkDonor(tx, { fullName: 'Ahmed', phone }, a, a)
      expect(first.outcome).toBe('created')
      // Same number written differently by another member.
      const second = await findOrLinkDonor(tx, { fullName: 'Ahmed R.', phone: `+92 ${phone.slice(1)}` }, b, b)
      expect(second.outcome).toBe('linked')
      expect(second.donor.id).toBe(first.donor.id)
      const again = await findOrLinkDonor(tx, { fullName: 'Ahmed', phone }, a, a)
      expect(again.outcome).toBe('existing')
      expect(await tx.donor.count({ where: { phoneNormalized: first.donor.phoneNormalized } })).toBe(1)
      expect(await tx.donorLink.count({ where: { donorId: first.donor.id } })).toBe(2)
    })
  })

  it('donors without a phone are never merged', async () => {
    await inTx(async (tx, [a]) => {
      const one = await findOrLinkDonor(tx, { fullName: 'No Phone' }, a, a)
      const two = await findOrLinkDonor(tx, { fullName: 'No Phone' }, a, a)
      expect(one.donor.id).not.toBe(two.donor.id)
    })
  })
})
