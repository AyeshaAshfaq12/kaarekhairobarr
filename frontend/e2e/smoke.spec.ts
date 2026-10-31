import { expect, test } from '@playwright/test'
import { expectNoHorizontalScroll, loginActive, prisma } from './helpers'

// Every screen loads for each kind of user and fits a 375 px phone (§13.1 General).
const COMMON = ['/portal/dashboard', '/portal/cases', '/portal/events', '/portal/reports', '/portal/onboarding', '/portal/notifications', '/portal/settings']

const ROLES: Record<string, string[]> = {
  'admin@kkb.test': [
    ...COMMON,
    '/portal/outreach',
    '/portal/donors',
    '/portal/donations',
    '/portal/donations/new',
    '/portal/donations/verify',
    '/portal/targets',
    '/portal/tasks',
    '/portal/tasks?view=board',
    '/portal/tasks/new',
    '/portal/expenses',
    '/portal/members',
    '/portal/members?view=tree',
    '/portal/members/pending',
    '/portal/members/invite',
    '/portal/teams',
    '/portal/roles',
    '/portal/roles/new',
    '/portal/audit',
    '/portal/settings/admin',
    '/portal/cases/new',
    '/portal/events/new',
    '/portal/reports?report=cases',
    '/portal/reports?report=donations',
    '/portal/reports?report=event',
    '/portal/reports?report=team',
    '/portal/reports?report=member',
    '/portal/reports?report=onboarding',
    '/portal/reports?report=impact&scope=org',
  ],
  'lead1@kkb.test': [...COMMON, '/portal/outreach', '/portal/donors', '/portal/donations', '/portal/targets', '/portal/tasks', '/portal/tasks?view=board', '/portal/members', '/portal/teams'],
  'm5@kkb.test': [...COMMON, '/portal/outreach', '/portal/donors', '/portal/donations', '/portal/donations/new', '/portal/tasks'],
  'finance@kkb.test': [...COMMON, '/portal/donations', '/portal/donations/verify', '/portal/expenses'],
}

for (const [email, paths] of Object.entries(ROLES)) {
  test(`every screen loads and fits 375 px for ${email}`, async ({ page }) => {
    test.setTimeout(240_000)
    await loginActive(page, email)
    for (const path of paths) {
      const response = await page.goto(path)
      expect(response?.status(), path).toBe(200)
      await expectNoHorizontalScroll(page)
    }
  })
}

test('detail pages load for admin', async ({ page }) => {
  test.setTimeout(120_000)
  const [kase, donation, donor, event, task, member, team, role] = await Promise.all([
    prisma.case.findFirstOrThrow({ where: { deletedAt: null } }),
    prisma.donation.findFirstOrThrow(),
    prisma.donor.findFirstOrThrow(),
    prisma.event.findFirstOrThrow(),
    prisma.task.findFirstOrThrow({ where: { deletedAt: null } }),
    prisma.member.findFirstOrThrow({ where: { status: 'ACTIVE' } }),
    prisma.team.findFirstOrThrow(),
    prisma.role.findFirstOrThrow(),
  ])
  await loginActive(page, 'admin@kkb.test')
  for (const path of [
    `/portal/cases/${kase.id}`,
    `/portal/donations/${donation.id}`,
    `/portal/donors/${donor.id}`,
    `/portal/events/${event.id}`,
    `/portal/tasks/${task.id}`,
    `/portal/members/${member.id}`,
    `/portal/members/${member.id}?tab=donations`,
    `/portal/members/${member.id}?tab=activity`,
    `/portal/teams/${team.id}`,
    `/portal/roles/${role.id}`,
  ]) {
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(200)
    await expectNoHorizontalScroll(page)
  }
  for (const format of ['xlsx', 'pdf']) {
    const response = await page.request.get(`/api/portal/export/impact?scope=org&format=${format}`)
    expect(response.status(), format).toBe(200)
  }
})
