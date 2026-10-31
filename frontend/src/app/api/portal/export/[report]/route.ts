import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/portal/db'
import { getRequestMeta } from '@/lib/portal/auth'
import { writeAudit } from '@/lib/portal/audit'
import { reportToXlsx } from '@/lib/portal/export'
import { reportToPdf } from '@/lib/portal/export-pdf'
import { can, getViewer, type ActiveViewer, type ModuleName } from '@/lib/portal/rbac'
import { REPORTS, ReportNotFound, buildReport, type ReportKey } from '@/lib/portal/reports'
import { monthKey } from '@/lib/portal/time'

const KEYS = new Set<string>([...Object.keys(REPORTS), 'tasks', 'members', 'donors', 'outreach'])

const EXPORT_MODULE: Record<string, ModuleName> = {
  members: 'members',
  donors: 'donors',
  outreach: 'donors',
  tasks: 'tasks',
  donations: 'donations',
  cases: 'cases',
  event: 'events',
  onboarding: 'onboarding',
}

/**
 * Excel/PDF export for every report and list page (§10.3). Uses the same builders and scope
 * as the screens, so exports contain exactly what the viewer may see. Every export is audited.
 */
export async function GET(request: NextRequest, { params }: { params: { report: string } }) {
  const viewer = await getViewer()
  if (!viewer?.memberId || viewer.status !== 'ACTIVE' || !KEYS.has(params.report)) return new NextResponse('Not found', { status: 404 })
  const query = Object.fromEntries(request.nextUrl.searchParams.entries())
  const format = query.format === 'pdf' ? 'pdf' : 'xlsx'

  // Exporting needs the export action on that module (or reports.export); a member can always
  // export their own month.
  const exportModule = EXPORT_MODULE[params.report] ?? 'reports'
  // The event summary PDF is part of the event page for anyone who can see the event.
  const ownOnly = params.report === 'event' || (params.report === 'impact' && (!query.scope || query.scope === 'self')) || (params.report === 'member' && (!query.memberId || query.memberId === viewer.memberId))
  if (!ownOnly && !can(viewer, exportModule, 'export') && !can(viewer, 'reports', 'export')) return new NextResponse('Not found', { status: 404 })

  let report
  try {
    report = await buildReport(viewer as ActiveViewer, params.report as ReportKey, query, monthKey())
  } catch (error) {
    if (error instanceof ReportNotFound) return new NextResponse('Not found', { status: 404 })
    throw error
  }

  const generatedBy = `${viewer.fullName} <${viewer.email}>`
  const body = format === 'pdf' ? await reportToPdf(report, generatedBy) : await reportToXlsx(report, generatedBy)
  await prisma.$transaction(async (tx) => {
    await writeAudit(tx, {
      actorId: viewer.userId,
      action: 'export',
      entity: 'Report',
      entityId: params.report,
      after: { format, scope: report.scopeLabel, period: report.period, rows: report.tables.reduce((sum, table) => sum + table.rows.length, 0), query },
      ip: getRequestMeta().ip,
    })
  })

  const filename = `KKB-${params.report}-${report.period.replace(/[^\w-]+/g, '_')}.${format}`
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
