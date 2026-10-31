import 'server-only'
import { notFound, redirect } from 'next/navigation'
import { requestCache as cache } from '../request-cache'
import { prisma } from '../db'
import { getSessionUser } from '../auth'
import { getLedTeamMemberIds, getSubtreeIds } from '../hierarchy'
import {
  ADMIN_ROLE_NAMES,
  SYSTEM_ROLE,
  checkScope,
  mergePermissions,
  type ActionName,
  type ModuleName,
  type PermissionGrant,
  type PermissionKey,
  type ScopeContext,
  type ScopeName,
  type ScopeTarget,
} from './model'

export * from './model'

export type Viewer = {
  userId: string
  email: string
  memberId: string | null
  fullName: string
  status: string | null
  roleNames: string[]
  perms: Map<PermissionKey, ScopeName>
  isAdmin: boolean
  isSuperAdmin: boolean
}

export async function loadPermissions(userId: string) {
  const roles = await prisma.userRole.findMany({
    where: { userId },
    include: { role: { include: { permissions: true } } },
  })
  const grants: PermissionGrant[] = roles.flatMap((userRole) =>
    userRole.role.permissions.map((permission) => ({
      module: permission.module as ModuleName,
      action: permission.action as ActionName,
      scope: permission.scope as ScopeName,
    }))
  )
  return { roleNames: roles.map((userRole) => userRole.role.name), perms: mergePermissions(grants) }
}

/** A signed-in, ACTIVE member (what requireActiveViewer returns). */
export type ActiveViewer = Viewer & { memberId: string }

export const getViewer = cache(async (): Promise<Viewer | null> => {
  const user = await getSessionUser()
  if (!user) return null
  const { roleNames, perms } = await loadPermissions(user.id)
  // Roles only take effect for ACTIVE members; applicants and paused members get nothing.
  const active = user.member?.status === 'ACTIVE'
  return {
    userId: user.id,
    email: user.email,
    memberId: user.member?.id ?? null,
    fullName: user.member?.fullName ?? user.email,
    status: user.member?.status ?? null,
    roleNames: active ? roleNames : [],
    perms: active ? perms : new Map(),
    isAdmin: active && roleNames.some((name) => ADMIN_ROLE_NAMES.includes(name)),
    isSuperAdmin: active && roleNames.includes(SYSTEM_ROLE.SUPER_ADMIN),
  }
})

/** The latest active NDA the member has not yet signed, if any. */
export const getOutstandingNda = cache(async (memberId: string) => {
  const active = await prisma.ndaVersion.findFirst({ where: { isActive: true }, orderBy: { version: 'desc' } })
  if (!active) return null
  const signed = await prisma.ndaSignature.findUnique({
    where: { memberId_ndaVersionId: { memberId, ndaVersionId: active.id } },
    select: { id: true },
  })
  return signed ? null : active
})

/** Signed in, any status. Used by the onboarding gate pages. */
export async function requireViewer() {
  const viewer = await getViewer()
  if (!viewer) redirect('/portal/login')
  return viewer
}

/**
 * Signed in, ACTIVE and up to date on the NDA. Everything else is sent to the
 * NDA or "awaiting approval" page (§13.1 Onboarding).
 */
export async function requireActiveViewer() {
  const viewer = await requireViewer()
  if (!viewer.memberId) redirect('/portal/onboarding/pending')
  if (viewer.status === 'PENDING_NDA') redirect('/portal/onboarding/nda')
  if (viewer.status !== 'ACTIVE') redirect('/portal/onboarding/pending')
  if (await getOutstandingNda(viewer.memberId)) redirect('/portal/onboarding/nda')
  return viewer as ActiveViewer
}

export function scopeFor(viewer: Viewer, module: ModuleName, action: ActionName): ScopeName | null {
  return viewer.perms.get(`${module}.${action}`) ?? null
}

export function can(viewer: Viewer, module: ModuleName, action: ActionName) {
  return scopeFor(viewer, module, action) !== null
}

async function scopeContext(viewer: Viewer, scope: ScopeName): Promise<ScopeContext> {
  const memberId = viewer.memberId
  const needsSubtree = scope === 'subtree'
  const needsTeam = scope === 'team' || scope === 'subtree'
  return {
    memberId,
    subtreeIds: memberId && needsSubtree ? await getSubtreeIds(memberId) : new Set(memberId ? [memberId] : []),
    teamMemberIds: memberId && needsTeam ? await getLedTeamMemberIds(memberId) : new Set(),
  }
}

/**
 * authorize(user, module, action, record) — §3.2. Resolves the user's best scope for the
 * module/action, then checks the record against it. Default deny.
 */
export async function authorize(viewer: Viewer, module: ModuleName, action: ActionName, target: ScopeTarget) {
  const scope = scopeFor(viewer, module, action)
  if (!scope) return false
  if (scope === 'all') return true
  return checkScope(scope, await scopeContext(viewer, scope), target)
}

/** Out-of-scope records 404 so their existence isn't leaked (§13.1). */
export async function authorizeOr404(viewer: Viewer, module: ModuleName, action: ActionName, target: ScopeTarget) {
  if (!(await authorize(viewer, module, action, target))) notFound()
}

export class ForbiddenError extends Error {
  constructor(message = 'You do not have permission to do that.') {
    super(message)
  }
}

export async function assertAuthorized(viewer: Viewer, module: ModuleName, action: ActionName, target: ScopeTarget) {
  if (!(await authorize(viewer, module, action, target))) throw new ForbiddenError()
}

/** Hard rule §3.4: role assignment and approvals are Admin/SuperAdmin only, on top of permissions. */
export function assertAdmin(viewer: Viewer) {
  if (!viewer.isAdmin) throw new ForbiddenError('Only an Admin can do that.')
}

/**
 * The set of member ids a list query may include for module/action, for use in a SQL
 * WHERE ... IN (...). 'all' means no member filter. Team scope adds members of teams the
 * viewer leads; subtree comes from the recursive CTE.
 */
export async function visibleMemberIds(viewer: Viewer, module: ModuleName, action: ActionName): Promise<'all' | string[]> {
  const scope = scopeFor(viewer, module, action)
  if (!scope || !viewer.memberId) return []
  if (scope === 'all') return 'all'
  const ids = new Set<string>([viewer.memberId])
  if (scope === 'subtree') {
    for (const id of await getSubtreeIds(viewer.memberId)) ids.add(id)
  }
  if (scope === 'team' || scope === 'subtree') {
    for (const id of await getLedTeamMemberIds(viewer.memberId)) ids.add(id)
  }
  return [...ids]
}

export function memberIdFilter(ids: 'all' | string[]) {
  return ids === 'all' ? {} : { in: ids }
}

/** CNIC, address and emergency contact: only the member, Admin and SuperAdmin (§3.4). */
export function canSeeSensitive(viewer: Viewer, memberId: string) {
  return viewer.isAdmin || viewer.memberId === memberId
}
