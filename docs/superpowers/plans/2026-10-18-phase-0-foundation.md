# Phase 0: Foundation & Live URL — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployable Next.js app where all four family members can log in at www.fenscloset.com, Jeff's one-time DEV password 0535 is enforced, every list is admin-editable, and the app installs to an iPhone home screen.

**Architecture:** Single Next.js 15 App Router service. Prisma + Postgres hold people, sessions, tokens, and every taxonomy list. Auth is in-house (argon2id + DB sessions + httpOnly cookie). Admin screens are driven by one generic list-CRUD component backed by a registry of Prisma delegates, so adding a list kind is a one-line registration.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind v4, Prisma 6, PostgreSQL 16, argon2, Resend, Serwist (PWA), Vitest, Playwright.

**Spec:** `docs/PLAN.md` (sections 3, 4, 5 Phase 0, 6, 7)

## Global Constraints

- Node 22, npm. Deploy target Railway (Railpack). Start command runs `prisma migrate deploy` then `next start`.
- No secrets in code. All config via env: `DATABASE_URL`, `SESSION_SECRET`, `DEV_MODE`, `RESEND_API_KEY`, `APP_URL`, `EMAIL_FROM`.
- Mobile-first: every screen works at 390px wide (iPhone 15) and at desktop widths.
- Every list (people, categories, subcategories, colors, patterns, fabrics, seasons, formality levels, occasions, tags, brands, stores, closets, check-in scales/options, rules) is editable, creatable, deletable by admins in the app.
- Login page has a visible "Forgot password" link. DEV MODE: `jeff@everbowl.com` / `0535` works exactly once, then forces a password change; a red banner shows while 0535 is active.
- Roles: `admin`, `member`, `minor`. Seed: Jeff (admin), Brittney (admin), Olivia (member, 21), Mya (minor, 15, guardians Jeff + Brittney).

## Review Focus

