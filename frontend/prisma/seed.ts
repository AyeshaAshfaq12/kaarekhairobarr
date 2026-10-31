/* eslint-disable no-console */
// Phase 1 seed (§13.2): roles, teams, NDA v1, checklist, and the people tree:
// 1 SuperAdmin, 1 Finance, 3 leads, 2 sub-leads, 15 members across 3 levels, plus applicants.
// Money data (cases, donors, outreach, donations) is added with Phase 2.
import { PrismaClient, type Action, type Gender, type MemberStatus, type Module, type Scope } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { createHash } from 'crypto'
import { encryptString } from '../src/lib/portal/crypto'
import { SEEDED_ROLES, SYSTEM_ROLE } from '../src/lib/portal/rbac/model'
import { DEFAULT_ONBOARDING_ITEMS, NDA_V1_BODY, NDA_V1_TITLE } from '../src/lib/portal/nda-text'

const prisma = new PrismaClient()
const PASSWORD = process.env.SEED_PASSWORD || 'kkb-portal-dev'

type Person = {
  key: string
  name: string
  lead?: string
  roles: string[]
  status?: MemberStatus
  gender?: Gender
  city?: string
}

const PEOPLE: Person[] = [
  { key: 'admin', name: 'Abdullah Yaqub', roles: [SYSTEM_ROLE.SUPER_ADMIN] },
  { key: 'finance', name: 'Sana Iqbal', lead: 'admin', roles: [SYSTEM_ROLE.FINANCE, SYSTEM_ROLE.MEMBER], gender: 'FEMALE' },
  // Leads
  { key: 'lead1', name: 'Hamza Tariq', lead: 'admin', roles: [SYSTEM_ROLE.LEAD, SYSTEM_ROLE.MEMBER] },
  { key: 'lead2', name: 'Ayesha Malik', lead: 'admin', roles: [SYSTEM_ROLE.LEAD, SYSTEM_ROLE.MEMBER], gender: 'FEMALE' },
  { key: 'lead3', name: 'Bilal Ahmed', lead: 'admin', roles: [SYSTEM_ROLE.LEAD, SYSTEM_ROLE.EVENT_LEAD, SYSTEM_ROLE.MEMBER], city: 'Islamabad' },
  // Sub-leads
  { key: 'sub1', name: 'Usman Raza', lead: 'lead1', roles: [SYSTEM_ROLE.LEAD, SYSTEM_ROLE.MEMBER] },
  { key: 'sub2', name: 'Fatima Noor', lead: 'lead2', roles: [SYSTEM_ROLE.LEAD, SYSTEM_ROLE.ONBOARDING_COORDINATOR, SYSTEM_ROLE.MEMBER], gender: 'FEMALE' },
  // Members (15)
  { key: 'm1', name: 'Ali Hassan', lead: 'lead1', roles: [SYSTEM_ROLE.MEMBER] },
  { key: 'm2', name: 'Zainab Shah', lead: 'lead1', roles: [SYSTEM_ROLE.MEMBER], gender: 'FEMALE' },
  { key: 'm3', name: 'Omar Farooq', lead: 'lead1', roles: [SYSTEM_ROLE.MEMBER] },
  { key: 'm4', name: 'Hira Javed', lead: 'sub1', roles: [SYSTEM_ROLE.MEMBER], gender: 'FEMALE' },
  { key: 'm5', name: 'Saad Khan', lead: 'sub1', roles: [SYSTEM_ROLE.MEMBER] },
  { key: 'm6', name: 'Maryam Aslam', lead: 'sub1', roles: [SYSTEM_ROLE.MEMBER], gender: 'FEMALE' },
  { key: 'm7', name: 'Hassan Ali', lead: 'lead2', roles: [SYSTEM_ROLE.MEMBER] },
  { key: 'm8', name: 'Iqra Saleem', lead: 'lead2', roles: [SYSTEM_ROLE.MEMBER], gender: 'FEMALE' },
  { key: 'm9', name: 'Talha Mehmood', lead: 'sub2', roles: [SYSTEM_ROLE.MEMBER] },
  { key: 'm10', name: 'Amna Riaz', lead: 'sub2', roles: [SYSTEM_ROLE.MEMBER], gender: 'FEMALE' },
  { key: 'm11', name: 'Fahad Nawaz', lead: 'sub2', roles: [SYSTEM_ROLE.MEMBER] },
  { key: 'm12', name: 'Rabia Anwar', lead: 'lead3', roles: [SYSTEM_ROLE.MEMBER], gender: 'FEMALE', city: 'Islamabad' },
  { key: 'm13', name: 'Danish Qureshi', lead: 'lead3', roles: [SYSTEM_ROLE.MEMBER], city: 'Islamabad' },
  { key: 'm14', name: 'Mahnoor Akhtar', lead: 'lead3', roles: [SYSTEM_ROLE.MEMBER], gender: 'FEMALE' },
  { key: 'm15', name: 'Junaid Iqbal', lead: 'lead3', roles: [SYSTEM_ROLE.AUDITOR, SYSTEM_ROLE.MEMBER] },
  // Applicants
  { key: 'applicant1', name: 'Kashif Mehdi', roles: [], status: 'PENDING_APPROVAL' },
  { key: 'applicant2', name: 'Noor Fatima', roles: [], status: 'PENDING_APPROVAL', gender: 'FEMALE' },
  { key: 'applicant3', name: 'Waqas Butt', roles: [], status: 'PENDING_NDA' },
]

