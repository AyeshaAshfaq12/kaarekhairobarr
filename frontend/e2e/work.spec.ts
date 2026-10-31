import { expect, test } from '@playwright/test'
import { PNG, loginActive, prisma } from './helpers'

// §13.2 E2E: event → expense → approval → summary.
test('event → expense → approval → summary', async ({ page }) => {
  const name = `E2E Food Drive ${Date.now() % 100000}`
  const lead3 = await prisma.member.findFirstOrThrow({ where: { user: { email: 'lead3@kkb.test' } } })

  // 1. Admin creates the event; its EVENT case is created with it.
  await loginActive(page, 'admin@kkb.test')
  await page.goto('/portal/events/new')
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Date and time').fill('2026-12-20T18:00')
  await page.getByLabel('Event lead').selectOption(lead3.id)
  await page.getByLabel(/Budget/).fill('10000')
  await page.getByLabel('Collection target (PKR)').fill('20000')
  await page.getByRole('button', { name: 'Create event' }).click()
  await page.waitForURL((url) => /^\/portal\/events\/(?!new$)[^/]+$/.test(url.pathname))
  const event = await prisma.event.findFirstOrThrow({ where: { name }, include: { case: true } })
  expect(event.case?.category).toBe('EVENT')
  expect(event.case?.targetAmount).toBe(20000)

  // 2. The event lead logs an expense that takes it over budget.
  await loginActive(page, 'lead3@kkb.test')
  await page.goto(`/portal/events/${event.id}`)
  await page.getByText('+ Log an expense').click()
  await page.getByLabel('What for').fill('Food packs')
  await page.getByLabel('Category').selectOption('Food')
  await page.getByLabel('Amount (PKR)').fill('12000')
  await page.getByLabel('Receipt').setInputFiles(PNG)
  await page.getByRole('button', { name: 'Submit for approval' }).click()
  await expect(page.getByText('Expense submitted for approval.')).toBeVisible()
  // The lead paid it, so they cannot approve it themselves.
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0)

  // 3. Finance approves; over budget requires a note.
  await loginActive(page, 'finance@kkb.test')
  await page.goto(`/portal/events/${event.id}`)
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('This event is over budget')).toBeVisible()
  await page.getByLabel('Review note').fill('Agreed in the planning meeting')
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect.poll(async () => (await prisma.expense.findFirstOrThrow({ where: { eventId: event.id } })).status).toBe('APPROVED')

  // 4. The summary matches §8.4.
  await page.reload()
  const summary = page.locator('section', { hasText: 'Collection target' })
  const row = (label: string) => summary.locator('dl > div', { hasText: label })
  await expect(row('Spent (approved)')).toContainText('PKR 12,000')
  await expect(row('Awaiting approval')).toContainText('PKR 0')
  await expect(row('Net')).toContainText('Deficit PKR 12,000') // 0 collected − 12,000 spent
  await expect(row('Spend vs budget')).toContainText('120%')
  const expense = await prisma.expense.findFirstOrThrow({ where: { eventId: event.id } })
  expect(expense.status).toBe('APPROVED')
  expect(expense.reviewNote).toBe('Agreed in the planning meeting')
})

test('tasks: the assignee moves to review, only a team lead marks it done', async ({ page }) => {
  const design = await prisma.team.findUniqueOrThrow({ where: { name: 'Design' } })
  const m1 = await prisma.member.findFirstOrThrow({ where: { user: { email: 'm1@kkb.test' } } })
  const title = `Poster draft ${Date.now() % 100000}`

  await loginActive(page, 'lead1@kkb.test')
  await page.goto(`/portal/tasks/new?teamId=${design.id}`)
  await page.getByLabel('Title').fill(title)
  await page.getByLabel(/^Assignee/).selectOption(m1.id)
  await page.getByRole('button', { name: 'Create task' }).click()
  await page.waitForURL((url) => /^\/portal\/tasks\/(?!new$)[^/]+$/.test(url.pathname))
  const task = await prisma.task.findFirstOrThrow({ where: { title } })

  await loginActive(page, 'm1@kkb.test')
  await page.goto(`/portal/tasks/${task.id}`)
  await page.getByRole('button', { name: 'In review' }).click()
  await expect(page.getByText('Moved to in review.')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0)
  await expect(page.getByText('A team lead marks reviewed work as done.')).toBeVisible()

  await loginActive(page, 'lead1@kkb.test')
  await page.goto(`/portal/tasks/${task.id}`)
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect.poll(async () => (await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).completedAt).not.toBeNull()

  // Board view renders the team's columns on a phone.
  await page.goto(`/portal/tasks?view=board&teamId=${design.id}`)
  await expect(page.locator('p', { hasText: /^In review/ })).toBeVisible()
})
