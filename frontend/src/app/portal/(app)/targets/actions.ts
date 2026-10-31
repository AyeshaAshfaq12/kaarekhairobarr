'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma } from '@/lib/portal/db'
import { getRequestMeta } from '@/lib/portal/auth'
import { writeAudit } from '@/lib/portal/audit'
import { getSubtreeIds } from '@/lib/portal/hierarchy'
import { previousMonth } from '@/lib/portal/metrics-core'
import { ForbiddenError, assertAdmin, requireActiveViewer, scopeFor, type ActiveViewer } from '@/lib/portal/rbac'
import { runAction } from '@/lib/portal/action-utils'
import type { ActionState } from '@/lib/portal/validation'

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Pick a month')
const amount = z
  .string()
  .trim()
  .optional()
  .transform((value, ctx) => {
    if (!value) return null
    const number = Number(value)
    if (!Number.isInteger(number) || number < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Whole numbers only' })
      return z.NEVER
    }
    return number
  })

/** Leads set targets for members in their subtree (not themselves); Admin sets anyone's (§9.1). */
async function settableMemberIds(viewer: ActiveViewer): Promise<'all' | Set<string>> {
  const scope = scopeFor(viewer, 'targets', 'edit') ?? scopeFor(viewer, 'targets', 'create')
  if (!scope) throw new ForbiddenError()
  if (scope === 'all') return 'all'
  const ids = new Set(scope === 'subtree' ? await getSubtreeIds(viewer.memberId) : [])
  ids.delete(viewer.memberId)
  return ids
}

export async function setMemberTargetAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const month = monthSchema.parse(formData.get('month'))
    const memberId = String(formData.get('memberId'))
    const amountTarget = amount.parse(formData.get('amountTarget') ?? undefined)
    const outreachTarget = amount.parse(formData.get('outreachTarget') ?? undefined)
    const allowed = await settableMemberIds(viewer)
    if (allowed !== 'all' && !allowed.has(memberId)) throw new ForbiddenError('You can set targets only for members below you.')
    const { ip } = getRequestMeta()

    await prisma.$transaction(async (tx) => {
      const before = await tx.target.findUnique({ where: { month_memberId: { month, memberId } } })
      if (amountTarget === null) {
        if (before) await tx.target.delete({ where: { id: before.id } })
        await writeAudit(tx, { actorId: viewer.userId, action: 'delete', entity: 'Target', entityId: before?.id ?? `${month}:${memberId}`, before, ip })
        return
      }
      const after = await tx.target.upsert({
        where: { month_memberId: { month, memberId } },
        create: { month, memberId, amountTarget, outreachTarget, setById: viewer.memberId },
        update: { amountTarget, outreachTarget, setById: viewer.memberId },
      })
      await writeAudit(tx, { actorId: viewer.userId, action: before ? 'update' : 'create', entity: 'Target', entityId: after.id, before, after, ip })
    })
    revalidatePath('/portal/targets')
    return { ok: true, message: 'Target saved.' }
  })
}

export async function setTeamTargetAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    assertAdmin(viewer)
    const month = monthSchema.parse(formData.get('month'))
    const teamId = String(formData.get('teamId'))
    const amountTarget = amount.parse(formData.get('amountTarget') ?? undefined)
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      const before = await tx.target.findUnique({ where: { month_teamId: { month, teamId } } })
      if (amountTarget === null) {
        if (before) await tx.target.delete({ where: { id: before.id } })
        await writeAudit(tx, { actorId: viewer.userId, action: 'delete', entity: 'Target', entityId: before?.id ?? `${month}:${teamId}`, before, ip })
        return
      }
      const after = await tx.target.upsert({
        where: { month_teamId: { month, teamId } },
        create: { month, teamId, amountTarget, setById: viewer.memberId },
        update: { amountTarget, setById: viewer.memberId },
      })
      await writeAudit(tx, { actorId: viewer.userId, action: before ? 'update' : 'create', entity: 'Target', entityId: after.id, before, after, ip })
    })
    revalidatePath('/portal/targets')
    return { ok: true, message: 'Team target saved.' }
  })
}

/** "Copy last month's targets" for the viewer's whole subtree; never overwrites (§9.1). */
export async function copyLastMonthAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const month = monthSchema.parse(formData.get('month'))
    const allowed = await settableMemberIds(viewer)
    const previous = await prisma.target.findMany({
      where: { month: previousMonth(month), memberId: allowed === 'all' ? { not: null } : { in: [...allowed] } },
    })
    const existing = new Set((await prisma.target.findMany({ where: { month, memberId: { in: previous.map((t) => t.memberId!) } }, select: { memberId: true } })).map((t) => t.memberId))
    const toCopy = previous.filter((target) => !existing.has(target.memberId))
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      await tx.target.createMany({
        data: toCopy.map((target) => ({ month, memberId: target.memberId, amountTarget: target.amountTarget, outreachTarget: target.outreachTarget, setById: viewer.memberId })),
        skipDuplicates: true,
      })
      await writeAudit(tx, { actorId: viewer.userId, action: 'copy_targets', entity: 'Target', entityId: month, after: { from: previousMonth(month), copied: toCopy.length }, ip })
    })
    revalidatePath('/portal/targets')
    return { ok: true, message: toCopy.length ? `Copied ${toCopy.length} target(s) from ${previousMonth(month)}.` : 'Nothing to copy — targets already set or none last month.' }
  })
}
