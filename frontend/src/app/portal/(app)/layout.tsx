import React, { ReactNode } from 'react'
import PortalShell, { type NavItem } from '@/components/portal/PortalShell'
import { prisma } from '@/lib/portal/db'
import { can, requireActiveViewer } from '@/lib/portal/rbac'
import { logoutAction } from '../(auth)/actions'

export const dynamic = 'force-dynamic'

export default async function PortalAppLayout({ children }: { children: ReactNode }) {
  const viewer = await requireActiveViewer()

  const [unread, pendingApprovals] = await Promise.all([
    prisma.notification.count({ where: { userId: viewer.userId, readAt: null } }),
    viewer.isAdmin ? prisma.member.count({ where: { status: 'PENDING_APPROVAL' } }) : Promise.resolve(0),
  ])

  const items: NavItem[] = [
    { href: '/portal/dashboard', label: 'Dashboard', icon: 'dashboard' },
    ...(can(viewer, 'members', 'view') ? [{ href: '/portal/members', label: 'Members', icon: 'members' } as NavItem] : []),
    ...(viewer.isAdmin ? [{ href: '/portal/members/pending', label: 'Approvals', icon: 'pending', badge: pendingApprovals } as NavItem] : []),
    ...(can(viewer, 'teams', 'view') ? [{ href: '/portal/teams', label: 'Teams', icon: 'teams' } as NavItem] : []),
    { href: '/portal/onboarding', label: 'Onboarding', icon: 'onboarding' },
    ...(can(viewer, 'roles', 'view') ? [{ href: '/portal/roles', label: 'Roles', icon: 'roles' } as NavItem] : []),
    ...(can(viewer, 'audit', 'view') ? [{ href: '/portal/audit', label: 'Audit log', icon: 'audit' } as NavItem] : []),
    { href: '/portal/settings', label: 'Settings', icon: 'settings' },
  ]

  return (
    <PortalShell
      items={items}
      userName={viewer.fullName}
      roleLabel={viewer.roleNames.join(', ') || 'Member'}
      unread={unread}
      logout={logoutAction}
    >
      {children}
    </PortalShell>
  )
}