1. A second login attempt with 0535 after it was used must fail with the normal "wrong password" message (test in Task 5).
2. `DEV_MODE=false` must make 0535 fail even on a fresh seed (test in Task 5).
3. A non-admin (member/minor) hitting `/admin/*` must get a 403 page, not a redirect loop and not the data (test in Task 8).
4. Deleting a list entry that is in use (e.g. a category with items, a closet with items) must be blocked with a clear message rather than cascading (test in Task 7; items don't exist yet, so the guard is written against the relation count and tested with a closet that has an ItemCloset row stubbed).
5. Password reset token must be single-use and expire after 60 minutes (test in Task 6).

---

### Task 1: Project scaffold, Prisma schema, local Postgres, CI build

**Files:**
- Create: `package.json`, `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `src/app/globals.css`, `src/app/layout.tsx`, `src/app/page.tsx`, `.env.example`, `.gitignore`, `prisma/schema.prisma`, `src/lib/db.ts`, `vitest.config.ts`, `railway.json`

**Interfaces:**
- Produces: `db` (PrismaClient singleton) from `src/lib/db.ts`; Prisma models per PLAN §3 (Phase 0 subset: Person, Session, PasswordResetToken, InviteToken, GuardianLink, Category, Subcategory, Color, Pattern, Fabric, Season, FormalityLevel, Occasion, Tag, Brand, Store, Closet, CheckInScale, CheckInOption, Rule, plus Item/ItemCloset stubs needed for delete guards).

- [ ] Step 1: `npx create-next-app@latest` equivalent by hand (App Router, TS, Tailwind, src dir, no ESLint config churn). Add deps: `@prisma/client prisma argon2 resend zod @serwist/next serwist`. Dev deps: `vitest @vitest/coverage-v8 @playwright/test tsx`.
- [ ] Step 2: Write `prisma/schema.prisma` with the Phase 0 models. Person fields: `id, name, email @unique, phone?, role Role, birthdate?, avatarKey?, savedZip?, passwordHash?, mustChangePassword Boolean @default(false), devPasswordActive Boolean @default(false), devPasswordUsedAt?, status PersonStatus (active|invited|removed), createdAt`. Every list model: `id, name, sortOrder Int @default(0), isArchived Boolean @default(false), createdAt`; Color adds `hex String`; Subcategory adds `categoryId`; CheckInOption adds `scaleId`; Closet adds `ownerId?` (null = shared) and `kind ClosetKind (personal|family|custom)`; Rule is `key @unique, value String, label String, description String`.
- [ ] Step 3: `railway.json`: `{"build":{"builder":"RAILPACK"},"deploy":{"startCommand":"npx prisma migrate deploy && npm run start","healthcheckPath":"/api/health"}}`. Add `src/app/api/health/route.ts` returning `{ok:true}`.
- [ ] Step 4: Run local Postgres 16, `npx prisma migrate dev --name init`, `npm run build` passes.
- [ ] Step 5: Commit `chore: scaffold Next.js app with Prisma schema`.

### Task 2: Password hashing + session library (TDD)

**Files:**
- Create: `src/lib/auth/password.ts`, `src/lib/auth/session.ts`, `src/lib/auth/current.ts`, `tests/auth/password.test.ts`, `tests/auth/session.test.ts`

**Interfaces:**
- Produces: `hashPassword(plain: string): Promise<string>`, `verifyPassword(hash: string, plain: string): Promise<boolean>`; `createSession(personId: string, meta?: {userAgent?: string}): Promise<{token: string; expiresAt: Date}>`, `validateSession(token: string): Promise<SessionWithPerson | null>` (sliding 30-day expiry, refresh when < 15 days left), `destroySession(token: string)`; cookie name `fc_session`; `getCurrentPerson()` (server-only, reads cookie) and `requireAdmin()` which throws a `ForbiddenError`.

- [ ] Step 1: Tests: hash differs per call; verify true/false; session validates, expires, refreshes; destroy invalidates.
- [ ] Step 2: Run, expect FAIL (modules missing).
- [ ] Step 3: Implement with argon2id and Prisma; token = 32 random bytes base64url; store sha256(token) in DB, never the raw token.
- [ ] Step 4: Tests PASS. Commit `feat(auth): password hashing and DB sessions`.

### Task 3: Seed script (people, guardians, closets, all default lists, rules)

**Files:**
- Create: `prisma/seed.ts`, `prisma/seed-data.ts`, `tests/seed.test.ts`

**Interfaces:**
- Produces: `npm run db:seed` idempotent (upsert by email / by name+kind). Seeds: 4 people; GuardianLink Mya→Jeff, Mya→Brittney; personal closet per person + "Family" closet; categories (Tops, Bottoms, Dresses, Outerwear, Shoes, Purses, Hats, Belts, Jewelry, Sunglasses, Activewear, Swimwear, Sleepwear, Accessories) with subcategories; 24 colors with hex; patterns; fabrics; seasons (Spring, Summer, Fall, Winter); formality (Lounge, Casual, Smart Casual, Business, Cocktail, Formal); occasions; starter tags; brands; stores; check-in scales Tan (None, Light, Medium, Deep), Hair (Great, Fine, Bad hair day), Skin (Clear, Okay, Breakout); rules `noRepeatDays=14`, `notWornMonths=6`. When `DEV_MODE=true`, Jeff gets `passwordHash=hash("0535")`, `mustChangePassword=true`, `devPasswordActive=true`; otherwise Jeff gets no password (invite flow).

- [ ] Step 1: Test: running seed twice yields same counts; Jeff has devPasswordActive only when DEV_MODE=true.
- [ ] Step 2: Implement; wire `"prisma": {"seed": "tsx prisma/seed.ts"}`.
- [ ] Step 3: PASS. Commit `feat(db): seed people, closets, default lists, rules`.

### Task 4: UI kit + app shell + PWA

**Files:**
- Create: `src/components/ui/{button,input,label,card,banner,sheet,toast,empty}.tsx`, `src/components/app-nav.tsx`, `src/app/(app)/layout.tsx`, `src/app/(app)/today/page.tsx` (placeholder "Outfits arrive in Phase 3"), `src/app/(app)/closet/page.tsx` (placeholder), `src/app/(app)/profile/page.tsx` (placeholder), `public/manifest.webmanifest`, `public/icons/*`, `src/app/sw.ts`, `src/app/offline/page.tsx`

**Interfaces:**
- Produces: bottom tab bar on mobile (Today, Closet, Add, Shop, Profile), side rail on desktop; `<Banner tone="danger">`.

- [ ] Step 1: Build components with Tailwind; 44px min tap targets; safe-area insets.
- [ ] Step 2: Manifest: name "Fen's Closet", `display: standalone`, theme color, 192/512 icons (generated SVG→PNG with sharp script `scripts/icons.ts`). Serwist service worker with offline fallback page.
- [ ] Step 3: Playwright smoke: `/today` renders tab bar at 390×844; manifest served with correct `display`. Commit `feat(ui): app shell, components, PWA manifest and service worker`.

### Task 5: Login + DEV MODE 0535 rule + forced password change

**Files:**
- Create: `src/app/(auth)/layout.tsx`, `src/app/(auth)/login/page.tsx`, `src/app/(auth)/login/actions.ts`, `src/app/(auth)/change-password/page.tsx`, `src/app/(auth)/change-password/actions.ts`, `src/lib/auth/login.ts`, `src/lib/auth/dev-mode.ts`, `src/middleware.ts`, `tests/auth/login.test.ts`, `e2e/login.spec.ts`

**Interfaces:**
- Produces: `login(email, password, meta): Promise<{ok:true; person; usedDevPassword:boolean} | {ok:false; reason:'invalid'|'no_password'}>`; `isDevMode(): boolean` (env `DEV_MODE === 'true'`); middleware redirects unauthenticated to `/login`, and authenticated-with-`mustChangePassword` to `/change-password` for every route except `/change-password`, `/logout`, `/api/health`.

- [ ] Step 1: Tests: (a) DEV_MODE=true + fresh seed: 0535 logs Jeff in, sets `devPasswordActive=false`, `devPasswordUsedAt` set, returns `usedDevPassword=true`; (b) second 0535 attempt → `{ok:false,reason:'invalid'}`; (c) DEV_MODE=false + fresh seed → 0535 fails; (d) wrong password fails; (e) person with no passwordHash → `no_password`.
- [ ] Step 2: FAIL. Step 3: Implement; on dev password use, `console.error('[DEV-MODE] 0535 used by jeff@everbowl.com at <iso>')` so it shows in Railway logs.
- [ ] Step 4: Login page: email, password, "Forgot password?" link under the button, red banner when `isDevMode()` and Jeff's `devPasswordActive` is true: "DEV password 0535 is active for jeff@everbowl.com. It works once. Change it right after logging in." After the dev login, the app banner reads "You logged in with the one-time DEV password. Set a new password now." and middleware forces `/change-password` (new password ≥ 8 chars, not "0535").
- [ ] Step 5: e2e: dev login → forced change → lands on /today; logout; login with new password works; 0535 fails. Commit `feat(auth): login, one-time DEV password rule, forced password change`.

### Task 6: Forgot / reset password via Resend

**Files:**
- Create: `src/lib/email.ts`, `src/lib/auth/reset.ts`, `src/app/(auth)/forgot-password/page.tsx`, `.../actions.ts`, `src/app/(auth)/reset-password/[token]/page.tsx`, `.../actions.ts`, `tests/auth/reset.test.ts`

**Interfaces:**
- Produces: `sendEmail({to, subject, html, text})` (no-op + console log when `RESEND_API_KEY` unset); `createResetToken(email): Promise<string|null>` (always returns in constant-ish time; null when email unknown but UI says "If that email exists, we sent a link"); `consumeResetToken(token, newPassword): Promise<boolean>`; tokens expire 60 min, single-use, sha256 stored.

- [ ] Step 1: Tests: expired token fails; token works once; second use fails; unknown email returns null without throwing.
- [ ] Step 2: Implement + pages. Commit `feat(auth): forgot and reset password`.

### Task 7: Generic list admin (registry + CRUD + inline "+ Add")

**Files:**
- Create: `src/lib/lists/registry.ts`, `src/lib/lists/service.ts`, `src/app/(app)/admin/lists/page.tsx`, `src/app/(app)/admin/lists/[kind]/page.tsx`, `src/app/(app)/admin/lists/actions.ts`, `src/components/lists/list-editor.tsx`, `src/components/lists/inline-add.tsx`, `tests/lists/service.test.ts`

**Interfaces:**
- Produces: `LIST_KINDS` registry: `{ kind: 'category'|'subcategory'|'color'|'pattern'|'fabric'|'season'|'formality'|'occasion'|'tag'|'brand'|'store'|'closet'|'checkInScale'|'checkInOption', label, delegate, extraFields: Field[], parent?: {kind, field}, inUseCount: (id)=>Promise<number> }`; `listEntries(kind, {parentId?, includeArchived?})`, `createEntry(kind, data)`, `updateEntry(kind, id, data)`, `deleteEntry(kind, id)` → throws `InUseError(count)` when `inUseCount>0`; `reorderEntries(kind, orderedIds)`.
- `<InlineAdd kind="category" onCreated={(entry)=>…}/>` for use inside other screens (confirm card in Phase 1).

- [ ] Step 1: Tests: create/update/delete per kind; delete blocked when in use; reorder persists; parent filter works.
- [ ] Step 2: Implement; admin screen: list with drag handles (or up/down), rename in place, archive, delete with confirm, "+ Add" at top of each list.
- [ ] Step 3: Commit `feat(admin): editable lists with in-use delete guard`.

### Task 8: People admin, roles, guardians, remove flow, invite link + email

**Files:**
- Create: `src/lib/people/service.ts`, `src/lib/auth/invite.ts`, `src/app/(app)/admin/people/page.tsx`, `.../actions.ts`, `src/app/(app)/admin/people/[id]/page.tsx`, `src/app/(auth)/invite/[token]/page.tsx`, `.../actions.ts`, `src/app/(app)/admin/rules/page.tsx`, `.../actions.ts`, `src/app/forbidden/page.tsx`, `tests/people/service.test.ts`, `e2e/admin.spec.ts`

**Interfaces:**
- Produces: `createInvite({email?, phone?, name, role, guardianIds?, createdBy}): Promise<{token, url}>` (7-day expiry); `acceptInvite(token, {name, password})` → creates session; `setRole(personId, role)`, `setGuardians(minorId, parentIds)`; `removePerson(personId, {items:'delete'|'moveToFamily'})` (Phase 0: marks `status=removed`, revokes sessions; item handling implemented in Phase 1 but the choice UI exists now); `getRules()`, `setRule(key, value)`.
- `requireAdmin()` returns 403 page for member/minor.

- [ ] Step 1: Tests: invite accept creates active person with personal closet; role change; guardians; remove revokes sessions; member cannot call admin actions.
- [ ] Step 2: Screens: People list with role badges; person detail: role select, guardians (for minors), "Send invite" (email now; SMS button present but disabled with "SMS arrives in Phase 2" until Twilio keys exist), copy link; Remove → sheet asking "Delete their items or move them to the Family closet?"; Rules page with two editable numbers.
- [ ] Step 3: e2e: Jeff invites a test person, accepts in a second context, sees own closet; member visiting /admin/people gets 403. Commit `feat(admin): people, roles, guardians, invites, rules`.

### Task 9: Deploy to Railway + domain

**Files:**
- Modify: `README.md` (runbook), `.env.example`

- [ ] Step 1: Jeff's Railway project connected to GitHub `everbowl/Fenscloset`; variables set; Postgres plugged; `DEV_MODE=true`.
- [ ] Step 2: Verify `/api/health`, run seed once via `railway run npm run db:seed` (or one-shot command).
- [ ] Step 3: Custom domain `www.fenscloset.com` (CNAME at GoDaddy) + GoDaddy forwarding of bare domain → www. Verify HTTPS.
- [ ] Step 4: Phase 0 acceptance on iPhone: install to home screen; Jeff logs in with 0535 once; forced change; forgot-password email arrives; admin lists editable. Report to Jeff.
