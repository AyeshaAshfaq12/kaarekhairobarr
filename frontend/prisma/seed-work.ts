/* eslint-disable no-console */
// Phase 2–3 seed data (§13.2): 5 cases (one per category) plus an event case, 40 donors,
// ~120 outreach records and ~60 donations in mixed states across 3 months, targets, tasks in
// every status, and one event with responsibilities and expenses. Runs once (skips if cases exist).
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { PrismaClient } from '@prisma/client'
import { encryptString } from '../src/lib/portal/crypto'
import { previousMonth } from '../src/lib/portal/metrics-core'
import { monthKey, monthRange } from '../src/lib/portal/time'

// Deterministic pseudo-random numbers so every seed run produces the same data.
function rng(seed: number) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

const FIRST = ['Ahmed', 'Sara', 'Imran', 'Nadia', 'Kamran', 'Farah', 'Tariq', 'Sadia', 'Asad', 'Huma', 'Rizwan', 'Mehwish', 'Shahid', 'Lubna', 'Adeel', 'Saima', 'Naveed', 'Uzma', 'Waseem', 'Bushra']
const LAST = ['Chaudhry', 'Butt', 'Sheikh', 'Mirza', 'Hashmi', 'Gill', 'Rana', 'Abbasi', 'Siddiqui', 'Bhatti']

// A one-page PDF reading "Demo receipt", so seeded expense receipts open like real uploads.
const PLACEHOLDER_PDF = [
  '%PDF-1.4',
  '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
  '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
  '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 120] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
  '4 0 obj << /Length 54 >> stream',
  'BT /F1 18 Tf 40 55 Td (Demo receipt - seed data) Tj ET',
  'endstream endobj',
  '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
  'trailer << /Root 1 0 R >>',
  '%%EOF',
].join('\n')

/** Stores a seed file where storeUpload() would (S3 when configured, else .uploads/) and registers it. */
async function seedFile(prisma: PrismaClient, key: string, uploadedById: string) {
  const bytes = Buffer.from(PLACEHOLDER_PDF, 'latin1')
  if (process.env.S3_BUCKET) {
    const client = new S3Client({
      region: process.env.S3_REGION || 'auto',
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: !!process.env.S3_ENDPOINT,
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID || '', secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '' },
    })
    await client.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: bytes, ContentType: 'application/pdf' }))
  } else {
    const target = path.join(process.cwd(), '.uploads', key)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, bytes)
  }
  await prisma.fileUpload.upsert({
    where: { key },
    update: {},
    create: { key, mime: 'application/pdf', sizeBytes: bytes.length, uploadedById, purpose: 'expense-receipt' },
  })
  return key
}

