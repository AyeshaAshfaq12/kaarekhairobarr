import { NextResponse } from 'next/server'
import { cronUnauthorized, runFollowUpReminders } from '@/lib/portal/cron'
import { runTaskReminders } from '@/lib/portal/tasks'

// 08:00 PKT (03:00 UTC): follow-ups due today, tasks due tomorrow / overdue.
export async function GET(request: Request) {
  const denied = cronUnauthorized(request)
  if (denied) return denied
  const followUps = await runFollowUpReminders()
  const tasks = await runTaskReminders()
  return NextResponse.json({ followUps, tasks })
}
