import 'server-only'

export type EmailAttachment = { filename: string; content: Buffer }

export type EmailMessage = {
  to: string
  subject: string
  text: string
  html?: string
  attachments?: EmailAttachment[]
}

export function portalUrl(path: string) {
  const base = (process.env.PORTAL_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
  return `${base}${path}`
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

export function simpleHtml(text: string) {
  const body = escapeHtml(text)
    .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>')
    .replace(/\n/g, '<br/>')
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#0f1917">${body}<br/><br/><span style="color:#54706b">Kaare Khair o Barr — Member Portal</span></div>`
}

// Transactional email via Resend's HTTP API. Without RESEND_API_KEY, emails are logged (dev).
export async function sendEmail(message: EmailMessage) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM || 'KKB Portal <portal@kaarekhair.com>'

  if (!apiKey) {
    console.info(`[email:dev] to=${message.to} subject="${message.subject}"\n${message.text}`)
    return
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html ?? simpleHtml(message.text),
      attachments: message.attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content.toString('base64'),
      })),
    }),
  })

  if (!response.ok) {
    console.error(`[email] Resend failed (${response.status}): ${await response.text()}`)
  }
}
