# Review A — auth, people, admin, email/SMS, crypto, proxy

Scope read line-by-line: `src/lib/auth/**`, `src/lib/people/**`, `src/lib/email.ts`, `src/lib/sms.ts`, `src/lib/crypto.ts`, `src/app/(auth)/**`, `src/app/(app)/admin/**`, `src/app/(app)/view-actions.ts`, `src/proxy.ts` (no `middleware.ts` exists), every `src/app/api` route that touches a session (only `photo` and `health` are relevant; the import/upload/google routes just call `getCurrentPerson`), `prisma/schema.prisma`, plus every component, layout, seed, script, test and build artifact those files depend on. No file was edited. (The DEV admin's address is written as `DEV_ADMIN_EMAIL` throughout; it is the constant in `src/lib/auth/dev-mode.ts:6`.)

Severity key: **breaks** (a family member cannot finish), **wrong** (does the wrong thing), **slow**, **unsafe**, **dead-end** (tap, no feedback), **dead-code**.

---

## 1. Most likely causes of last night's failures

### A1. Sign-in on the second phone: 0535 is single-use and the login page never says so
- `src/lib/auth/login.ts:23` returns `reason: "invalid"` when `passwordHash` is null and `devPasswordUsedAt` is set; `src/app/(auth)/login/actions.ts:21` turns that into "That email and password don't match."
- **Severity:** dead-end (this is the exact shape of "a sign-in that did not go through on a second phone").
- **Path:** Jeff signs in with 0535 on phone 1 (hash is cleared at `login.ts:35-37`), then types 0535 on phone 2 → "don't match", no hint. Worse: until he finishes `/change-password` on phone 1 the account has **no password at all**, so phone 2 cannot sign in with anything.
- **Fix:** return a distinct reason (e.g. `"dev_used"`) for the DEV admin when `devPasswordUsedAt` is set and no hash exists, and show "0535 was already used on another phone — finish setting the password there, or tap Forgot password."

### A2. "Sign out instead" on the forced-change screen can lock the admin out
- `src/app/(auth)/change-password/page.tsx:26` shows "Sign out instead" while `person.mustChangePassword` is true; at that moment `passwordHash` is null (`login.ts:37`).
- **Severity:** dead-end / breaks.
- **Path:** Jeff taps "Sign out instead" to try the other phone → no password, 0535 dead, Forgot password needs `RESEND_API_KEY` (see A3). Only `npm run db:reset-dev-password` on the server recovers.
- **Fix:** hide the sign-out button (or warn) when the person has no hash; or keep the old hash until the new password is saved.

### A3. "Forgot password" says the link is on its way even when no email can be sent
- `src/lib/auth/reset.ts:31` ignores `sendEmail`'s `{ sent: false }`; `src/app/(auth)/forgot-password/actions.ts:10-11` returns `done: true`; `form.tsx:16-18` shows "a reset link is on its way".
- With `RESEND_API_KEY` unset, `src/lib/email.ts:13` writes the full reset URL (token included) to the server log instead. Same pattern for SMS at `src/lib/sms.ts:19`.
- **Severity:** dead-end + unsafe (reset/invite tokens in production logs).
- **Fix:** propagate `sent`; when the failure is configuration show "Email isn't set up on the site yet — ask Jeff"; only log message bodies when `NODE_ENV !== "production"`.

### A4. Secure cookie dropped over plain http looks like "login did nothing"
- `src/lib/auth/current.ts:53` sets `secure` in production (correct). If a phone reaches the site over `http://` (typed URL, Railway internal hostname, LAN), Safari discards the `Set-Cookie`; the action redirects to `/today`, `src/proxy.ts:10-14` finds no cookie and bounces to `/login` with no message.
- **Severity:** dead-end.
- **Fix:** in the proxy, redirect `http` → `https` (check `x-forwarded-proto`); in `loginAction`, if the request is not https return an error instead of setting a cookie that will be dropped.

### A5. Dead buttons after a deploy (adjacent to my area, read because the layout mounts it)
- `src/lib/sw-source.ts:11-15` `skipWaiting` + `clients.claim` + deletes every old cache on activate; `src/components/sw-registrar.tsx` never reloads on `controllerchange`. A page opened before the deploy keeps old hashed chunk URLs and old Server Action IDs; the new container serves neither (Next answers `Failed to find Server Action … older or newer deployment`, `node_modules/next/dist/server/app-render/manifests-singleton.js:60`). Every tap that needs a lazy chunk or an action does nothing.
- **Severity:** breaks (after each deploy, for any phone that had the PWA open).
- **Fix:** listen for `controllerchange` and `location.reload()`; catch `ChunkLoadError` and the stale-action error in `(app)/error.tsx` → reload once; optionally keep the previous cache for one version.

---

## 2. Security / privacy

### S1. No rate limiting on sign-in, and the admin email is pre-filled for every visitor while DEV_MODE is on
- `src/lib/auth/login.ts:18-31`, `src/app/(auth)/login/actions.ts:9-27`: no attempt counter, no delay. `src/app/(auth)/login/page.tsx:19` passes `prefillEmail={isDevMode() ? DEV_ADMIN_EMAIL : undefined}` to a public page.
- **Severity:** unsafe (high while DEV_MODE=true). 0535 is a 4-digit code: 10,000 guesses with no throttle lets an outsider consume the one-time password, be forced to set their own, and own the admin account. `forgot-password` is equally unthrottled (email bombing).
- **Fix:** per-IP+email attempt limit (e.g. 5 per 15 min, a small `LoginAttempt` table or in-memory map with backoff), the same on `forgotPasswordAction`; stop pre-filling the admin email publicly.

### S2. Two phones can both consume 0535
- `src/lib/auth/login.ts:30-37`: `verifyPassword` then an unconditional `update`. Two simultaneous 0535 logins both pass verify before either update runs → two sessions, both `usedDevPassword`.
- **Severity:** unsafe (low likelihood, but it is the "two phones" scenario).
- **Fix:** `updateMany({ where: { id, devPasswordActive: true }, data: … })` and treat `count !== 1` as invalid.

### S3. Admin pages are gated only by the layout
- `src/app/(app)/admin/layout.tsx:5-6` renders `<Forbidden/>` for non-admins, but `admin/people/page.tsx`, `admin/lists/page.tsx`, `admin/lists/[kind]/page.tsx` and `admin/rules/page.tsx` never call `requireAdmin`. Next renders layout and page segments in parallel, so a member requesting `/admin/people` still executes `listPeople()` (names, emails, phones, DEV flag) and the page segment is produced server-side; Next's own auth guide says not to rely on a layout check alone.
- **Severity:** unsafe (medium).
- **Fix:** `await requireAdmin()` as the first line of every admin page, and inside `listPeople`/`getRules`-style data helpers where cheap.

### S4. `requireAdmin` throws an error nothing catches
- `src/lib/auth/current.ts:39-44` comment says "pages catch it and render the 403 page"; no page does (`admin/people/[id]/page.tsx:10`). A non-admin at that URL produces the generic "Something slipped" boundary or a server-side unhandled error (the admin layout hides `children`, so the thrown page segment has no visible boundary).
- **Severity:** wrong / dead-code (stale comment).
- **Fix:** make `requireAdmin` call `notFound()`/`forbidden()` or return a result the page renders as `<Forbidden/>`.

### S5. Changing an adult to `minor` keeps the grants they gave
- `src/lib/people/service.ts:51-59` deletes guardian links when leaving `minor`, but on entering `minor` does not delete `BodyDataGrant`/`ShopForGrant` rows where `ownerId = id`; `src/lib/people/visibility.ts:73-76` only blocks *new* grants. A non-parent member keeps seeing the now-minor's body data and shopping for them. Also no guardian is required when switching to `minor` (the editor only shows checkboxes afterwards).
- **Severity:** unsafe (privacy rule: a minor's body data goes only to the minor and parents).
- **Fix:** on role → minor, delete both grant tables for that owner inside the same transaction and require at least one guardian.

### S6. Removing a person leaves their body data behind
- `src/lib/people/service.ts:84-99`: Person is kept as `removed`, so cascades never fire; `BodyPhoto` rows and bucket objects, `BodyMeasurement`, `BodyProfile`, check-in selfies, inspiration photos all remain.
- **Severity:** unsafe (a removed minor's body photos stay in the bucket indefinitely).
- **Fix:** delete body tables and `deleteObject` each `BodyPhoto.bucketKey` (as `setMinorBodyImageApproval` already does at `src/lib/profiles/service.ts:250-252`).

### S7. `createInvite` trusts client-supplied guardian ids and rewrites contact info before acceptance
- `src/lib/auth/invite.ts:30-45`: `guardianIds` are stored unchecked (not verified to be active admins; `setGuardians` does check at `service.ts:64`); with `personId` the person's `email`/`phone` are overwritten at invite creation, so a typo replaces the real login email immediately, and a duplicate email throws a raw Prisma P2002 that `people/actions.ts:38 msg(e)` shows verbatim, leaving an orphan `InviteToken`.
- **Severity:** wrong.
- **Fix:** validate guardians against `role: admin, status != removed`; apply email/phone at accept time (or catch P2002 with a friendly message and delete the token).

### S8. `canGrantBodyAccess` says yes for an unknown owner
- `src/lib/people/visibility.ts:73-76`: `owner?.role !== "minor"` is `true` when `owner` is null.
- **Severity:** wrong (low). **Fix:** `return owner ? owner.role !== "minor" : false`.

### S9. HTML injection in invite emails
- `src/lib/email.ts:33-35` interpolates `heading` (contains the admin-typed name) and `body` into HTML unescaped.
- **Severity:** unsafe (low; admin-controlled). **Fix:** escape `<>&"` in `heading`/`body`.

### S10. Unauthenticated `/api/*` calls get a 302 to HTML
- `src/proxy.ts:4,10-14`: everything but `/api/health` is redirected to `/login`; a client `fetch` to `/api/import/*` or `/api/uploads/*` after session expiry receives HTML, not 401.
- **Severity:** wrong (low). **Fix:** for `pathname.startsWith("/api/")` return `401 JSON` instead of redirecting.

### S11. User enumeration (low)
- `src/app/(auth)/login/actions.ts:19-20` "This account doesn't have a password yet…" confirms an email belongs to the family; `login.ts:20-31` returns fast for unknown emails and slow (argon2) for known ones.
- **Fix:** one message and a constant-time dummy verify for unknown emails. Acceptable for a family app, but it compounds S1.

### Things that are correct
- DEV MODE rule as specified: `login.ts:26-41` honours 0535 only for `DEV_ADMIN_EMAIL` while `DEV_MODE=true`, consumes it in one update (hash nulled, `devPasswordUsedAt` set, `mustChangePassword` on); `seed.ts:63-73` seeds it only in DEV mode and only when no hash exists; `scripts/reset-dev-password.ts:13` refuses outside DEV mode; `validateNewPassword` (`change-password.ts:9`) refuses 0535 as a new password; `DevModeBanner` (`dev-mode-banner.tsx:6-15`) shows exactly while `devPasswordActive` is true and disappears after use; the `(app)` and `(flow)` layouts (`layout.tsx:20`, `(flow)/layout.tsx:9`) and `redirectIfSignedIn` (`login/actions.ts:37`) force `/change-password`. Unit tests (`tests/auth/login.test.ts`) and the e2e (`e2e/login.spec.ts`) cover this.
- Tokens: 32 random bytes base64url, only the sha256 is stored (`tokens.ts`), lookup by hash via unique index (timing-safe by construction), single use via conditional `updateMany` + count check (`reset.ts:44-45`, `invite.ts:80-81`), expiry 60 min / 7 days, invite rolled back on failure (`invite.ts:105`). Reset signs out every other session (`reset.ts:48`); change-password keeps only the current one (`change-password/actions.ts:21-22`).
- Cookies: `httpOnly`, `sameSite: lax`, `secure` in production, `path: /`, 30-day `expires` (`current.ts:50-56`); `fc_view` the same with a 1-year `maxAge` (`view-actions.ts:11`). Fine for iOS (server-set cookies are not ITP-capped).
- Open-redirect guard on `next` (`login/actions.ts:26`). Proxy excludes static assets and public auth pages; the production build registers it as a Node-runtime function with the right matcher (`.next/server/functions-config-manifest.json`).
- Body-data rules: admins get nothing automatically, parents of a minor and explicit grants only (`visibility.ts:50-61`); minors cannot grant (`:73`); `setMinorBodyImageApproval` requires admin **and** guardian link (`profiles/service.ts:244-245`); the photo proxy 404s for anonymous callers and anything not viewable (`api/photo/[...key]/route.ts:7-11`). Members may browse a minor's closet (decision Q13 A) but worn photos are withheld (`visibility.ts:32-36`, `photos/visibility.ts:40`).
- `crypto.ts`: AES-256-GCM with random IV, HMAC state verified with `timingSafeEqual` (`:34`). `SESSION_SECRET` is only used for Google tokens, not sessions — name is misleading but harmless.
- Logging: `login.ts:39` logs the admin's address on DEV use (no secret); `email.ts`/`sms.ts` dry-run logging is the one secret leak (A3).

---

## 3. Wrong behaviour

### W1. `removePersonAction` redirects, but the client reads `r.ok`
- `src/app/(app)/admin/people/actions.ts:63-69` calls `redirect("/admin/people")` on success. `person-editor.tsx:28-33, 123-124` does `const r = await fn(); if (r.ok) …`. Next resolves an imperatively-invoked action that redirected with `undefined` (`node_modules/next/dist/client/components/router-reducer/reducers/server-action-reducer.js:159`), so `r.ok` throws a TypeError inside `startTransition(async …)`; React 19 sends that to the nearest error boundary ("Something slipped"), racing the navigation. The success toast text is dead code; `e2e/admin.spec.ts:126` only checks the URL so it passes.
- **Severity:** wrong (can flash the error page after a successful removal).
- **Fix:** return `{ ok: true }` and `router.push("/admin/people")` in the client after the toast (or `if (r?.ok)`).

### W2. Moving a removed person's pieces to Family breaks every photo
- `src/lib/people/service.ts:91` moves `ownerId` to the admin, but photo keys keep the old owner's id (`src/lib/storage.ts:37`); `src/lib/photos/visibility.ts:31-32` resolves the owner from the key and returns `false` for `status: "removed"`.
- **Severity:** wrong. **Path:** Jeff removes Olivia → "Move Olivia's pieces to Family" → all her items show broken images for everyone.
- **Fix:** in `canViewKey`, when the key's owner is removed, fall back to `ItemPhoto → Item.ownerId`; or re-key photos on move.

### W3. Session sliding refresh never reaches the cookie
- `src/lib/auth/session.ts:47-52` extends `expiresAt` in the DB; the cookie set at `current.ts:55` keeps its original 30-day `expires`, so Safari drops it on day 30 however active the person is. Also an `UPDATE` on every request for the last 15 days.
- **Severity:** wrong (+ slow). **Fix:** re-set the cookie when extending (from the proxy or an action) and refresh at most once per day.

### W4. Person details "save on blur" cannot be retried after a failure
- `src/app/(app)/admin/people/[id]/person-editor.tsx:38-44`: `last` is overwritten and `dirty` cleared *before* the server answers; on `{ ok: false }` ("That email is already used…") the toast shows, but the next blur sees no diff and never re-sends; the field keeps showing the unsaved value.
- **Severity:** wrong. **Fix:** update `last` only on success; on failure set `dirty.current = true`.

### W5. Optimistic role / guardian state is not reverted
- `person-editor.tsx:50, 80, 132`: `setRole(r)` / `setGuardianIds(next)` before the action; "There has to be at least one admin." or "Pick at least one parent admin." leave the UI showing the rejected state until reload.
- **Severity:** wrong. **Fix:** revert on `!r.ok`.

### W6. People created by invite are invisible until they accept
- `src/lib/people/service.ts:13-26` lists `Person` rows only; an invite without `personId` creates no Person (`invite.ts:33`), so `/admin/people` shows nothing and the link (shown once in the sheet) cannot be recovered or re-sent.
- **Severity:** dead-end / wrong. **Path:** Jeff invites Grandma, taps Done, she never gets the email; there is nothing to tap.
- **Fix:** list open `InviteToken`s on the People page with copy link / resend / cancel.

### W7. Clearing an email locks the person out
- `service.ts:36` accepts `email: null` for someone with a password; `login.ts:20` needs an email. Also clearing or changing the DEV admin's email silently disables 0535 and the banner.
- **Severity:** wrong (low). **Fix:** refuse clearing when `passwordHash` or `devPasswordActive` is set.

### W8. `list-requests` hides the row before the server confirms
- `src/app/(app)/admin/lists/list-requests.tsx:19, 27-28`: on failure the toast shows but the row stays hidden (local `hidden` survives `router.refresh()`).
- **Severity:** wrong (low). **Fix:** un-hide on `!r.ok`.

### W9. `assertKind` throws outside the try
- `src/app/(app)/admin/lists/actions.ts:34, 47, 59, 71, 86`: a bad `kind` throws a plain Error past the error handling → "Something slipped". Low; return `{ ok: false }`.

### W10. Old reset tokens are never revoked
- `src/lib/auth/reset.ts:16, 44`: issuing or using a token leaves earlier unexpired ones valid. Low; `updateMany usedAt` for the person on success.

### W11. Dead code / stale comments
- `src/lib/auth/current.ts:39` comment (see S4). `src/lib/email.ts:25-28` duplicates `src/lib/app-url.ts:5-8` (the email copy does not add a missing leading slash). `src/components/header-back.tsx:35` handles `/change-password`, which is rendered by the `(auth)` layout without a header. `person-editor.tsx:123-124` success toasts (W1).

---

## 4. Slow

### P1. The proxy bundles Prisma for one string constant
- `src/proxy.ts:2` imports `SESSION_COOKIE` from `session.ts`, which imports `db.ts` → `new PrismaClient` at module load inside the proxy. The built proxy chunk (`.next/server/chunks/[root-of-the-server]__032c5dn3h5syy._.js`) is 676 KB with Prisma references; it runs on every request.
- **Fix:** move `SESSION_COOKIE`/`VIEW_COOKIE` to a tiny `src/lib/auth/cookies.ts` with no imports.

### P2. The person page loads everyone twice, sequentially
- `src/app/(app)/admin/people/[id]/page.tsx:12-15`: `getPerson` → `listPeople({ includeRemoved: true })` (2 queries), then `listPeople()` again (2 queries), then `bodyPhotosAllowed` — 5 round-trips in series. **Fix:** one list, derive admins; `Promise.all`.

### P3. `resolveView` re-queries the viewer's own name on every page
- `src/lib/people/visibility.ts:27`, called by the layout **and** by `today`, `closet`, `fits`, `clean-out`, `profile/target` → 2-3 extra queries per request. **Fix:** accept the full Person (callers already have it) or wrap in React `cache()`.

### P4. Visibility helpers do two sequential lookups each
- `visibility.ts:50-61` (`isParentOf` then grant); `src/lib/shop/people.ts:13` calls `canShopFor` in a loop over every person (N×2 queries). **Fix:** one `OR` query or `Promise.all`.

### P5. `validateSession` loads the whole Person every request
- `session.ts:37-40` `include: { person: true }` (brings `mirrorPrefs` JSON etc.). Combine with W3's per-request UPDATE. **Fix:** `select` the fields `requirePerson` callers use; refresh once a day.

### P6. `removePerson` inserts `ItemCloset` rows one at a time inside a transaction
- `service.ts:93`; hundreds of items can exceed Prisma's 5 s interactive-transaction timeout → removal fails with a raw Prisma message in the toast. **Fix:** `createMany`.

### P7. `DevModeBanner` queries the DB on every render of both layouts while DEV_MODE is on (`dev-mode-banner.tsx:9`). Minor; cache per request.

### P8. Long work inside server actions
- `src/app/(app)/admin/rules/actions.ts:19-28, 33-42` (`untidyAll`, `refitCutouts`) call remove.bg per item in the request; past the proxy timeout the row shows "Re-cutting…" forever, then an opaque error. **Fix:** enqueue via `jobs.ts` and poll; the copy already says the server retries hourly.

### P9. No timeouts on outside calls
- `src/lib/sms.ts:24` `fetch` and the Resend call at `email.ts:17` have no `AbortSignal.timeout`; a slow provider leaves "Creating…" spinning indefinitely. **Fix:** `AbortSignal.timeout(10_000)`.

---

## 5. Unhandled rejections / missing try-catch around outside calls

- **`invitePersonAction`** `src/app/(app)/admin/people/actions.ts:20-39`: `deliverInvite` (Resend / Twilio) runs inside the *same* try as `createInvite`; a thrown network error returns `{ ok: false }` and the already-created invite's URL is never shown, so the admin creates another. **Fix:** try/catch each delivery separately and always return `url`.
- **`sendResetEmail`** `src/lib/auth/reset.ts:31` → `sendEmail` can throw (SDK network error) → `forgotPasswordAction` rejects → root error boundary (no `error.tsx` under `(auth)`). Wrap and surface a message.
- **`sendSms`** `src/lib/sms.ts:24`: `fetch` throws on DNS/network; callers assume `{ sent, error }`.
- **`decrypt`** `src/lib/crypto.ts:18-19` throws on a malformed string (destructuring `undefined`); callers in `plans/google.ts` are outside my area but should guard.
- **`DevModeBanner`** does catch and log (`dev-mode-banner.tsx:11-14`) — good.

---

## 6. iOS Safari specifics in the client components I read

### I1. Save feedback renders under the keyboard
- `person-editor.tsx:58-61` saves on blur, which on a phone happens while the keyboard is up (moving field to field or tapping Done). `src/components/ui/toast.tsx:33` is `position: fixed; bottom: …`; iOS positions fixed elements against the layout viewport, which the keyboard does not shrink, so "Details saved" / the error toast is hidden behind the keyboard. `src/components/app-nav.tsx:21` (fixed bottom bar) floats over the lower inputs for the same reason.
- **Severity:** dead-end. **Fix:** inline "✓ Saved" / error beside the field, as `rule-form.tsx:38-40` already does.

### I2. Custom accent colour never saves on iOS
- `src/app/(app)/admin/rules/rule-form.tsx:80`: `<input type="color">` saves `onBlur`; iOS presents the picker as a popover and blur is unreliable → the swatch changes, "✓ Saved" never shows, value reverts on reload. **Fix:** also save on `change` (debounced ~400 ms).

### I3. "Copy link" fails silently
- `invite-sheet.tsx:52`: `navigator.clipboard.writeText` rejects outside a secure context, and in `share()` (`:55-56`) the fallback `copy` runs after an async rejection, outside the user gesture → nothing happens, `catch {}` swallows it. **Fix:** show "Couldn't copy — long-press the link" on failure (the URL text is at least visible at `:72`).

### I4. `autoFocus` inside a `<dialog>`
- `invite-sheet.tsx:82`, `src/components/lists/inline-add.tsx:52, 72`: iOS ignores programmatic focus without a gesture and can scroll the sheet oddly. Harmless; remove or focus in a `click` handler.

### I5. Sheet height vs. keyboard
- `src/components/ui/sheet.tsx:35` `max-h-[90dvh]`: `dvh` does not react to the keyboard on iOS, so in the invite sheet "Create invite" can sit under the keyboard; the body scrolls so it is recoverable. The Safari `flex: 1 1 0%` collapse fix is in place (`sheet.tsx:47`). `(auth)/layout.tsx:8` `min-h-dvh` and `auth-hero.tsx:7` `46dvh` are fine; no `100vh` in my area.

### I6. Nothing in my area uses `use()` with Suspense; `HeaderBack` is correctly wrapped in `Suspense` for `useSearchParams` (`(app)/layout.tsx:29`). `PersonMenu`'s logout form inside a `<dialog>` works (no `method="dialog"`).

---

## 7. Every dead end (tap → no feedback) in my area

| Where | What the person taps | What they get |
|---|---|---|
| `login-form.tsx:22` after 0535 was used on another phone | Sign in | "don't match", no hint (A1) |
| `login-form.tsx:22` over plain http | Sign in | bounced back to the empty login form (A4) |
| `login-form.tsx:22` with a session that expired | any link → `/login?next=` | login form with no "you were signed out" line (`proxy.ts:13`, `current.ts:31`) |
| `change-password/page.tsx:26` | Sign out instead | signed out with no password left (A2) |
| `forgot-password/form.tsx:28` with no RESEND key | Send reset link | "on its way" — nothing arrives (A3) |
| `invite-sheet.tsx:74` on http / after share-cancel | Copy link | nothing (I3) |
| `invite-sheet.tsx:110` when Resend/Twilio hangs or throws | Create invite | "Creating…" forever, or an error with the link lost (P9, §5) |
| `person-editor.tsx:58-61` with the keyboard up | leave a field | "Details saved" invisible (I1); after a failure no retry possible (W4) |
| `person-editor.tsx:123-124` | Move pieces / Delete | navigation, possibly "Something slipped", never the promised toast (W1) |
| `rule-form.tsx:80` on iOS | pick any colour | swatch changes, never saves (I2) |
| `list-requests.tsx:28` when the server fails | Dismiss | row gone, toast only; stays gone (W8) |
| `untidy-photos.tsx:22`, `refit-photos.tsx:12` on a big closet | Re-cut / Refit | spinner until the request times out (P8) |
| `admin/people/page.tsx` after inviting a new person | — | the person is nowhere on the list; link unrecoverable (W6) |
| `admin/people/[id]/page.tsx:10` as a member | typed URL | "Something slipped" instead of "Admins only" (S4) |

---

## 8. Smaller notes
- `src/app/(auth)/login/page.tsx:2` imports `redirectIfSignedIn` from a `"use server"` file, which also makes it (and `logoutAction`) public POST endpoints; harmless, but a plain server helper would be cleaner.
- `src/lib/auth/invite.ts:49-64` `deliverInvite` re-reads the token by hash it just created; fine. The SMS body carries the raw invite URL (expected).
- `src/lib/auth/session.ts:28` truncates `userAgent` to 255 — good. `createdById` cascades on the admin's deletion, but people are never hard-deleted.
- `src/app/(app)/view-actions.ts:11` accepts any 64-char key; `resolveView` validates later — fine.
- `src/lib/people/service.ts:98` frees the address as `removed+<id>@<old domain>` — good; but `removePerson` does not clear `BodyDataGrant`/`ShopForGrant` given *to* the removed person (harmless since `status` blocks them).
- `.env.example:7-8` lists `APP_URL`/`DEV_MODE` as required but nothing validates them at boot; with `APP_URL` unset in production every invite/reset link points at `http://localhost:3000` (`email.ts:26`). Consider failing fast in `instrumentation.ts`.

---

## 9. Files read (every line) with line counts

| File | Lines |
|---|---|
| src/lib/auth/session.ts | 62 |
| src/lib/auth/current.ts | 64 |
| src/lib/auth/dev-mode.ts | 10 |
| src/lib/auth/login.ts | 44 |
| src/lib/auth/password.ts | 13 |
| src/lib/auth/tokens.ts | 10 |
| src/lib/auth/invite.ts | 109 |
| src/lib/auth/reset.ts | 50 |
| src/lib/auth/change-password.ts | 19 |
| src/lib/people/service.ts | 102 |
| src/lib/people/visibility.ts | 76 |
| src/lib/email.ts | 38 |
| src/lib/sms.ts | 35 |
| src/lib/crypto.ts | 36 |
| src/lib/app-url.ts | 8 |
| src/lib/db.ts | 15 |
| src/proxy.ts | 21 |
| src/app/(auth)/layout.tsx | 13 |
| src/app/(auth)/login/page.tsx | 23 |
| src/app/(auth)/login/actions.ts | 38 |
| src/app/(auth)/login/login-form.tsx | 29 |
| src/app/(auth)/forgot-password/page.tsx | 19 |
| src/app/(auth)/forgot-password/actions.ts | 12 |
| src/app/(auth)/forgot-password/form.tsx | 32 |
| src/app/(auth)/reset-password/[token]/page.tsx | 33 |
| src/app/(auth)/reset-password/[token]/actions.ts | 18 |
| src/app/(auth)/reset-password/[token]/form.tsx | 17 |
| src/app/(auth)/invite/page.tsx | 19 |
| src/app/(auth)/invite/[token]/page.tsx | 33 |
| src/app/(auth)/invite/[token]/actions.ts | 20 |
| src/app/(auth)/invite/[token]/form.tsx | 25 |
| src/app/(auth)/change-password/page.tsx | 31 |
| src/app/(auth)/change-password/actions.ts | 28 |
| src/app/(auth)/change-password/form.tsx | 18 |
| src/app/(app)/admin/layout.tsx | 8 |
| src/app/(app)/admin/people/page.tsx | 36 |
| src/app/(app)/admin/people/actions.ts | 69 |
| src/app/(app)/admin/people/invite-sheet.tsx | 116 |
| src/app/(app)/admin/people/[id]/page.tsx | 22 |
| src/app/(app)/admin/people/[id]/person-editor.tsx | 137 |
| src/app/(app)/admin/lists/page.tsx | 49 |
| src/app/(app)/admin/lists/actions.ts | 95 |
| src/app/(app)/admin/lists/list-requests.tsx | 33 |
| src/app/(app)/admin/lists/[kind]/page.tsx | 30 |
| src/app/(app)/admin/rules/page.tsx | 56 |
| src/app/(app)/admin/rules/actions.ts | 42 |
| src/app/(app)/admin/rules/rule-form.tsx | 103 |
| src/app/(app)/admin/rules/refit-photos.tsx | 17 |
| src/app/(app)/admin/rules/untidy-photos.tsx | 32 |
| src/app/(app)/view-actions.ts | 12 |
| src/app/api/photo/[...key]/route.ts | 26 |
| src/app/api/health/route.ts | 5 |
| prisma/schema.prisma (Role, PersonStatus, Person, Session, PasswordResetToken, InviteToken, GuardianLink, Closet, ItemCloset, ListRequest, Rule, BodyProfile/Measurement/SizeByBrand/Photo, BodyDataGrant, ShopForGrant, MinorBodyImageApproval; model index of the rest) | 1116 total |
| Supporting files read in full for context: src/app/(app)/layout.tsx 36, src/app/(flow)/layout.tsx 18, src/app/layout.tsx 31, src/app/page.tsx 5, src/app/(app)/error.tsx 20, src/app/error.tsx 19, src/app/(app)/profile/actions.ts 101, src/app/(app)/profile/target.ts 24, src/lib/photos/visibility.ts 85, src/lib/lists/requests.ts 39, src/lib/profiles/service.ts (lines 40-60, 240-255), src/components/dev-mode-banner.tsx 21, forbidden.tsx 11, auth-hero.tsx 14, person-menu.tsx 67, lists/inline-add.tsx 80, ui/sheet.tsx 51, ui/toast.tsx 42, ui/new-password.tsx 27, ui/password-input.tsx 15, ui/banner.tsx 20, ui/button.tsx 77, ui/button-class.ts 33, ui/field.tsx 15, ui/input.tsx 24, ui/undo-strip.tsx 38, ui/page-header.tsx 16, ui/card.tsx 7, app-header.tsx 16, header-back.tsx 53, app-nav.tsx 44, header-action.tsx 18, sw-registrar.tsx 11, src/app/sw.js/route.ts 12, src/lib/sw-source.ts 42, src/instrumentation.ts 17, src/app/globals.css 159, prisma/seed.ts 238, scripts/reset-dev-password.ts 23, e2e/login.spec.ts 52, e2e/admin.spec.ts 140, e2e/helpers.ts 22, e2e/set-password.ts 9, tests/auth/login.test.ts 69, tests/auth/session.test.ts 67, playwright.config.ts 30, next.config.ts 16, railway.json 10, package.json 55, .env.example 81 | — |

Also inspected: `.next/server/functions-config-manifest.json` (proxy registered, Node runtime), `.next/server/middleware.js` + chunk sizes, `node_modules/next/dist/client/components/router-reducer/reducers/server-action-reducer.js:131-258` (redirect → `actionResult = undefined`), `node_modules/next/dist/server/app-render/manifests-singleton.js:59-61` and `action-handler.js:405-420` (stale action handling). Total lines read in my area and its direct dependencies: 5,244.
