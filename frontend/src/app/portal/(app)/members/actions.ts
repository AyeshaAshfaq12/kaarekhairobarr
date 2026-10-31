'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { prisma } from '@/lib/portal/db'
import { getRequestMeta, issueToken, revokeAllSessions } from '@/lib/portal/auth'
import { writeAudit } from '@/lib/portal/audit'
import { portalUrl, sendEmail } from '@/lib/portal/email'
import { wouldCreateCycle } from '@/lib/portal/hierarchy'
import { ensureChecklist, offboardMember, setMemberTeams, setUserRoles } from '@/lib/portal/members'
import { notify } from '@/lib/portal/notify'
import { SYSTEM_ROLE, assertAdmin, assertAuthorized, can, requireActiveViewer, ForbiddenError } from '@/lib/portal/rbac'
import { runAction, UserError } from '@/lib/portal/action-utils'
import { reasonSchema, type ActionState } from '@/lib/portal/validation'

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

function ids(formData: FormData, name: string) {
  return formData.getAll(name).map(String).filter(Boolean)
}

async function requireActiveLead(leadId: string, client = prisma) {
  const lead = await client.member.findUnique({ where: { id: leadId }, select: { id: true, status: true, userId: true, fullName: true } })
  if (!lead || lead.status !== 'ACTIVE') throw new UserError('Choose an active member as the lead.')
  return lead
}

// ---------- Approval (§5.3, Admin only) ----------

export async function approveMemberAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    assertAdmin(viewer)
    if (!can(viewer, 'members', 'approve')) throw new ForbiddenError()

    const memberId = String(formData.get('memberId'))
    const reportsToId = String(formData.get('reportsToId') ?? '')
    const teamIds = ids(formData, 'teamIds')
    let roleIds = ids(formData, 'roleIds')
    const welcomeNote = String(formData.get('welcomeNote') ?? '').trim()

    const fieldErrors: Record<string, string[]> = {}
    if (!reportsToId) fieldErrors.reportsToId = ['Choose a lead']
    if (teamIds.length === 0) fieldErrors.teamIds = ['Choose at least one team']
    if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors }

    if (roleIds.length === 0) {
      const memberRole = await prisma.role.findUniqueOrThrow({ where: { name: SYSTEM_ROLE.MEMBER } })
      roleIds = [memberRole.id]
    }

    const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId }, include: { user: true } })
    if (member.status !== 'PENDING_APPROVAL') throw new UserError('This applicant is no longer awaiting approval.')
    const lead = await requireActiveLead(reportsToId)
    const { ip } = getRequestMeta()

    await prisma.$transaction(async (tx) => {
      if (await wouldCreateCycle(memberId, lead.id, tx)) throw new UserError('That lead would create a loop in the hierarchy.')
      const updated = await tx.member.update({
        where: { id: memberId },
        data: { status: 'ACTIVE', joinedAt: new Date(), reportsToId: lead.id },
      })
      const teams = await setMemberTeams(tx, memberId, teamIds)
      const roles = await setUserRoles(tx, viewer, member.userId, roleIds)
      await ensureChecklist(tx, memberId)
      await writeAudit(tx, {
        actorId: viewer.userId,
        action: 'approve',
        entity: 'Member',
        entityId: memberId,
        before: { status: member.status, reportsToId: member.reportsToId, joinedAt: member.joinedAt, teams: teams.before, roles: roles.before },
        after: { status: updated.status, reportsToId: updated.reportsToId, joinedAt: updated.joinedAt, teams: teams.after, roles: roles.after },
        reason: welcomeNote || null,
        ip,
      })
    })

    await sendEmail({
      to: member.user.email,
      subject: 'Welcome to Kaare Khair o Barr',
      text: `Assalam o Alaikum ${member.fullName},\n\nYour application has been approved. Your lead is ${lead.fullName}.${welcomeNote ? `\n\n${welcomeNote}` : ''}\n\nSign in to see your onboarding checklist: ${portalUrl('/portal/dashboard')}`,
    })
    await notify(member.userId, 'APPLICATION_APPROVED', {
      title: 'Your application was approved',
      body: welcomeNote || `Welcome to KKB! Your lead is ${lead.fullName}.`,
      href: '/portal/onboarding',
    })
    await notify(lead.userId, 'SUBTREE_MEMBER_JOINED', {
      title: `${member.fullName} joined your team`,
      body: `${member.fullName} now reports to you. Schedule an intro call and tick it on their checklist.`,
      href: `/portal/members/${memberId}`,
    })

    // The applicant's card disappears from the queue, so confirm via a notice on reload.
    redirect(`/portal/members/pending?approved=${member.id}`)
  })
}

