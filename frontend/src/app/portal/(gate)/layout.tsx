import Link from 'next/link'
import React, { ReactNode } from 'react'
import BrandLogo from '@/components/BrandLogo'
import { logoutAction } from '../(auth)/actions'

export default function GateLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-white/50 bg-cream-50/80 backdrop-blur-xl">
        <div className="container-custom flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <BrandLogo size="sm" />
            <span className="font-display text-lg font-semibold text-ink-900">KKB Portal</span>
          </Link>
          <form action={logoutAction}>
            <button className="text-sm font-medium text-ink-600 hover:text-ink-900">Sign out</button>
          </form>
        </div>
      </header>
      <main className="container-custom py-6 sm:py-10">{children}</main>
    </div>
  )
}
