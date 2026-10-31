// Pure permission model (§3). No DB access here so it can be unit-tested directly.

export const MODULES = [
  'members',
  'onboarding',
  'roles',
  'teams',
  'tasks',
  'cases',
  'beneficiaries',
  'donors',
  'donations',
  'targets',
  'events',
  'expenses',
  'reports',
  'audit',
  'settings',
] as const

export const ACTIONS = ['view', 'create', 'edit', 'delete', 'verify', 'approve', 'assign', 'export'] as const

// Narrow → wide.
export const SCOPES = ['own', 'assigned', 'team', 'subtree', 'all'] as const

export type ModuleName = (typeof MODULES)[number]
export type ActionName = (typeof ACTIONS)[number]
export type ScopeName = (typeof SCOPES)[number]
export type PermissionKey = `${ModuleName}.${ActionName}`

export type PermissionGrant = { module: ModuleName; action: ActionName; scope: ScopeName }

export function scopeRank(scope: ScopeName | null | undefined) {
  return scope ? SCOPES.indexOf(scope) : -1
}

export function widerScope(a: ScopeName | null, b: ScopeName | null) {
  return scopeRank(a) >= scopeRank(b) ? a : b
}

// Union of all role permissions; the widest scope wins (§3.2).
export function mergePermissions(grants: PermissionGrant[]) {
  const merged = new Map<PermissionKey, ScopeName>()
  for (const grant of grants) {
    const key = `${grant.module}.${grant.action}` as PermissionKey
    merged.set(key, widerScope(merged.get(key) ?? null, grant.scope) as ScopeName)
  }
  return merged
}

/**
 * Everything authorize() needs to know about the viewer, pre-resolved.
 * subtreeIds always contains the viewer's own member id.
 */
export type ScopeContext = {
  memberId: string | null
  subtreeIds: ReadonlySet<string>
  teamMemberIds: ReadonlySet<string> // members of teams the viewer leads
}

/**
 * How a record relates to people. A record matches a scope when any of these lists hits.
 * - ownerIds: members who created it or are its subject (own)
 * - assignedIds: members assigned to it (assigned)
 * - memberIds: members whose data this is, checked for team/subtree (defaults to ownerIds)
 */
export type ScopeTarget = {
  ownerIds?: (string | null | undefined)[]
  assignedIds?: (string | null | undefined)[]
  memberIds?: (string | null | undefined)[]
}

function hits(ids: (string | null | undefined)[] | undefined, test: (id: string) => boolean) {
  return (ids ?? []).some((id) => !!id && test(id))
}

export function recordMatchesScope(scope: ScopeName, ctx: ScopeContext, target: ScopeTarget) {
  const people = target.memberIds ?? target.ownerIds
  switch (scope) {
    case 'all':
      return true
    case 'subtree':
      return hits(people, (id) => ctx.subtreeIds.has(id))
    case 'team':
      return hits(people, (id) => ctx.teamMemberIds.has(id))
    case 'assigned':
      return !!ctx.memberId && hits(target.assignedIds, (id) => id === ctx.memberId)
    case 'own':
      return !!ctx.memberId && hits(target.ownerIds, (id) => id === ctx.memberId)
  }
}

/**
 * Holding a scope also grants every narrower scope (a subtree lead can still see records
 * they are merely assigned to). The record passes if it matches any scope up to the best one.
 */
export function checkScope(best: ScopeName | null | undefined, ctx: ScopeContext, target: ScopeTarget) {
  if (!best) return false
  const limit = scopeRank(best)
  return SCOPES.slice(0, limit + 1).some((scope) => recordMatchesScope(scope, ctx, target))
}

/**
 * Hard rule §3.4: nobody can grant a permission or scope they don't hold themselves.
 * Returns the grants the granter is not allowed to hand out.
 */
export function ungrantable(granter: Map<PermissionKey, ScopeName>, requested: PermissionGrant[]) {
  return requested.filter((grant) => {
    const held = granter.get(`${grant.module}.${grant.action}`)
    return scopeRank(held) < scopeRank(grant.scope)
  })
}

// ---------- Seeded roles (§3.3) ----------

export const SYSTEM_ROLE = {
  SUPER_ADMIN: 'SuperAdmin',
  ADMIN: 'Admin',
  FINANCE: 'Finance',
  LEAD: 'Lead',
  EVENT_LEAD: 'Event Lead',
  ONBOARDING_COORDINATOR: 'Onboarding Coordinator',
  AUDITOR: 'Auditor',
  MEMBER: 'Member',
} as const

