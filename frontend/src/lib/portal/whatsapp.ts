import 'server-only'
import { createHmac, timingSafeEqual } from 'crypto'
import { prisma } from './db'
import { toWhatsAppId } from './whatsapp-commands'

// WhatsApp Cloud API (Phase 4, §11.2). Everything is off unless these env vars are set.
const GRAPH = 'https://graph.facebook.com/v20.0'

export function whatsappConfig() {
  const token = process.env.WHATSAPP_TOKEN
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!token || !phoneNumberId) return null
  return {
    token,
    phoneNumberId,
    // Business-initiated messages need an approved template; it takes two body parameters:
    // {{1}} = title, {{2}} = details + link.
    template: process.env.WHATSAPP_TEMPLATE || 'kkb_notification',
    templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en',
  }
}

export const isWhatsAppConfigured = () => whatsappConfig() !== null

/**
 * Checks Meta's X-Hub-Signature-256 header (HMAC-SHA256 of the raw body with the app secret).
 * Exported pure so it can be unit-tested.
 */
export function verifyWebhookSignature(rawBody: string, header: string | null, appSecret: string | undefined) {
  if (!appSecret || !header?.startsWith('sha256=')) return false
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')
  const given = header.slice('sha256='.length)
  if (given.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'))
}

async function post(body: Record<string, unknown>) {
  const config = whatsappConfig()
  if (!config) throw new Error('WhatsApp is not configured.')
  const response = await fetch(`${GRAPH}/${config.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
  })
  if (!response.ok) throw new Error(`WhatsApp API ${response.status}: ${(await response.text()).slice(0, 300)}`)
}

async function logOutbound(phone: string, memberId: string | null, body: string, error?: unknown) {
  await prisma.whatsAppMessage.create({
    data: { direction: 'OUT', phone, memberId, body: body.slice(0, 2000), status: error ? 'failed' : 'sent', error: error ? String(error).slice(0, 500) : null },
  })
}

/** Notification outside the 24-hour window: approved template with title + details. */
export async function sendTemplate(phone: string, memberId: string | null, title: string, details: string) {
  const config = whatsappConfig()
  if (!config) return
  try {
    await post({
      to: toWhatsAppId(phone),
      type: 'template',
      template: {
        name: config.template,
        language: { code: config.templateLanguage },
        components: [{ type: 'body', parameters: [{ type: 'text', text: title.slice(0, 200) }, { type: 'text', text: details.slice(0, 700) }] }],
      },
    })
    await logOutbound(phone, memberId, `${title}\n${details}`)
  } catch (error) {
    await logOutbound(phone, memberId, `${title}\n${details}`, error)
    throw error
  }
}

/** Free-text reply. Only valid within 24 hours of the member's last message (command replies). */
export async function sendText(phone: string, memberId: string | null, text: string) {
  if (!isWhatsAppConfigured()) return
  try {
    await post({ to: toWhatsAppId(phone), type: 'text', text: { body: text.slice(0, 4000), preview_url: false } })
    await logOutbound(phone, memberId, text)
  } catch (error) {
    await logOutbound(phone, memberId, text, error)
  }
}

/** Downloads media (e.g. a payment screenshot) sent to the business number. */
export async function downloadMedia(mediaId: string) {
  const config = whatsappConfig()
  if (!config) throw new Error('WhatsApp is not configured.')
  const meta = await fetch(`${GRAPH}/${mediaId}`, { headers: { Authorization: `Bearer ${config.token}` } })
  if (!meta.ok) throw new Error(`Media lookup failed (${meta.status})`)
  const { url, mime_type: mime } = (await meta.json()) as { url: string; mime_type: string }
  const file = await fetch(url, { headers: { Authorization: `Bearer ${config.token}` } })
  if (!file.ok) throw new Error(`Media download failed (${file.status})`)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const extension = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg'
  return new File([bytes], `whatsapp-${mediaId}.${extension}`, { type: mime })
}