export async function rejectMemberAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    assertAdmin(viewer)
    if (!can(viewer, 'members', 'approve')) throw new ForbiddenError()

    const memberId = String(formData.get('memberId'))
    const reason = reasonSchema.safeParse(formData.get('reason'))
    if (!reason.success) return { ok: false, fieldErrors: { reason: ['A reason is required to reject'] } }

    const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId }, include: { user: true } })
    if (member.status !== 'PENDING_APPROVAL') throw new UserError('This applicant is no longer awaiting approval.')
    const { ip } = getRequestMeta()

    await prisma.$transaction(async (tx) => {
      await tx.member.update({ where: { id: memberId }, data: { status: 'REJECTED', rejectionReason: reason.data } })
      await writeAudit(tx, {
        actorId: viewer.userId,
        action: 'reject',
        entity: 'Member',
        entityId: memberId,
        before: { status: member.status },
        after: { status: 'REJECTED' },
        reason: reason.data,
        ip,
      })
    })
    await revokeAllSessions(member.userId)
    await sendEmail({
      to: member.user.email,
      subject: 'Your KKB application',
      text: `Assalam o Alaikum ${member.fullName},\n\nThank you for applying to Kaare Khair o Barr. Unfortunately your application was not approved.\n\nReason: ${reason.data}`,
    })
    await notify(member.userId, 'APPLICATION_REJECTED', { title: 'Your application was not approved', body: reason.data })

    redirect(`/portal/members/pending?rejected=${member.id}`)
  })
}

// ---------- Profile changes (§5.5, Admin) ----------

export async function changeLeadAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    assertAdmin(viewer)
    if (!can(viewer, 'members', 'edit')) throw new ForbiddenError()
    const memberId = String(formData.get('memberId'))
    const leadId = String(formData.get('reportsToId') ?? '')
    if (!leadId) return { ok: false, fieldErrors: { reportsToId: ['Choose a lead'] } }
    const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } })
    const lead = await requireActiveLead(leadId)
    const { ip } = getRequestMeta()

    await prisma.$transaction(async (tx) => {
      if (await wouldCreateCycle(memberId, lead.id, tx)) {
        throw new UserError('That would create a loop: the new lead reports (directly or indirectly) to this member.')
      }
      await tx.member.update({ where: { id: memberId }, data: { reportsToId: lead.id } })
      await writeAudit(tx, {
        actorId: viewer.userId,
        action: 'change_lead',
        entity: 'Member',
        entityId: memberId,
        before: { reportsToId: member.reportsToId },
        after: { reportsToId: lead.id },
        ip,
      })
    })
    if (member.reportsToId !== lead.id && member.status === 'ACTIVE') {
      await notify(lead.userId, 'SUBTREE_MEMBER_JOINED', {
        title: `${member.fullName} now reports to you`,
        href: `/portal/members/${memberId}`,
      })
    }
    revalidatePath(`/portal/members/${memberId}`)
    return { ok: true, message: 'Lead updated.' }
  })
}

export async function updateTeamsAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    assertAdmin(viewer)
    const memberId = String(formData.get('memberId'))
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      const result = await setMemberTeams(tx, memberId, ids(formData, 'teamIds'))
      await writeAudit(tx, { actorId: viewer.userId, action: 'update_teams', entity: 'Member', entityId: memberId, before: { teams: result.before }, after: { teams: result.after }, ip })
    })
    revalidatePath(`/portal/members/${memberId}`)
    return { ok: true, message: 'Teams updated.' }
  })
}

export async function updateRolesAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    assertAdmin(viewer)
    const memberId = String(formData.get('memberId'))
    const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } })
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      const result = await setUserRoles(tx, viewer, member.userId, ids(formData, 'roleIds'))
      if (result.changed) {
        await writeAudit(tx, { actorId: viewer.userId, action: 'role_change', entity: 'Member', entityId: memberId, before: { roles: result.before }, after: { roles: result.after }, ip })
      }
    })
    revalidatePath(`/portal/members/${memberId}`)
    return { ok: true, message: 'Roles updated.' }
  })
}

export async function setStatusAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    assertAdmin(viewer)
    const memberId = String(formData.get('memberId'))
    const status = z.enum(['ACTIVE', 'INACTIVE']).parse(formData.get('status'))
    const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } })
    if (!['ACTIVE', 'INACTIVE'].includes(member.status)) throw new UserError('Only active or paused members can be paused or reactivated.')
    if (memberId === viewer.memberId) throw new UserError("You can't pause yourself.")
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      await tx.member.update({ where: { id: memberId }, data: { status } })
      await writeAudit(tx, { actorId: viewer.userId, action: status === 'INACTIVE' ? 'pause' : 'reactivate', entity: 'Member', entityId: memberId, before: { status: member.status }, after: { status }, ip })
    })
    revalidatePath(`/portal/members/${memberId}`)
    return { ok: true, message: status === 'INACTIVE' ? 'Member paused.' : 'Member reactivated.' }
  })
}

