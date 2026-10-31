import React, { ReactNode } from 'react'
import PortalShell, { type NavItem } from '@/components/portal/PortalShell'
import { prisma } from '@/lib/portal/db'
import { donationWhere } from '@/lib/portal/money'
import { can, requireActiveViewer } from '@/lib/portal/rbac'
import { logoutAction } from '../(auth)/actions'

export const dynamic = 'force-dynamic'

export default async function PortalAppLayout({ children }: { children: ReactNode }) {
  const viewer = await requireActiveViewer()

  const canVerify = can(viewer, 'donations', 'verify')
  const [unread, pendingApprovals, verifyQueue, expensesWaiting] = await Promise.all([
    prisma.notification.count({ where: { userId: viewer.userId, readAt: null } }),
    viewer.isAdmin ? prisma.member.count({ where: { status: 'PENDING_APPROVAL' } }) : Promise.resolve(0),
    canVerify
      ? prisma.donation.count({
          where: { AND: [{ status: 'PENDING' }, await donationWhere(viewer, 'verify'), { loggedById: { not: viewer.memberId } }, { credits: { none: { memberId: viewer.memberId } } }] },
        })
      : Promise.resolve(0),
    can(viewer, 'expenses', 'approve') ? prisma.expense.count({ where: { status: 'SUBMITTED', submittedById: { not: viewer.memberId }, paidById: { not: viewer.memberId } } }) : Promise.resolve(0),
  ])
  const item = (show: boolean, entry: NavItem) => (show ? [entry] : [])

  const items: NavItem[] = [
    { href: '/portal/dashboard', label: 'Dashboard', icon: 'dashboard' },
    ...item(can(viewer, 'donors', 'view'), { href: '/portal/outreach', label: 'Outreach', icon: 'outreach' }),
    ...item(can(viewer, 'donations', 'view'), { href: '/portal/donations', label: 'Donations', icon: 'donations' }),
    ...item(canVerify, { href: '/portal/donations/verify', label: 'Verify', icon: 'verify', badge: verifyQueue }),
    { href: '/portal/cases', label: 'Cases', icon: 'cases' },
    ...item(can(viewer, 'donors', 'view'), { href: '/portal/donors', label: 'Donors', icon: 'donors' }),
    ...item(can(viewer, 'targets', 'view') || viewer.isAdmin, { href: '/portal/targets', label: 'Targets', icon: 'targets' }),
    ...item(can(viewer, 'tasks', 'view'), { href: '/portal/tasks', label: 'Tasks', icon: 'tasks' }),
    { href: '/portal/events', label: 'Events', icon: 'events' },
    ...item(can(viewer, 'expenses', 'approve'), { href: '/portal/expenses', label: 'Expenses', icon: 'expenses', badge: expensesWaiting }),
    { href: '/portal/reports', label: 'Reports', icon: 'reports' },
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
