import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/portal/db'
import { getSubtreeIds } from '@/lib/portal/hierarchy'
import { groupMetrics, memberMetrics, statusBand, formatRatio } from '@/lib/portal/metrics'
import { can, requireActiveViewer, scopeFor } from '@/lib/portal/rbac'
import { getSettings } from '@/lib/portal/settings'
import { formatPKR, monthKey } from '@/lib/portal/time'
import { ActionForm, SubmitButton } from '@/components/portal/ActionForm'
import { BandBadge, Card, EmptyState, MonthPicker, PageHeader, Stat } from '@/components/portal/ui'
import { copyLastMonthAction, setMemberTargetAction, setTeamTargetAction } from './actions'

export const metadata: Metadata = { title: 'Targets | KKB Portal' }

export default async function TargetsPage({ searchParams }: { searchParams: { month?: string } }) {
  const viewer = await requireActiveViewer()
  if (!can(viewer, 'targets', 'view') && !viewer.isAdmin) notFound()
  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? '') ? searchParams.month! : monthKey()
  const scope = scopeFor(viewer, 'targets', 'view')
  const canSet = !!(scopeFor(viewer, 'targets', 'edit') ?? scopeFor(viewer, 'targets', 'create'))
  const settings = await getSettings()

  const memberIds =
    scope === 'all'
      ? (await prisma.member.findMany({ where: { status: 'ACTIVE' }, select: { id: true } })).map((member) => member.id)
      : [...(await getSubtreeIds(viewer.memberId))]
  const [members, metrics, rollup, teams] = await Promise.all([
    prisma.member.findMany({ where: { id: { in: memberIds }, status: 'ACTIVE' }, select: { id: true, fullName: true, reportsToId: true }, orderBy: { fullName: 'asc' } }),
    memberMetrics(memberIds, month),
    groupMetrics(memberIds, month),
    viewer.isAdmin
      ? prisma.team.findMany({ orderBy: { name: 'asc' }, include: { targets: { where: { month } }, memberships: { select: { memberId: true } } } })
      : Promise.resolve([]),
  ])
  const mine = metrics.get(viewer.memberId)
  const teamRaised = await Promise.all(teams.map((team) => groupMetrics(team.memberships.map((m) => m.memberId), month, team.targets[0]?.amountTarget ?? null)))
  const thresholds = { onTrack: settings.bandOnTrack, close: settings.bandClose }

  return (
    <>
      <PageHeader
        title="Targets"
        description="Monthly amount and outreach targets. Achievement counts verified donations only."
        actions={<MonthPicker month={month} basePath="/portal/targets" />}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="My target" value={mine?.amountTarget != null ? formatPKR(mine.amountTarget) : '—'} hint={`Achieved ${formatRatio(mine?.achievement)}`} />
        <Stat label="My raised" value={formatPKR(mine?.raised ?? 0)} />
        {memberIds.length > 1 ? (
          <>
            <Stat label="Subtree target" value={formatPKR(rollup.amountTarget ?? 0)} hint="Sum of everyone's targets" />
            <Stat label="Subtree raised" value={formatPKR(rollup.raised)} hint={`Achieved ${formatRatio(rollup.achievement)}`} />
          </>
        ) : null}
      </div>

      {members.length > 1 || scope === 'all' ? (
        <Card
          title="Member targets"
          actions={
            canSet ? (
              <ActionForm action={copyLastMonthAction}>
                <input type="hidden" name="month" value={month} />
                <SubmitButton variant="outline" className="!px-3 !py-1.5 text-xs">
                  Copy last month&apos;s targets
                </SubmitButton>
              </ActionForm>
            ) : null
          }
        >
          {members.length === 0 ? (
            <EmptyState>No members below you.</EmptyState>
          ) : (
            <ul className="divide-y divide-ink-900/5">
              {members.map((member) => {
                const m = metrics.get(member.id)!
                const editable = canSet && (scope === 'all' || member.id !== viewer.memberId)
                return (
                  <li key={member.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                        {member.fullName} <BandBadge band={statusBand(m.achievement, thresholds)} />
                      </p>
                      <p className="text-xs text-ink-500">
                        Raised {formatPKR(m.raised)} · reached {m.reached}
                        {m.outreachTarget ? ` of ${m.outreachTarget}` : ''} · achievement {formatRatio(m.achievement)}
                      </p>
                    </div>
                    {editable ? (
                      <ActionForm action={setMemberTargetAction} className="flex items-center gap-2">
                        <input type="hidden" name="month" value={month} />
                        <input type="hidden" name="memberId" value={member.id} />
                        <input name="amountTarget" type="number" min={0} inputMode="numeric" defaultValue={m.amountTarget ?? ''} placeholder="PKR" aria-label={`Amount target for ${member.fullName}`} className="field !w-28 !py-2" />
                        <input name="outreachTarget" type="number" min={0} inputMode="numeric" defaultValue={m.outreachTarget ?? ''} placeholder="Reach" aria-label={`Outreach target for ${member.fullName}`} className="field !w-20 !py-2" />
                        <SubmitButton variant="secondary" className="!px-3 !py-2 text-xs">
                          Save
                        </SubmitButton>
                      </ActionForm>
                    ) : (
                      <span className="text-sm text-ink-600">{m.amountTarget != null ? formatPKR(m.amountTarget) : 'No target'}</span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          <p className="mt-3 text-xs text-ink-500">Leave the amount empty and save to remove a target.</p>
        </Card>
      ) : null}

      {viewer.isAdmin ? (
        <Card title="Team targets" className="mt-5">
          <ul className="divide-y divide-ink-900/5">
            {teams.map((team, index) => (
              <li key={team.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold">{team.name}</p>
                  <p className="text-xs text-ink-500">
                    Raised {formatPKR(teamRaised[index].raised)} (each donation once) · achievement {formatRatio(teamRaised[index].achievement)}
                  </p>
                </div>
                <ActionForm action={setTeamTargetAction} className="flex items-center gap-2">
                  <input type="hidden" name="month" value={month} />
                  <input type="hidden" name="teamId" value={team.id} />
                  <input name="amountTarget" type="number" min={0} defaultValue={team.targets[0]?.amountTarget ?? ''} placeholder="PKR" aria-label={`Target for ${team.name}`} className="field !w-32 !py-2" />
                  <SubmitButton variant="secondary" className="!px-3 !py-2 text-xs">
                    Save
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  )
}
