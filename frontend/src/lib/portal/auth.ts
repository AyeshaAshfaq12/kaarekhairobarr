import 'server-only'
import bcrypt from 'bcryptjs'
import { cookies, headers } from 'next/headers'
import { requestCache as cache } from './request-cache'
import { prisma } from './db'
import { randomToken, sha256 } from './crypto'

export const SESSION_COOKIE = 'kkb_session'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const SLIDE_AFTER_MS = 60 * 60 * 1000
export const BCRYPT_COST = 12

export function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_COST)
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash)
}

export function getRequestMeta() {
  const headerList = headers()
  const forwarded = headerList.get('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim() || headerList.get('x-real-ip') || 'unknown'
  const userAgent = headerList.get('user-agent') || 'unknown'
  return { ip, userAgent }
}

export function sessionCookieOptions(maxAgeMs = SESSION_TTL_MS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: Math.floor(maxAgeMs / 1000),
  }
}

// Only callable from server actions / route handlers (sets a cookie).
export async function createSession(userId: string) {
  const token = randomToken()
  const { ip, userAgent } = getRequestMeta()
  await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      ip,
      userAgent,
    },
  })
  cookies().set(SESSION_COOKIE, token, sessionCookieOptions())
}

export async function destroyCurrentSession() {
  const token = cookies().get(SESSION_COOKIE)?.value
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } })
  }
  cookies().delete(SESSION_COOKIE)
}

export async function revokeAllSessions(userId: string) {
  await prisma.session.deleteMany({ where: { userId } })
}

// Resolves the signed-in user once per request. Expiry slides by 30 days on activity;
// the middleware refreshes the cookie's max-age to match.
export const getSessionUser = cache(async () => {
  const token = cookies().get(SESSION_COOKIE)?.value
  if (!token) return null

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { member: true } } },
  })
  if (!session) return null

  const now = Date.now()
  if (session.expiresAt.getTime() < now || session.user.disabledAt) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined)
    return null
  }

  if (now - session.lastSeenAt.getTime() > SLIDE_AFTER_MS) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(now), expiresAt: new Date(now + SESSION_TTL_MS) },
    })
  }

  return session.user
})

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>

// ---------- Single-use tokens ----------

export async function issueToken(input: {
  purpose: 'EMAIL_VERIFY' | 'PASSWORD_RESET' | 'INVITE'
  email: string
  userId?: string
  ttlMs: number
  payload?: Record<string, string>
}) {
  const token = randomToken()
  await prisma.authToken.create({
    data: {
      tokenHash: sha256(token),
      purpose: input.purpose,
      email: input.email,
      userId: input.userId,
      payload: input.payload,
      expiresAt: new Date(Date.now() + input.ttlMs),
    },
  })
  return token
}

export async function findValidToken(token: string, purpose: 'EMAIL_VERIFY' | 'PASSWORD_RESET' | 'INVITE') {
  if (!token) return null
  const record = await prisma.authToken.findUnique({ where: { tokenHash: sha256(token) } })
  if (!record || record.purpose !== purpose || record.usedAt || record.expiresAt < new Date()) return null
  return record
}

// ---------- Login rate limit: 5 failed attempts per 15 minutes per email + IP ----------

export const LOGIN_WINDOW_MS = 15 * 60 * 1000
export const LOGIN_MAX_FAILURES = 5

export async function isLoginRateLimited(email: string, ip: string) {
  const failures = await prisma.loginAttempt.count({
    where: { email, ip, success: false, at: { gte: new Date(Date.now() - LOGIN_WINDOW_MS) } },
  })
  return failures >= LOGIN_MAX_FAILURES
}
