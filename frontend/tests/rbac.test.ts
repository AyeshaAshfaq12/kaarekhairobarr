import { describe, expect, it } from 'vitest'
import {
  MODULES,
  ACTIONS,
  SEEDED_ROLES,
  SYSTEM_ROLE,
  checkScope,
  mergePermissions,
  recordMatchesScope,
  ungrantable,
  type ScopeContext,
} from '@/lib/portal/rbac/model'

// Tree used throughout:
//   admin
//   ├── lead1
//   │   ├── sub1
//   │   │   └── m4
//   │   └── m1
//   └── lead2
//       └── m7
// lead1 leads the Design team, which also contains m7 (outside lead1's subtree).
const lead1: ScopeContext = {
  memberId: 'lead1',
  subtreeIds: new Set(['lead1', 'sub1', 'm4', 'm1']),
  teamMemberIds: new Set(['lead1', 'm1', 'm7']),
}
const sub1: ScopeContext = { memberId: 'sub1', subtreeIds: new Set(['sub1', 'm4']), teamMemberIds: new Set() }

describe('recordMatchesScope', () => {
  it('all matches anything', () => {
    expect(recordMatchesScope('all', sub1, { memberIds: ['admin'] })).toBe(true)
  })

  it('subtree matches self and anyone below at any depth', () => {
    expect(recordMatchesScope('subtree', lead1, { memberIds: ['lead1'] })).toBe(true)
    expect(recordMatchesScope('subtree', lead1, { memberIds: ['m4'] })).toBe(true)
  })

  it('subtree never matches upward or sideways', () => {
    expect(recordMatchesScope('subtree', lead1, { memberIds: ['admin'] })).toBe(false)
    expect(recordMatchesScope('subtree', lead1, { memberIds: ['lead2'] })).toBe(false)
    expect(recordMatchesScope('subtree', lead1, { memberIds: ['m7'] })).toBe(false)
  })

  it("a sub-lead sees only their branch, not their lead's other branches", () => {
    expect(recordMatchesScope('subtree', sub1, { memberIds: ['m4'] })).toBe(true)
    expect(recordMatchesScope('subtree', sub1, { memberIds: ['m1'] })).toBe(false)
    expect(recordMatchesScope('subtree', sub1, { memberIds: ['lead1'] })).toBe(false)
  })

  it('team matches members of teams the viewer leads, even outside the subtree', () => {
    expect(recordMatchesScope('team', lead1, { memberIds: ['m7'] })).toBe(true)
    expect(recordMatchesScope('team', lead1, { memberIds: ['m4'] })).toBe(false)
  })

  it('assigned matches only when the viewer is in assignedIds', () => {
    expect(recordMatchesScope('assigned', sub1, { assignedIds: ['x', 'sub1'] })).toBe(true)
    expect(recordMatchesScope('assigned', sub1, { assignedIds: ['m4'] })).toBe(false)
    expect(recordMatchesScope('assigned', sub1, { ownerIds: ['sub1'] })).toBe(false)
  })

  it('own matches creator/subject only', () => {
    expect(recordMatchesScope('own', sub1, { ownerIds: ['sub1'] })).toBe(true)
    expect(recordMatchesScope('own', sub1, { ownerIds: ['m4'] })).toBe(false)
  })

  it('ignores null and undefined ids', () => {
    expect(recordMatchesScope('own', { ...sub1, memberId: null }, { ownerIds: [null, undefined] })).toBe(false)
  })
})

describe('checkScope', () => {
  it('denies by default when no scope is held', () => {
    expect(checkScope(null, lead1, { memberIds: ['lead1'], ownerIds: ['lead1'] })).toBe(false)
  })

  it('a wider scope also grants narrower ones (subtree lead can see assigned records elsewhere)', () => {
    const assignedElsewhere = { memberIds: ['lead2'], ownerIds: ['lead2'], assignedIds: ['lead1'] }
    expect(checkScope('subtree', lead1, assignedElsewhere)).toBe(true)
    expect(checkScope('own', lead1, assignedElsewhere)).toBe(false)
  })

  it('own scope cannot reach a subtree record', () => {
    expect(checkScope('own', lead1, { ownerIds: ['m1'], memberIds: ['m1'] })).toBe(false)
  })
})