export async function seedWork(prisma: PrismaClient, ids: Map<string, { memberId: string; userId: string }>) {
  // Idempotent, so re-seeding an existing database also repairs the demo receipt links.
  const receiptKey = await seedFile(prisma, 'seed/receipt-placeholder.pdf', ids.get('lead3')!.userId)
  if (await prisma.case.count()) return
  const random = rng(42)
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]
  const id = (key: string) => ids.get(key)!.memberId
  const admin = id('admin')
  const finance = id('finance')
  const fundraisers = ['lead1', 'lead2', 'lead3', 'sub1', 'sub2', ...Array.from({ length: 15 }, (_, i) => `m${i + 1}`)].map(id)
  const current = monthKey()
  const months = [previousMonth(current, 2), previousMonth(current), current]
  // Keep current-month dates in the past so nothing is "received in the future".
  const today = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', day: '2-digit' }).format(new Date()))
  const dayIn = (month: string, day: number) => {
    const safeDay = month === current ? Math.max(1, Math.min(day, today)) : day
    return new Date(monthRange(month).start.getTime() + ((safeDay - 1) * 24 + 12) * 3_600_000)
  }

  // ----- Cases -----
  const caseDefs = [
    { title: 'Ramadan ration packs for 50 families', category: 'RATION', target: 500_000, status: 'OPEN', by: 'lead1', assigned: ['m1', 'm2', 'm3'] },
    { title: 'Dialysis support for Mr. Akram', category: 'DIALYSIS', target: 180_000, status: 'OPEN', by: 'lead2', assigned: ['m7', 'm8'] },
    { title: 'Chemotherapy for a 9-year-old', category: 'CANCER', target: 350_000, status: 'OPEN', by: 'admin', assigned: ['m4', 'm12'] },
    { title: "Clear a widow's debt", category: 'DEBT', target: 60_000, status: 'OPEN', by: 'lead3', assigned: ['m13'] },
    { title: 'School fees for 12 students', category: 'EDUCATION', target: 240_000, status: 'DRAFT', by: 'lead1', assigned: [] },
  ] as const
  const caseIds: string[] = []
  for (const [index, def] of caseDefs.entries()) {
    const beneficiary = await prisma.beneficiary.create({
      data: {
        fullName: `Beneficiary ${index + 1}`,
        phone: `+92333${String(1000000 + index).slice(-7)}`,
        cnicEncrypted: encryptString(`35202-${2000000 + index}-${index}`),
        city: 'Lahore',
        condition: def.category.toLowerCase(),
        documentKeys: [],
      },
    })
    const kase = await prisma.case.create({
      data: {
        title: def.title,
        category: def.category,
        description: `${def.title}. Seeded for testing.`,
        targetAmount: def.target,
        status: def.status,
        startDate: dayIn(months[0], 2),
        createdById: id(def.by),
        beneficiaryId: beneficiary.id,
        assignments: { create: def.assigned.map((key) => ({ memberId: id(key) })) },
      },
    })
    caseIds.push(kase.id)
  }
  const openCaseIds = caseIds.slice(0, 4)

  // ----- Donors -----
  const donors: { id: string; memberId: string }[] = []
  for (let i = 0; i < 40; i += 1) {
    const memberId = fundraisers[i % fundraisers.length]
    const phone = `+92345${String(2000000 + i * 37).slice(-7)}`
    const donor = await prisma.donor.create({
      data: {
        fullName: `${FIRST[i % FIRST.length]} ${LAST[(i * 3) % LAST.length]}`,
        phone,
        phoneNormalized: phone,
        city: i % 4 ? 'Lahore' : 'Islamabad',
        createdById: memberId,
        links: { create: { memberId } },
      },
    })
    donors.push({ id: donor.id, memberId })
  }

  // ----- Outreach -----
  const outcomes = ['CONTACTED', 'PROMISED', 'DONATED', 'DECLINED', 'NO_RESPONSE'] as const
  for (let i = 0; i < 120; i += 1) {
    const donor = donors[i % donors.length]
    const month = months[i % 3]
    const outcome = pick(outcomes)
    await prisma.outreach.create({
      data: {
        memberId: donor.memberId,
        donorId: donor.id,
        caseId: pick(openCaseIds),
        contactedAt: dayIn(month, 1 + Math.floor(random() * 25)),
        channel: pick(['WHATSAPP', 'CALL', 'IN_PERSON', 'SOCIAL'] as const),
        outcome,
        promisedAmount: outcome === 'PROMISED' ? 1000 * (1 + Math.floor(random() * 20)) : null,
        followUpAt: outcome === 'PROMISED' || outcome === 'CONTACTED' ? dayIn(month, 27) : null,
        loggedById: donor.memberId,
      },
    })
  }
  const firstOutreach = await prisma.onboardingItem.findUnique({ where: { autoKey: 'FIRST_OUTREACH' } })
  if (firstOutreach) {
    await prisma.onboardingProgress.updateMany({ where: { itemId: firstOutreach.id, memberId: { in: fundraisers }, doneAt: null }, data: { doneAt: new Date() } })
  }

  // ----- Donations: ~70% verified, 20% pending, 10% rejected; every 12th co-credited -----
  for (let i = 0; i < 60; i += 1) {
    const donor = donors[(i * 7) % donors.length]
    const month = months[i % 3]
    const status = i % 10 === 9 ? 'REJECTED' : i % 10 >= 7 ? 'PENDING' : 'VERIFIED'
    const coCredit = i % 12 === 0 ? fundraisers[(fundraisers.indexOf(donor.memberId) + 1) % fundraisers.length] : null
    if (coCredit) {
      await prisma.donorLink.upsert({ where: { donorId_memberId: { donorId: donor.id, memberId: coCredit } }, create: { donorId: donor.id, memberId: coCredit }, update: {} })
    }
    const cash = i % 5 === 0
    await prisma.donation.create({
      data: {
        donorId: donor.id,
        caseId: openCaseIds[i % openCaseIds.length],
        amount: 500 * (2 + Math.floor(random() * 30)),
        receivedAt: dayIn(month, 1 + Math.floor(random() * 26)),
        method: cash ? 'CASH' : pick(['EASYPAISA', 'JAZZCASH', 'BANK'] as const),
        transactionRef: cash ? null : `TX${100000 + i}`,
        cashReceivedNote: cash ? 'Handed to Sana at UET' : null,
        status,
        loggedById: donor.memberId,
        verifiedById: status === 'PENDING' ? null : finance,
        verifiedAt: status === 'PENDING' ? null : new Date(),
        rejectionReason: status === 'REJECTED' ? 'Amount does not match the screenshot' : null,
        credits: { create: [{ memberId: donor.memberId }, ...(coCredit ? [{ memberId: coCredit }] : [])] },
      },
    })
  }

  // ----- Targets -----
  for (const month of months.slice(1)) {
    for (const [index, memberId] of fundraisers.entries()) {
      await prisma.target.create({ data: { month, memberId, amountTarget: 10_000 + (index % 5) * 5_000, outreachTarget: 5 + (index % 4), setById: admin } })
    }
  }
  const donationTeam = await prisma.team.findUniqueOrThrow({ where: { name: 'Donation' } })
  await prisma.target.create({ data: { month: current, teamId: donationTeam.id, amountTarget: 150_000, setById: admin } })

  // ----- Event with its EVENT case, responsibilities, collections and expenses -----
  const event = await prisma.event.create({
    data: { name: 'Community Iftar Drive', description: 'Iftar for 300 people at the UET mosque lawn.', startsAt: new Date(Date.now() + 10 * 86_400_000), venue: 'UET Lahore', leadId: id('lead3'), budget: 150_000, status: 'LIVE' },
  })
  const eventCase = await prisma.case.create({
    data: { title: event.name, category: 'EVENT', description: 'Collections for the Community Iftar Drive.', targetAmount: 200_000, status: 'OPEN', startDate: event.startsAt, createdById: admin, eventId: event.id },
  })
  for (const [index, key] of ['m12', 'm13', 'm14'].entries()) {
    await prisma.eventResponsibility.create({
      data: { eventId: event.id, memberId: id(key), title: ['Venue booking', 'Food', 'Registration desk'][index], status: index === 0 ? 'DONE' : 'IN_PROGRESS' },
    })
    await prisma.donation.create({
      data: {
        donorId: donors[index].id,
        caseId: eventCase.id,
        amount: 15_000 + index * 5_000,
        receivedAt: dayIn(current, 1 + index),
        method: 'BANK',
        transactionRef: `EV${index}`,
        status: index === 2 ? 'PENDING' : 'VERIFIED',
        loggedById: id(key),
        verifiedById: index === 2 ? null : finance,
        verifiedAt: index === 2 ? null : new Date(),
        credits: { create: [{ memberId: id(key) }] },
      },
    })
  }
  const expenses = [
    { title: 'Lawn booking', category: 'Venue', amount: 30_000, status: 'APPROVED', paidBy: 'm12' },
    { title: 'Dates and water', category: 'Food', amount: 45_000, status: 'REIMBURSED', paidBy: 'm13' },
    { title: 'Biryani deg x10', category: 'Food', amount: 60_000, status: 'SUBMITTED', paidBy: 'lead3' },
    { title: 'Banner printing', category: 'Printing', amount: 8_000, status: 'REJECTED', paidBy: 'm14' },
  ] as const
  for (const expense of expenses) {
    await prisma.expense.create({
      data: {
        eventId: event.id,
        title: expense.title,
        category: expense.category,
        amount: expense.amount,
        spentAt: dayIn(current, 1),
        paidById: id(expense.paidBy),
        submittedById: id('lead3'),
        receiptKey,
        status: expense.status,
        reviewedById: expense.status === 'SUBMITTED' ? null : finance,
        reviewedAt: expense.status === 'SUBMITTED' ? null : new Date(),
        rejectionReason: expense.status === 'REJECTED' ? 'Duplicate of an earlier banner' : null,
        reimbursedAt: expense.status === 'REIMBURSED' ? new Date() : null,
      },
    })
  }

  // ----- Tasks in every status, some overdue, one monthly recurring -----
  const teams = await prisma.team.findMany({ where: { isGeneral: false }, include: { memberships: true } })
  const statuses = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE', 'CANCELLED'] as const
  let n = 0
  for (const team of teams) {
    const lead = team.memberships.find((m) => m.isLead)!.memberId
    const people = team.memberships.map((m) => m.memberId)
    for (const status of statuses) {
      n += 1
      const due = new Date(Date.now() + (n % 3 === 0 ? -3 : 4 + n) * 86_400_000)
      await prisma.task.create({
        data: {
          title: `${team.name}: ${['Draft', 'Review', 'Publish', 'Plan', 'Follow up on', 'Archive'][n % 6]} item ${n}`,
          teamId: team.id,
          assigneeId: people[n % people.length],
          createdById: lead,
          dueAt: due,
          priority: (['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const)[n % 4],
          status,
          createdAt: new Date(Date.now() - (10 + n) * 86_400_000),
          completedAt: status === 'DONE' ? new Date(Math.min(Date.now(), due.getTime() - 86_400_000)) : null,
          eventId: team.name === 'Donation' && status === 'TODO' ? event.id : null,
        },
      })
    }
  }
  const design = teams.find((team) => team.name === 'Design')!
  await prisma.task.create({
    data: {
      title: 'Monthly goals poster',
      description: "Poster with this month's targets for social media.",
      teamId: design.id,
      assigneeId: id('m1'),
      createdById: id('lead1'),
      dueAt: new Date(Date.now() + 2 * 86_400_000),
      priority: 'HIGH',
      status: 'IN_REVIEW',
      recurringMonthly: true,
    },
  })

  // Case statuses follow verified totals.
  for (const caseId of [...openCaseIds, eventCase.id]) {
    const kase = await prisma.case.findUniqueOrThrow({ where: { id: caseId } })
    const verified = await prisma.donation.aggregate({ where: { caseId, status: 'VERIFIED' }, _sum: { amount: true } })
    if ((verified._sum.amount ?? 0) >= kase.targetAmount) await prisma.case.update({ where: { id: caseId }, data: { status: 'FUNDED' } })
  }
  console.log('Seeded 6 cases, 40 donors, 120 outreach records, 63 donations, targets, 19 tasks and an event with expenses.')
}
