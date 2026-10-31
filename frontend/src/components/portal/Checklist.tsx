import React from 'react'
import { CheckCircle2, Circle } from 'lucide-react'
import { prisma } from '@/lib/portal/db'
import { authorize, type Viewer } from '@/lib/portal/rbac'
import { formatDate } from '@/lib/portal/time'
import { ActionForm, SubmitButton } from './ActionForm'
import { ProgressBar } from './ui'
import { toggleChecklistItemAction } from '@/app/portal/(app)/members/actions'

export async function loadChecklist(memberId: string) {
  return prisma.onboardingProgress.findMany({
    where: { memberId, item: { isActive: true } },
    include: { item: true, verifiedBy: { select: { fullName: true } } },
    orderBy: { item: { order: 'asc' } },
  })
}

export type ChecklistRows = Awaited<ReturnType<typeof loadChecklist>>

export default async function Checklist({ viewer, memberId, rows }: { viewer: Viewer; memberId: string; rows: ChecklistRows }) {
  const isSelf = viewer.memberId === memberId
  const canEditOthers = !isSelf && (await authorize(viewer, 'onboarding', 'edit', { memberIds: [memberId] }))
  const canEditOwn = isSelf && (await authorize(viewer, 'onboarding', 'edit', { ownerIds: [memberId] }))
  const done = rows.filter((row) => row.doneAt).length

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <ProgressBar value={done} max={rows.length} />
        <span className="shrink-0 text-sm font-semibold text-ink-700">
          {done}/{rows.length}
        </span>
      </div>
      <ul className="space-y-2">
        {rows.map((row) => {
          const editable =
            row.item.completedBy === 'MEMBER' ? canEditOwn || canEditOthers : row.item.completedBy === 'LEAD' ? canEditOthers : false
          const Icon = row.doneAt ? CheckCircle2 : Circle
          return (
            <li key={row.id} className="flex items-start gap-3 rounded-2xl bg-cream-50 px-3 py-3">
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${row.doneAt ? 'text-forest-600' : 'text-ink-300'}`} />
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${row.doneAt ? 'text-ink-500 line-through' : 'text-ink-900'}`}>{row.item.title}</p>
                <p className="text-xs text-ink-500">
                  {row.doneAt
                    ? `Done ${formatDate(row.doneAt)}${row.verifiedBy ? ` · ticked by ${row.verifiedBy.fullName}` : ''}`
                    : row.item.description ?? (row.item.completedBy === 'LEAD' ? 'Your lead ticks this.' : '')}
                </p>
              </div>
              {editable ? (
                <ActionForm action={toggleChecklistItemAction}>
                  <input type="hidden" name="progressId" value={row.id} />
                  <input type="hidden" name="done" value={row.doneAt ? 'false' : 'true'} />
                  <SubmitButton variant={row.doneAt ? 'outline' : 'secondary'} className="!px-3 !py-1.5 text-xs">
                    {row.doneAt ? 'Undo' : 'Mark done'}
                  </SubmitButton>
                </ActionForm>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
