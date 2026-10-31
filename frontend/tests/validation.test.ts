import { describe, expect, it } from 'vitest'
import { CNIC_PATTERN, normalizePhone, signupSchema } from '@/lib/portal/validation'

describe('normalizePhone', () => {
  it.each([
    ['0300 1234567', '+923001234567'],
    ['03001234567', '+923001234567'],
    ['+92 300 1234567', '+923001234567'],
    ['923001234567', '+923001234567'],
    ['0092-300-1234567', '+923001234567'],
    ['3001234567', '+923001234567'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected)
  })

  it.each(['', '12345', '04235123456', '+1 555 123 4567', '0300123456'])('rejects %s', (input) => {
    expect(normalizePhone(input)).toBeNull()
  })
})

describe('CNIC', () => {
  it('requires #####-#######-#', () => {
    expect(CNIC_PATTERN.test('35202-1234567-1')).toBe(true)
    expect(CNIC_PATTERN.test('3520212345671')).toBe(false)
    expect(CNIC_PATTERN.test('35202-123456-1')).toBe(false)
  })
})

describe('signupSchema', () => {
  const valid = {
    email: 'New.Member@Example.com',
    password: 'longenough',
    confirmPassword: 'longenough',
    fullName: 'New Member',
    gender: 'FEMALE',
    dateOfBirth: '2000-01-01',
    phone: '0300 1234567',
    city: 'Lahore',
    address: 'House 1, Street 2',
    cnic: '35202-1234567-1',
    emergencyName: 'Parent',
    emergencyPhone: '0321 7654321',
    skills: 'design, , writing',
  }

  it('normalises email, phones and skills', () => {
    const parsed = signupSchema.parse(valid)
    expect(parsed.email).toBe('new.member@example.com')
    expect(parsed.phone).toBe('+923001234567')
    expect(parsed.emergencyPhone).toBe('+923217654321')
    expect(parsed.skills).toEqual(['design', 'writing'])
    expect(parsed.whatsapp).toBeNull()
  })

  it('rejects short passwords and mismatched confirmation', () => {
    expect(signupSchema.safeParse({ ...valid, password: 'short', confirmPassword: 'short' }).success).toBe(false)
    const mismatch = signupSchema.safeParse({ ...valid, confirmPassword: 'different1' })
    expect(mismatch.success).toBe(false)
    expect(mismatch.error?.flatten().fieldErrors.confirmPassword).toBeDefined()
  })

  it('rejects a malformed CNIC', () => {
    expect(signupSchema.safeParse({ ...valid, cnic: '3520212345671' }).success).toBe(false)
  })
})
