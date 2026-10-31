import 'server-only'
import { NextResponse } from 'next/server'
import { readUpload } from './storage'

export const notFoundResponse = () => new NextResponse('Not found', { status: 404 })

/** Streams (local) or redirects to a 15-minute signed URL (S3). Callers authorize first. */
export async function fileResponse(key: string) {
  const file = await readUpload(key)
  if ('redirect' in file) return NextResponse.redirect(file.redirect)
  return new NextResponse(new Uint8Array(file.bytes), {
    headers: { 'Content-Type': file.mime, 'Cache-Control': 'private, max-age=900', 'X-Content-Type-Options': 'nosniff' },
  })
}
