import type { Metadata } from 'next'
import StatisticsPageClient from '@/components/goals/StatisticsPageClient'

export const metadata: Metadata = {
  title: 'Statistics | Kaare Khair o Barr',
  description: 'See monthly and yearly fundraising targets through charts and summaries.',
}

export default function StatisticsPage() {
  return <StatisticsPageClient />
}
