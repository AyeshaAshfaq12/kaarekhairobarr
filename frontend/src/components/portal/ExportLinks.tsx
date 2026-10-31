import React from 'react'
import { Download } from 'lucide-react'

/** Excel + PDF export of the current report or list, with the same filters (§10.3). */
export default function ExportLinks({ report, params }: { report: string; params: Record<string, string | undefined> }) {
  const query = (format: string) => new URLSearchParams({ ...(Object.fromEntries(Object.entries(params).filter(([, value]) => value)) as Record<string, string>), format }).toString()
  return (
    <div className="mb-3 flex justify-end gap-2 text-xs">
      <a href={`/api/portal/export/${report}?${query('xlsx')}`} className="inline-flex items-center gap-1 rounded-full bg-white/80 px-3 py-1.5 font-medium text-ink-700 hover:bg-white">
        <Download className="h-3.5 w-3.5" /> Excel
      </a>
      <a href={`/api/portal/export/${report}?${query('pdf')}`} className="inline-flex items-center gap-1 rounded-full bg-white/80 px-3 py-1.5 font-medium text-ink-700 hover:bg-white">
        <Download className="h-3.5 w-3.5" /> PDF
      </a>
    </div>
  )
}