export const ADMIN_ROLE_NAMES: string[] = [SYSTEM_ROLE.SUPER_ADMIN, SYSTEM_ROLE.ADMIN]

function grid(modules: readonly ModuleName[], actions: readonly ActionName[], scope: ScopeName): PermissionGrant[] {
  return modules.flatMap((module) => actions.map((action) => ({ module, action, scope })))
}

const CRUD: ActionName[] = ['view', 'create', 'edit', 'delete']

export const SEEDED_ROLES: { name: string; description: string; grants: PermissionGrant[] }[] = [
  {
    name: SYSTEM_ROLE.SUPER_ADMIN,
    description: 'Everything, all scope. Cannot be edited or deleted.',
    grants: grid(MODULES, ACTIONS, 'all'),
  },
  {
    name: SYSTEM_ROLE.ADMIN,
    description: 'Everything, all scope, including member approval and donation verification.',
    grants: grid(MODULES, ACTIONS, 'all'),
  },
  {
    name: SYSTEM_ROLE.FINANCE,
    description: 'Verifies donations and approves expenses. No tasks or member personal data.',
    grants: [
      ...grid(['donations', 'expenses', 'cases'], ['view', 'verify', 'export'], 'all'),
      { module: 'expenses', action: 'approve', scope: 'all' },
      ...grid(['reports'], ['view', 'export'], 'all'),
    ],
  },
  {
    name: SYSTEM_ROLE.LEAD,
    description: 'Manages their subtree: members, donors, donations, targets, team tasks.',
    grants: [
      { module: 'members', action: 'view', scope: 'subtree' },
      ...grid(['donors', 'donations', 'targets'], CRUD, 'subtree'),
      { module: 'cases', action: 'create', scope: 'subtree' },
      { module: 'cases', action: 'view', scope: 'subtree' },
      { module: 'cases', action: 'assign', scope: 'subtree' },
      ...grid(['tasks'], CRUD, 'team'),
      { module: 'events', action: 'create', scope: 'own' },
      ...grid(['reports'], ['view', 'export'], 'subtree'),
      ...grid(['onboarding'], ['view', 'edit'], 'subtree'),
      { module: 'teams', action: 'view', scope: 'team' },
      { module: 'teams', action: 'assign', scope: 'subtree' },
    ],
  },
  {
    name: SYSTEM_ROLE.EVENT_LEAD,
    description: 'Runs assigned events: edits them, logs expenses, sees collections.',
    grants: [
      { module: 'events', action: 'view', scope: 'assigned' },
      { module: 'events', action: 'edit', scope: 'assigned' },
      { module: 'expenses', action: 'view', scope: 'assigned' },
      { module: 'expenses', action: 'create', scope: 'assigned' },
      { module: 'expenses', action: 'edit', scope: 'assigned' },
      { module: 'donations', action: 'view', scope: 'assigned' },
    ],
  },
  {
    name: SYSTEM_ROLE.ONBOARDING_COORDINATOR,
    description: 'Runs onboarding for everyone. Cannot approve members.',
    grants: [...grid(['onboarding'], ['view', 'edit'], 'all'), { module: 'members', action: 'view', scope: 'all' }],
  },
  {
    name: SYSTEM_ROLE.AUDITOR,
    description: 'Read and export everything, including the audit log. No writes.',
    grants: grid(MODULES, ['view', 'export'], 'all'),
  },
  {
    name: SYSTEM_ROLE.MEMBER,
    description: 'Default role: own donors, donations, profile and dashboard.',
    grants: [
      ...grid(['donors', 'donations'], ['view', 'create', 'edit'], 'own'),
      { module: 'cases', action: 'view', scope: 'assigned' },
      { module: 'tasks', action: 'view', scope: 'own' },
      { module: 'tasks', action: 'edit', scope: 'own' },
      { module: 'tasks', action: 'create', scope: 'own' },
      { module: 'events', action: 'view', scope: 'assigned' },
      { module: 'members', action: 'view', scope: 'own' },
      { module: 'members', action: 'edit', scope: 'own' },
      ...grid(['onboarding'], ['view', 'edit'], 'own'),
      { module: 'teams', action: 'view', scope: 'own' },
    ],
  },
]
