import { expect, test } from '@playwright/test'
import { PNG, expectNoHorizontalScroll, loginActive, prisma } from './helpers'

// §13.2 E2E: log outreach → donation → verify → dashboard updates.
test('outreach → donation → verification → dashboard', async ({ page }) => {
  const phone = `0312${String(Date.now()).slice(-7)}`
  const amount = 7_777

  // 1. m5 logs outreach for a brand-new donor on a phone (quick add).
  await loginActive(page, 'm5@kkb.test')
  await page.goto('/portal/outreach')
  await expectNoHorizontalScroll(page)
  const started = Date.now()
  await page.getByPlaceholder('Search by name or phone').fill('Zubair Test')
  await page.getByRole('button', { name: /Add "Zubair Test" as a new donor/ }).click()
  await page.getByPlaceholder('Phone (dedupes donors)').fill(phone)
  await page.getByRole('radio', { name: 'Promised' }).check({ force: true })
  await page.getByLabel('Promised (PKR)').fill(String(amount))
  await page.getByRole('button', { name: 'Log outreach' }).click()
  await expect(page.getByText('Outreach logged.')).toBeVisible()
  expect(Date.now() - started, 'logging an outreach should take well under 30 s').toBeLessThan(30_000)

  const donor = await prisma.donor.findFirstOrThrow({ where: { phoneNormalized: `+92${phone.slice(1)}` } })

  // 2. Logging a donor with the same phone again links instead of duplicating.
  await page.goto('/portal/donors')
  await page.getByLabel('Name').fill('Zubair (again)')
  await page.getByLabel('Phone').fill(phone)
  await page.getByRole('button', { name: 'Add donor' }).click()
  await expect(page.getByText(/already in your donors|now linked/)).toBeVisible()
  expect(await prisma.donor.count({ where: { phoneNormalized: donor.phoneNormalized } })).toBe(1)

  // 3. Log the donation with a screenshot. It starts PENDING and doesn't count yet.
  const kase = await prisma.case.findFirstOrThrow({ where: { status: { in: ['OPEN', 'FUNDED'] }, category: 'RATION' } })
  await page.goto(`/portal/donations/new?donorId=${donor.id}&caseId=${kase.id}`)
  await page.getByLabel('Amount (PKR)').fill(String(amount))
  await page.getByLabel('Transaction ref').fill(`E2E-${Date.now()}`)
  await page.getByLabel('Payment screenshot').setInputFiles(PNG)
  await page.getByRole('button', { name: 'Log donation' }).click()
  await page.waitForURL(/\/portal\/donations\/[^/]+\?logged=1/)
  const donationId = page.url().split('/').pop()!.split('?')[0]
  const pending = await prisma.donation.findUniqueOrThrow({ where: { id: donationId }, include: { credits: true } })
  expect(pending.status).toBe('PENDING')
  expect(pending.credits.map((c) => c.memberId)).toHaveLength(1)
  // The outreach flipped to DONATED.
  expect(await prisma.outreach.count({ where: { donorId: donor.id, outcome: 'DONATED' } })).toBe(1)

  const m5 = await prisma.member.findFirstOrThrow({ where: { user: { email: 'm5@kkb.test' } } })
  const raisedBefore = await raisedThisMonth(m5.id)

  // 4. Finance verifies from the queue (keyboard shortcut V).
  await loginActive(page, 'finance@kkb.test')
  await page.goto('/portal/donations/verify')
  // Walk the queue with N until our donation is in focus.
  for (let i = 0; i < 40 && !(await page.getByText(`PKR ${amount.toLocaleString('en-PK')} · Zubair`).isVisible()); i += 1) await page.keyboard.press('n')
  await expect(page.getByText(`PKR ${amount.toLocaleString('en-PK')} · Zubair`)).toBeVisible()
  await page.keyboard.press('v')
  await expect.poll(async () => (await prisma.donation.findUniqueOrThrow({ where: { id: donationId } })).status).toBe('VERIFIED')

  // 5. m5's numbers now include it; the donation is locked.
  expect(await raisedThisMonth(m5.id)).toBe(raisedBefore + amount)
  await loginActive(page, 'm5@kkb.test')
  await page.goto(`/portal/donations/${donationId}`)
  await expect(page.getByText('Edit (only while pending)')).toHaveCount(0)
  expect(await prisma.notification.count({ where: { user: { email: 'm5@kkb.test' }, type: 'DONATION_VERIFIED' } })).toBeGreaterThan(0)
})

test('nobody verifies their own donation', async ({ page }) => {
  const admin = await prisma.member.findFirstOrThrow({ where: { user: { email: 'admin@kkb.test' } } })
  const donor = await prisma.donor.findFirstOrThrow()
  const kase = await prisma.case.findFirstOrThrow({ where: { status: { in: ['OPEN', 'FUNDED'] } } })
  const own = await prisma.donation.create({
    data: { donorId: donor.id, caseId: kase.id, amount: 1234, receivedAt: new Date(), method: 'CASH', cashReceivedNote: 'me', loggedById: admin.id, credits: { create: [{ memberId: admin.id }] } },
  })
  await loginActive(page, 'admin@kkb.test')
  await page.goto(`/portal/donations/${own.id}`)
  await expect(page.getByRole('button', { name: 'Verify' })).toHaveCount(0)
  await page.goto('/portal/donations/verify')
  await expect(page.getByRole('link', { name: new RegExp(`${donor.fullName} · ${kase.title}`) }).filter({ hasText: '1,234' })).toHaveCount(0)
})

test('Excel export is scoped and audited; members without export rights get 404', async ({ page }) => {
  await loginActive(page, 'lead1@kkb.test')
  const download = page.waitForEvent('download')
  await page.goto('/portal/reports?report=impact')
  await page.getByRole('link', { name: 'Excel' }).click()
  expect((await download).suggestedFilename()).toMatch(/KKB-impact-.*\.xlsx$/)
  expect(await prisma.auditLog.count({ where: { action: 'export', entityId: 'impact', actor: { email: 'lead1@kkb.test' } } })).toBeGreaterThan(0)

  await loginActive(page, 'm5@kkb.test')
  const response = await page.request.get('/api/portal/export/members?format=xlsx')
  expect(response.status()).toBe(404)
})

async function raisedThisMonth(memberId: string) {
  const now = new Date()
  const karachi = new Date(now.getTime() + 5 * 3_600_000)
  const start = new Date(Date.UTC(karachi.getUTCFullYear(), karachi.getUTCMonth(), 1, -5))
  const rows = await prisma.donation.aggregate({ where: { status: 'VERIFIED', receivedAt: { gte: start }, credits: { some: { memberId } } }, _sum: { amount: true } })
  return rows._sum.amount ?? 0
}
