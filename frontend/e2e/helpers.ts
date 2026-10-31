import { expect, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()
export const SEED_PASSWORD = process.env.SEED_PASSWORD || 'kkb-portal-dev'

export async function login(page: Page, email: string, password = SEED_PASSWORD) {
  await page.context().clearCookies()
  await page.goto('/portal/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/** Signs in an active member and, if a newer agreement is outstanding, signs it. */
export async function loginActive(page: Page, email: string) {
  await login(page, email)
  await page.waitForURL(/\/portal\/(dashboard|onboarding\/nda)/)
  // Load the dashboard fully so the server-side NDA gate has a chance to redirect.
  await page.goto('/portal/dashboard')
  if (page.url().includes('/onboarding/nda')) {
    const member = await prisma.member.findFirstOrThrow({ where: { user: { email } } })
    await signNda(page, member.fullName)
    await page.waitForURL(/\/portal\/dashboard/)
  }
}

export async function signNda(page: Page, fullName: string) {
  await page.getByLabel('Agreement text').evaluate((el) => {
    el.scrollTop = el.scrollHeight
    el.dispatchEvent(new Event('scroll'))
  })
  await page.getByRole('checkbox', { name: /I agree/ }).check()
  await page.getByLabel('Type your full name to sign').fill(fullName)
  await page.getByRole('button', { name: 'Sign agreement' }).click()
}

/** Visits a URL and asserts it rendered there (no redirect) with the given status. */
export async function expectStatus(page: Page, path: string, status: number) {
  const response = await page.goto(path)
  expect(new URL(page.url()).pathname, `${path} should not redirect`).toBe(path)
  expect(response?.status(), path).toBe(status)
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'page should fit a 375 px screen').toBeLessThanOrEqual(1)
}
