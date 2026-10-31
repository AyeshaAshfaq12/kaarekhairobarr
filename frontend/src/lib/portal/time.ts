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
