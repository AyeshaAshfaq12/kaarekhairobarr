import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/portal/db'
import { can, requireActiveViewer } from '@/lib/portal/rbac'
import { Badge, Card, PageHeader } from '@/components/portal/ui'

export const metadata: Metadata = { title: 'Roles | KKB Portal' }

export default async function RolesPage() {
  const viewer = await requireActiveViewer()
  if (!can(viewer, 'roles', 'view')) notFound()
  const roles = await prisma.role.findMany({
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { users: true, permissions: true } } },
  })

  return (
    <>
      <PageHeader
        title="Roles"
        description="A role is a named set of module × action × scope permissions. Users can hold several; the widest scope wins."
        actions={can(viewer, 'roles', 'create') ? <Link href="/portal/roles/new" className="btn-primary">New role</Link> : null}
      />
      <Card className="p-0 sm:p-0">
        <ul className="divide-y divide-ink-900/5">
          {roles.map((role) => (
            <li key={role.id}>
              <Link href={`/portal/roles/${role.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-cream-50/60 sm:px-6">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-semibold text-ink-900">
                    {role.name} {role.isSystem ? <Badge>Seeded</Badge> : null}
                  </p>
                  {role.description ? <p className="text-sm text-ink-500">{role.description}</p> : null}
                </div>
                <p className="text-sm text-ink-500">
                  {role._count.users} holders · {role._count.permissions} permissions
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}
