import 'server-only'
import type { Tx } from './db'
import { prisma } from './db'
import { monthKey } from './time'
import { UserError } from './action-utils'
import {
  ForbiddenError,
  SYSTEM_ROLE,
  assertAdmin,
  ungrantable,
  type ActionName,
  type ModuleName,
  type ScopeName,
  type Viewer,
} from './rbac'

export async function getGeneralTeamId(client: Tx | typeof prisma = prisma) {
  const team = await client.team.findFirst({ where: { isGeneral: true }, select: { id: true } })
  if (!team) throw new UserError('The General team is missing. Run the seed script.')
  return team.id
}

export async function ensureChecklist(tx: Tx, memberId: string) {
  const items = await tx.onboardingItem.findMany({ where: { isActive: true }, select: { id: true } })
  await tx.onboardingProgress.createMany({
    data: items.map((item) => ({ memberId, itemId: item.id })),
    skipDuplicates: true,
  })
}

// Ticks a system-managed checklist item (e.g. FIRST_OUTREACH from the outreach module).
export async function tickAutoItem(tx: Tx, memberId: string, autoKey: string) {
  const item = await tx.onboardingItem.findUnique({ where: { autoKey } })
  if (!item) return
  await tx.onboardingProgress.updateMany({ where: { memberId, itemId: item.id, doneAt: null }, data: { doneAt: new Date() } })
}

async function activeSuperAdminCount(tx: Tx, excludingUserId?: string) {
  return tx.userRole.count({
    where: {
      role: { name: SYSTEM_ROLE.SUPER_ADMIN },
      user: { disabledAt: null, member: { status: 'ACTIVE' } },
      ...(excludingUserId ? { userId: { not: excludingUserId } } : {}),
    },
  })
}

/**
 * Replaces a user's roles, enforcing §3.4: Admin-only, nobody grants beyond what they hold,
 * only a SuperAdmin hands out or removes SuperAdmin, and one SuperAdmin must always remain.
 */
export async function setUserRoles(tx: Tx, viewer: Viewer, userId: string, roleIds: string[]) {
  assertAdmin(viewer)
  const current = await tx.userRole.findMany({ where: { userId }, include: { role: true } })
  const requested = await tx.role.findMany({ where: { id: { in: roleIds } }, include: { permissions: true } })
  if (requested.length !== new Set(roleIds).size) throw new UserError('One of the selected roles no longer exists.')

  const currentIds = new Set(current.map((userRole) => userRole.roleId))
  const added = requested.filter((role) => !currentIds.has(role.id))
  const removed = current.filter((userRole) => !roleIds.includes(userRole.roleId))

  for (const role of added) {
    const blocked = ungrantable(
      viewer.perms,
      role.permissions.map((permission) => ({
        module: permission.module as ModuleName,
        action: permission.action as ActionName,
        scope: permission.scope as ScopeName,
      }))
    )
    if (blocked.length) {
      throw new ForbiddenError(`You can't grant "${role.name}": it includes permissions you don't hold.`)
    }
  }

  const touchesSuperAdmin = [...added.map((role) => role.name), ...removed.map((userRole) => userRole.role.name)].includes(SYSTEM_ROLE.SUPER_ADMIN)
  if (touchesSuperAdmin && !viewer.isSuperAdmin) throw new ForbiddenError('Only a SuperAdmin can grant or remove SuperAdmin.')
  if (removed.some((userRole) => userRole.role.name === SYSTEM_ROLE.SUPER_ADMIN) && (await activeSuperAdminCount(tx, userId)) === 0) {
    throw new UserError('At least one SuperAdmin must always exist.')
  }

  if (removed.length) await tx.userRole.deleteMany({ where: { userId, roleId: { in: removed.map((userRole) => userRole.roleId) } } })
  if (added.length) {
    await tx.userRole.createMany({ data: added.map((role) => ({ userId, roleId: role.id, grantedById: viewer.userId })) })
  }
  return {
    before: current.map((userRole) => userRole.role.name).sort(),
    after: requested.map((role) => role.name).sort(),
    changed: added.length > 0 || removed.length > 0,
  }
}

/** Replaces non-General team memberships. General can never be removed (§6.1). */
export async function setMemberTeams(tx: Tx, memberId: string, teamIds: string[]) {
  const generalId = await getGeneralTeamId(tx)
  const wanted = new Set([...teamIds, generalId])
  const current = await tx.teamMembership.findMany({ where: { memberId }, include: { team: true } })
  const toRemove = current.filter((membership) => !wanted.has(membership.teamId))
  const toAdd = [...wanted].filter((teamId) => !current.some((membership) => membership.teamId === teamId))
  if (toRemove.length) await tx.teamMembership.deleteMany({ where: { id: { in: toRemove.map((membership) => membership.id) } } })
  if (toAdd.length) await tx.teamMembership.createMany({ data: toAdd.map((teamId) => ({ teamId, memberId })), skipDuplicates: true })
  const after = await tx.team.findMany({ where: { id: { in: [...wanted] } }, select: { name: true } })
  return { before: current.map((membership) => membership.team.name).sort(), after: after.map((team) => team.name).sort() }
}

