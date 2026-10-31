import { createHmac } from 'crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { WHATSAPP_TEST_SECRET, loginActive, prisma } from './helpers'

// Phase 4: quick logging by WhatsApp through the signed webhook. Outbound sends are disabled in
// tests (no WHATSAPP_TOKEN), so only the inbound path and its effects are checked.

function webhookBody(from: string, text: string, id = `wamid.${Date.now()}.${Math.random()}`) {
  return JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id, from, type: 'text', text: { body: text } }] } }] }] })
}

async function send(request: APIRequestContext, body: string, secret = WHATSAPP_TEST_SECRET) {
  return request.post('/api/portal/whatsapp/webhook', {
    data: body,
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` },
  })
}

test('opted-in members log outreach and cash donations by WhatsApp', async ({ page, request }) => {
  const m5 = await prisma.member.findFirstOrThrow({ where: { user: { email: 'm5@kkb.test' } } })
  const from = (m5.whatsapp ?? m5.phone).replace('+', '')
  const donorPhone = `0333${String(Date.now()).slice(-7)}`

  // Not opted in yet → rejected.
  const before = await send(request, webhookBody(from, `outreach ${donorPhone} contacted`))
  expect((await before.json()).results).toEqual(['rejected'])

  // Opt in from Settings.
  await loginActive(page, 'm5@kkb.test')
  await page.goto('/portal/settings')
  await page.getByLabel('Use WhatsApp with KKB').check()
  await page.getByRole('button', { name: 'Save WhatsApp settings' }).click()
  await expect(page.getByText('WhatsApp turned on.')).toBeVisible()

  // Outreach for a new donor.
  const outreach = await send(request, webhookBody(from, `outreach ${donorPhone} promised 5k Bilal WA`))
  expect((await outreach.json()).results).toEqual(['processed'])
  const donor = await prisma.donor.findUniqueOrThrow({ where: { phoneNormalized: `+92${donorPhone.slice(1)}` } })
  expect(donor.fullName).toBe('Bilal WA')
  const row = await prisma.outreach.findFirstOrThrow({ where: { donorId: donor.id } })
  expect(row).toMatchObject({ memberId: m5.id, loggedById: m5.id, channel: 'WHATSAPP', outcome: 'PROMISED', promisedAmount: 5000 })

  // Cash donation to case #1 → PENDING, credited to m5, outreach flipped to DONATED.
  const donation = await send(request, webhookBody(from, `donation ${donorPhone} 2000 cash #1 handed to Sana`))
  expect((await donation.json()).results).toEqual(['processed'])
  const logged = await prisma.donation.findFirstOrThrow({ where: { donorId: donor.id }, include: { credits: true } })
  expect(logged).toMatchObject({ amount: 2000, method: 'CASH', status: 'PENDING', loggedById: m5.id, cashReceivedNote: 'handed to Sana' })
  expect(logged.credits.map((c) => c.memberId)).toEqual([m5.id])
  expect(await prisma.outreach.count({ where: { donorId: donor.id, outcome: 'DONATED' } })).toBe(1)
  expect(await prisma.auditLog.count({ where: { entity: 'Donation', entityId: logged.id, actor: { email: 'm5@kkb.test' } } })).toBe(1)

  // Case numbers are permanent (Case.number): #5 is the seeded draft, so it is refused even
  // though only four cases come before the event case, and #6 is always the event case.
  await send(request, webhookBody(from, `donation ${donorPhone} 1000 cash #5 handed to Sana`))
  expect(await prisma.donation.count({ where: { donorId: donor.id } })).toBe(1)
  await send(request, webhookBody(from, `donation ${donorPhone} 1500 cash #6 handed to Sana`))
  const eventCase = await prisma.case.findUniqueOrThrow({ where: { number: 6 } })
  expect(eventCase.category).toBe('EVENT')
  expect(await prisma.donation.count({ where: { donorId: donor.id, caseId: eventCase.id, amount: 1500 } })).toBe(1)

  // A non-cash donation without a screenshot is refused; nothing is logged.
  await send(request, webhookBody(from, `donation ${donorPhone} 3000 easypaisa TX9 #1`))
  expect(await prisma.donation.count({ where: { donorId: donor.id } })).toBe(2)

  // The same WhatsApp message id is only processed once.
  const id = `wamid.dup.${Date.now()}`
  await send(request, webhookBody(from, `outreach ${donorPhone} contacted`, id))
  const again = await send(request, webhookBody(from, `outreach ${donorPhone} contacted`, id))
  expect((await again.json()).results).toEqual(['duplicate'])
})

test('webhook rejects unsigned or wrongly signed requests and verifies subscriptions', async ({ request }) => {
  const body = webhookBody('923001234567', 'help')
  expect((await request.post('/api/portal/whatsapp/webhook', { data: body, headers: { 'content-type': 'application/json' } })).status()).toBe(401)
  expect((await send(request, body, 'wrong-secret')).status()).toBe(401)

  const ok = await request.get('/api/portal/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=e2e-verify&hub.challenge=12345')
  expect(ok.status()).toBe(200)
  expect(await ok.text()).toBe('12345')
  expect((await request.get('/api/portal/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1')).status()).toBe(403)
})
