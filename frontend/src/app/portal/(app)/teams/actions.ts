'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { prisma } from '@/lib/portal/db'
import { getRequestMeta } from '@/lib/portal/auth'
import { writeAudit } from '@/lib/portal/audit'
import { getSubtreeIds } from '@/lib/portal/hierarchy'
import { ForbiddenError, assertAdmin, can, requireActiveViewer, scopeFor, type Viewer } from '@/lib/portal/rbac'
import { runAction, UserError } from '@/lib/portal/action-utils'
import type { ActionState } from '@/lib/portal/validation'

const teamSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(60),
  description: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((value) => value || null),
})

export async function saveTeamAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    assertAdmin(viewer)
    const teamId = String(formData.get('teamId') ?? '')
    const input = teamSchema.parse({ name: formData.get('name'), description: formData.get('description') ?? undefined })
    if (!can(viewer, 'teams', teamId ? 'edit' : 'create')) throw new ForbiddenError()
    const clash = await prisma.team.findFirst({ where: { name: { equals: input.name, mode: 'insensitive' }, NOT: teamId ? { id: teamId } : undefined } })
    if (clash) return { ok: false, fieldErrors: { name: ['A team with this name already exists'] } }
    const { ip } = getRequestMeta()

    const team = await prisma.$transaction(async (tx) => {
      const before = teamId ? await tx.team.findUniqueOrThrow({ where: { id: teamId } }) : null
      const saved = teamId ? await tx.team.update({ where: { id: teamId }, data: input }) : await tx.team.create({ data: input })
      await writeAudit(tx, { actorId: viewer.userId, action: teamId ? 'update' : 'create', entity: 'Team', entityId: saved.id, before, after: saved, ip })
      return saved
    })
    if (!teamId) redirect(`/portal/teams/${team.id}`)
    revalidatePath(`/portal/teams/${team.id}`)
    return { ok: true, message: 'Team saved.' }
  })
}

export async function deleteTeamAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    assertAdmin(viewer)
    if (!can(viewer, 'teams', 'delete')) throw new ForbiddenError()
    const teamId = String(formData.get('teamId'))
    const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId }, include: { _count: { select: { tasks: true } } } })
    if (team.isGeneral) throw new UserError('The General team cannot be deleted.')
    if (team._count.tasks > 0) throw new UserError('This team has tasks. Move or delete them first.')
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      await tx.team.delete({ where: { id: teamId } })
      await writeAudit(tx, { actorId: viewer.userId, action: 'delete', entity: 'Team', entityId: teamId, before: team, ip })
    })
    redirect('/portal/teams')
  })
}

/** Admin can add anyone; a team lead can add or remove members of their own subtree (§6.1). */
async function assertCanManageMembership(viewer: Viewer, teamId: string, memberId: string) {
  if (viewer.isAdmin) return
  const leadsTeam = await prisma.teamMembership.findFirst({ where: { teamId, memberId: viewer.memberId!, isLead: true } })
  const scope = scopeFor(viewer, 'teams', 'assign')
  if (!leadsTeam || !scope) throw new ForbiddenError('Only this team\'s leads or an Admin can change its members.')
  if (scope !== 'all' && !(await getSubtreeIds(viewer.memberId!)).has(memberId)) {
    throw new ForbiddenError('You can only add or remove people in your own subtree.')
  }
}

export async function addTeamMemberAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const teamId = String(formData.get('teamId'))
    const memberId = String(formData.get('memberId') ?? '')
    if (!memberId) return { ok: false, fieldErrors: { memberId: ['Choose a member'] } }
    await assertCanManageMembership(viewer, teamId, memberId)
    const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } })
    if (member.status !== 'ACTIVE') throw new UserError('Only active members can join a team.')
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      const membership = await tx.teamMembership.upsert({
        where: { teamId_memberId: { teamId, memberId } },
        create: { teamId, memberId },
        update: {},
      })
      await writeAudit(tx, { actorId: viewer.userId, action: 'add_member', entity: 'Team', entityId: teamId, after: { memberId, membershipId: membership.id }, ip })
    })
    revalidatePath(`/portal/teams/${teamId}`)
    return { ok: true, message: `${member.fullName} added.` }
  })
}

export async function removeTeamMemberAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const teamId = String(formData.get('teamId'))
    const memberId = String(formData.get('memberId'))
    const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } })
    if (team.isGeneral) throw new UserError('Every active member stays in General.')
    await assertCanManageMembership(viewer, teamId, memberId)
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      await tx.teamMembership.delete({ where: { teamId_memberId: { teamId, memberId } } })
      await writeAudit(tx, { actorId: viewer.userId, action: 'remove_member', entity: 'Team', entityId: teamId, before: { memberId }, ip })
    })
    revalidatePath(`/portal/teams/${teamId}`)
    return { ok: true, message: 'Removed from team.' }
  })
}

export async function setTeamLeadAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    assertAdmin(viewer)
    const teamId = String(formData.get('teamId'))
    const memberId = String(formData.get('memberId'))
    const isLead = formData.get('isLead') === 'true'
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      await tx.teamMembership.update({ where: { teamId_memberId: { teamId, memberId } }, data: { isLead } })
      await writeAudit(tx, { actorId: viewer.userId, action: isLead ? 'make_lead' : 'remove_lead', entity: 'Team', entityId: teamId, after: { memberId, isLead }, ip })
    })
    revalidatePath(`/portal/teams/${teamId}`)
    return { ok: true, message: isLead ? 'Marked as team lead.' : 'No longer a team lead.' }
  })
}