describe('mergePermissions', () => {
  it('unions roles and keeps the widest scope', () => {
    const merged = mergePermissions([
      { module: 'donations', action: 'view', scope: 'own' },
      { module: 'donations', action: 'view', scope: 'all' },
      { module: 'donations', action: 'view', scope: 'subtree' },
      { module: 'tasks', action: 'edit', scope: 'team' },
    ])
    expect(merged.get('donations.view')).toBe('all')
    expect(merged.get('tasks.edit')).toBe('team')
    expect(merged.get('tasks.view')).toBeUndefined()
  })

  it('granting a custom role with donations.view all widens; removing it narrows', () => {
    const member = SEEDED_ROLES.find((role) => role.name === SYSTEM_ROLE.MEMBER)!.grants
    const custom = [{ module: 'donations' as const, action: 'view' as const, scope: 'all' as const }]
    expect(mergePermissions([...member, ...custom]).get('donations.view')).toBe('all')
    expect(mergePermissions(member).get('donations.view')).toBe('own')
  })
})

describe('ungrantable (hard rule: no granting beyond what you hold)', () => {
  const lead = mergePermissions(SEEDED_ROLES.find((role) => role.name === SYSTEM_ROLE.LEAD)!.grants)

  it('allows equal or narrower scopes', () => {
    expect(ungrantable(lead, [{ module: 'donors', action: 'view', scope: 'subtree' }])).toEqual([])
    expect(ungrantable(lead, [{ module: 'donors', action: 'view', scope: 'own' }])).toEqual([])
  })

  it('blocks wider scopes and permissions not held at all', () => {
    expect(ungrantable(lead, [{ module: 'donors', action: 'view', scope: 'all' }])).toHaveLength(1)
    expect(ungrantable(lead, [{ module: 'donations', action: 'verify', scope: 'own' }])).toHaveLength(1)
  })
})

describe('seeded roles', () => {
  const byName = new Map(SEEDED_ROLES.map((role) => [role.name, mergePermissions(role.grants)]))

  it('SuperAdmin and Admin hold every module × action at all', () => {
    for (const name of [SYSTEM_ROLE.SUPER_ADMIN, SYSTEM_ROLE.ADMIN]) {
      const perms = byName.get(name)!
      for (const module of MODULES) for (const action of ACTIONS) expect(perms.get(`${module}.${action}`)).toBe('all')
    }
  })

  it('Auditor can view and export but never write', () => {
    const perms = byName.get(SYSTEM_ROLE.AUDITOR)!
    expect(perms.get('audit.view')).toBe('all')
    for (const [key] of perms) expect(key.endsWith('.view') || key.endsWith('.export')).toBe(true)
  })

  it('Finance verifies donations and approves expenses but has no tasks or member data', () => {
    const perms = byName.get(SYSTEM_ROLE.FINANCE)!
    expect(perms.get('donations.verify')).toBe('all')
    expect(perms.get('expenses.approve')).toBe('all')
    expect(perms.get('tasks.view')).toBeUndefined()
    expect(perms.get('members.view')).toBeUndefined()
  })

  it('Onboarding Coordinator cannot approve members', () => {
    expect(byName.get(SYSTEM_ROLE.ONBOARDING_COORDINATOR)!.get('members.approve')).toBeUndefined()
  })

  it('Member only reaches its own donors and donations', () => {
    const perms = byName.get(SYSTEM_ROLE.MEMBER)!
    expect(perms.get('donors.view')).toBe('own')
    expect(perms.get('donations.view')).toBe('own')
    expect(perms.get('donations.verify')).toBeUndefined()
  })
})
