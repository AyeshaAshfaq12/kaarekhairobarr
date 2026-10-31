import 'server-only'
import { ZodError } from 'zod'
import { ForbiddenError } from './rbac'
import { UploadError } from './storage'
import type { ActionState } from './validation'

export class UserError extends Error {}

function isNextControlFlow(error: unknown) {
  const digest = (error as { digest?: unknown } | null)?.digest
  return typeof digest === 'string' && (digest.startsWith('NEXT_REDIRECT') || digest === 'NEXT_NOT_FOUND')
}

// Turns expected failures into form state; redirects and notFound() still propagate.
export async function runAction(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: true }
  } catch (error) {
    if (isNextControlFlow(error)) throw error
    if (error instanceof ZodError) {
      return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: error.flatten().fieldErrors }
    }
    if (error instanceof ForbiddenError || error instanceof UserError || error instanceof UploadError) {
      return { ok: false, message: error.message }
    }
    console.error('[portal action]', error)
    return { ok: false, message: 'Something went wrong. Please try again.' }
  }
}
