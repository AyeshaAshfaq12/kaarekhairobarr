// Pure parser for WhatsApp quick-logging commands (Phase 4, §11.2). No I/O; unit-tested.
//
//   help
//   cases                                   → numbered list of open cases
//   outreach <phone> <outcome> [amount] [donor name…]
//   donation <phone> <amount> <method> [ref] #<case> [cash: who received it…]
//
// Examples:
//   outreach 0300 1234567 promised 5000 Ahmed Raza
//   o 03001234567 nr
//   donation 03001234567 5000 easypaisa TX123 #2      (send it as the caption of the screenshot)
//   d 03001234567 2,000 cash #1 given to Sana at UET
import { normalizePhone } from './validation'

export type Outcome = 'CONTACTED' | 'PROMISED' | 'DONATED' | 'DECLINED' | 'NO_RESPONSE'
export type Method = 'EASYPAISA' | 'JAZZCASH' | 'BANK' | 'CASH' | 'OTHER'

export type Command =
  | { kind: 'help' }
  | { kind: 'cases' }
  | { kind: 'outreach'; phone: string; outcome: Outcome; amount: number | null; name: string | null }
  | { kind: 'donation'; phone: string; amount: number; method: Method; ref: string | null; caseNumber: number; cashNote: string | null }
  | { kind: 'error'; message: string }

const OUTCOMES: Record<string, Outcome> = {
  contacted: 'CONTACTED',
  c: 'CONTACTED',
  promised: 'PROMISED',
  promise: 'PROMISED',
  p: 'PROMISED',
  donated: 'DONATED',
  d: 'DONATED',
  declined: 'DECLINED',
  decline: 'DECLINED',
  x: 'DECLINED',
  no_response: 'NO_RESPONSE',
  noresponse: 'NO_RESPONSE',
  nr: 'NO_RESPONSE',
}

const METHODS: Record<string, Method> = {
  easypaisa: 'EASYPAISA',
  ep: 'EASYPAISA',
  jazzcash: 'JAZZCASH',
  jc: 'JAZZCASH',
  bank: 'BANK',
  cash: 'CASH',
  other: 'OTHER',
}

export const HELP_TEXT = [
  'KKB quick logging:',
  '• outreach <phone> <outcome> [amount] [name]',
  '   outcomes: contacted, promised, donated, declined, nr',
  '   e.g. outreach 03001234567 promised 5000 Ahmed Raza',
  '• cases — list open cases with their numbers',
  '• donation <phone> <amount> <method> [ref] #<case>',
  '   methods: easypaisa, jazzcash, bank, cash, other',
  '   send it as the caption of the payment screenshot',
  '   cash: donation 03001234567 2000 cash #1 given to Sana',
].join('\n')

/** "5000", "5,000", "5k", "1.5k" → whole rupees; null if not an amount. */
export function parseAmount(token: string | undefined) {
  if (!token) return null
  const match = token.toLowerCase().replace(/,/g, '').match(/^(?:rs\.?|pkr)?(\d+(?:\.\d+)?)(k)?$/)
  if (!match) return null
  const value = Math.round(Number(match[1]) * (match[2] ? 1000 : 1))
  return Number.isInteger(value) && value > 0 ? value : null
}

/**
 * Phones can be typed with spaces ("0300 1234567"); greedily join leading tokens until they
 * form a valid Pakistani mobile number.
 */
function takePhone(tokens: string[]) {
  for (let count = 1; count <= Math.min(4, tokens.length); count += 1) {
    const phone = normalizePhone(tokens.slice(0, count).join(''))
    if (phone) return { phone, rest: tokens.slice(count) }
  }
  return null
}

export function parseCommand(text: string): Command {
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  const verb = tokens.shift()?.toLowerCase()
  if (!verb || verb === 'help' || verb === '?' || verb === 'hi' || verb === 'salam') return { kind: 'help' }
  if (verb === 'cases') return { kind: 'cases' }

  if (verb === 'outreach' || verb === 'o') {
    const phone = takePhone(tokens)
    if (!phone) return { kind: 'error', message: 'Start with the donor phone, e.g. outreach 03001234567 contacted' }
    const [outcomeToken, ...rest] = phone.rest
    // "no response" as two words
    const joined = outcomeToken?.toLowerCase() === 'no' && rest[0]?.toLowerCase() === 'response' ? 'no_response' : outcomeToken?.toLowerCase()
    const outcome = joined ? OUTCOMES[joined] : undefined
    if (!outcome) return { kind: 'error', message: 'Outcome must be contacted, promised, donated, declined or nr (no response).' }
    const after = joined === 'no_response' && outcomeToken?.toLowerCase() === 'no' ? rest.slice(1) : rest
    const amount = parseAmount(after[0])
    const nameTokens = amount ? after.slice(1) : after
    if (outcome === 'PROMISED' && !amount) return { kind: 'error', message: 'Add the promised amount, e.g. outreach 03001234567 promised 5000' }
    return { kind: 'outreach', phone: phone.phone, outcome, amount, name: nameTokens.join(' ') || null }
  }

  if (verb === 'donation' || verb === 'd') {
    const phone = takePhone(tokens)
    if (!phone) return { kind: 'error', message: 'Start with the donor phone, e.g. donation 03001234567 5000 easypaisa TX123 #2' }
    const amount = parseAmount(phone.rest[0])
    if (!amount) return { kind: 'error', message: 'Add the amount after the phone, e.g. donation 03001234567 5000 …' }
    const method = METHODS[phone.rest[1]?.toLowerCase() ?? '']
    if (!method) return { kind: 'error', message: 'Method must be easypaisa, jazzcash, bank, cash or other.' }
    let rest = phone.rest.slice(2)
    // Case: "#2" or "case 2" anywhere after the method.
    let caseNumber: number | null = null
    const hashIndex = rest.findIndex((token) => /^#\d+$/.test(token))
    if (hashIndex >= 0) {
      caseNumber = Number(rest[hashIndex].slice(1))
      rest = [...rest.slice(0, hashIndex), ...rest.slice(hashIndex + 1)]
    } else {
      const wordIndex = rest.findIndex((token, index) => token.toLowerCase() === 'case' && /^\d+$/.test(rest[index + 1] ?? ''))
      if (wordIndex >= 0) {
        caseNumber = Number(rest[wordIndex + 1])
        rest = [...rest.slice(0, wordIndex), ...rest.slice(wordIndex + 2)]
      }
    }
    if (!caseNumber) return { kind: 'error', message: 'Add the case number, e.g. #2. Send "cases" to see the list.' }
    if (method === 'CASH') {
      const note = rest.join(' ').trim()
      if (!note) return { kind: 'error', message: 'For cash, say who received it, e.g. … cash #1 given to Sana' }
      return { kind: 'donation', phone: phone.phone, amount, method, ref: null, caseNumber, cashNote: note }
    }
    return { kind: 'donation', phone: phone.phone, amount, method, ref: rest[0] ?? null, caseNumber, cashNote: null }
  }

  return { kind: 'error', message: `I didn't understand "${verb}". Send "help" for the commands.` }
}

/** WhatsApp sends numbers as "923001234567"; the portal stores "+923001234567". */
export function fromWhatsAppId(waId: string) {
  return normalizePhone(waId.startsWith('+') ? waId : `+${waId}`)
}

export function toWhatsAppId(phone: string) {
  return phone.replace(/^\+/, '')
}
