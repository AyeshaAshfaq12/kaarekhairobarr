import { NextResponse, type NextRequest } from 'next/server'
import { cronUnauthorized, runMonthlyClose, runPendingDigest } from '@/lib/portal/cron'
import { runMonthlyTaskJobs } from '@/lib/portal/tasks'

export const maxDuration = 300

// 03:00 PKT (22:00 UTC): monthly close + recompute, pending-donation digest, recurring tasks.
// `?at=<ISO date>` replays the job as of that moment (backfills, ops). Same secret required.
export async function GET(request: NextRequest) {
  const denied = cronUnauthorized(request)
  if (denied) return denied
  const at = request.nextUrl.searchParams.get('at')
  const now = at ? new Date(at) : new Date()
  if (Number.isNaN(now.getTime())) return NextResponse.json({ error: 'Invalid at' }, { status: 400 })
  const close = await runMonthlyClose(now)
  const digest = await runPendingDigest(now)
  const tasks = await runMonthlyTaskJobs(now)
  return NextResponse.json({ close, digest, tasks })
}
