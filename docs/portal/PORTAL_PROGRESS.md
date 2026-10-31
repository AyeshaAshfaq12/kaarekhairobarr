# KKB Member Portal — Decisions, Progress and Pending Work

Living record of how the portal described in `docs/KKB Portal — Build Spec.pdf` (the "spec") is being built.
Update this file at the end of every phase or whenever a decision changes.

- **Last updated:** 2026-10-31
- **Current phase:** Phase 1 (Foundation) done. Phase 2 (Money) not started.
- **Code:** `frontend/` (Next.js 14.2 App Router). Portal pages are in `frontend/src/app/portal`, server logic in `frontend/src/lib/portal`, schema in `frontend/prisma`.

---

## 1. Phase status

| Phase | Scope (spec §13) | Status | Notes |
|---|---|---|---|
| 1. Foundation | Auth, members, hierarchy, roles/RBAC, sign-up + NDA + approval + checklist, teams, audit log, in-app notifications (§2–5, §6.1, §11) | ✅ Done | 48 unit tests and 7 browser tests pass. See §4 for the small gaps that remain. |
| 2. Money | Cases, beneficiaries, donors, outreach, donations, verification, targets, metrics, monthly close, dashboards (§7, §9, §10.1) | ⏳ Not started | All tables already exist in the schema. |
| 3. Work and events | Tasks + Kanban, events, responsibilities, expenses, reports, Excel/PDF export, email notifications (§6.2–6.3, §8, §10.2–10.3) | ⏳ Not started | Tables exist. Email notifications already work (built early, see D14). |
| 4. WhatsApp | WhatsApp channel for notifications, then quick-logging via WhatsApp (§11.2) | ⏳ Not started | `notify()` already routes through channel adapters, so this is a new adapter only. |

---

## 2. Decisions log

Each entry records what was decided and why. "Spec" means the build spec PDF. Where the repo and the spec disagreed on tooling, the spec says to follow the repo; those cases are marked **(deviation)**.

### Architecture and tooling

