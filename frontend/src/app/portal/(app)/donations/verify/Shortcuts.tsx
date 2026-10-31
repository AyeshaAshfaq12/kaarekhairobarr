'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** V = verify, R = jump to reject reason, N = skip to the next donation (§7.5). */
export default function Shortcuts({ nextHref }: { nextHref: string | null }) {
  const router = useRouter()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (event.metaKey || event.ctrlKey || event.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      const key = event.key.toLowerCase()
      if (key === 'v') {
        event.preventDefault()
        document.getElementById('verify-submit')?.click()
      } else if (key === 'r') {
        event.preventDefault()
        document.getElementById('reject-reason')?.focus()
      } else if (key === 'n' && nextHref) {
        event.preventDefault()
        router.push(nextHref)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nextHref, router])
  return null
}
