'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { prisma } from '@/lib/portal/db'
import { getRequestMeta } from '@/lib/portal/auth'
import { writeAudit } from '@/lib/portal/audit'
import { encryptString } from '@/lib/portal/crypto'
import { getSubtreeIds } from '@/lib/portal/hierarchy'
import { refreshCaseFunding } from '@/lib/portal/money'
import { notifyMany } from '@/lib/portal/notify'
import { ForbiddenError, can, requireActiveViewer, scopeFor, type ActiveViewer } from '@/lib/portal/rbac'
import { storeUpload } from '@/lib/portal/storage'
import { parseKarachiDate } from '@/lib/portal/time'
import { runAction, UserError } from '@/lib/portal/action-utils'
import { CNIC_PATTERN, formDataToObject, reasonSchema, type ActionState } from '@/lib/portal/validation'

const optional = z.string().trim().optional().transform((value) => value || null)

const caseSchema = z.object({
  title: z.string().trim().min(3, 'Title is required').max(150),
  category: z.enum(['RATION', 'DIALYSIS', 'CANCER', 'DEBT', 'EDUCATION', 'OTHER'], { errorMap: () => ({ message: 'Choose a category' }) }),
  description: z.string().trim().min(10, 'Describe the case').max(5000),
  targetAmount: z.coerce.number({ invalid_type_error: 'Enter an amount' }).int('Whole rupees only').positive('Target must be above 0'),
  startDate: z.string().min(1, 'Start date is required').transform(parseKarachiDate),
  endDate: optional.transform((value) => (value ? parseKarachiDate(value) : null)),
  status: z.enum(['DRAFT', 'OPEN']).optional(),
  beneficiaryName: optional,
  beneficiaryPhone: optional,
  beneficiaryCnic: optional.refine((value) => !value || CNIC_PATTERN.test(value), 'CNIC must look like 35202-1234567-1'),
  beneficiaryCity: optional,
  beneficiaryCondition: optional,
  beneficiaryNotes: optional,
})

async function loadEditableCase(viewer: ActiveViewer, caseId: string) {
  const kase = await prisma.case.findUnique({ where: { id: caseId }, include: { assignments: true } })
  if (!kase || kase.deletedAt) throw new UserError('Case not found.')
  if (!viewer.isAdmin && kase.createdById !== viewer.memberId) throw new ForbiddenError('Only the case creator or an Admin can change this case.')
  return kase
}

async function uploadDocs(viewer: ActiveViewer, formData: FormData) {
  const keys: string[] = []
  for (const file of formData.getAll('documents')) {
    if (file instanceof File && file.size > 0) keys.push(await storeUpload(file, { uploadedById: viewer.userId, purpose: 'beneficiary-doc' }))
  }
  return keys
}

export async function saveCaseAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const caseId = String(formData.get('caseId') ?? '')
    const input = caseSchema.parse(formDataToObject(formData))
    if (input.endDate && input.endDate < input.startDate) return { ok: false, fieldErrors: { endDate: ['End date is before the start date'] } }
    const existing = caseId ? await loadEditableCase(viewer, caseId) : null
    if (!existing && !can(viewer, 'cases', 'create')) throw new ForbiddenError('Only Admins and leads can create cases.')
    if (existing?.category === 'EVENT') throw new UserError('Event cases are edited from their event.')
    const docKeys = await uploadDocs(viewer, formData)
    const { ip } = getRequestMeta()

    const saved = await prisma.$transaction(async (tx) => {
      let beneficiaryId = existing?.beneficiaryId ?? null
      if (input.beneficiaryName) {
        const data = {
          fullName: input.beneficiaryName,
          phone: input.beneficiaryPhone,
          city: input.beneficiaryCity,
          condition: input.beneficiaryCondition,
          notes: input.beneficiaryNotes,
          ...(input.beneficiaryCnic ? { cnicEncrypted: encryptString(input.beneficiaryCnic) } : {}),
        }
        if (beneficiaryId) {
          const before = await tx.beneficiary.findUniqueOrThrow({ where: { id: beneficiaryId } })
          await tx.beneficiary.update({ where: { id: beneficiaryId }, data: { ...data, documentKeys: [...before.documentKeys, ...docKeys] } })
        } else {
          beneficiaryId = (await tx.beneficiary.create({ data: { ...data, documentKeys: docKeys } })).id
        }
      }
      const fields = {
        title: input.title,
        category: input.category,
        description: input.description,
        targetAmount: input.targetAmount,
        startDate: input.startDate,
        endDate: input.endDate,
        beneficiaryId,
      }
      const kase = existing
        ? await tx.case.update({ where: { id: existing.id }, data: fields })
        : await tx.case.create({ data: { ...fields, status: input.status ?? 'DRAFT', createdById: viewer.memberId } })
      if (existing) await refreshCaseFunding(tx, kase.id)
      await writeAudit(tx, { actorId: viewer.userId, action: existing ? 'update' : 'create', entity: 'Case', entityId: kase.id, before: existing, after: kase, ip })
      return kase
    })

    revalidatePath('/portal/cases')
    if (!existing) redirect(`/portal/cases/${saved.id}`)
    revalidatePath(`/portal/cases/${saved.id}`)
    return { ok: true, message: 'Case saved.' }
  })
}

const TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['OPEN', 'CANCELLED'],
  OPEN: ['CLOSED', 'CANCELLED'],
  FUNDED: ['CLOSED', 'CANCELLED'],
  CLOSED: ['OPEN'],
  CANCELLED: [],
}

export async function setCaseStatusAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const kase = await loadEditableCase(viewer, String(formData.get('caseId')))
    const status = z.enum(['OPEN', 'CLOSED', 'CANCELLED']).parse(formData.get('status'))
    if (!TRANSITIONS[kase.status]?.includes(status)) throw new UserError(`A ${kase.status.toLowerCase()} case can't move to ${status.toLowerCase()}.`)
    let reason: string | null = null
    if (status === 'CANCELLED') {
      const parsed = reasonSchema.safeParse(formData.get('reason'))
      if (!parsed.success) return { ok: false, fieldErrors: { reason: ['Cancelling requires a reason'] } }
      reason = parsed.data
    }
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      await tx.case.update({ where: { id: kase.id }, data: { status, cancelReason: reason } })
      // Re-opening a funded case lands on FUNDED again.
      if (status === 'OPEN') await refreshCaseFunding(tx, kase.id)
      await writeAudit(tx, { actorId: viewer.userId, action: `status_${status.toLowerCase()}`, entity: 'Case', entityId: kase.id, before: { status: kase.status }, after: { status }, reason, ip })
    })
    revalidatePath(`/portal/cases/${kase.id}`)
    return { ok: true, message: 'Status updated.' }
  })
}

/** Leads assign members from their subtree; Admin can assign anyone (§7.1). */
export async function assignCaseMembersAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const caseId = String(formData.get('caseId'))
    const scope = scopeFor(viewer, 'cases', 'assign')
    if (!scope) throw new ForbiddenError()
    const kase = await prisma.case.findUniqueOrThrow({ where: { id: caseId }, include: { assignments: true } })
    const wanted = new Set(formData.getAll('memberIds').map(String))
    const current = new Set(kase.assignments.map((assignment) => assignment.memberId))
    const allowed = scope === 'all' ? null : await getSubtreeIds(viewer.memberId)
    const added = [...wanted].filter((id) => !current.has(id))
    const removed = [...current].filter((id) => !wanted.has(id))
    // A lead can only change assignments for people in their own subtree.
    if (allowed && [...added, ...removed].some((id) => !allowed.has(id))) throw new ForbiddenError('You can only assign members from your subtree.')
    const valid = await prisma.member.count({ where: { id: { in: added }, status: 'ACTIVE' } })
    if (valid !== added.length) throw new UserError('Only active members can be assigned.')
    const { ip } = getRequestMeta()

    await prisma.$transaction(async (tx) => {
      if (removed.length) await tx.caseAssignment.deleteMany({ where: { caseId, memberId: { in: removed } } })
      if (added.length) await tx.caseAssignment.createMany({ data: added.map((memberId) => ({ caseId, memberId })) })
      await writeAudit(tx, { actorId: viewer.userId, action: 'assign', entity: 'Case', entityId: caseId, before: { members: [...current] }, after: { members: [...wanted] }, ip })
    })
    if (added.length) {
      const users = await prisma.member.findMany({ where: { id: { in: added } }, select: { userId: true } })
      await notifyMany(users.map((user) => user.userId), 'ASSIGNED', { title: `You were assigned to the case "${kase.title}"`, href: `/portal/cases/${caseId}` })
    }
    revalidatePath(`/portal/cases/${caseId}`)
    return { ok: true, message: 'Assignments saved.' }
  })
}

export async function deleteCaseAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const kase = await loadEditableCase(viewer, String(formData.get('caseId')))
    if (kase.category === 'EVENT') throw new UserError('Event cases are removed with their event.')
    if (await prisma.donation.count({ where: { caseId: kase.id } })) throw new UserError('This case has donations. Cancel or close it instead.')
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      await tx.case.update({ where: { id: kase.id }, data: { deletedAt: new Date() } })
      await writeAudit(tx, { actorId: viewer.userId, action: 'delete', entity: 'Case', entityId: kase.id, before: kase, ip })
    })
    redirect('/portal/cases')
  })
}