- **D1. The portal lives in the existing `frontend/` Next.js app, using the App Router.** The repo already uses the App Router with a `src/` folder and the `@/*` path alias, so the portal follows the same layout.
- **D2. The public pages moved into a `(site)` route group.** `page.tsx`, `goals/` and `statistics/` now live under `src/app/(site)/`, which has its own layout with the public Header and Footer. The root layout keeps only `<html>`, `<body>` and `Providers`. URLs did not change. This lets the portal have its own mobile-first shell instead of the public header (spec §2: "the public site stays untouched").
- **D3. Database: PostgreSQL with Prisma 6** (spec assumption #1). Firebase/Firestore stays as it is for the public homepage only; the portal does not use it. Prisma 6 was chosen over 7 because 7 changes the config model. The `package.json#prisma` seed config prints a deprecation warning for Prisma 7. That's harmless for now.
- **D4. Migrations are committed** in `prisma/migrations/`. The first one, `20261031000000_portal_foundation`, creates the full §4 data model, including the Phase 2–4 tables, so later phases add columns rather than whole schemas.
- **D5. (deviation) Our own session layer instead of Auth.js.** Auth.js's Credentials provider doesn't support database sessions without workarounds, and the spec asks for both. `lib/portal/auth.ts` implements:
  - random 32-byte tokens, stored as SHA-256 in the `Session` table
  - httpOnly, `SameSite=Lax` cookies, `secure` in production
  - a 30-day sliding expiry: the middleware refreshes the cookie on each portal request, and the database expiry is extended at most once an hour
  - Admin "sign out everywhere"
  - bcrypt cost 12 via `bcryptjs`
  - single-use, hashed tokens for email verification (24 h), password reset (1 h) and invites (7 days)
- **D6. (deviation) UI uses the repo's Tailwind design system, not shadcn/ui.** It reuses the existing tokens (`cream`, `forest`, `clay`, `ink`) and component classes (`btn-*`, `field`, `label`, `surface-panel`). Portal primitives are in `components/portal/ui.tsx` and `ActionForm.tsx`.
- **D7. (deviation) Plain server-rendered tables instead of TanStack Table.** Filtering, search and pagination happen on the server through URL params, which meets the spec's intent ("filter, sort, paginate server-side") with no client-side table library. TanStack can be added in Phase 2 if the donation and verification lists need richer interaction.
- **D8. Zod validation is shared.** `lib/portal/validation.ts` has no server-only imports, so forms and server actions use the same schemas. Phones normalise to `+923XXXXXXXXX` and CNICs must match `#####-#######-#`.
- **D9. Every mutation goes through a server action.** Each action re-checks permissions on the server through `requireActiveViewer()` and `authorize()`/`assertAdmin()`. Expected failures become form state through `runAction()`. The route handlers are GET only (PDFs, the photo, cron), so there is no POST route that needs a separate CSRF check.
- **D10. File storage has an S3-compatible adapter with a local fallback.** If `S3_BUCKET` is set, files go to a private bucket and are served through 15-minute signed URLs. Otherwise they go to the gitignored `frontend/.uploads/`, which is for dev only. Types are detected from magic bytes (jpg, png, pdf only), size is capped at 5 MB, keys are random, and every download goes through `authorize()` on the parent record. The server-action body limit was raised to 6 MB to allow 5 MB uploads.
- **D11. Email goes through Resend's HTTP API with no extra dependency.** Without `RESEND_API_KEY`, emails are printed to the server log so development works with no keys.
- **D12. PDFs use `@react-pdf/renderer`.** This covers the NDA copy (§5.2) and "download my data" (§11.4).
- **D13. Jobs use Vercel Cron.** `vercel.json` calls `/api/portal/cron/purge-unverified` daily, protected by `Authorization: Bearer $CRON_SECRET`.

### Access control (spec §3)

- **D14. One `authorize(viewer, module, action, target)` helper**, in `lib/portal/rbac/index.ts`. The pure logic lives in `rbac/model.ts` so it can be unit-tested. Records describe themselves as `{ ownerIds, assignedIds, memberIds }`.
- **D15. Holding a scope also grants every narrower scope** (own < assigned < team < subtree < all). This is how the seeded Lead role gets "cases.view subtree + assigned": the schema allows only one scope per role, module and action.
- **D16. List queries are scoped in SQL.** `visibleMemberIds()` returns either `'all'` or the ids from the recursive subtree CTE (plus members of teams the viewer leads), and that list goes into the query's `WHERE id IN (…)`. Results are never filtered after fetching.
- **D17. Hierarchy uses recursive CTEs** (`fetchSubtreeIds`, `fetchAncestorIds`, `wouldCreateCycle`), cached per request with React `cache()`. `request-cache.ts` falls back to a plain call outside Next's server runtime, so tests and the seed still work.
- **D18. Roles only take effect for ACTIVE members.** Applicants, paused members and leavers get no permissions, and `requireActiveViewer()` sends them to the NDA or "awaiting approval" page.
- **D19. The hard rules (§3.4) are enforced in code, on top of permissions:**
  - Assigning roles and approving members needs an Admin or SuperAdmin role, not just the permission.
  - `ungrantable()` blocks granting any permission or scope the granter doesn't hold, both when assigning roles and when editing a role.
  - Only a SuperAdmin can grant or remove SuperAdmin (added rule; Admin holds the same permissions, so without this an Admin could promote themselves).
  - At least one active SuperAdmin must always remain. This is checked when removing roles and when offboarding.
  - CNIC, address and emergency contact are shown only to the member themselves and Admins. Profiles show only the last 4 digits of the CNIC. The full CNIC appears only in the Admin approval queue, for identity checks.
- **D20. Out-of-scope URLs return 404, not 403** (`notFound()`), so the existence of a record isn't leaked.
- **D21. Seeded roles** are defined once in `rbac/model.ts → SEEDED_ROLES` and used by both the seed and the tests. Interpretations of the spec's role table:
  - **Finance** has no `members.view`; it sees names only through joins ("no member personal data beyond names"). It gets `expenses.approve all` per §8.3.
  - **Lead** additionally gets `cases.assign subtree`, `onboarding.view/edit subtree` (for the "New members" widget and ticking the intro call), `teams.view team` and `teams.assign subtree` (to add or remove subtree members on teams they lead).
  - **Member** additionally gets `members.view/edit own`, `onboarding.view/edit own`, `teams.view own` and `tasks.create own`.
- **D22. Teams visibility:** scope `all` sees every team; any narrower scope sees only the teams the viewer belongs to.

### Onboarding and members (spec §5)

- **D23. Email verification is a button press, not a plain link.** The emailed link opens a page with a "Confirm my email" button, so link scanners can't use up the single-use token. Unverified accounts can't sign in.
- **D24. Invites pre-verify the email.** The invite link went to that inbox, so signing up through it with the same address skips the verification email.
- **D25. NDA details:**
  - The SHA-256 of the exact text shown is sent with the form and re-checked on the server. If a newer version was published in the meantime, the signature is refused.
  - The typed-name check is case-insensitive and ignores extra spaces.
  - A newly published version forces **every** active member to re-sign, including the admin who published it.
  - The signed PDF is emailed on a best-effort basis: the signature is stored first.
- **D26. Approval** requires a lead and at least one team; General is always added, and the Member role is the default. After approval or rejection the admin is redirected back to the queue with a notice, because the applicant's card disappears from the list.
- **D27. Checklist items have a `completedBy` setting (MEMBER, LEAD or SYSTEM) and an optional `autoKey`.**
  - `LEAD_INTRO_CALL` can only be ticked by the lead or someone above, never the member.
  - `FIRST_OUTREACH` is ticked by the system. The `tickAutoItem()` hook is ready; Phase 2's outreach logging must call it.
  - Built-in items can be deactivated but not deleted.
  - New template items are added to the checklists of members who joined in the last 60 days.
  - Only Admins can change the template.
- **D28. Offboarding (§5.6)** runs in one transaction with one audit entry listing every moved id:
  - donor links go to the lead, and the leaver's own links are kept, marked historical
  - open tasks are unassigned and the lead is notified
  - case assignments and open event responsibilities move to the lead
  - **(addition)** active events the leaver leads are also handed to the lead
  - direct reports are re-parented to the lead
  - targets for months after the current one are deleted
  - login is disabled and all sessions are revoked
  - team memberships are kept as history; team lists show only ACTIVE members
- **D29. Hard-deleting a REJECTED applicant** needs an Admin with `members.delete` and a reason. The audit row is written before the delete; audit rows keep their `actorId` set to null via `SetNull`.

### Audit and notifications (spec §11)

- **D30. `writeAudit(tx, …)` is called inside the same transaction as the change.** It records changed fields only and masks `cnic*`, `passwordHash` and `tokenHash`. There is no code path that updates or deletes audit rows. Logins, failed logins, sign-ups, NDA signatures, exports, marking notifications read, email preference changes and cron purges are audited too.
- **D31. `notify(userId, type, payload)` routes through channel adapters**: `InAppChannel` (always) and `EmailChannel` (respects the user's per-type opt-out in `User.emailOptOuts`). Email sends never block or roll back the caller. Phase 4 adds a `WhatsAppChannel` in the same list.

### Data and time

- **D32. Money is stored as integer PKR.** Times are stored in UTC and displayed in Asia/Karachi. `monthKey()` and `monthRange()` turn a Karachi calendar month (`YYYY-MM`, UTC+5, no daylight saving) into UTC bounds.
- **D33. "Raised" counts verified donations by the month they were received** (spec assumption #5). Each credited member gets the full amount; team and org totals count each donation once (`raisedByGroup` uses `EXISTS`, not a sum over credits). This is already used in the directory, dashboard and team pages.

### Testing

- **D34. Vitest unit tests** are in `frontend/tests`. The hierarchy CTE tests run only when `TEST_DATABASE_URL` is set, and every write is rolled back.
- **D35. Playwright browser tests** are in `frontend/e2e` and run at a 375 px viewport. They use a dedicated `E2E_DATABASE_URL` (defaulting to `TEST_DATABASE_URL`) that is **wiped and re-seeded on every run**, and they refuse to run if it equals `DATABASE_URL`. `E2E_SKIP_RESET=1` skips the reset for a database that was just created.

---

## 3. Phase 1: what was built

| Area | Where |
|---|---|
| Sign-up (every §5.1 field, optional photo, referrer, invite pre-fill), verify, login, logout, reset | `app/portal/(auth)/` |
| NDA signing, awaiting approval / rejected / paused page | `app/portal/(gate)/onboarding/` |
| App shell (desktop sidebar, mobile drawer, notification bell), permission-filtered nav | `components/portal/PortalShell.tsx`, `app/portal/(app)/layout.tsx` |
| Dashboard (my month, my teams' totals, checklist, new members, admin counts, notifications) | `app/portal/(app)/dashboard` |
| Members directory (filters, search, pagination, raised vs target), org tree | `app/portal/(app)/members` |
| Approval queue, invites | `members/pending`, `members/invite` |
| Profile tabs: Overview, Donations, Outreach, Tasks, Events, Onboarding, Activity; Admin panel (lead, teams, roles, status, sign out everywhere, mark as left, hard delete) | `members/[id]`, `members/[id]/offboard` |
| Teams (Admin create/edit/delete, leads, membership, task counts, target vs raised, activity) | `app/portal/(app)/teams` |
| Roles create/edit/delete with the permission grid | `app/portal/(app)/roles` |
| Audit log viewer (filter by actor, entity, action, date) | `app/portal/(app)/audit` |
| Notifications | `app/portal/(app)/notifications` |
| Settings: profile + photo, password, email preferences, NDA PDFs, my data PDF; org settings: minimum age, handbook link, status bands, NDA publishing, checklist template | `app/portal/(app)/settings` |
| API: member photo, NDA PDF, my data export, unverified-account purge cron | `app/api/portal/` |
| Middleware (session cookie gate and sliding refresh), security headers (CSP, HSTS, X-Frame-Options, nosniff, noindex) | `src/middleware.ts`, `next.config.js` |
| Seed: 8 roles, 4 teams, NDA v1, checklist, 1 SuperAdmin, 1 Finance, 3 leads, 2 sub-leads, 15 members over 3 levels, 2 pending applicants, 1 waiting to sign the NDA | `prisma/seed.ts` |

### Phase 1 acceptance criteria (spec §13.1) covered so far

| Criterion | Status |
|---|---|
| A lead sees their full subtree, nothing above or beside | ✅ browser + unit tests |
| A sub-lead sees only their branch | ✅ browser + unit tests |
| Granting `donations.view all` widens lists; removing it narrows them | ✅ unit test (merge logic). Lists come from the same scope on each request; the money lists themselves are Phase 2. |
| Out-of-scope URLs return 404 | ✅ browser test |
| Nobody grants a scope they don't hold | ✅ unit test + server checks |
| An unapproved account reaches only the NDA and "awaiting approval" pages | ✅ browser test |
| The NDA signature stores the text's hash; a new version forces re-signing | ✅ browser test |
| Approval requires a lead and ≥ 1 team; General is added automatically | ✅ browser test |
| Offboarding moves everything to the lead in one transaction | ✅ browser test |
| Every mutation produces an audit row | ✅ by construction (D30); spot-checked in browser tests |
| All screens work at 375 px | 🟡 Browser tests check for horizontal overflow on sign-up, approvals, members and dashboard. Not every screen has been checked by eye. |

---

## 4. Pending and open items

### Phase 1 gaps (small)

- [ ] **Nightly database backup with 30-day retention (§11.3).** This is hosting setup (Neon, Supabase or Railway point-in-time recovery), not app code. Configure it when choosing the host.
- [ ] Go through every screen by eye at 375 px. So far only automated overflow checks have run.
- [ ] Role editor edge case: when someone edits a role that contains a scope they don't hold themselves, that dropdown option is disabled, and the browser drops disabled values on submit. Saving would silently narrow the role. Only reachable by non-Admin role editors. Fix: send held-out scopes as hidden fields, or show a warning.
- [ ] The approvals notice is read from the `?notice=` URL parameter, so a crafted link could show any text there. It is escaped, so the risk is low; the fix is to look up the name by id instead.
- [ ] Team "recent activity" shows only Team audit entries. Task activity will be added in Phase 3.
- [ ] `npm audit` reports existing advisories in the dependency tree. They haven't been reviewed.

### Phase 2 (Money): next up

- [ ] Cases: CRUD, DRAFT visible to the creator and Admin only, FUNDED set automatically, cancelling requires a reason, beneficiary details restricted, assignments with notifications.
- [ ] Beneficiaries, with encrypted CNIC.
- [ ] Donors: dedupe on `phoneNormalized` and link the existing donor; non-linked members see the name only.
- [ ] Outreach quick-add (target ≤ 30 seconds on a phone), logging on behalf of subtree members, follow-up reminders, CSV bulk add. Call `tickAutoItem(tx, memberId, 'FIRST_OUTREACH')`.
- [ ] Donations: proof upload, cash note, co-credits, outreach flips to DONATED, duplicate guard, edit/delete only while PENDING.
- [ ] Verification queue: oldest first, keyboard shortcuts, bulk verify only for unique transaction refs, nobody verifies their own donation, Admin-only reopen with a reason.
- [ ] Targets: member and team, "copy last month", lead rollup.
- [ ] All §9.2 metrics and status bands (thresholds are already in Settings).
- [ ] Monthly close: `MonthlyMetric` snapshots on the 1st at 03:00 PKT, recomputed nightly for 10 days, then frozen. Note: the unique index on `MonthlyMetric` includes nullable columns, which Postgres treats as distinct, so the upsert key needs work.
- [ ] Full per-role dashboards (§10.1).
- [ ] Extend the seed: 5 cases, 40 donors, ~120 outreach records, 60 donations over 3 months.
- [ ] Unit tests for every §9.2 metric, dedupe and credit rollups; browser test for outreach → donation → verify → dashboard.

### Phase 3 (Work and events)

- [ ] Tasks: Kanban board with drag, list filters, IN_REVIEW → DONE only by a lead, comments with attachments, monthly recurrence job, overdue reminders.
- [ ] Events: creating one also creates its EVENT case; responsibilities; expenses with approval (nobody approves their own), over-budget warning, §8.4 summary.
- [ ] Reports 1–7 (§10.2), Excel (`exceljs`) and PDF exports, each audited, never including CNICs.
- [ ] Cron jobs: task due/overdue reminders, follow-up reminders, daily digest of pending donations, "monthly report ready".

### Phase 4 (WhatsApp)

- [ ] `WhatsAppChannel` (WhatsApp Cloud API) added to the `notify()` channel list. `Member.whatsapp` is already collected.
- [ ] Quick-logging outreach and donations via WhatsApp.

---

## 5. Running it

See `frontend/FRONTEND_SETUP.md` → "Member Portal". In short:

```bash
cd frontend
cp .env.example .env.local   # DATABASE_URL, CNIC_ENCRYPTION_KEY are required
npm install && npm run db:deploy && npm run db:seed && npm run dev
npm test                     # unit tests
npm run build && npm run test:e2e   # browser tests; E2E_DATABASE_URL is wiped each run
```

Seed logins: `admin@kkb.test`, `finance@kkb.test`, `lead1..3@kkb.test`, `sub1..2@kkb.test`, `m1..m15@kkb.test`, all with password `kkb-portal-dev`.

**Keys needed before deployment:** `CNIC_ENCRYPTION_KEY` (32 random bytes, base64; if lost, existing CNICs can't be decrypted), `RESEND_API_KEY` and `EMAIL_FROM`, the `S3_*` settings, `CRON_SECRET`, and `PORTAL_BASE_URL`.
