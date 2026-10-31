import type { Metadata } from 'next'
import GoalsPageClient from '@/components/goals/GoalsPageClient'

export const metadata: Metadata = {
  title: 'Goals and Events | Kaare Khair o Barr',
  description: 'Private goals and events management page for Kaare Khair o Barr.',
  robots: {
    index: false,
    follow: false,
  },
}

export default function GoalsPage() {
  return <GoalsPageClient />
}
