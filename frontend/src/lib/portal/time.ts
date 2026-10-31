export const PORTAL_TIME_ZONE = 'Asia/Karachi'

// A "month" is a calendar month in Asia/Karachi, keyed YYYY-MM (§2).
export function monthKey(date: Date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PORTAL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  return `${year}-${month}`
}

// UTC bounds of a Karachi month. PKT is UTC+5 with no DST.
export function monthRange(key: string) {
  const [year, month] = key.split('-').map(Number)
  const start = new Date(Date.UTC(year, month - 1, 1, -5))
  const end = new Date(Date.UTC(year, month, 1, -5))
  return { start, end }
}

// "YYYY-MM-DD" of a moment in Asia/Karachi.
export function dayKey(date: Date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PORTAL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

// UTC bounds of the Karachi calendar day containing `date`.
export function dayRange(date: Date = new Date()) {
  const [year, month, day] = dayKey(date).split('-').map(Number)
  const start = new Date(Date.UTC(year, month - 1, day, -5))
  return { start, end: new Date(start.getTime() + 86_400_000) }
}

// Parses an <input type="date"> value as a Karachi date (midday, so it never shifts a day).
export function parseKarachiDate(value: string) {
  return new Date(`${value}T12:00:00+05:00`)
}

export function toDateInput(date: Date | null | undefined) {
  return date ? dayKey(date) : ''
}

export function formatDate(value: Date | string | null | undefined) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-PK', {
    timeZone: PORTAL_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

export function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-PK', {
    timeZone: PORTAL_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

export function formatPKR(amount: number | null | undefined) {
  if (amount === null || amount === undefined) return '—'
  return `PKR ${amount.toLocaleString('en-PK')}`
}

export function daysBetween(from: Date, to: Date = new Date()) {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000)
}

export function ageOn(dateOfBirth: Date, on: Date = new Date()) {
  let age = on.getUTCFullYear() - dateOfBirth.getUTCFullYear()
  const beforeBirthday =
    on.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (on.getUTCMonth() === dateOfBirth.getUTCMonth() && on.getUTCDate() < dateOfBirth.getUTCDate())
  if (beforeBirthday) age -= 1
  return age
}
