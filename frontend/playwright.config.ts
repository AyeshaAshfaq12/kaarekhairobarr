import { defineConfig, devices } from '@playwright/test'
import { existsSync, readFileSync } from 'fs'

// Load .env.local so the specs know the database URLs.
if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2]
  }
}

// E2E runs against its own database (wiped and re-seeded in global-setup), never DATABASE_URL.
process.env.APP_DATABASE_URL = process.env.DATABASE_URL
process.env.E2E_DATABASE_URL ||= process.env.TEST_DATABASE_URL
if (process.env.E2E_DATABASE_URL) process.env.DATABASE_URL = process.env.E2E_DATABASE_URL

const PORT = Number(process.env.E2E_PORT || 3100)

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    // The portal is mobile-first: every flow runs at 375 px wide (§13.1).
    ...devices['iPhone 13 Mini'],
    browserName: 'chromium',
    viewport: { width: 375, height: 812 },
    trace: 'retain-on-failure',
  },
  webServer: {
    // Requires `npm run build` first.
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/portal/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    // WhatsApp webhook secrets for the Phase 4 specs (outbound sending stays off: no token).
    env: { DATABASE_URL: process.env.E2E_DATABASE_URL ?? '', WHATSAPP_APP_SECRET: 'e2e-whatsapp-secret', WHATSAPP_VERIFY_TOKEN: 'e2e-verify' },
  },
})