export async function offboardAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    assertAdmin(viewer)
    const memberId = String(formData.get('memberId'))
    const reason = reasonSchema.safeParse(formData.get('reason'))
    if (!reason.success) return { ok: false, fieldErrors: { reason: ['A reason is required'] } }
    if (memberId === viewer.memberId) throw new UserError("You can't offboard yourself.")
    const { ip } = getRequestMeta()

    const result = await prisma.$transaction(async (tx) => {
      const outcome = await offboardMember(tx, memberId)
      await tx.member.update({ where: { id: memberId }, data: { leftReason: reason.data } })
      // One audit entry listing every moved record (§5.6).
      await writeAudit(tx, {
        actorId: viewer.userId,
        action: 'offboard',
        entity: 'Member',
        entityId: memberId,
        before: { status: 'ACTIVE' },
        after: { status: 'LEFT', handedTo: outcome.lead.id, ...outcome.moved },
        reason: reason.data,
        ip,
      })
      return outcome
    })

    const lead = await prisma.member.findUniqueOrThrow({ where: { id: result.lead.id }, select: { userId: true } })
    if (result.openTasks.length) {
      await notify(lead.userId, 'TASKS_UNASSIGNED', {
        title: `${result.openTasks.length} task(s) need a new assignee`,
        body: result.openTasks.map((task) => `• ${task.title}`).join('\n'),
      })
    }
    redirect(`/portal/members/${memberId}`)
  })
}

export async function revokeSessionsAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    assertAdmin(viewer)
    const memberId = String(formData.get('memberId'))
    const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } })
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.session.deleteMany({ where: { userId: member.userId } })
      await writeAudit(tx, { actorId: viewer.userId, action: 'revoke_sessions', entity: 'User', entityId: member.userId, after: { sessionsRevoked: count }, ip })
    })
    return { ok: true, message: 'All sessions signed out.' }
  })
}

// Admin can hard-delete a REJECTED applicant's data on request (§11.4).
export async function hardDeleteApplicantAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    assertAdmin(viewer)
    if (!can(viewer, 'members', 'delete')) throw new ForbiddenError()
    const memberId = String(formData.get('memberId'))
    const reason = reasonSchema.safeParse(formData.get('reason'))
    if (!reason.success) return { ok: false, fieldErrors: { reason: ['A reason is required'] } }
    const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } })
    if (member.status !== 'REJECTED') throw new UserError('Only rejected applicants can be permanently deleted.')
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, { actorId: viewer.userId, action: 'hard_delete', entity: 'Member', entityId: memberId, before: { fullName: member.fullName }, reason: reason.data, ip })
      await tx.user.delete({ where: { id: member.userId } })
    })
    redirect('/portal/members?status=REJECTED')
  })
}

// ---------- Invite (§5.1) ----------

export async function inviteAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    if (!viewer.isAdmin && !can(viewer, 'members', 'create')) throw new ForbiddenError()
    const input = z
      .object({ email: z.string().trim().toLowerCase().email('Enter a valid email'), fullName: z.string().trim().min(2, 'Enter a name') })
      .parse({ email: formData.get('email'), fullName: formData.get('fullName') })
    if (await prisma.user.findUnique({ where: { email: input.email } })) {
      return { ok: false, fieldErrors: { email: ['Someone with this email already has an account.'] } }
    }
    const token = await issueToken({ purpose: 'INVITE', email: input.email, ttlMs: INVITE_TTL_MS, payload: { fullName: input.fullName } })
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, { actorId: viewer.userId, action: 'invite', entity: 'Invite', entityId: input.email, after: input, ip })
    })
    await sendEmail({
      to: input.email,
      subject: `${viewer.fullName} invited you to join Kaare Khair o Barr`,
      text: `Assalam o Alaikum ${input.fullName},\n\n${viewer.fullName} has invited you to join KKB as a member. Complete your application here (link valid for 7 days):\n${portalUrl(`/portal/signup?invite=${token}`)}`,
    })
    return { ok: true, message: `Invite sent to ${input.email}.` }
  })
}

// ---------- Onboarding checklist ticks (§5.4) ----------

export async function toggleChecklistItemAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const progressId = String(formData.get('progressId'))
    const done = formData.get('done') === 'true'
    const progress = await prisma.onboardingProgress.findUniqueOrThrow({ where: { id: progressId }, include: { item: true, member: true } })

    const isSelf = progress.memberId === viewer.memberId
    if (progress.item.completedBy === 'SYSTEM') throw new UserError('This item ticks itself automatically.')
    if (progress.item.completedBy === 'LEAD') {
      // The member's lead (or anyone with onboarding.edit over them except the member) ticks it.
      if (isSelf) throw new UserError('Your lead ticks this one.')
      await assertAuthorized(viewer, 'onboarding', 'edit', { memberIds: [progress.memberId] })
    } else {
      await assertAuthorized(viewer, 'onboarding', 'edit', { ownerIds: [progress.memberId], memberIds: [progress.memberId] })
    }

    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      await tx.onboardingProgress.update({
        where: { id: progressId },
        data: { doneAt: done ? new Date() : null, verifiedById: done && !isSelf ? viewer.memberId : null },
      })
      await writeAudit(tx, {
        actorId: viewer.userId,
        action: done ? 'checklist_tick' : 'checklist_untick',
        entity: 'OnboardingProgress',
        entityId: progressId,
        after: { memberId: progress.memberId, item: progress.item.title, done },
        ip,
      })
    })
    revalidatePath('/portal/onboarding')
    revalidatePath('/portal/dashboard')
    revalidatePath(`/portal/members/${progress.memberId}`)
    return { ok: true }
  })
}
