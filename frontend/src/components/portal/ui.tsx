import Link from 'next/link'
import React, { ReactNode } from 'react'
import clsx from 'clsx'

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  eyebrow?: string
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}
        <h1 className="font-display text-2xl font-semibold text-ink-900 sm:text-3xl">{title}</h1>
        {description ? <p className="mt-1 text-sm text-ink-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  )
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('min-w-0 rounded-3xl border border-ink-900/5 bg-white/85 p-4 shadow-soft sm:p-6', className)}>
      {title || actions ? (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title ? <h2 className="font-display text-lg font-semibold text-ink-900">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  )
}

const BADGE_TONES = {
  neutral: 'bg-ink-50 text-ink-700',
  green: 'bg-forest-50 text-forest-700',
  amber: 'bg-cream-100 text-cream-700',
  red: 'bg-clay-50 text-clay-700',
  blue: 'bg-sky-50 text-sky-700',
} as const

export type BadgeTone = keyof typeof BADGE_TONES

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', BADGE_TONES[tone])}>
      {children}
    </span>
  )
}

const MEMBER_STATUS_TONE: Record<string, BadgeTone> = {
  ACTIVE: 'green',
  PENDING_NDA: 'amber',
  PENDING_APPROVAL: 'amber',
  INACTIVE: 'neutral',
  LEFT: 'neutral',
  REJECTED: 'red',
}

export function MemberStatusBadge({ status }: { status: string }) {
  return <Badge tone={MEMBER_STATUS_TONE[status] ?? 'neutral'}>{humanize(status)}</Badge>
}

export function humanize(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ')
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-ink-900/10 px-4 py-6 text-center text-sm text-ink-500">{children}</p>
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-2xl bg-cream-50 p-3 sm:p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-ink-900 sm:text-2xl">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-ink-500">{hint}</p> : null}
    </div>
  )
}

export function Tabs({ tabs, active }: { tabs: { key: string; label: string; href: string }[]; active: string }) {
  return (
    <nav className="-mx-4 mb-5 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          scroll={false}
          className={clsx(
            'shrink-0 rounded-full px-3.5 py-2 text-sm font-medium',
            tab.key === active ? 'bg-ink-900 text-cream-50' : 'bg-white/70 text-ink-600 hover:bg-white'
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}

export function ProgressBar({ value, max, className }: { value: number; max: number; className?: string }) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className={clsx('h-2 w-full overflow-hidden rounded-full bg-ink-50', className)}>
      <div className="h-full rounded-full bg-forest-500" style={{ width: `${percent}%` }} />
    </div>
  )
}

/** Verified progress, with pending money as a lighter segment (§7.1). */
export function SplitProgress({ verified, pending, target, className }: { verified: number; pending: number; target: number; className?: string }) {
  const pct = (value: number) => (target > 0 ? Math.min(100, (value / target) * 100) : 0)
  const verifiedPct = pct(verified)
  const pendingPct = Math.min(100 - verifiedPct, pct(pending))
  return (
    <div className={clsx('flex h-2.5 w-full overflow-hidden rounded-full bg-ink-50', className)} title={`Verified ${verified}, pending ${pending}, target ${target}`}>
      <div className="h-full bg-forest-500" style={{ width: `${verifiedPct}%` }} />
      <div className="h-full bg-forest-200" style={{ width: `${pendingPct}%` }} />
    </div>
  )
}

const BAND_TONE = { ON_TRACK: 'green', CLOSE: 'amber', BEHIND: 'red' } as const
const BAND_LABEL = { ON_TRACK: 'On track', CLOSE: 'Close', BEHIND: 'Behind' } as const

export function BandBadge({ band }: { band: keyof typeof BAND_TONE | null }) {
  return band ? <Badge tone={BAND_TONE[band]}>{BAND_LABEL[band]}</Badge> : <span className="text-xs text-ink-400">—</span>
}

export function MonthPicker({ month, basePath, extra }: { month: string; basePath: string; extra?: Record<string, string | undefined> }) {
  return (
    <form action={basePath} className="flex items-center gap-2">
      {Object.entries(extra ?? {}).map(([key, value]) => (value ? <input key={key} type="hidden" name={key} value={value} /> : null))}
      <input type="month" name="month" defaultValue={month} className="field !w-auto !py-2" aria-label="Month" />
      <button className="btn-secondary !py-2">Go</button>
    </form>
  )
}

export function Pagination({ page, pages, href }: { page: number; pages: number; href: (page: number) => string }) {
  if (pages <= 1) return null
  return (
    <div className="mt-4 flex items-center justify-between text-sm">
      {page > 1 ? <Link href={href(page - 1)} className="btn-outline">Previous</Link> : <span />}
      <span className="text-ink-500">
        Page {page} of {pages}
      </span>
      {page < pages ? <Link href={href(page + 1)} className="btn-outline">Next</Link> : <span />}
    </div>
  )
}

export function pageHref(basePath: string, params: Record<string, string | undefined>) {
  return (page: number) => {
    const search = new URLSearchParams(Object.entries({ ...params, page: String(page) }).filter(([, value]) => value) as [string, string][])
    return `${basePath}?${search.toString()}`
  }
}

export function KeyValue({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">{item.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-ink-900">{item.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

export const CASE_STATUS_TONE: Record<string, BadgeTone> = { DRAFT: 'neutral', OPEN: 'blue', FUNDED: 'green', CLOSED: 'neutral', CANCELLED: 'red' }
export const DONATION_STATUS_TONE: Record<string, BadgeTone> = { PENDING: 'amber', VERIFIED: 'green', REJECTED: 'red' }
export const TASK_STATUS_TONE: Record<string, BadgeTone> = { TODO: 'neutral', IN_PROGRESS: 'blue', IN_REVIEW: 'amber', BLOCKED: 'red', DONE: 'green', CANCELLED: 'neutral' }