// ---------- Offboarding (§5.6) ----------

const OPEN_TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED'] as const

export async function offboardingPreview(memberId: string, client: Tx | typeof prisma = prisma) {
  const member = await client.member.findUniqueOrThrow({
    where: { id: memberId },
    include: { reportsTo: { select: { id: true, fullName: true } }, user: { select: { id: true } } },
  })
  const currentMonth = monthKey()
  const [donorLinks, openTasks, caseAssignments, responsibilities, ledEvents, directReports, futureTargets] = await Promise.all([
    client.donorLink.findMany({ where: { memberId, historical: false }, select: { id: true, donorId: true } }),
    client.task.findMany({ where: { assigneeId: memberId, status: { in: [...OPEN_TASK_STATUSES] }, deletedAt: null }, select: { id: true, title: true } }),
    client.caseAssignment.findMany({ where: { memberId }, select: { id: true, caseId: true } }),
    client.eventResponsibility.findMany({ where: { memberId, status: { in: [...OPEN_TASK_STATUSES] } }, select: { id: true, title: true } }),
    client.event.findMany({ where: { leadId: memberId, status: { in: ['PLANNING', 'LIVE'] }, deletedAt: null }, select: { id: true, name: true } }),
    client.member.findMany({ where: { reportsToId: memberId }, select: { id: true, fullName: true } }),
    client.target.findMany({ where: { memberId, month: { gt: currentMonth } }, select: { id: true, month: true } }),
  ])
  return { member, lead: member.reportsTo, donorLinks, openTasks, caseAssignments, responsibilities, ledEvents, directReports, futureTargets }
}

export async function offboardMember(tx: Tx, memberId: string) {
  const preview = await offboardingPreview(memberId, tx)
  const { member, lead } = preview
  if (!lead) throw new UserError('This member has no lead to hand their work to. Assign a lead first.')
  if (!['ACTIVE', 'INACTIVE'].includes(member.status)) throw new UserError('Only active or paused members can be offboarded.')
  const isSuperAdmin = await tx.userRole.count({ where: { userId: member.userId, role: { name: SYSTEM_ROLE.SUPER_ADMIN } } })
  if (isSuperAdmin && (await activeSuperAdminCount(tx, member.userId)) === 0) {
    throw new UserError('This is the last SuperAdmin. Grant SuperAdmin to someone else first.')
  }

  // Donor links → lead; the leaver's link stays as historical.
  for (const link of preview.donorLinks) {
    await tx.donorLink.upsert({
      where: { donorId_memberId: { donorId: link.donorId, memberId: lead.id } },
      create: { donorId: link.donorId, memberId: lead.id },
      update: { historical: false },
    })
  }
  await tx.donorLink.updateMany({ where: { memberId, historical: false }, data: { historical: true } })

  await tx.task.updateMany({ where: { id: { in: preview.openTasks.map((task) => task.id) } }, data: { assigneeId: null } })

  for (const assignment of preview.caseAssignments) {
    await tx.caseAssignment.upsert({
      where: { caseId_memberId: { caseId: assignment.caseId, memberId: lead.id } },
      create: { caseId: assignment.caseId, memberId: lead.id },
      update: {},
    })
  }
  await tx.caseAssignment.deleteMany({ where: { memberId } })

  await tx.eventResponsibility.updateMany({ where: { id: { in: preview.responsibilities.map((item) => item.id) } }, data: { memberId: lead.id } })
  await tx.event.updateMany({ where: { id: { in: preview.ledEvents.map((event) => event.id) } }, data: { leadId: lead.id } })
  await tx.member.updateMany({ where: { reportsToId: memberId }, data: { reportsToId: lead.id } })
  await tx.target.deleteMany({ where: { id: { in: preview.futureTargets.map((target) => target.id) } } })

  await tx.member.update({ where: { id: memberId }, data: { status: 'LEFT', leftAt: new Date() } })
  await tx.user.update({ where: { id: member.userId }, data: { disabledAt: new Date() } })
  await tx.session.deleteMany({ where: { userId: member.userId } })

  return {
    lead,
    moved: {
      donorIds: preview.donorLinks.map((link) => link.donorId),
      unassignedTaskIds: preview.openTasks.map((task) => task.id),
      caseIds: preview.caseAssignments.map((assignment) => assignment.caseId),
      responsibilityIds: preview.responsibilities.map((item) => item.id),
      eventIds: preview.ledEvents.map((event) => event.id),
      reparentedMemberIds: preview.directReports.map((report) => report.id),
      deletedTargetMonths: preview.futureTargets.map((target) => target.month),
    },
    openTasks: preview.openTasks,
  }
}
