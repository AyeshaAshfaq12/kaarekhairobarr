import { createHmac } from 'crypto'
import { describe, expect, it } from 'vitest'
import { fromWhatsAppId, parseAmount, parseCommand, toWhatsAppId } from '@/lib/portal/whatsapp-commands'
import { verifyWebhookSignature } from '@/lib/portal/whatsapp'

describe('parseCommand', () => {
  it('help for empty or greeting messages', () => {
    expect(parseCommand('').kind).toBe('help')
    expect(parseCommand('Salam').kind).toBe('help')
    expect(parseCommand('HELP').kind).toBe('help')
  })

  it('cases', () => expect(parseCommand('cases')).toEqual({ kind: 'cases' }))

  it('outreach with promised amount and donor name', () => {
    expect(parseCommand('outreach 03001234567 promised 5,000 Ahmed Raza')).toEqual({
      kind: 'outreach',
      phone: '+923001234567',
      outcome: 'PROMISED',
      amount: 5000,
      name: 'Ahmed Raza',
    })
  })

  it('phone typed with spaces, short aliases, "no response"', () => {
    expect(parseCommand('o 0300 1234567 nr')).toMatchObject({ kind: 'outreach', phone: '+923001234567', outcome: 'NO_RESPONSE', amount: null, name: null })
    expect(parseCommand('outreach +92 300 1234567 no response Sara')).toMatchObject({ outcome: 'NO_RESPONSE', name: 'Sara' })
  })

  it('promised needs an amount', () => {
    expect(parseCommand('outreach 03001234567 promised Ahmed')).toMatchObject({ kind: 'error' })
  })

  it('rejects bad phones and outcomes', () => {
    expect(parseCommand('outreach 12345 contacted')).toMatchObject({ kind: 'error' })
    expect(parseCommand('outreach 03001234567 maybe')).toMatchObject({ kind: 'error' })
  })

  it('donation with ref and #case', () => {
    expect(parseCommand('donation 03001234567 5k easypaisa TX123 #2')).toEqual({
      kind: 'donation',
      phone: '+923001234567',
      amount: 5000,
      method: 'EASYPAISA',
      ref: 'TX123',
      caseNumber: 2,
      cashNote: null,
    })
    expect(parseCommand('d 03001234567 2000 bank case 3 REF9')).toMatchObject({ caseNumber: 3, ref: 'REF9' })
  })

  it('cash donations need a note on who received it', () => {
    expect(parseCommand('donation 03001234567 2000 cash #1 given to Sana at UET')).toMatchObject({ method: 'CASH', cashNote: 'given to Sana at UET', ref: null })
    expect(parseCommand('donation 03001234567 2000 cash #1')).toMatchObject({ kind: 'error' })
  })

  it('donation needs a case number, amount and method', () => {
    expect(parseCommand('donation 03001234567 5000 easypaisa TX1')).toMatchObject({ kind: 'error' })
    expect(parseCommand('donation 03001234567 lots easypaisa #1')).toMatchObject({ kind: 'error' })
    expect(parseCommand('donation 03001234567 5000 bitcoin #1')).toMatchObject({ kind: 'error' })
  })

  it('unknown verbs explain how to get help', () => {
    expect(parseCommand('refund 5000')).toMatchObject({ kind: 'error', message: expect.stringContaining('help') })
  })
})

describe('parseAmount', () => {
  it.each([
    ['5000', 5000],
    ['5,000', 5000],
    ['5k', 5000],
    ['1.5k', 1500],
    ['Rs5000', 5000],
    ['pkr2000', 2000],
  ])('%s → %s', (input, expected) => expect(parseAmount(input)).toBe(expected))
  it.each(['0', '-5', 'abc', '', '5kk'])('rejects %s', (input) => expect(parseAmount(input)).toBeNull())
})

describe('WhatsApp ids', () => {
  it('round-trips between WhatsApp and portal formats', () => {
    expect(fromWhatsAppId('923001234567')).toBe('+923001234567')
    expect(toWhatsAppId('+923001234567')).toBe('923001234567')
    expect(fromWhatsAppId('15551234567')).toBeNull()
  })
})

describe('verifyWebhookSignature', () => {
  const secret = 'app-secret'
  const body = JSON.stringify({ entry: [] })
  const sign = (payload: string, key = secret) => `sha256=${createHmac('sha256', key).update(payload).digest('hex')}`

  it('accepts a correct signature', () => expect(verifyWebhookSignature(body, sign(body), secret)).toBe(true))
  it('rejects a tampered body, wrong secret, missing header or secret', () => {
    expect(verifyWebhookSignature(`${body} `, sign(body), secret)).toBe(false)
    expect(verifyWebhookSignature(body, sign(body, 'other'), secret)).toBe(false)
    expect(verifyWebhookSignature(body, null, secret)).toBe(false)
    expect(verifyWebhookSignature(body, sign(body), undefined)).toBe(false)
    expect(verifyWebhookSignature(body, 'sha256=abc', secret)).toBe(false)
  })
})
