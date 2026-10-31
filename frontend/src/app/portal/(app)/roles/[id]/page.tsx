import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/portal/db'
import { SYSTEM_ROLE, can, requireActiveViewer } from '@/lib/portal/rbac'
import { ActionForm, SubmitButton } from '@/components/portal/ActionForm'
import { Card, PageHeader } from '@/components/portal/ui'
import RoleEditor from '../RoleEditor'
import { deleteRoleAction } from '../actions'

export const metadata: Metadata = { title: 'Role | KKB Portal' }

export default async function RolePage({ params }: { params: { id: string } }) {
  const viewer = await requireActiveViewer()
  if (!can(viewer, 'roles', 'view')) notFound()
  const role = await prisma.role.findUnique({
    where: { id: params.id },
    include: { permissions: true, users: { include: { user: { select: { member: { select: { id: true, fullName: true } } } } } } },
  })
  if (!role) notFound()

  const locked = role.name === SYSTEM_ROLE.SUPER_ADMIN
  const readOnly = locked || !can(viewer, 'roles', 'edit')

  return (
    <>
      <PageHeader title={role.name} description={locked ? 'SuperAdmin has every permission and cannot be edited or deleted.' : role.description ?? undefined} />
      <div className="grid gap-5 xl:grid-cols-[3fr_1fr]">
        <Card>
          <RoleEditor viewer={viewer} role={role} readOnly={readOnly} />
        </Card>
        <div className="space-y-5">
          <Card title={`Holders (${role.users.length})`}>
            <ul className="space-y-1 text-sm">
              {role.users.map((userRole) =>
                userRole.user.member ? (
                  <li key={userRole.id}>
                    <Link href={`/portal/members/${userRole.user.member.id}`} className="text-ink-800 hover:text-forest-700">
                      {userRole.user.member.fullName}
                    </Link>
                  </li>
                ) : null
              )}
            </ul>
            <p className="mt-3 text-xs text-ink-500">Assign roles from a member&apos;s profile (Admin only).</p>
          </Card>
          {!locked && can(viewer, 'roles', 'delete') ? (
            <Card title="Delete">
              <ActionForm action={deleteRoleAction} confirm={`Delete the ${role.name} role?`}>
                <input type="hidden" name="roleId" value={role.id} />
                <SubmitButton variant="danger">Delete role</SubmitButton>
              </ActionForm>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  )
}
