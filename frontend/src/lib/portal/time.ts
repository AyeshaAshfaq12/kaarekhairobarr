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
/**
 * UTC bounds of a Karachi month ("2026-01") or an inclusive month range ("2026-01..2026-03",
 * used by reports, §10.2).
 */
export function monthRange(key: string) {
  const [first, last = first] = key.split('..')
  const [year, month] = first.split('-').map(Number)
  const [lastYear, lastMonth] = last.split('-').map(Number)
  const start = new Date(Date.UTC(year, month - 1, 1, -5))
  const end = new Date(Date.UTC(lastYear, lastMonth, 1, -5))
  return { start, end }
}

export const isMonthSpan = (key: string) => key.includes('..')

/** Every month key in a month or month range, oldest first. */
export function periodMonths(key: string) {
  const [first, last = first] = key.split('..')
  const months: string[] = []
  let [year, month] = first.split('-').map(Number)
  while (`${year}-${String(month).padStart(2, '0')}` <= last && months.length < 120) {
    months.push(`${year}-${String(month).padStart(2, '0')}`)
    month += 1
    if (month > 12) [year, month] = [year + 1, 1]
  }
  return months
}

/** "2026-01..2026-03" when the range is valid and at most `maxMonths` long; otherwise just `from`. */
export function makePeriod(from: string, to: string | undefined, maxMonths = 12) {
  if (!to || !/^\d{4}-\d{2}$/.test(to) || to <= from) return from
  const span = `${from}..${to}`
  return periodMonths(span).length <= maxMonths ? span : from
}

export function formatPeriod(key: string) {
  return key.replace('..', ' to ')
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
