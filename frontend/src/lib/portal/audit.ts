import 'server-only'
import type { Prisma } from '@prisma/client'
import type { Tx } from './db'

const MASKED_FIELDS = new Set(['cnic', 'cnicEncrypted', 'passwordHash', 'password', 'tokenHash'])

function toJsonable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(toJsonable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, toJsonable(inner)]))
  }
  return value
}

function mask(record: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, MASKED_FIELDS.has(key) ? '***' : toJsonable(value)])
  )
}

// before/after hold changed fields only (§11.1); sensitive fields are masked.
export function diffFields(before: Record<string, unknown> | null | undefined, after: Record<string, unknown> | null | undefined) {
  if (!before || !after) {
    return { before: before ? mask(before) : null, after: after ? mask(after) : null }
  }
  const changedBefore: Record<string, unknown> = {}
  const changedAfter: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key === 'updatedAt') continue
    const a = JSON.stringify(toJsonable(before[key]))
    const b = JSON.stringify(toJsonable(after[key]))
    if (a !== b) {
      changedBefore[key] = before[key]
      changedAfter[key] = after[key]
    }
  }
  return { before: mask(changedBefore), after: mask(changedAfter) }
}

export type AuditInput = {
  actorId: string | null
  action: string
  entity: string
  entityId: string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  reason?: string | null
  ip?: string | null
}

// Always call inside the same transaction as the change it records.
export async function writeAudit(tx: Tx, input: AuditInput) {
  const { before, after } = diffFields(input.before, input.after)
  await tx.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      before: (before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (after ?? undefined) as Prisma.InputJsonValue | undefined,
      reason: input.reason ?? null,
      ip: input.ip ?? null,
    },
  })
}
