import * as React from 'react'

// React's per-request cache() exists in Next's server runtime; outside it (unit tests, the
// seed script) fall back to calling the function directly.
type AnyFn = (...args: never[]) => unknown
export const requestCache: <T extends AnyFn>(fn: T) => T =
  (React as unknown as { cache?: <T extends AnyFn>(fn: T) => T }).cache ?? ((fn) => fn)
