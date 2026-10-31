# KKB Member Portal — Decisions, Progress and Pending Work

Living record of how the portal described in `docs/KKB Portal — Build Spec.pdf` (the "spec") is being built.
Update this file at the end of every phase or whenever a decision changes.

- **Last updated:** 2026-10-31
- **Current state:** all four phases are built and tested. Phase 4 (WhatsApp) has not been tried against Meta's live API yet, because it needs credentials and an approved template (see §6).
- **Code:** `frontend/` (Next.js 14.2 App Router). Portal pages are in `frontend/src/app/portal`, API routes in `frontend/src/app/api/portal`, server logic in `frontend/src/lib/portal`, schema and seed in `frontend/prisma`.
- **Branches and commits:**
  - Phase 1 is on `feature/portal-phase-1` (`ec985e9`, plus docs in `29d5c44`).
  - Phases 2–4 are on `feature/portal-phases-2-4`, which branches from it: `e4cba0a` (Phases 2–3), `1655799` (Phase 4), plus this doc.

---

## 1. Phase status

| Phase | Scope (spec §13) | Status | Evidence |
|---|---|---|---|
| 1. Foundation | Auth, members, hierarchy, roles/RBAC, sign-up + NDA + approval + checklist, teams, audit log, in-app notifications (§2–5, §6.1, §11) | ✅ Done | Browser tests: onboarding, access, offboarding |
| 2. Money | Cases, beneficiaries, donors, outreach, donations, verification, targets, metrics, monthly close, dashboards (§7, §9, §10.1) | ✅ Done | Unit tests for every §9.2 metric and for dedupe; browser money flow |
| 3. Work and events | Tasks + Kanban, events, responsibilities, expenses, reports, Excel/PDF export, email notifications (§6.2–6.3, §8, §10.2–10.3) | ✅ Done | Browser event and task flows; export test |
| 4. WhatsApp | WhatsApp channel for notifications, then quick-logging outreach and donations via WhatsApp (§11.2) | ✅ Built, 🟡 not tried live | Signed-webhook browser tests; parser and signature unit tests |

**Test totals:**
- 104 unit tests in 7 files.
- 19 browser tests in 7 files, all at 375 px. They include a smoke test that opens every screen as Admin, Lead, Member and Finance.
- Each phase also passed a type-check and a production build.

**Phases 2 and 3 were committed together.** The nightly job runs task recurrence, the dashboard shows event-lead widgets, and the list pages export through the Phase 3 report system. Split apart, neither half builds on its own.

---

## 2. Decisions log

Each entry records what was decided and why. "Spec" means the build spec PDF. Where the repo and the spec disagreed on tooling, the spec says to follow the repo; those cases are marked **(deviation)**. Entries D1–D35 come from Phase 1. Some are updated with what changed later.

### Architecture and tooling

