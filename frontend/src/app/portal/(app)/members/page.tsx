import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { MemberStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/portal/db'
import { buildTree, type TreeNode } from '@/lib/portal/hierarchy'
import { raisedByMember, targetsByMember } from '@/lib/portal/metrics'
import { can, memberIdFilter, requireActiveViewer, visibleMemberIds } from '@/lib/portal/rbac'
import { formatDate, formatPKR, monthKey } from '@/lib/portal/time'
import { Card, EmptyState, MemberStatusBadge, PageHeader, Tabs } from '@/components/portal/ui'

export const metadata: Metadata = { title: 'Members | KKB Portal' }

const PAGE_SIZE = 25
const STATUSES: MemberStatus[] = ['ACTIVE', 'INACTIVE', 'PENDING_APPROVAL', 'PENDING_NDA', 'LEFT', 'REJECTED']

type SearchParams = { view?: string; q?: string; team?: string; status?: string; lead?: string; page?: string }

function TreeList({ nodes }: { nodes: TreeNode[] }) {
  return (
    <ul className="space-y-1 border-l border-ink-900/10 pl-3 sm:pl-4">
      {nodes.map((node) => (
        <li key={node.id}>
          {node.children.length ? (
            <details open className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl py-1 text-sm">
                <span className="inline-block w-3 text-ink-400 transition group-open:rotate-90">›</span>
                <Link href={`/portal/members/${node.id}`} className="font-medium text-ink-900 hover:text-forest-700">
                  {node.fullName}
                </Link>
                <span className="text-xs text-ink-400">{node.children.length}</span>
                {node.status !== 'ACTIVE' ? <MemberStatusBadge status={node.status} /> : null}
              </summary>
              <TreeList nodes={node.children} />
            </details>
          ) : (
            <div className="flex items-center gap-2 py-1 pl-5 text-sm">
              <Link href={`/portal/members/${node.id}`} className="text-ink-800 hover:text-forest-700">
                {node.fullName}
              </Link>
              {node.status !== 'ACTIVE' ? <MemberStatusBadge status={node.status} /> : null}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

export default async function MembersPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requireActiveViewer()
  if (!can(viewer, 'members', 'view')) notFound()

  const visible = await visibleMemberIds(viewer, 'members', 'view')
  const view = searchParams.view === 'tree' ? 'tree' : 'list'
  const tabs = [
    { key: 'list', label: 'Directory', href: '/portal/members' },
    { key: 'tree', label: 'Org tree', href: '/portal/members?view=tree' },
  ]
  const headerActions = viewer.isAdmin ? (
    <Link href="/portal/members/invite" className="btn-primary">
      Invite member
    </Link>
  ) : null

  if (view === 'tree') {
    // Admin (scope all) sees the whole tree from the root(s); everyone else sees their own subtree.
    const rows = await prisma.member.findMany({
      where: { id: memberIdFilter(visible), status: { in: ['ACTIVE', 'INACTIVE'] }, deletedAt: null },
      select: { id: true, fullName: true, status: true, reportsToId: true },
    })
    const ids = new Set(rows.map((row) => row.id))
    const roots = visible === 'all' ? rows.filter((row) => !row.reportsToId || !ids.has(row.reportsToId)).map((row) => row.id) : [viewer.memberId]
    const tree = buildTree(rows, roots)
    return (
      <>
        <PageHeader title="Members" actions={headerActions} />
        <Tabs tabs={tabs} active="tree" />
        <Card>{tree.length ? <TreeList nodes={tree} /> : <EmptyState>No one to show.</EmptyState>}</Card>
      </>
    )
  }

  const status = STATUSES.includes(searchParams.status as MemberStatus) ? (searchParams.status as MemberStatus) : undefined
  const page = Math.max(1, Number(searchParams.page) || 1)
  const where: Prisma.MemberWhereInput = {
    id: memberIdFilter(visible),
    deletedAt: null,
    status: status ?? { in: ['ACTIVE', 'INACTIVE'] },
    ...(searchParams.q ? { fullName: { contains: searchParams.q, mode: 'insensitive' } } : {}),
    ...(searchParams.team ? { teams: { some: { teamId: searchParams.team } } } : {}),
    ...(searchParams.lead ? { reportsToId: searchParams.lead } : {}),
  }

  const [total, members, teams, leads] = await Promise.all([
    prisma.member.count({ where }),
    prisma.member.findMany({
      where,
      orderBy: { fullName: 'asc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        reportsTo: { select: { id: true, fullName: true } },
        teams: { include: { team: { select: { name: true, isGeneral: true } } } },
        user: { select: { roles: { select: { role: { select: { name: true } } } } } },
      },
    }),
    prisma.team.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.member.findMany({
      where: { id: memberIdFilter(visible), reports: { some: {} } },
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true },
    }),
  ])

  const month = monthKey()
  const memberIds = members.map((member) => member.id)
  const [raised, targets] = await Promise.all([raisedByMember(memberIds, month), targetsByMember(memberIds, month)])
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageHref = (target: number) => {
    const params = new URLSearchParams(Object.entries({ ...searchParams, page: String(target) }).filter(([, value]) => value) as [string, string][])
    return `/portal/members?${params.toString()}`
  }

  return (
    <>
      <PageHeader title="Members" description={`${total} ${total === 1 ? 'member' : 'members'}`} actions={headerActions} />
      <Tabs tabs={tabs} active="list" />

      <form className="mb-4 grid gap-2 sm:grid-cols-5" action="/portal/members">
        <input name="q" defaultValue={searchParams.q} placeholder="Search by name" className="field sm:col-span-2" />
        <select name="team" defaultValue={searchParams.team ?? ''} className="field">
          <option value="">All teams</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={searchParams.status ?? ''} className="field">
          <option value="">Active + paused</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {value.replace('_', ' ').toLowerCase()}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <select name="lead" defaultValue={searchParams.lead ?? ''} className="field min-w-0">
            <option value="">Any lead</option>
            {leads.map((lead) => (
              <option key={lead.id} value={lead.id}>
                {lead.fullName}
              </option>
            ))}
          </select>
          <button className="btn-secondary shrink-0">Filter</button>
        </div>
      </form>

      <Card className="overflow-hidden p-0 sm:p-0">
        {members.length === 0 ? (
          <div className="p-4">
            <EmptyState>No members match these filters.</EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-cream-50 text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="hidden px-4 py-3 md:table-cell">Lead</th>
                  <th className="hidden px-4 py-3 lg:table-cell">Teams</th>
                  <th className="hidden px-4 py-3 lg:table-cell">Roles</th>
                  <th className="hidden px-4 py-3 sm:table-cell">Joined</th>
                  <th className="px-4 py-3 text-right">This month</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-900/5">
                {members.map((member) => {
                  const memberRaised = raised.get(member.id) ?? 0
                  const target = targets.get(member.id)
                  return (
                    <tr key={member.id} className="align-top hover:bg-cream-50/60">
                      <td className="px-4 py-3">
                        <Link href={`/portal/members/${member.id}`} className="font-semibold text-ink-900 hover:text-forest-700">
                          {member.fullName}
                        </Link>
                        <div className="mt-1">
                          <MemberStatusBadge status={member.status} />
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 text-ink-600 md:table-cell">{member.reportsTo?.fullName ?? '—'}</td>
                      <td className="hidden px-4 py-3 text-ink-600 lg:table-cell">
                        {member.teams.filter((membership) => !membership.team.isGeneral).map((membership) => membership.team.name + (membership.isLead ? ' (lead)' : '')).join(', ') || '—'}
                      </td>
                      <td className="hidden px-4 py-3 text-ink-600 lg:table-cell">{member.user.roles.map((userRole) => userRole.role.name).join(', ') || '—'}</td>
                      <td className="hidden px-4 py-3 text-ink-600 sm:table-cell">{formatDate(member.joinedAt)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <span className="font-semibold text-ink-900">{formatPKR(memberRaised)}</span>
                        <div className="text-xs text-ink-500">{target !== undefined ? `of ${formatPKR(target)}` : 'no target'}</div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {pages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm">
          {page > 1 ? <Link href={pageHref(page - 1)} className="btn-outline">Previous</Link> : <span />}
          <span className="text-ink-500">
            Page {page} of {pages}
          </span>
          {page < pages ? <Link href={pageHref(page + 1)} className="btn-outline">Next</Link> : <span />}
        </div>
      ) : null}
    </>
  )
}
