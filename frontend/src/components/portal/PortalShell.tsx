'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React, { ReactNode, useEffect, useState } from 'react'
import clsx from 'clsx'
import {
  Bell,
  ClipboardCheck,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  Settings,
  ShieldCheck,
  UserCheck,
  Users,
  Users2,
  X,
} from 'lucide-react'
import BrandLogo from '@/components/BrandLogo'

const ICONS = {
  dashboard: LayoutDashboard,
  members: Users,
  pending: UserCheck,
  teams: Users2,
  onboarding: ClipboardCheck,
  roles: ShieldCheck,
  audit: ScrollText,
  settings: Settings,
} as const

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number }

function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname()
  // The longest matching href wins, so /portal/members/pending highlights Approvals, not Members.
  const activeHref = items
    .map((item) => item.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0]
  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const Icon = ICONS[item.icon]
        const active = item.href === activeHref
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={clsx(
              'flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium',
              active ? 'bg-ink-900 text-cream-50' : 'text-ink-700 hover:bg-white'
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="flex-1">{item.label}</span>
            {item.badge ? (
              <span className={clsx('rounded-full px-2 text-xs font-semibold', active ? 'bg-cream-50 text-ink-900' : 'bg-clay-500 text-white')}>
                {item.badge}
              </span>
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}

export default function PortalShell({
  items,
  userName,
  roleLabel,
  unread,
  logout,
  children,
}: {
  items: NavItem[]
  userName: string
  roleLabel: string
  unread: number
  logout: () => Promise<void>
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  useEffect(() => setOpen(false), [pathname])

  const bell = (
    <Link href="/portal/notifications" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-ink-900/10 bg-white/80">
      <Bell className="h-4 w-4" />
      {unread ? (
        <span className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full bg-clay-500 px-1 text-center text-[0.65rem] font-bold leading-[1.1rem] text-white">
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}
    </Link>
  )

  const footer = (
    <div className="mt-auto border-t border-ink-900/5 pt-4">
      <p className="truncate text-sm font-semibold text-ink-900">{userName}</p>
      <p className="truncate text-xs text-ink-500">{roleLabel}</p>
      <form action={logout} className="mt-3">
        <button className="inline-flex items-center gap-2 text-sm font-medium text-ink-600 hover:text-ink-900">
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </form>
    </div>
  )

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col gap-6 border-r border-white/60 bg-cream-50/70 p-5 backdrop-blur-xl lg:flex">
        <Link href="/portal/dashboard" className="flex items-center gap-2">
          <BrandLogo size="sm" />
          <span className="font-display text-lg font-semibold text-ink-900">KKB Portal</span>
        </Link>
        <NavLinks items={items} />
        {footer}
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-white/60 bg-cream-50/85 px-4 backdrop-blur-xl lg:hidden">
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-ink-900/10 bg-white/80">
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/portal/dashboard" className="font-display text-lg font-semibold text-ink-900">
          KKB Portal
        </Link>
        {bell}
      </header>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button aria-label="Close menu" className="absolute inset-0 bg-ink-950/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col gap-6 overflow-y-auto bg-cream-50 p-5 shadow-card-glow">
            <div className="flex items-center justify-between">
              <span className="font-display text-lg font-semibold text-ink-900">Menu</span>
              <button onClick={() => setOpen(false)} aria-label="Close menu" className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <NavLinks items={items} onNavigate={() => setOpen(false)} />
            {footer}
          </div>
        </div>
      ) : null}

      <div className="min-w-0 flex-1">
        <div className="hidden justify-end px-8 pt-6 lg:flex">{bell}</div>
        <main className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 lg:px-8 lg:py-4">{children}</main>
      </div>
    </div>
  )
}
