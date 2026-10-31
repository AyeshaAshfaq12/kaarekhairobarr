import { describe, expect, it } from 'vitest'
import { diffFields } from '@/lib/portal/audit'
import { decryptString, encryptString, sha256 } from '@/lib/portal/crypto'
import { buildTree } from '@/lib/portal/hierarchy'
import { sniffMime } from '@/lib/portal/storage'
import { ageOn, formatPeriod, makePeriod, monthKey, monthRange, periodMonths } from '@/lib/portal/time'

describe('audit diffFields', () => {
  it('keeps changed fields only and masks sensitive ones', () => {
    const { before, after } = diffFields(
      { fullName: 'A', city: 'Lahore', cnicEncrypted: 'old', updatedAt: new Date(1) },
      { fullName: 'A', city: 'Karachi', cnicEncrypted: 'new', updatedAt: new Date(2) }
    )
    expect(before).toEqual({ city: 'Lahore', cnicEncrypted: '***' })
    expect(after).toEqual({ city: 'Karachi', cnicEncrypted: '***' })
  })

  it('masks password hashes on create', () => {
    const { before, after } = diffFields(null, { email: 'x@y.z', passwordHash: 'secret' })
    expect(before).toBeNull()
    expect(after).toEqual({ email: 'x@y.z', passwordHash: '***' })
  })
})

describe('CNIC encryption', () => {
  it('round-trips with AES-256-GCM and never stores plaintext', () => {
    const cipher = encryptString('35202-1234567-1')
    expect(cipher).not.toContain('35202')
    expect(decryptString(cipher)).toBe('35202-1234567-1')
    expect(encryptString('35202-1234567-1')).not.toBe(cipher) // random IV
  })

  it('detects tampering', () => {
    const [v, iv, tag, data] = encryptString('35202-1234567-1').split(':')
    const flipped = Buffer.from(data, 'base64')
    flipped[0] ^= 1
    expect(() => decryptString([v, iv, tag, flipped.toString('base64')].join(':'))).toThrow()
  })

  it('sha256 is stable', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('Karachi months', () => {
  it('uses Asia/Karachi (UTC+5) for the month key', () => {
    expect(monthKey(new Date('2026-10-31T18:59:00Z'))).toBe('2026-10')
    expect(monthKey(new Date('2026-10-31T19:00:00Z'))).toBe('2026-11')
  })

  it('monthRange returns UTC bounds of the Karachi month', () => {
    const { start, end } = monthRange('2026-01')
    expect(start.toISOString()).toBe('2025-12-31T19:00:00.000Z')
    expect(end.toISOString()).toBe('2026-01-31T19:00:00.000Z')
  })

  it('monthRange spans a month range end-inclusive', () => {
    const { start, end } = monthRange('2025-11..2026-01')
    expect(start.toISOString()).toBe('2025-10-31T19:00:00.000Z')
    expect(end.toISOString()).toBe('2026-01-31T19:00:00.000Z')
  })

  it('periodMonths lists every month of a month or range', () => {
    expect(periodMonths('2026-03')).toEqual(['2026-03'])
    expect(periodMonths('2025-11..2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
  })

  it('makePeriod builds a range only when it is valid and at most 12 months', () => {
    expect(makePeriod('2026-01', '2026-03')).toBe('2026-01..2026-03')
    expect(makePeriod('2026-01', undefined)).toBe('2026-01')
    expect(makePeriod('2026-03', '2026-01')).toBe('2026-03')
    expect(makePeriod('2026-01', '2026-01')).toBe('2026-01')
    expect(makePeriod('2026-01', 'junk')).toBe('2026-01')
    expect(makePeriod('2025-01', '2025-12')).toBe('2025-01..2025-12')
    expect(makePeriod('2025-01', '2026-01')).toBe('2025-01')
    expect(formatPeriod('2026-01..2026-03')).toBe('2026-01 to 2026-03')
  })

  it('ageOn handles birthdays', () => {
    expect(ageOn(new Date('2010-11-01'), new Date('2026-10-31'))).toBe(15)
    expect(ageOn(new Date('2010-10-31'), new Date('2026-10-31'))).toBe(16)
  })
})

describe('buildTree', () => {
  it('nests by reportsToId and survives cycles', () => {
    const rows = [
      { id: 'a', fullName: 'A', status: 'ACTIVE', reportsToId: null },
      { id: 'b', fullName: 'B', status: 'ACTIVE', reportsToId: 'a' },
      { id: 'c', fullName: 'C', status: 'ACTIVE', reportsToId: 'b' },
      { id: 'x', fullName: 'X', status: 'ACTIVE', reportsToId: 'y' },
      { id: 'y', fullName: 'Y', status: 'ACTIVE', reportsToId: 'x' },
    ]
    const [root] = buildTree(rows, ['a'])
    expect(root.children[0].id).toBe('b')
    expect(root.children[0].children[0].id).toBe('c')
    expect(buildTree(rows, ['x'])[0].children[0].children).toEqual([])
  })
})

describe('upload sniffing', () => {
  it('identifies jpg, png and pdf by magic bytes, not extension', () => {
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png')
    expect(sniffMime(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe('application/pdf')
    expect(sniffMime(new Uint8Array([0x3c, 0x73, 0x76, 0x67]))).toBeNull() // <svg
  })
})
