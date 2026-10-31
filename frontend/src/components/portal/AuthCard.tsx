import Link from 'next/link'
import React, { ReactNode } from 'react'
import clsx from 'clsx'
import BrandLogo from '@/components/BrandLogo'

export default function AuthCard({
  title,
  subtitle,
  children,
  wide = false,
}: {
  title: string
  subtitle?: ReactNode
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div className="flex min-h-screen flex-col items-center px-4 py-8 sm:py-14">
      <Link href="/" className="mb-6 flex items-center gap-3">
        <BrandLogo size="sm" className="shadow-soft" priority />
        <div>
          <p className="font-display text-lg font-semibold leading-none text-ink-900">Kaare Khair o Barr</p>
          <p className="mt-1 text-[0.68rem] uppercase tracking-[0.18em] text-ink-500">Member portal</p>
        </div>
      </Link>
      <div className={clsx('surface-panel w-full p-5 sm:p-8', wide ? 'max-w-3xl' : 'max-w-md')}>
        <h1 className="font-display text-2xl font-semibold text-ink-900">{title}</h1>
        {subtitle ? <p className="mt-1.5 text-sm text-ink-500">{subtitle}</p> : null}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  )
}
