import { expect, test } from '@playwright/test'
import { loginActive, prisma } from './helpers'

// Follow-ups after Phase 4: report month ranges, locked role grants and seeded receipts.

test('reports accept a month range and export it', async ({ page }) => {
  await loginActive(page, 'admin@kkb.test')
  const now = new Date()
  const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const fromDate = new Date(now.getFullYear(), now.getMonth() - 2, 1)
  const from = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}`

  await page.goto(`/portal/reports?report=impact&scope=org&month=${from}&toMonth=${to}`)
  await expect(page.getByText(`${from} to ${to}`).first()).toBeVisible()
  await expect(page.getByText('Compared with the previous period')).toBeVisible()

  // A range longer than 12 months falls back to the single start month.
  await page.goto(`/portal/reports?report=impact&scope=org&month=2024-01&toMonth=${to}`)
  await expect(page.getByText('Month over month')).toBeVisible()

  const xlsx = await page.request.get(`/api/portal/export/impact?scope=org&month=${from}&toMonth=${to}`)
  expect(xlsx.status()).toBe(200)
  expect(xlsx.headers()['content-type']).toContain('spreadsheet')
})

test('a role editor without a wide scope keeps, rather than drops, grants they cannot change', async ({ page }) => {
  const editor = await prisma.role.create({
    data: {
      name: `Role editor ${Date.now()}`,
      permissions: { create: [{ module: 'roles', action: 'view', scope: 'all' }, { module: 'roles', action: 'edit', scope: 'all' }, { module: 'tasks', action: 'view', scope: 'all' }] },
    },
  })
  const target = await prisma.role.create({
    data: {
      name: `Locked target ${Date.now()}`,
      permissions: { create: [{ module: 'donations', action: 'view', scope: 'all' }, { module: 'tasks', action: 'view', scope: 'own' }] },
    },
  })
  const m6 = await prisma.user.findUniqueOrThrow({ where: { email: 'm6@kkb.test' } })
  await prisma.userRole.create({ data: { userId: m6.id, roleId: editor.id } })

  await loginActive(page, 'm6@kkb.test')
  await page.goto(`/portal/roles/${target.id}`)
  await expect(page.locator('select[name="perm:donations.view"]')).toBeDisabled()
  await page.locator('select[name="perm:tasks.view"]').selectOption('team')
  await page.getByRole('button', { name: 'Save role' }).click()
  await expect(page.getByText('Role saved.')).toBeVisible()

  const saved = await prisma.permission.findMany({ where: { roleId: target.id }, orderBy: { module: 'asc' } })
  expect(saved.map((p) => `${p.module}.${p.action}:${p.scope}`).sort()).toEqual(['donations.view:all', 'tasks.view:team'])
})

test('seeded expense receipts open', async ({ page }) => {
  await loginActive(page, 'finance@kkb.test')
  const expense = await prisma.expense.findFirstOrThrow({ where: { receiptKey: 'seed/receipt-placeholder.pdf' } })
  const response = await page.request.get(`/api/portal/files/expense-receipt/${expense.id}`)
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('application/pdf')
})
