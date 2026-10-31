import { NextResponse, type NextRequest } from 'next/server'
import { verifyWebhookSignature } from '@/lib/portal/whatsapp'
import { handleInbound, type InboundMessage } from '@/lib/portal/whatsapp-inbound'

export const maxDuration = 60

/** Meta's subscription check: echo hub.challenge when the verify token matches. */
export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const expected = process.env.WHATSAPP_VERIFY_TOKEN
  if (expected && params.get('hub.mode') === 'subscribe' && params.get('hub.verify_token') === expected) {
    return new NextResponse(params.get('hub.challenge') ?? '', { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

type WebhookBody = {
  entry?: { changes?: { value?: { messages?: InboundMessage[] } }[] }[]
}

/**
 * Inbound messages (Phase 4). Requests must carry a valid X-Hub-Signature-256 from Meta, so
 * this is the route handler's CSRF/authenticity check (§11.3).
 */
export async function POST(request: NextRequest) {
  const raw = await request.text()
  if (!verifyWebhookSignature(raw, request.headers.get('x-hub-signature-256'), process.env.WHATSAPP_APP_SECRET)) {
    return new NextResponse('Invalid signature', { status: 401 })
  }
  let body: WebhookBody
  try {
    body = JSON.parse(raw) as WebhookBody
  } catch {
    return new NextResponse('Bad request', { status: 400 })
  }
  const messages = (body.entry ?? []).flatMap((entry) => (entry.changes ?? []).flatMap((change) => change.value?.messages ?? []))
  const results = []
  for (const message of messages) results.push(await handleInbound(message))
  // Always 200 so Meta doesn't retry messages we've already logged.
  return NextResponse.json({ received: messages.length, results })
}