- **D1. The portal lives in the existing `frontend/` Next.js app, using the App Router**, with the repo's `src/` folder and `@/*` alias.
- **D2. The public pages moved into a `(site)` route group** with its own Header/Footer layout. URLs did not change. The portal has its own mobile-first shell.
- **D3. Database: PostgreSQL with Prisma 6** (spec assumption #1). Firebase stays for the public homepage only. Prisma 6 was chosen over 7 because 7 changes the config model. The `package.json#prisma` seed config prints a harmless deprecation warning.
- **D4. Migrations are committed** in `prisma/migrations/`:
  - `…_portal_foundation`: the full §4 model
  - `…_portal_money`: a `MonthlyMetric.key` column and follow-up reminder tracking
  - `…_portal_work_events`: task recurrence and reminder fields; expense submitter, review note and reimbursement time
  - `…_portal_whatsapp`: WhatsApp opt-in and the message log
- **D5. (deviation) Our own session layer instead of Auth.js**, because the Credentials provider doesn't support database sessions. Details:
  - random tokens, stored hashed in `Session`
  - httpOnly, `SameSite=Lax` cookies, `secure` in production
  - a 30-day sliding expiry and Admin "sign out everywhere"
  - bcrypt cost 12
  - single-use hashed tokens for email verification (24 h), password reset (1 h) and invites (7 days)
  - **Updated:** the middleware no longer refreshes the cookie on Next.js link-prefetch requests (see D58).
- **D6. (deviation) The UI uses the repo's Tailwind design system, not shadcn/ui.**
- **D7. (deviation) Plain server-rendered tables instead of TanStack Table.** Filtering and pagination go through URL params on the server. This was still enough through Phase 3, so TanStack was never added.
- **D8. Zod validation is shared** between forms and server actions (`lib/portal/validation.ts`).
- **D9. Every mutation goes through a server action** that re-checks permissions on the server. **Updated:** there is now one POST route handler, the WhatsApp webhook. It is authenticated by Meta's `X-Hub-Signature-256` HMAC, which serves as its CSRF/authenticity check (§11.3).
- **D10. File storage is an S3-compatible private bucket** with 15-minute signed URLs, falling back to the gitignored `frontend/.uploads/` in development.
  - File type is detected from magic bytes; 5 MB maximum.
  - Every download is authorized against its parent record: member photo, donation proof, beneficiary document, expense receipt, task attachment.
- **D11. Email goes through Resend's HTTP API.** Without a key, emails are printed to the server log.
- **D12. PDFs use `@react-pdf/renderer`.** They cover the NDA copy, "download my data", report exports and the event summary.
- **D13. Jobs run on Vercel Cron** (`vercel.json`), each protected by `Authorization: Bearer $CRON_SECRET`:
  - `nightly`, 22:00 UTC = 03:00 PKT: monthly close, the pending-donation digest, and recurring tasks.
  - `morning`, 03:00 UTC = 08:00 PKT: follow-ups due today, and tasks due tomorrow or overdue.
  - `purge-unverified`, daily.

### Access control (spec §3)

- **D14. One `authorize(viewer, module, action, target)` helper** handles single records. **List pages turn the same scopes into Prisma `WHERE` clauses**:
  - `donorWhere`, `donationWhere`, `caseWhere` and `outreachWhere` in `lib/portal/money.ts`
  - `taskWhere` in `tasks.ts` and `eventWhere` in `events.ts`
  - The subtree comes from the recursive CTE; nothing is filtered after fetching.
- **D15. Holding a scope also grants every narrower scope** (own < assigned < team < subtree < all).
- **D16. List queries are scoped in SQL.** (See D14.)
- **D17. Hierarchy uses recursive CTEs**, cached per request.
- **D18. Roles only take effect for ACTIVE members.** `viewerForUser()` applies the same rule to WhatsApp senders, who have no browser session.
- **D19. The hard rules (§3.4) are enforced in code:**
  - Only Admin or SuperAdmin can assign roles and approve members.
  - Nobody can grant beyond what they hold.
  - Only a SuperAdmin can grant or remove SuperAdmin, and at least one must always remain.
  - CNIC, address and emergency contact are shown only to the member and Admins.
  - **Phase 2:** nobody can verify a donation they logged or are credited on.
  - **Phase 3:** nobody can approve an expense they submitted or paid.
  - Verified donations and approved expenses are locked; only an Admin can reopen them, with a reason.
- **D20. Out-of-scope URLs return 404, not 403.**
- **D21. Seeded roles** are defined once in `rbac/model.ts → SEEDED_ROLES`. The interpretations of the spec's role table are unchanged; see the Phase 1 notes in git history.
- **D22. Teams visibility:** scope `all` sees every team; narrower scopes see only the teams the viewer belongs to.

### Onboarding and members (spec §5)

- **D23.** Email verification is a button press, so link scanners can't use up the single-use token.
- **D24.** Signing up through an invite pre-verifies the email.
- **D25. The NDA:**
  - the text's hash is re-checked on the server
  - the typed-name check ignores case and extra spaces
  - a new version forces every active member to re-sign, Admins included
- **D26.** Approval needs a lead and at least one team; General is added automatically.
- **D27. Checklist items have a completer (MEMBER, LEAD or SYSTEM).** **Updated:** `FIRST_OUTREACH` now ticks itself through `createOutreach()`, from the portal, bulk import and WhatsApp.
- **D28. Offboarding moves work to the lead in one transaction** with one audit entry. As an addition, active events the leaver leads are handed over too.
- **D29.** An Admin can hard-delete a REJECTED applicant, with a reason.

### Audit and notifications (spec §11)

- **D30. `writeAudit(tx, …)` runs in the same transaction as each change.** It records changed fields only and masks sensitive ones. Exports, logins and cron purges are audited too.
- **D31. `notify()` routes through channel adapters:** `InAppChannel`, `EmailChannel` and, since Phase 4, `WhatsAppChannel`. Callers never changed.

### Data and time

- **D32.** Money is stored as integer PKR. Times are stored in UTC and displayed in Asia/Karachi; months are Karachi calendar months.
- **D33. "Raised" counts verified donations by the month they were received.**
  - Each credited member gets the full amount.
  - Group totals count each donation once.

### Testing

- **D34. Vitest unit tests** are in `frontend/tests`. The database-backed suites (`*.db.test.ts`) run only when `TEST_DATABASE_URL` is set, and every write is rolled back.
- **D35. Playwright browser tests** are in `frontend/e2e` at 375 px, on a dedicated `E2E_DATABASE_URL` that is **wiped and re-seeded every run**. `E2E_SKIP_RESET=1` is for a database that was just created.
  - Prisma refuses `migrate reset` when an AI agent runs it, so agent runs use fresh databases instead.

### Phase 2: money (spec §7, §9, §10.1)

- **D36. Metrics are pure functions over scoped rows** (`metrics-core.ts`), not SQL aggregates.
  - The server layer (`metrics.ts`) loads one month's outreach and non-rejected donations for a member set, then computes.
  - This gives one definition of each §9.2 metric, unit-tested directly, which is fast enough at 50–100 members.
  - Group rollups pass the whole member set, so a donation counts once, and Reached/Converted are distinct donors across the group (§9.3).
- **D37. "Repeat donors"** = converted donors with a verified donation in any earlier month, from any member. The spec doesn't say whether "earlier" means with this member, so this reads it organisation-wide.
- **D38. Snapshots are keyed by a string.**
  - `MonthlyMetric.key` = `<month>:<scope>:<id|org>`, because a compound unique index over nullable columns doesn't work in Postgres.
  - The nightly job writes the previous month's snapshots on days 1–10 and freezes them on day 11. Frozen rows never change.
  - Reports and the org/team trend read frozen snapshots for closed months; the current month is always live (§9.4).
  - `/api/portal/cron/nightly?at=<ISO>` replays the job as of any moment, for backfills. It needs the same cron secret.
- **D39. Case visibility (§7.1):**
  - Every active member sees OPEN and FUNDED summaries.
  - A DRAFT is visible only to its creator and Admins.
  - Other statuses follow `cases.view`.
  - Beneficiary details (with the decrypted CNIC) are shown only to assigned members, the creator and Admins.
  - Event cases are edited only through their event.
  - FUNDED is set automatically when verified ≥ target, and reverts to OPEN if a reopen drops it below.
- **D40. Donors:**
  - visible through donor links (the members linked, everyone above them, and all-scope roles)
  - deduplicated on the normalised phone, which links the existing donor
  - the creator's "how you know them" note is shown only to the creator, people above them and all-scope roles, and is never sent to others' browsers, not even as a hidden field
- **D41. Outreach uses the `donors` module's scopes**, because the spec has no separate outreach module.
  - The quick-add form is one screen: an instant donor search with inline creation, and one-tap channel and outcome buttons. The browser test logs one in well under 30 seconds.
  - Leads can log on behalf of their subtree.
  - Bulk add takes pasted lines or a CSV file of `name, phone, outcome`.
- **D42. Donations (§7.4):**
  - A payment screenshot is required unless the method is cash; cash needs a note on who received it.
  - Co-credits must be members who also approached the donor, through a donor link or an outreach record.
  - The duplicate guard warns on the same transaction ref, or the same donor, amount and Karachi day, and requires ticking "Log anyway".
  - Edit and delete follow the spec's people rule (logger, credited members, their leads, Admin) regardless of role, and only while the donation isn't verified.
  - Editing a REJECTED donation resubmits it as PENDING.
  - The donor can't be changed after logging; delete the donation and log it again.
- **D43. Verification queue (§7.5):**
  - Oldest first, with the proof inline and keyboard shortcuts: V verify, R reject, N next.
  - The viewer's own donations are excluded.
  - Bulk verify only works for refs that no other non-rejected donation uses, and it checks every selected donation before verifying any.
- **D44. Targets (§9.1):**
  - Leads set targets for their subtree but not for themselves; Admin sets anyone's and the team targets.
  - "Copy last month" never overwrites a target already set.
  - Saving an empty amount removes the target.
- **D45. Dashboards (§10.1) pick widgets by role:**
  - Lead widgets show when the viewer's subtree has anyone else in it.
  - The Finance panel shows for anyone with `donations.verify` who isn't an Admin.
  - Event-lead widgets show when the viewer leads, or has a responsibility on, an active event.
  - "Inactive 30+ days" means an active member with no outreach, credited donation or task update in 30 days.

### Phase 3: work, events, reports (spec §6.2–6.3, §8, §10.2–10.3)

- **D46. Task visibility:**
  - `own` = assigned to me or created by me
  - `team` = plus every task in teams I lead
  - `subtree` = plus tasks assigned to my subtree
- **D47. Task editing:**
  - The team lead, Admin or the task's creator can edit everything; the assignee can change status and comment.
  - Members can create tasks only for themselves, in their own teams.
  - IN_REVIEW → DONE is team-lead only.
  - Due dates are the end of the chosen day in Karachi.
- **D48. Recurring tasks are a series.** Each month the newest task in a series is copied with the same day of the month and points back to the first task (`recurrenceSourceId`). Only the newest copy carries `recurringMonthly`, and the job is idempotent.
- **D49. Kanban board:** columns are statuses, drag-and-drop on desktop, and a per-card status menu on phones, where HTML5 drag doesn't work. Moves update instantly and roll back if the server refuses.
- **D50. Events:**
  - Creating an event creates its EVENT case in the same transaction; editing the collection target updates the case.
  - Completing or cancelling the event closes or cancels the case.
  - Event visibility follows `eventWhere`. **Expense approvers (Finance) see all events**, because approval happens on the event page and Finance has no `events.view` otherwise.
  - The event's lead manages it by being its lead, whatever their role. Only an Admin can change the lead.
- **D51. Expenses (§8.3):**
  - The event lead or a member with a responsibility on the event logs them, with a receipt required.
  - Approval needs `expenses.approve`, never on your own expense (submitted or paid by you).
  - When approved + submitted exceeds the budget, approval needs a note, which is stored as `reviewNote`.
  - REIMBURSED comes after APPROVED.
  - **(deviation)** Unapproved expenses can be withdrawn and resubmitted rather than edited.
- **D52. Reports use one builder per report** (`lib/portal/reports.ts`), which returns plain tables. The page, the Excel export (`exceljs`) and the PDF export render the same rows, so exports match the screen exactly (§10.3).
  - The scope picker offers only what the viewer can see: self, subtrees within reach, teams they lead, and the org for all-scope roles.
  - Export needs `<module>.export` or `reports.export`. A member can always export their own month, and anyone who can see an event can download its summary PDF.
  - Every export is audited with the report, scope, period, row count and query.
  - CNICs are never in any export. Phones appear only in the donors export, matching what those viewers already see.
- **D53. Reminders are idempotent.** Outreach `followUpNotifiedAt` and task `dueReminderSentAt` / `overdueNotifiedAt` record what was sent. Changing a task's due date re-arms its reminders.

### Phase 4: WhatsApp (spec §11.2)

- **D54. WhatsApp is off by default at two levels.**
  - Organisation: nothing is sent or accepted unless `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are set.
  - Member: each member must opt in under Settings → WhatsApp, and can turn off individual notification types (`whatsappOptOuts`).
- **D55. Notifications use an approved template** (`WHATSAPP_TEMPLATE`, with body parameters `{{1}}` title and `{{2}}` details plus link), so they work outside WhatsApp's 24-hour window. Command replies are free text, which is allowed because the member has just messaged.
- **D56. Inbound identity is the sender's number.**
  - It must match an ACTIVE, opted-in member's registered WhatsApp number, or their phone when no WhatsApp number is set.
  - Members with an outstanding NDA are refused.
  - The webhook checks Meta's HMAC signature, and messages are deduplicated on the WhatsApp message id.
- **D57. Commands** are parsed by a pure, unit-tested parser (`whatsapp-commands.ts`):
  - `help` and `cases` (open cases, numbered by creation order).
  - `outreach <phone> <outcome> [amount] [name]`.
  - `donation <phone> <amount> <method> [ref] #<case>`, where non-cash donations must arrive as the caption of the screenshot, which is downloaded and stored like a portal upload.
  - Logging goes through the same domain functions as the portal: dedupe, `FIRST_OUTREACH`, outreach→DONATED, the duplicate guard, and audit.
  - Inbound and outbound messages are logged in `WhatsAppMessage`; Admins see the last 20 in Organisation settings.

### Fixes found by testing (worth knowing)

- **D58. Prisma treats `OR: [{}, …]` as false, not "match all".** An unrestricted scope filter (`{}`) inside `OR` silently hid records from all-scope users like Admin and Finance. `anyOf()` in `money.ts` short-circuits to `{}` when any filter is empty; use it whenever scope filters are combined with OR.
- **D59. Next.js link prefetches no longer touch the session cookie.** A late prefetch response could re-set a cookie the test had just cleared. Real logouts were never affected, because logout deletes the session server-side.
- **D60. Cards get `min-w-0`.** Without it, wide tables inside grid cells stretched pages past 375 px. The smoke test caught it.
- **D61. Forms that disappear after submitting** (approving the last applicant, moving a task) can't show their own toast. The approvals page redirects with a notice instead; task status moves use one stable form.

---

## 3. What was built, by area

| Area | Where |
|---|---|
| Sign-up, verify, login, reset; NDA and awaiting-approval gate | `app/portal/(auth)/`, `app/portal/(gate)/` |
| Shell and role-filtered navigation (with badges for approvals, verification and expenses) | `components/portal/PortalShell.tsx`, `app/portal/(app)/layout.tsx` |
| Dashboard: Me, Subtree (table, 6-month trend, pending, new members, team Kanban), My events, Finance, Organisation (12-month trend, teams compared, inactive members) | `app/portal/(app)/dashboard`, `components/portal/DashboardWidgets.tsx`, `EventLeadPanel.tsx`, `TrendChart.tsx` |
| Members, approvals, invites, profiles, offboarding; teams; roles; audit; notifications; settings | `app/portal/(app)/{members,teams,roles,audit,notifications,settings}` |
| Cases (list, create/edit, status, assignments, beneficiary, documents) | `app/portal/(app)/cases` |
| Donors and outreach (quick add, bulk CSV, follow-ups due) | `app/portal/(app)/{donors,outreach}` |
| Donations (log, list, detail/edit/resubmit/delete, proof) and the verification queue | `app/portal/(app)/donations` |
| Targets (member and team, copy last month, rollup) | `app/portal/(app)/targets` |
| Tasks (list filters, Kanban, detail, comments with attachments, recurrence) | `app/portal/(app)/tasks` |
| Events (create with EVENT case, summary, responsibilities, collections by member, expenses) and the expense queue | `app/portal/(app)/{events,expenses}` |
| Reports 1–7 plus list exports (members, donors, outreach, donations, tasks) as Excel and PDF | `app/portal/(app)/reports`, `app/api/portal/export/[report]`, `lib/portal/{reports,export,export-pdf}.ts` |
| Cron: nightly, morning, purge-unverified | `app/api/portal/cron/*`, `lib/portal/cron.ts` |
| WhatsApp: channel, webhook, settings, message log | `lib/portal/whatsapp*.ts`, `app/api/portal/whatsapp/webhook` |
| Seed: people/roles/teams (Phase 1) plus 6 cases, 40 donors, 120 outreach records, 63 donations, targets, 19 tasks and an event with expenses | `prisma/seed.ts`, `prisma/seed-work.ts` |

---

## 4. Acceptance criteria (spec §13.1)

| Criterion | Status | How it's checked |
|---|---|---|
| A member sees only their own donors, donations, outreach and metrics | ✅ | Scoped `WHERE`s (D14); `access` and `smoke` browser tests |
| A lead sees their full subtree at any depth, nothing about their lead or sibling leads | ✅ | `access` browser test, CTE unit tests |
| A sub-lead sees only their branch | ✅ | `access` browser test, rbac unit tests |
| Granting `donations.view all` widens lists, dashboards and exports; removing it narrows them | ✅ | Every list, dashboard and export is built from the viewer's current permissions on each request; unit test of the merge |
| Out-of-scope URLs return 404 | ✅ | `access` browser test |
| Nobody grants a scope they don't hold; nobody verifies their own donation or approves their own expense | ✅ | rbac unit tests; `money` and `work` browser tests |
| An unapproved account reaches only the NDA and awaiting-approval pages | ✅ | `onboarding` browser test |
| The NDA stores the text's hash; a new version forces re-signing | ✅ | `onboarding` browser test |
| Approval requires a lead and ≥ 1 team; General is auto-added | ✅ | `onboarding` browser test |
| Offboarding moves everything to the lead in one transaction | ✅ | `offboarding` browser test |
| A pending donation never appears in Raised, Achievement or case progress | ✅ | metrics unit tests; case progress shows pending as a separate lighter bar |
| A co-credited donation counts in full for each member but once for team/org totals | ✅ | metrics unit tests |
| A donor with an existing phone is linked, not duplicated | ✅ | `money.db` unit test; `money` browser test |
| Verified donations and approved expenses can't be edited except by an Admin reopen with a reason | ✅ | Server checks; the `money` browser test checks the edit form disappears |
| Creating an event creates its EVENT case; the summary matches §8.4 | ✅ | `work` browser test; summary unit test |
| Conversion and achievement match §9.2 on test data | ✅ | metrics unit tests |
| Excel/PDF exports contain exactly the rows on screen and never CNICs | ✅ | Shared builders (D52); export browser test |
| Closed months read from frozen snapshots | ✅ | Reports and trends read frozen rows (D38); the snapshot job was replayed against the dev database |
| Every mutation produces an audit row | ✅ | Every action uses `writeAudit` in its transaction; spot-checked in browser tests |
| All screens work at 375 px | ✅ | `smoke` browser test covers every screen for four roles (status 200, no horizontal overflow). It checks for broken layouts, not visual polish. |
| Logging an outreach on a phone takes ≤ 30 seconds | ✅ | `money` browser test times the quick add |

---

## 5. Running it

See `frontend/FRONTEND_SETUP.md` → "Member Portal". In short:

```bash
cd frontend
cp .env.example .env.local    # DATABASE_URL and CNIC_ENCRYPTION_KEY are required
npm install && npm run db:deploy && npm run db:seed && npm run dev
npm test                      # unit tests (set TEST_DATABASE_URL for the DB-backed suites)
npm run build && npm run test:e2e   # browser tests; E2E_DATABASE_URL is WIPED each run
```

Seed logins (password `kkb-portal-dev`):
- `admin@kkb.test` (SuperAdmin)
- `finance@kkb.test`
- `lead1..3@kkb.test` (lead3 also leads the seeded event)
- `sub1..2@kkb.test`
- `m1..m15@kkb.test` (m15 is also an Auditor)

**Before deploying, configure:**
- `CNIC_ENCRYPTION_KEY`: keep it safe; losing it makes stored CNICs unreadable.
- `PORTAL_BASE_URL`
- `RESEND_API_KEY` and `EMAIL_FROM`
- the `S3_*` settings
- `CRON_SECRET`
- the `WHATSAPP_*` settings, if WhatsApp is wanted. Point Meta's webhook at `/api/portal/whatsapp/webhook`.

---

## 6. Pending and open items

### Needs someone outside the code

- [ ] **WhatsApp go-live:** create the Meta app and phone number, get the notification template approved, set the `WHATSAPP_*` variables, and point the webhook at the portal. It is tested only against signed fake payloads; nothing has been sent or received through Meta yet.
- [ ] **Nightly database backup with 30-day retention (§11.3):** a hosting setting, e.g. Neon/Supabase point-in-time recovery.
- [ ] **NDA text review by a lawyer** (spec §12 says to have it reviewed).

### Known limitations and small gaps

- [ ] WhatsApp case numbers follow creation order among open cases, so they shift when a case closes. Members should send `cases` before logging a donation.
- [ ] Team totals for a month that isn't frozen yet use current team membership. Frozen snapshots keep the membership as it was at closing.
- [ ] The subtree trend on the lead dashboard is always computed live, because there are no subtree snapshots, only member, team and org ones.
- [ ] Reports are monthly. Only the donations ledger accepts a from/to date range.
- [ ] A donation's donor can't be changed after logging (delete and log again). Expenses are withdrawn and resubmitted rather than edited (D51).
- [ ] Seeded expenses point to a placeholder receipt file that doesn't exist, so their receipt links 404 in demo data. Real uploads work.
- [ ] Role editor edge case: when a non-Admin role editor saves a role containing a scope they don't hold, that disabled option is dropped, silently narrowing the role.
- [ ] The approvals notice is read from the `?notice=` URL parameter. The text is escaped, but any text can be shown.
- [ ] Dashboards compute metrics on every request. That's fine for 50–100 members; add caching if it grows a lot.
- [ ] No ESLint configuration in the repo, so `next lint` isn't part of the checks.
- [ ] `npm audit` reports existing advisories in the dependency tree. They haven't been reviewed.
- [ ] The Prisma 7 deprecation warning about `package.json#prisma` (D3).

### Ideas, not requested

- A leaderboard page beyond the subtree table on the lead dashboard.
- Daily email digests instead of one email per notification.
