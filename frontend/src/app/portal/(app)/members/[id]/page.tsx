import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/portal/db'
import { SYSTEM_ROLE, authorize, can, canSeeSensitive, requireActiveViewer } from '@/lib/portal/rbac'
import { raisedByMember, targetsByMember } from '@/lib/portal/metrics'
import { formatDate, formatDateTime, formatPKR, monthKey } from '@/lib/portal/time'
import { ActionForm, Field, SubmitButton } from '@/components/portal/ActionForm'
import Checklist, { loadChecklist } from '@/components/portal/Checklist'
import { Badge, Card, EmptyState, KeyValue, MemberStatusBadge, PageHeader, Stat, Tabs, humanize } from '@/components/portal/ui'
import {
  changeLeadAction,
  hardDeleteApplicantAction,
  revokeSessionsAction,
  setStatusAction,
  updateRolesAction,
  updateTeamsAction,
} from '../actions'

export const metadata: Metadata = { title: 'Member | KKB Portal' }

const TAB_KEYS = ['overview', 'donations', 'outreach', 'tasks', 'events', 'onboarding', 'activity'] as const
type TabKey = (typeof TAB_KEYS)[number]

export default async function MemberProfilePage({ params, searchParams }: { params: { id: string }; searchParams: { tab?: string } }) {
  const viewer = await requireActiveViewer()
  const member = await prisma.member.findUnique({
    where: { id: params.id },
    include: {
      user: { select: { email: true, roles: { include: { role: true } } } },
      reportsTo: { select: { id: true, fullName: true } },
      teams: { include: { team: true } },
      referredBy: { select: { id: true, fullName: true } },
    },
  })
  // Out of scope → 404, so existence isn't leaked.
  if (!member || !(await authorize(viewer, 'members', 'view', { ownerIds: [member.id], memberIds: [member.id] }))) notFound()

  const subject = { ownerIds: [member.id], memberIds: [member.id], assignedIds: [member.id] }
  const [canDonations, canOutreach, canTasks, canEvents, canOnboarding] = await Promise.all([
    authorize(viewer, 'donations', 'view', subject),
    authorize(viewer, 'donors', 'view', subject),
    authorize(viewer, 'tasks', 'view', subject),
    authorize(viewer, 'events', 'view', subject),
    authorize(viewer, 'onboarding', 'view', subject),
  ])
  const canActivity = can(viewer, 'audit', 'view')
  const allowed: Record<TabKey, boolean> = {
    overview: true,
    donations: canDonations,
    outreach: canOutreach,
    tasks: canTasks,
    events: canEvents,
    onboarding: canOnboarding,
    activity: canActivity,
  }
  const tab: TabKey = TAB_KEYS.includes(searchParams.tab as TabKey) && allowed[searchParams.tab as TabKey] ? (searchParams.tab as TabKey) : 'overview'
  const tabs = TAB_KEYS.filter((key) => allowed[key]).map((key) => ({
    key,
    label: humanize(key),
    href: `/portal/members/${member.id}${key === 'overview' ? '' : `?tab=${key}`}`,
  }))

  const sensitive = canSeeSensitive(viewer, member.id)

  return (
    <>
      <PageHeader
        title={member.fullName}
        eyebrow={member.reportsTo ? `Reports to ${member.reportsTo.fullName}` : 'Root of the tree'}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <MemberStatusBadge status={member.status} />
            {member.user.roles.map((userRole) => (
              <Badge key={userRole.id} tone="blue">
                {userRole.role.name}
              </Badge>
            ))}
          </span>
        }
      />
      <Tabs tabs={tabs} active={tab} />

      {tab === 'overview' ? <Overview /> : null}
      {tab === 'donations' ? <DonationsTab memberId={member.id} /> : null}
      {tab === 'outreach' ? <OutreachTab memberId={member.id} /> : null}
      {tab === 'tasks' ? <TasksTab memberId={member.id} /> : null}
      {tab === 'events' ? <EventsTab memberId={member.id} /> : null}
      {tab === 'onboarding' ? (
        <Card title="Onboarding checklist">
          <Checklist viewer={viewer} memberId={member.id} rows={await loadChecklist(member.id)} />
        </Card>
      ) : null}
      {tab === 'activity' ? <ActivityTab memberId={member.id} userId={member.userId} /> : null}
    </>
  )

  async function Overview() {
    const month = monthKey()
    const [raised, targets] = await Promise.all([raisedByMember([member!.id], month), targetsByMember([member!.id], month)])
    const target = targets.get(member!.id)
    const m = member!
    return (
      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Raised this month" value={formatPKR(raised.get(m.id) ?? 0)} hint="Verified donations only" />
            <Stat label="Target" value={target !== undefined ? formatPKR(target) : '—'} />
          </div>
          <Card title="Profile">
            <div className="mb-5 flex items-center gap-4">
              {m.photoKey ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/portal/files/member-photo/${m.id}`} alt="" className="h-16 w-16 rounded-2xl object-cover" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-cream-100 font-display text-2xl text-cream-700">
                  {m.fullName.charAt(0)}
                </div>
              )}
              <div className="text-sm text-ink-600">
                <p>{m.user.email}</p>
                <p>Joined {formatDate(m.joinedAt)}</p>
              </div>
            </div>
            <KeyValue
              items={[
                { label: 'Phone', value: m.phone },
                { label: 'WhatsApp', value: m.whatsapp },
                { label: 'City', value: m.city },
                { label: "Father's name", value: m.fatherName },
                { label: 'Institution / job', value: m.institutionOrJob },
                { label: 'Skills', value: m.skills.join(', ') || '—' },
                { label: 'Hours per week', value: m.availabilityHoursPerWeek },
                { label: 'Teams', value: m.teams.map((membership) => membership.team.name + (membership.isLead ? ' (lead)' : '')).join(', ') || '—' },
                { label: 'Referred by', value: m.referredBy?.fullName },
                ...(sensitive
                  ? [
                      { label: 'CNIC', value: `•••• ${m.cnicLast4}` },
                      { label: 'Address', value: m.address },
                      { label: 'Emergency contact', value: `${m.emergencyName}, ${m.emergencyPhone}` },
                    ]
                  : []),
                ...(m.status === 'LEFT' ? [{ label: 'Left', value: `${formatDate(m.leftAt)} — ${m.leftReason ?? ''}` }] : []),
                ...(m.status === 'REJECTED' ? [{ label: 'Rejection reason', value: m.rejectionReason }] : []),
              ]}
            />
          </Card>
        </div>
        {viewer.isAdmin ? <AdminPanel /> : null}
      </div>
    )
  }

  async function AdminPanel() {
    const m = member!
    const [leads, teams, roles] = await Promise.all([
      prisma.member.findMany({ where: { status: 'ACTIVE', id: { not: m.id } }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true } }),
      prisma.team.findMany({ orderBy: [{ isGeneral: 'desc' }, { name: 'asc' }] }),
      prisma.role.findMany({ orderBy: { name: 'asc' } }),
    ])
    const teamIds = new Set(m.teams.map((membership) => membership.teamId))
    const roleIds = new Set(m.user.roles.map((userRole) => userRole.roleId))
    const live = m.status === 'ACTIVE' || m.status === 'INACTIVE'

    return (
      <div className="space-y-5">
        {live ? (
          <>
            <Card title="Lead">
              <ActionForm action={changeLeadAction} className="space-y-3">
                <input type="hidden" name="memberId" value={m.id} />
                <Field label="Reports to" name="reportsToId">
                  <select id="reportsToId" name="reportsToId" defaultValue={m.reportsToId ?? ''} className="field">
                    <option value="" disabled>
                      Choose…
                    </option>
                    {leads.map((lead) => (
                      <option key={lead.id} value={lead.id}>
                        {lead.fullName}
                      </option>
                    ))}
                  </select>
                </Field>
                <SubmitButton variant="secondary">Change lead</SubmitButton>
              </ActionForm>
            </Card>
            <Card title="Teams">
              <ActionForm action={updateTeamsAction} className="space-y-3">
                <input type="hidden" name="memberId" value={m.id} />
                <div className="flex flex-wrap gap-2">
                  {teams.map((team) => (
                    <label key={team.id} className="flex items-center gap-2 rounded-full border border-ink-900/10 bg-white px-3 py-1.5 text-sm">
                      <input type="checkbox" name="teamIds" value={team.id} defaultChecked={teamIds.has(team.id) || team.isGeneral} disabled={team.isGeneral} className="accent-forest-600" />
                      {team.name}
                    </label>
                  ))}
                </div>
                <SubmitButton variant="secondary">Save teams</SubmitButton>
              </ActionForm>
            </Card>
            <Card title="Roles">
              <ActionForm action={updateRolesAction} className="space-y-3">
                <input type="hidden" name="memberId" value={m.id} />
                <div className="flex flex-wrap gap-2">
                  {roles.map((role) => {
                    const locked = role.name === SYSTEM_ROLE.SUPER_ADMIN && !viewer.isSuperAdmin
                    return (
                      <label key={role.id} className={`flex items-center gap-2 rounded-full border border-ink-900/10 bg-white px-3 py-1.5 text-sm ${locked ? 'opacity-50' : ''}`}>
                        <input type="checkbox" name="roleIds" value={role.id} defaultChecked={roleIds.has(role.id)} disabled={locked} className="accent-forest-600" />
                        {role.name}
                      </label>
                    )
                  })}
                </div>
                {/* Disabled checkboxes don't submit; keep a locked SuperAdmin grant intact. */}
                {roles
                  .filter((role) => role.name === SYSTEM_ROLE.SUPER_ADMIN && !viewer.isSuperAdmin && roleIds.has(role.id))
                  .map((role) => (
                    <input key={role.id} type="hidden" name="roleIds" value={role.id} />
                  ))}
                <SubmitButton variant="secondary">Save roles</SubmitButton>
              </ActionForm>
            </Card>
            <Card title="Status">
              <div className="flex flex-wrap gap-2">
                <ActionForm action={setStatusAction}>
                  <input type="hidden" name="memberId" value={m.id} />
                  <input type="hidden" name="status" value={m.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'} />
                  <SubmitButton variant="outline">{m.status === 'ACTIVE' ? 'Pause member' : 'Reactivate'}</SubmitButton>
                </ActionForm>
                <ActionForm action={revokeSessionsAction}>
                  <input type="hidden" name="memberId" value={m.id} />
                  <SubmitButton variant="outline">Sign out everywhere</SubmitButton>
                </ActionForm>
                <Link href={`/portal/members/${m.id}/offboard`} className="btn bg-clay-600 text-white hover:bg-clay-700">
                  Mark as left
                </Link>
              </div>
            </Card>
          </>
        ) : null}
        {m.status === 'REJECTED' && can(viewer, 'members', 'delete') ? (
          <Card title="Delete applicant data">
            <ActionForm action={hardDeleteApplicantAction} className="space-y-3" confirm="Permanently delete this applicant's data? This cannot be undone.">
              <input type="hidden" name="memberId" value={m.id} />
              <Field label="Reason (e.g. applicant's request)" name="reason">
                <input id="reason" name="reason" required className="field" />
              </Field>
              <SubmitButton variant="danger">Delete permanently</SubmitButton>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    )
  }
}

async function DonationsTab({ memberId }: { memberId: string }) {
  const credits = await prisma.donationCredit.findMany({
    where: { memberId },
    include: { donation: { include: { donor: { select: { fullName: true } }, case: { select: { title: true } } } } },
    orderBy: { donation: { receivedAt: 'desc' } },
    take: 50,
  })
  return (
    <Card title="Donations credited">
      {credits.length === 0 ? (
        <EmptyState>No donations yet.</EmptyState>
      ) : (
        <ul className="divide-y divide-ink-900/5 text-sm">
          {credits.map(({ donation }) => (
            <li key={donation.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div>
                <p className="font-medium text-ink-900">{donation.donor.fullName}</p>
                <p className="text-xs text-ink-500">
                  {donation.case.title} · {formatDate(donation.receivedAt)}
                </p>
              </div>
              <div className="text-right">
                <p className="font-semibold">{formatPKR(donation.amount)}</p>
                <Badge tone={donation.status === 'VERIFIED' ? 'green' : donation.status === 'REJECTED' ? 'red' : 'amber'}>{humanize(donation.status)}</Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

async function OutreachTab({ memberId }: { memberId: string }) {
  const rows = await prisma.outreach.findMany({
    where: { memberId },
    include: { donor: { select: { fullName: true } } },
    orderBy: { contactedAt: 'desc' },
    take: 50,
  })
  return (
    <Card title="Outreach">
      {rows.length === 0 ? (
        <EmptyState>No outreach logged yet.</EmptyState>
      ) : (
        <ul className="divide-y divide-ink-900/5 text-sm">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div>
                <p className="font-medium text-ink-900">{row.donor.fullName}</p>
                <p className="text-xs text-ink-500">
                  {humanize(row.channel)} · {formatDate(row.contactedAt)}
                </p>
              </div>
              <Badge>{humanize(row.outcome)}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

async function TasksTab({ memberId }: { memberId: string }) {
  const tasks = await prisma.task.findMany({
    where: { assigneeId: memberId, deletedAt: null },
    include: { team: { select: { name: true } } },
    orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
    take: 50,
  })
  const now = new Date()
  return (
    <Card title="Tasks">
      {tasks.length === 0 ? (
        <EmptyState>No tasks assigned.</EmptyState>
      ) : (
        <ul className="divide-y divide-ink-900/5 text-sm">
          {tasks.map((task) => {
            const overdue = task.dueAt && task.dueAt < now && !['DONE', 'CANCELLED'].includes(task.status)
            return (
              <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <p className="font-medium text-ink-900">{task.title}</p>
                  <p className={`text-xs ${overdue ? 'font-semibold text-clay-600' : 'text-ink-500'}`}>
                    {task.team.name} · due {formatDate(task.dueAt)}
                  </p>
                </div>
                <Badge>{humanize(task.status)}</Badge>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

async function EventsTab({ memberId }: { memberId: string }) {
  const [led, responsibilities] = await Promise.all([
    prisma.event.findMany({ where: { leadId: memberId, deletedAt: null }, orderBy: { startsAt: 'desc' } }),
    prisma.eventResponsibility.findMany({ where: { memberId }, include: { event: { select: { name: true, startsAt: true } } } }),
  ])
  return (
    <Card title="Events">
      {led.length === 0 && responsibilities.length === 0 ? (
        <EmptyState>No events yet.</EmptyState>
      ) : (
        <ul className="divide-y divide-ink-900/5 text-sm">
          {led.map((event) => (
            <li key={event.id} className="flex justify-between gap-2 py-2.5">
              <span className="font-medium">{event.name}</span>
              <span className="text-ink-500">Event lead · {formatDate(event.startsAt)}</span>
            </li>
          ))}
          {responsibilities.map((item) => (
            <li key={item.id} className="flex justify-between gap-2 py-2.5">
              <span className="font-medium">{item.event.name}</span>
              <span className="text-ink-500">
                {item.title} · {humanize(item.status)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

async function ActivityTab({ memberId, userId }: { memberId: string; userId: string }) {
  const entries = await prisma.auditLog.findMany({
    where: { OR: [{ entity: 'Member', entityId: memberId }, { entity: 'User', entityId: userId }, { actorId: userId }] },
    include: { actor: { select: { member: { select: { fullName: true } }, email: true } } },
    orderBy: { at: 'desc' },
    take: 100,
  })
  return (
    <Card title="Activity">
      {entries.length === 0 ? (
        <EmptyState>No activity recorded.</EmptyState>
      ) : (
        <ul className="divide-y divide-ink-900/5 text-sm">
          {entries.map((entry) => (
            <li key={entry.id} className="py-2.5">
              <p>
                <span className="font-semibold">{entry.actor?.member?.fullName ?? entry.actor?.email ?? 'System'}</span>{' '}
                <span className="text-ink-600">{humanize(entry.action)}</span> <span className="text-ink-500">{entry.entity}</span>
              </p>
              <p className="text-xs text-ink-500">
                {formatDateTime(entry.at)}
                {entry.reason ? ` · ${entry.reason}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