const TEAMS = [
  { name: 'General', description: 'Every active member.', isGeneral: true, leads: ['admin'], members: [] as string[] },
  { name: 'Design', description: 'Posters, social media creatives and event branding.', isGeneral: false, leads: ['lead1'], members: ['sub1', 'm1', 'm4', 'm5'] },
  { name: 'Content Creation', description: 'Stories, captions and campaign copy.', isGeneral: false, leads: ['lead2'], members: ['sub2', 'm2', 'm8', 'm9', 'm10'] },
  { name: 'Donation', description: 'Donor outreach and collections.', isGeneral: false, leads: ['lead3'], members: ['m3', 'm6', 'm7', 'm11', 'm12', 'm13', 'm14', 'm15', 'finance'] },
]

function emailFor(key: string) {
  return key === 'admin' ? process.env.SEED_ADMIN_EMAIL || 'admin@kkb.test' : `${key}@kkb.test`
}

function fakeCnic(index: number) {
  const body = String(1000000 + index * 7919).slice(0, 7)
  return `35202-${body}-${index % 10}`
}

async function main() {
  // Roles and permissions
  for (const def of SEEDED_ROLES) {
    const role = await prisma.role.upsert({
      where: { name: def.name },
      create: { name: def.name, description: def.description, isSystem: true },
      update: { description: def.description, isSystem: true },
    })
    await prisma.permission.deleteMany({ where: { roleId: role.id } })
    await prisma.permission.createMany({
      data: def.grants.map((grant) => ({ roleId: role.id, module: grant.module as Module, action: grant.action as Action, scope: grant.scope as Scope })),
    })
  }
  const roles = new Map((await prisma.role.findMany()).map((role) => [role.name, role.id]))

  // NDA v1 and checklist template
  const nda = await prisma.ndaVersion.upsert({
    where: { version: 1 },
    create: { version: 1, title: NDA_V1_TITLE, body: NDA_V1_BODY, isActive: true, publishedAt: new Date() },
    update: {},
  })
  const activeNda = (await prisma.ndaVersion.findFirst({ where: { isActive: true }, orderBy: { version: 'desc' } })) ?? nda
  for (const [index, item] of DEFAULT_ONBOARDING_ITEMS.entries()) {
    const existing = await prisma.onboardingItem.findFirst({ where: item.autoKey ? { autoKey: item.autoKey } : { title: item.title } })
    if (!existing) {
      await prisma.onboardingItem.create({
        data: { title: item.title, description: 'description' in item ? item.description : null, order: index + 1, completedBy: item.completedBy, autoKey: item.autoKey },
      })
    }
  }
  const checklistItems = await prisma.onboardingItem.findMany({ where: { isActive: true }, orderBy: { order: 'asc' } })

  // People
  const passwordHash = await bcrypt.hash(PASSWORD, 12)
  const ids = new Map<string, { memberId: string; userId: string }>()
  for (const [index, person] of PEOPLE.entries()) {
    const status = person.status ?? 'ACTIVE'
    const cnic = fakeCnic(index + 1)
    const phone = `+92300${String(1000000 + index).slice(-7)}`
    const joinedAt = status === 'ACTIVE' ? new Date(Date.now() - (index < 7 ? 200 : 10 + index * 3) * 86_400_000) : null
    const user = await prisma.user.upsert({
      where: { email: emailFor(person.key) },
      create: { email: emailFor(person.key), passwordHash, emailVerifiedAt: new Date() },
      update: {},
    })
    const member = await prisma.member.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        fullName: person.name,
        gender: person.gender ?? 'MALE',
        dateOfBirth: new Date(Date.UTC(1998 + (index % 6), index % 12, 1 + (index % 27))),
        phone,
        whatsapp: phone,
        city: person.city ?? 'Lahore',
        address: `House ${index + 10}, Street ${index + 1}, UET Lahore`,
        cnicEncrypted: encryptString(cnic),
        cnicLast4: cnic.replace(/\D/g, '').slice(-4),
        institutionOrJob: 'UET Lahore',
        skills: index % 2 ? ['design', 'social media'] : ['fundraising', 'writing'],
        availabilityHoursPerWeek: 4 + (index % 6),
        emergencyName: 'Family contact',
        emergencyPhone: `+92321${String(2000000 + index).slice(-7)}`,
        howHeard: 'Friend at UET',
        status,
        joinedAt,
      },
      update: {},
    })
    ids.set(person.key, { memberId: member.id, userId: user.id })
  }

  for (const person of PEOPLE) {
    const self = ids.get(person.key)!
    if (person.lead) {
      await prisma.member.update({ where: { id: self.memberId }, data: { reportsToId: ids.get(person.lead)!.memberId } })
    }
    for (const roleName of person.roles) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: self.userId, roleId: roles.get(roleName)! } },
        create: { userId: self.userId, roleId: roles.get(roleName)!, grantedById: ids.get('admin')!.userId },
        update: {},
      })
    }
    const status = person.status ?? 'ACTIVE'
    if (status === 'ACTIVE' || status === 'PENDING_APPROVAL') {
      await prisma.ndaSignature.upsert({
        where: { memberId_ndaVersionId: { memberId: self.memberId, ndaVersionId: activeNda.id } },
        create: {
          memberId: self.memberId,
          ndaVersionId: activeNda.id,
          typedName: person.name,
          bodySha256: createHash('sha256').update(activeNda.body).digest('hex'),
          signedAt: new Date(),
          ip: '127.0.0.1',
          userAgent: 'seed',
        },
        update: {},
      })
    }
    if (status === 'ACTIVE') {
      // Older members have finished onboarding; newer ones are part-way through.
      const finished = PEOPLE.indexOf(person) < 7
      for (const [index, item] of checklistItems.entries()) {
        await prisma.onboardingProgress.upsert({
          where: { memberId_itemId: { memberId: self.memberId, itemId: item.id } },
          create: { memberId: self.memberId, itemId: item.id, doneAt: finished || index < PEOPLE.indexOf(person) % 4 ? new Date() : null },
          update: {},
        })
      }
    }
  }

  // Teams
  const activeKeys = PEOPLE.filter((person) => (person.status ?? 'ACTIVE') === 'ACTIVE').map((person) => person.key)
  for (const def of TEAMS) {
    const team = await prisma.team.upsert({
      where: { name: def.name },
      create: { name: def.name, description: def.description, isGeneral: def.isGeneral },
      update: { isGeneral: def.isGeneral },
    })
    const memberKeys = def.isGeneral ? activeKeys : [...def.leads, ...def.members]
    for (const key of memberKeys) {
      await prisma.teamMembership.upsert({
        where: { teamId_memberId: { teamId: team.id, memberId: ids.get(key)!.memberId } },
        create: { teamId: team.id, memberId: ids.get(key)!.memberId, isLead: def.leads.includes(key) },
        update: { isLead: def.leads.includes(key) },
      })
    }
  }

  console.log(`Seeded ${PEOPLE.length} people. Sign in as ${emailFor('admin')} (or lead1@kkb.test, m1@kkb.test, …) with password "${PASSWORD}".`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
