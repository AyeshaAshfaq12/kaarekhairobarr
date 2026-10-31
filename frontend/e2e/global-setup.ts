import { execSync } from 'child_process'

// Resets and re-seeds the dedicated E2E database before every run so specs start from the
// seed state. Never touches DATABASE_URL.
export default function globalSetup() {
  const url = process.env.E2E_DATABASE_URL
  if (!url) throw new Error('Set E2E_DATABASE_URL (or TEST_DATABASE_URL) to a throwaway database for E2E runs.')
  if (url === process.env.APP_DATABASE_URL) throw new Error('E2E_DATABASE_URL must differ from DATABASE_URL: it is wiped on every run.')
  const env = { ...process.env, DATABASE_URL: url }
  // E2E_SKIP_RESET=1: the database is already fresh (e.g. newly created); just migrate and seed.
  if (process.env.E2E_SKIP_RESET === '1') {
    execSync('npx prisma migrate deploy', { env, stdio: 'inherit' })
  } else {
    execSync('npx prisma migrate reset --force --skip-seed --skip-generate', { env, stdio: 'inherit' })
  }
  execSync('npx tsx prisma/seed.ts', { env, stdio: 'inherit' })
}
