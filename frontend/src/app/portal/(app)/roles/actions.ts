'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { prisma } from '@/lib/portal/db'
import { getRequestMeta } from '@/lib/portal/auth'
import { writeAudit } from '@/lib/portal/audit'
import {
  ACTIONS,
  ForbiddenError,
  MODULES,
  SCOPES,
  SYSTEM_ROLE,
  can,
  requireActiveViewer,
  ungrantable,
  type PermissionGrant,
  type ScopeName,
} from '@/lib/portal/rbac'
import { runAction, UserError } from '@/lib/portal/action-utils'
import type { ActionState } from '@/lib/portal/validation'

function parseGrid(formData: FormData): PermissionGrant[] {
  const grants: PermissionGrant[] = []
  for (const module of MODULES) {
    for (const action of ACTIONS) {
      const value = formData.get(`perm:${module}.${action}`)
      if (value && SCOPES.includes(value as ScopeName)) grants.push({ module, action, scope: value as ScopeName })
    }
  }
  return grants
}

const describe = (grants: { module: string; action: string; scope: string }[]) => grants.map((grant) => `${grant.module}.${grant.action}:${grant.scope}`).sort()

export async function saveRoleAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    const roleId = String(formData.get('roleId') ?? '')
    if (!can(viewer, 'roles', roleId ? 'edit' : 'create')) throw new ForbiddenError()

    const input = z
      .object({
        name: z.string().trim().min(2, 'Name is required').max(60),
        description: z.string().trim().max(300).optional().transform((value) => value || null),
      })
      .parse({ name: formData.get('name'), description: formData.get('description') ?? undefined })
    const grants = parseGrid(formData)

    const existing = roleId ? await prisma.role.findUniqueOrThrow({ where: { id: roleId }, include: { permissions: true } }) : null
    if (existing?.name === SYSTEM_ROLE.SUPER_ADMIN) throw new UserError('SuperAdmin cannot be edited.')
    if (input.name === SYSTEM_ROLE.SUPER_ADMIN) throw new UserError('That name is reserved.')
    const clash = await prisma.role.findFirst({ where: { name: { equals: input.name, mode: 'insensitive' }, NOT: roleId ? { id: roleId } : undefined } })
    if (clash) return { ok: false, fieldErrors: { name: ['A role with this name already exists'] } }

    // Hard rule: nobody can grant a permission or scope they don't hold themselves.
    const blocked = ungrantable(viewer.perms, grants)
    if (blocked.length) {
      throw new ForbiddenError(`You can't grant permissions you don't hold: ${describe(blocked).slice(0, 5).join(', ')}${blocked.length > 5 ? '…' : ''}`)
    }

    const { ip } = getRequestMeta()
    const saved = await prisma.$transaction(async (tx) => {
      const role = existing
        ? await tx.role.update({ where: { id: existing.id }, data: input })
        : await tx.role.create({ data: { ...input, isSystem: false } })
      await tx.permission.deleteMany({ where: { roleId: role.id } })
      await tx.permission.createMany({ data: grants.map((grant) => ({ ...grant, roleId: role.id })) })
      await writeAudit(tx, {
        actorId: viewer.userId,
        action: existing ? 'update' : 'create',
        entity: 'Role',
        entityId: role.id,
        before: existing ? { name: existing.name, description: existing.description, permissions: describe(existing.permissions) } : null,
        after: { name: role.name, description: role.description, permissions: describe(grants) },
        ip,
      })
      return role
    })

    revalidatePath('/portal/roles')
    if (!existing) redirect(`/portal/roles/${saved.id}`)
    return { ok: true, message: 'Role saved. Changes apply on each holder\'s next page load.' }
  })
}

export async function deleteRoleAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await requireActiveViewer()
    if (!can(viewer, 'roles', 'delete')) throw new ForbiddenError()
    const roleId = String(formData.get('roleId'))
    const role = await prisma.role.findUniqueOrThrow({ where: { id: roleId }, include: { permissions: true, _count: { select: { users: true } } } })
    if (role.name === SYSTEM_ROLE.SUPER_ADMIN) throw new UserError('SuperAdmin cannot be deleted.')
    if (role._count.users > 0) throw new UserError(`${role._count.users} user(s) still hold this role. Remove it from them first.`)
    const { ip } = getRequestMeta()
    await prisma.$transaction(async (tx) => {
      await tx.role.delete({ where: { id: roleId } })
      await writeAudit(tx, { actorId: viewer.userId, action: 'delete', entity: 'Role', entityId: roleId, before: { name: role.name, permissions: describe(role.permissions) }, ip })
    })
    redirect('/portal/roles')
  })
}
