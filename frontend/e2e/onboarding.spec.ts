import { expect, test } from '@playwright/test'
import { expectNoHorizontalScroll, login, loginActive, prisma, signNda } from './helpers'

// §13.2 E2E: sign-up → NDA → approval.
test('a new member signs up, signs the NDA, waits, and is approved by an admin', async ({ page }) => {
  const stamp = Date.now()
  const email = `applicant-${stamp}@kkb.test`
  const fullName = `Test Applicant ${stamp % 100000}`

  // 1. Sign up
  await page.goto('/portal/signup')
  await expectNoHorizontalScroll(page)
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill('applicant-pass')
  await page.getByLabel('Confirm password').fill('applicant-pass')
  await page.getByLabel('Full name').fill(fullName)
  await page.getByLabel('Gender').selectOption('FEMALE')
  await page.getByLabel('Date of birth').fill('2001-05-20')
  await page.getByLabel('CNIC').fill('35202-7654321-2')
  await page.getByLabel('Phone', { exact: true }).fill('0301 2345678')
  await page.getByLabel('City').fill('Lahore')
  await page.getByLabel('Address').fill('Hostel 3, UET Lahore')
  await page.getByLabel('Emergency contact name').fill('Parent')
  await page.getByLabel('Emergency contact phone').fill('0321 1112223')
  await page.getByRole('button', { name: 'Submit application' }).click()
  await expect(page).toHaveURL(/\/portal\/verify\?sent=/)

  const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { member: true } })
  expect(user.member?.status).toBe('PENDING_NDA')
  expect(user.member?.phone).toBe('+923012345678')
  expect(user.member?.cnicEncrypted).not.toContain('35202')

  // 2. Unverified accounts can't sign in.
  await login(page, email, 'applicant-pass')
  await expect(page.locator('form [role=alert]')).toContainText('confirm your email')

  // The emailed link is a hashed single-use token; mark the email verified as the link would.
  await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } })

  // 3. Sign in → forced to the NDA. Other portal pages are unreachable.
  await login(page, email, 'applicant-pass')
  await page.waitForURL(/\/portal\/onboarding\/nda/)
  await page.goto('/portal/members')
  await expect(page).toHaveURL(/\/portal\/onboarding\/nda/)

  // 4. "I agree" stays disabled until the text is scrolled to the end.
  const agree = page.getByRole('checkbox', { name: /I agree/ })
  await expect(agree).toBeDisabled()
  await page.getByLabel('Agreement text').evaluate((el) => {
    el.scrollTop = el.scrollHeight
    el.dispatchEvent(new Event('scroll'))
  })
  await expect(agree).toBeEnabled()
  await agree.check()
  await page.getByLabel('Type your full name to sign').fill('Someone Else')
  await page.getByRole('button', { name: 'Sign agreement' }).click()
  await expect(page.getByText('Type your full name exactly as registered')).toBeVisible()
  await page.getByLabel('Type your full name to sign').fill(fullName.toUpperCase())
  await page.getByRole('button', { name: 'Sign agreement' }).click()
  await page.waitForURL(/\/portal\/onboarding\/pending/)
  await expect(page.getByRole('heading', { name: 'Awaiting approval' })).toBeVisible()

  const signature = await prisma.ndaSignature.findFirstOrThrow({ where: { memberId: user.member!.id }, include: { ndaVersion: true } })
  expect(signature.bodySha256).toMatch(/^[a-f0-9]{64}$/)
  await page.goto('/portal/dashboard')
  await expect(page).toHaveURL(/\/portal\/onboarding\/pending/)

  // 5. Admin approves: lead + at least one team; General is added automatically.
  await loginActive(page, 'admin@kkb.test')
  await page.goto('/portal/members/pending')
  await expectNoHorizontalScroll(page)
  const card = page.locator('section', { hasText: fullName })
  const lead = await prisma.member.findFirstOrThrow({ where: { user: { email: 'lead1@kkb.test' } } })
  await card.getByLabel('Lead (reports to)').selectOption(lead.id)
  await card.getByRole('checkbox', { name: 'Design' }).check()
  await card.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText(`${fullName} approved.`)).toBeVisible()

  const approved = await prisma.member.findUniqueOrThrow({
    where: { id: user.member!.id },
    include: { teams: { include: { team: true } }, user: { include: { roles: { include: { role: true } } } }, onboarding: true },
  })
  expect(approved.status).toBe('ACTIVE')
  expect(approved.reportsToId).toBe(lead.id)
  expect(approved.teams.map((membership) => membership.team.name).sort()).toEqual(['Design', 'General'])
  expect(approved.user.roles.map((userRole) => userRole.role.name)).toEqual(['Member'])
  expect(approved.onboarding.length).toBeGreaterThan(0)
  expect(await prisma.auditLog.count({ where: { entity: 'Member', entityId: approved.id, action: 'approve' } })).toBe(1)
  expect(await prisma.notification.count({ where: { userId: lead.userId, type: 'SUBTREE_MEMBER_JOINED' } })).toBeGreaterThan(0)

  // 6. The new member lands on their dashboard with the checklist.
  await login(page, email, 'applicant-pass')
  await page.waitForURL(/\/portal\/dashboard/)
  await expect(page.getByRole('heading', { name: 'Getting started' })).toBeVisible()
  await expectNoHorizontalScroll(page)
})

test('publishing a new NDA version forces active members (admins included) to re-sign', async ({ page }) => {
  await loginActive(page, 'admin@kkb.test')
  await page.goto('/portal/settings/admin')
  const body = page.getByLabel(/^Text/)
  await body.fill(`${await body.inputValue()}

Updated ${Date.now()}.`)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Publish new version' }).click()
  // The publisher is an active member too, so they are sent to re-sign straight away.
  await page.waitForURL(/\/portal\/onboarding\/nda/)
  await expect(page.getByText('Updated agreement')).toBeVisible()
  await signNda(page, 'Abdullah Yaqub')
  await page.waitForURL(/\/portal\/dashboard/)
  expect(await prisma.ndaVersion.count({ where: { isActive: true } })).toBe(1)

  await login(page, 'm1@kkb.test')
  await page.waitForURL(/\/portal\/onboarding\/nda/)
  await page.goto('/portal/members')
  await expect(page).toHaveURL(/\/portal\/onboarding\/nda/)
})
