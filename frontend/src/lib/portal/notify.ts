import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma, type Tx } from './db'
import { portalUrl, sendEmail } from './email'
import { ADMIN_ROLE_NAMES } from './rbac/model'
import { isWhatsAppConfigured, sendTemplate } from './whatsapp'

// Every notification type the portal sends (§11.2). Users can turn email off per type.
export const NOTIFICATION_TYPES = {
  APPLICANT_PENDING: 'New applicant awaiting approval',
  APPLICATION_APPROVED: 'Application approved',
  APPLICATION_REJECTED: 'Application rejected',
  SUBTREE_MEMBER_JOINED: 'New member joins your subtree',
  DONATION_VERIFIED: 'Donation verified',
  DONATION_REJECTED: 'Donation rejected',
  DONATIONS_PENDING_DIGEST: 'Donations pending > 3 days',
  ASSIGNED: 'Assigned to a case, event or task',
  TASK_DUE: 'Task due tomorrow or overdue',
  FOLLOW_UP_DUE: 'Follow-up due today',
  EXPENSE_UPDATE: 'Expense submitted, approved or rejected',
  NDA_PUBLISHED: 'New NDA version',
  MONTHLY_REPORT_READY: 'Monthly report ready',
  TASKS_UNASSIGNED: 'Tasks unassigned after offboarding',
} as const

export type NotificationType = keyof typeof NOTIFICATION_TYPES

export type NotificationPayload = {
  title: string
  body?: string
  href?: string
}

export type NotificationChannel = {
  name: string
  send(userId: string, type: NotificationType, payload: NotificationPayload, tx?: Tx): Promise<void>
}

export const InAppChannel: NotificationChannel = {
  name: 'in-app',
  async send(userId, type, payload, tx) {
    await (tx ?? prisma).notification.create({
      data: { userId, type, payload: payload as unknown as Prisma.InputJsonValue },
    })
  },
}

export const EmailChannel: NotificationChannel = {
  name: 'email',
  async send(userId, type, payload) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailOptOuts: true, disabledAt: true },
    })
    if (!user || user.disabledAt || user.emailOptOuts.includes(type)) return
    const link = payload.href ? `\n\nOpen: ${portalUrl(payload.href)}` : ''
    await sendEmail({
      to: user.email,
      subject: `KKB: ${payload.title}`,
      text: `${payload.body ?? payload.title}${link}`,
    })
  },
}

/**
 * WhatsApp (Phase 4): only when the Cloud API is configured, the member opted in, and hasn't
 * turned this type off. Uses the approved template so it works outside the 24-hour window.
 */
export const WhatsAppChannel: NotificationChannel = {
  name: 'whatsapp',
  async send(userId, type, payload) {
    if (!isWhatsAppConfigured()) return
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { disabledAt: true, whatsappOptIn: true, whatsappOptOuts: true, member: { select: { id: true, status: true, whatsapp: true, phone: true } } },
    })
    if (!user || user.disabledAt || !user.whatsappOptIn || user.whatsappOptOuts.includes(type) || user.member?.status !== 'ACTIVE') return
    const phone = user.member.whatsapp ?? user.member.phone
    const link = payload.href ? portalUrl(payload.href) : ''
    const details = [payload.body, link].filter(Boolean).join('\n') || '-'
    await sendTemplate(phone, user.member.id, payload.title, details)
  },
}

// Every notification goes through these adapters; callers never change.
const channels: NotificationChannel[] = [InAppChannel, EmailChannel, WhatsAppChannel]

export async function notify(userId: string, type: NotificationType, payload: NotificationPayload, tx?: Tx) {
  for (const channel of channels) {
    if (channel === InAppChannel) {
      await channel.send(userId, type, payload, tx)
    } else {
      // Out-of-band channels never block or roll back the caller.
      channel.send(userId, type, payload).catch((error) => console.error(`[notify:${channel.name}]`, error))
    }
  }
}

export async function notifyMany(userIds: string[], type: NotificationType, payload: NotificationPayload, tx?: Tx) {
  for (const userId of new Set(userIds)) {
    await notify(userId, type, payload, tx)
  }
}

export async function adminUserIds(client: Tx | typeof prisma = prisma) {
  const rows = await client.userRole.findMany({
    where: { role: { name: { in: ADMIN_ROLE_NAMES } }, user: { disabledAt: null } },
    select: { userId: true },
  })
  return [...new Set(rows.map((row) => row.userId))]
}
