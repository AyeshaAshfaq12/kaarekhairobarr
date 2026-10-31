import 'server-only'
import { prisma } from './db'
import { writeAudit } from './audit'
import { portalUrl } from './email'
import { createOutreach, findDuplicateDonations, findOrLinkDonor, syncOutreachForDonation } from './money'
import { can, getOutstandingNda, viewerForUser, type ActiveViewer } from './rbac'
import { storeUpload } from './storage'
import { HELP_TEXT, fromWhatsAppId, parseCommand, type Command } from './whatsapp-commands'
import { downloadMedia, sendText } from './whatsapp'

/** A message as delivered by the Cloud API webhook (only the fields we use). */
export type InboundMessage = {
  id: string
  from: string
  type: string
  text?: { body: string }
  image?: { id: string; caption?: string }
  document?: { id: string; caption?: string; mime_type?: string }
}

const pkr = (amount: number) => `PKR ${amount.toLocaleString('en-PK')}`

/** Open cases in a stable order; WhatsApp users refer to them by this number. */
export async function numberedOpenCases() {
  const cases = await prisma.case.findMany({ where: { deletedAt: null, status: { in: ['OPEN', 'FUNDED'] } }, orderBy: { createdAt: 'asc' }, select: { id: true, title: true } })
  return cases.map((kase, index) => ({ ...kase, number: index + 1 }))
}

/**
 * Only an ACTIVE member who opted in to WhatsApp in Settings, writing from their registered
 * WhatsApp number (or their phone when no WhatsApp number is set), can log by WhatsApp.
 */
async function findSender(phone: string) {
  return prisma.member.findFirst({
    where: { status: 'ACTIVE', user: { whatsappOptIn: true, disabledAt: null }, OR: [{ whatsapp: phone }, { whatsapp: null, phone }] },
    select: { id: true, userId: true, fullName: true },
  })
}

async function runCommand(viewer: ActiveViewer, command: Command, mediaId: string | null): Promise<string> {
  switch (command.kind) {
    case 'help':
      return HELP_TEXT
    case 'error':
      return command.message
    case 'cases': {
      const cases = await numberedOpenCases()
      return cases.length ? ['Open cases:', ...cases.map((kase) => `#${kase.number} ${kase.title}`)].join('\n') : 'There are no open cases right now.'
    }
    case 'outreach': {
      if (!can(viewer, 'donors', 'create')) return "Your role can't log outreach."
      const name = command.name ?? `WhatsApp contact …${command.phone.slice(-4)}`
      const outcome = await prisma.$transaction(async (tx) => {
        const linked = await findOrLinkDonor(tx, { fullName: name, phone: command.phone }, viewer.memberId, viewer.memberId)
        const outreach = await createOutreach(tx, {
          memberId: viewer.memberId,
          donorId: linked.donor.id,
          contactedAt: new Date(),
          channel: 'WHATSAPP',
          outcome: command.outcome,
          promisedAmount: command.amount,
          loggedById: viewer.memberId,
          notes: 'Logged via WhatsApp.',
        })
        await writeAudit(tx, { actorId: viewer.userId, action: 'create', entity: 'Outreach', entityId: outreach.id, after: { ...outreach, via: 'whatsapp' } })
        return linked
      })
      return `Logged ${command.outcome.toLowerCase().replace('_', ' ')} for ${outcome.donor.fullName}${command.amount ? ` (${pkr(command.amount)})` : ''}.${outcome.outcome === 'linked' ? ' This donor already existed, so they are now linked to you.' : ''}`
    }
    case 'donation': {
      if (!can(viewer, 'donations', 'create')) return "Your role can't log donations."
      const kase = (await numberedOpenCases()).find((item) => item.number === command.caseNumber)
      if (!kase) return `There's no open case #${command.caseNumber}. Send "cases" to see the list.`
      if (command.method !== 'CASH' && !mediaId) return 'Send the payment screenshot with this text as its caption (required unless cash).'
      const donor = await prisma.donor.findUnique({ where: { phoneNormalized: command.phone } })
      if (donor) {
        const duplicates = await findDuplicateDonations({ donorId: donor.id, amount: command.amount, receivedAt: new Date(), transactionRef: command.ref })
        if (duplicates.length) return 'This looks like a duplicate of a donation already logged (same ref, or same donor, amount and day). If it is new, log it in the portal.'
      }
      const proofKey = mediaId ? await storeUpload(await downloadMedia(mediaId), { uploadedById: viewer.userId, purpose: 'donation-proof' }) : null
      const donation = await prisma.$transaction(async (tx) => {
        const linked = await findOrLinkDonor(tx, { fullName: donor?.fullName ?? `WhatsApp contact …${command.phone.slice(-4)}`, phone: command.phone }, viewer.memberId, viewer.memberId)
        const created = await tx.donation.create({
          data: {
            donorId: linked.donor.id,
            caseId: kase.id,
            amount: command.amount,
            receivedAt: new Date(),
            method: command.method,
            transactionRef: command.ref,
            cashReceivedNote: command.cashNote,
            proofKey,
            status: 'PENDING',
            loggedById: viewer.memberId,
            credits: { create: [{ memberId: viewer.memberId }] },
          },
        })
        await syncOutreachForDonation(tx, { donorId: linked.donor.id, memberId: viewer.memberId, caseId: kase.id, receivedAt: created.receivedAt, loggedById: viewer.memberId })
        await writeAudit(tx, { actorId: viewer.userId, action: 'create', entity: 'Donation', entityId: created.id, after: { ...created, via: 'whatsapp' } })
        return created
      })
      return `Logged ${pkr(donation.amount)} for "${kase.title}". It's pending verification and counts once verified.\n${portalUrl(`/portal/donations/${donation.id}`)}`
    }
  }
}

/** Handles one inbound message: dedupe, identify the member, run the command, reply. */
export async function handleInbound(message: InboundMessage) {
  if (await prisma.whatsAppMessage.findUnique({ where: { waMessageId: message.id } })) return 'duplicate'
  const phone = fromWhatsAppId(message.from) ?? `+${message.from}`
  const text = message.text?.body ?? message.image?.caption ?? message.document?.caption ?? ''
  const mediaId = message.image?.id ?? message.document?.id ?? null
  const log = await prisma.whatsAppMessage.create({ data: { direction: 'IN', waMessageId: message.id, phone, body: text.slice(0, 2000) || `[${message.type}]`, status: 'received' } })

  const sender = await findSender(phone)
  if (!sender) {
    await prisma.whatsAppMessage.update({ where: { id: log.id }, data: { status: 'rejected', error: 'Unknown or not opted-in number' } })
    await sendText(phone, null, 'This number is not linked to an active KKB member with WhatsApp turned on. Turn it on in the portal under Settings → WhatsApp.')
    return 'rejected'
  }

  let reply: string
  let status = 'processed'
  let error: string | null = null
  try {
    const viewer = await viewerForUser(sender.userId)
    if (!viewer) throw new Error('Member is not active')
    if (await getOutstandingNda(viewer.memberId)) {
      reply = 'Please sign the updated member agreement in the portal before logging.'
      status = 'rejected'
    } else {
      reply = await runCommand(viewer, parseCommand(text), mediaId)
    }
  } catch (caught) {
    status = 'failed'
    error = String(caught).slice(0, 500)
    reply = 'Sorry, something went wrong. Please log it in the portal instead.'
    console.error('[whatsapp inbound]', caught)
  }
  await prisma.whatsAppMessage.update({ where: { id: log.id }, data: { memberId: sender.id, status, error } })
  await sendText(phone, sender.id, reply)
  return status
}
