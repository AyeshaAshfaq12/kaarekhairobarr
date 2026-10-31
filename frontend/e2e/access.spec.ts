import { expect, test } from '@playwright/test'
import { expectNoHorizontalScroll, expectStatus, loginActive, prisma } from './helpers'

async function memberId(email: string) {
  return (await prisma.member.findFirstOrThrow({ where: { user: { email } } })).id
}

// §13.1 Access criteria.
test('a sub-lead sees their branch only; out-of-scope URLs 404', async ({ page }) => {
  const [m4, m1, lead1, m7] = await Promise.all(['m4@kkb.test', 'm1@kkb.test', 'lead1@kkb.test', 'm7@kkb.test'].map(memberId))

  await loginActive(page, 'sub1@kkb.test')
  await expectStatus(page, `/portal/members/${m4}`, 200)
  await expectStatus(page, `/portal/members/${m1}`, 404) // lead's other branch
  await expectStatus(page, `/portal/members/${lead1}`, 404) // their own lead
  await expectStatus(page, `/portal/members/${m7}`, 404) // another lead's branch

  await page.goto('/portal/members')
  await expect(page.getByRole('link', { name: 'Hira Javed' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ali Hassan' })).toHaveCount(0)
  await expectNoHorizontalScroll(page)
})

test('a lead sees their whole subtree at any depth', async ({ page }) => {
  const [m4, lead2] = await Promise.all(['m4@kkb.test', 'lead2@kkb.test'].map(memberId))
  await loginActive(page, 'lead1@kkb.test')
  await expectStatus(page, `/portal/members/${m4}`, 200) // two levels down
  await expectStatus(page, `/portal/members/${lead2}`, 404) // sibling lead
  await page.goto('/portal/members?view=tree')
  await expect(page.getByRole('link', { name: 'Hira Javed' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ayesha Malik' })).toHaveCount(0)
})

test('a plain member sees only themselves and cannot open admin pages', async ({ page }) => {
  const [self, other] = await Promise.all(['m5@kkb.test', 'm4@kkb.test'].map(memberId))
  await loginActive(page, 'm5@kkb.test')
  await expectStatus(page, `/portal/members/${self}`, 200)
  await expectStatus(page, `/portal/members/${other}`, 404)
  await expectStatus(page, '/portal/members/pending', 404)
  await expectStatus(page, '/portal/roles', 404)
  await expectStatus(page, '/portal/audit', 404)
})

test('only Admin sees CNIC, address and emergency contact of others', async ({ page }) => {
  const m4 = await memberId('m4@kkb.test')
  await loginActive(page, 'sub1@kkb.test')
  await page.goto(`/portal/members/${m4}`)
  await expect(page.getByText('Emergency contact')).toHaveCount(0)
  await loginActive(page, 'admin@kkb.test')
  await page.goto(`/portal/members/${m4}`)
  await expect(page.getByText('Emergency contact')).toBeVisible()
})
