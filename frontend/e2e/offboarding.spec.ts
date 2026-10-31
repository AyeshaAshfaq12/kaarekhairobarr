import { expect, test } from '@playwright/test'
import { login, loginActive, prisma } from './helpers'

// §13.2 E2E: offboarding moves work to the lead in one transaction and disables login.
test('admin offboards a member with direct reports', async ({ page }) => {
  // Give m6 a direct report and a future target so there is something to move.
  const [m6, m5, sub1] = await Promise.all(
    ['m6@kkb.test', 'm5@kkb.test', 'sub1@kkb.test'].map((email) => prisma.member.findFirstOrThrow({ where: { user: { email } } }))
  )
  await prisma.member.update({ where: { id: m5.id }, data: { reportsToId: m6.id } })
  await prisma.target.upsert({
    where: { month_memberId: { month: '2099-01', memberId: m6.id } },
    create: { month: '2099-01', memberId: m6.id, amountTarget: 5000, setById: sub1.id },
    update: {},
  })

  await loginActive(page, 'admin@kkb.test')
  await page.goto(`/portal/members/${m6.id}/offboard`)
  await expect(page.getByText('direct report(s) re-parented to Usman Raza')).toBeVisible()
  await page.getByLabel('Reason for leaving').fill('Moved abroad for studies')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Confirm and mark as left' }).click()
  await page.waitForURL(new RegExp(`/portal/members/${m6.id}$`))

  const [left, report, target, audit] = await Promise.all([
    prisma.member.findUniqueOrThrow({ where: { id: m6.id }, include: { user: true } }),
    prisma.member.findUniqueOrThrow({ where: { id: m5.id } }),
    prisma.target.findFirst({ where: { memberId: m6.id, month: '2099-01' } }),
    prisma.auditLog.findMany({ where: { entity: 'Member', entityId: m6.id, action: 'offboard' } }),
  ])
  expect(left.status).toBe('LEFT')
  expect(left.user.disabledAt).not.toBeNull()
  expect(report.reportsToId).toBe(sub1.id)
  expect(target).toBeNull()
  expect(audit).toHaveLength(1)
  expect((audit[0].after as { reparentedMemberIds: string[] }).reparentedMemberIds).toContain(m5.id)

  await login(page, 'm6@kkb.test')
  await expect(page.locator('form [role=alert]')).toContainText('disabled')
})
