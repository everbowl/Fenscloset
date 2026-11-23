# Review F · the shell (service worker, layouts, shared UI, nav, config, shell tests)

Scope: src/components/** (except mirror/ and looks/), root and (app) layouts, error/not-found pages, offline page, manifest, /sw.js route, src/lib/sw-source.ts, app-url.ts, db.ts, cn.ts, next.config.ts, package.json scripts, playwright.config.ts, vitest.config.mts, tests/shell/**, e2e/shell.spec.ts, plus the files those depend on (proxy.ts, auth/current.ts, people/visibility.ts, closet-memory.ts, import/client-queue.ts, api/photo, api/import/open, api/health, railway.json). Every line of every listed file was read with `cat -n`; callers were found with grep. No file was edited.

Note on state: the working tree moved while I read it (git status: globals.css, app-header.tsx, app-nav.tsx, person-menu.tsx, button-class.ts, button.tsx, page-header.tsx modified; docs/redesign-2026-11-23.md new). Those seven were re-read; line numbers below are from the working tree at my final read (counts in the last section). Where HEAD differed materially I say so.

Severity key: breaks | wrong | slow | unsafe | dead-end | dead-code.

---

## A. The deploy-while-open failure: service worker, stale build, no reload prompt

**A1. src/components/sw-registrar.tsx:8 · breaks.** `register("/sw.js")` and nothing else: no `updatefound`, no `statechange`, no `controllerchange` listener, no periodic `registration.update()`. The SW is versioned per deploy (route.ts:7) so the browser *does* learn a new build exists, but no code hears it, so no "new version, reload" bar is ever shown. Path: Jeff has /today open on the home-screen app; a deploy lands; every button he taps calls an action id the new server never had ("Failed to find Server Action"); in standalone iOS there is no reload button, so the only way out is force-quitting the app. Fix: in the registrar listen for `reg.addEventListener("updatefound")` → `installing.addEventListener("statechange")` (state `installed` with an existing `navigator.serviceWorker.controller` = new build ready) and show a fixed bar "New version ready · Reload" that posts `skipWaiting` and reloads on `controllerchange`; also call `reg.update()` on `visibilitychange` → visible and every few minutes, because `register()` runs once per hard load and client-side `<Link>` navigations never trigger an update check.

**A2. src/lib/sw-source.ts:8,13 · breaks (second half of the same incident).** `skipWaiting()` on install and `clients.claim()` + delete-every-other-cache on activate. The new worker takes the open old page immediately and throws away `fc-static-<old>`; Railway has already stopped the old container, so the old page's next lazy chunk (`/_next/static/chunks/<oldhash>.js`) misses cache and 404s. Path: same as A1, plus any navigation inside the stale page that needs a not-yet-loaded chunk. Fix: either drop `skipWaiting`/`claim` and let the new worker wait until the user accepts the reload bar from A1 (keeping the old cache alive until then), or keep `skipWaiting` but delete old caches only after all controlled clients have reloaded (e.g. on the first navigation by the new build).

**A3. src/app/(app)/error.tsx:15 · dead-end.** After a deploy the stale action rejects with Next's `UnrecognizedActionError` (node_modules/next/dist/esm/client/components/router-reducer/reducers/server-action-reducer.js:95-97: the client throws; Next 16.4.6 does not auto-reload). In most of this app the call sits in `startTransition(async …)` so the error reaches this boundary, which offers "Try again" (`reset()` re-renders the same stale client tree, so it fails again) and "Go to Today" (a `<Link>`; this one happens to recover because the RSC fetch sees a build mismatch and hard-navigates). Nothing says "a new version is here". Fix: `import { unstable_isUnrecognizedActionError } from "next/navigation"`; when true, render "The app was updated · Reload" with `window.location.reload()` as the primary button and hide "Try again"; also check `error.message.includes("Server Action")` for the server-thrown form.

**A4. src/components/items/brand-search.tsx:37-44 · dead-end.** `ensureBrandAction(name).then(…)` with no `.catch`. Any rejection (stale deploy, network drop, 500) leaves `busy` true forever: the row shows "Adding…" and the whole list is disabled, no error, no way out except closing the sheet. Path: typing a new brand on the confirm screen right after a deploy or on a dead cell. Fix: add `.catch(() => { setBusy(false); setError("Couldn't add it. Try again."); })`, or `try/finally` in an async function.

**A5. src/components/items/match-sheet.tsx:16,23 · dead-end.** `styleMatchesAction(probe).then(…)` with no `.catch`: on rejection `rows` stays `null` and the sheet reads "Looking at {brand}…" forever. Path: "Is it this one?" opened on a flaky connection or right after a deploy. Fix: `.catch(() => setError("Couldn't reach the store. Try again."))`; the Close button already exists so the user can leave once the text changes.

**A6. src/app/sw.js/route.ts:10 · wrong (verify).** `GET()` takes no request and uses no dynamic API, so Next prerenders it at build. Next may replace the handler's `Cache-Control: no-cache` with its static-route cache header. Browsers fetch the main SW script bypassing the HTTP cache by default (`updateViaCache: "imports"`), so this only matters behind a caching proxy/CDN, but it is cheap to pin: add `export const dynamic = "force-dynamic"` or confirm the served header in prod. (The `Service-Worker-Allowed: /` header is unnecessary for a root-scoped script; harmless.)

**A7. src/app/sw.js/route.ts:7 · wrong (edge).** `String(Date.now())` fallback is evaluated once per server process. Off Railway (or if `RAILWAY_GIT_COMMIT_SHA` is absent at build), every restart and every replica yields a different VERSION, so phones re-install the SW on each visit and two replicas flap each other. Fix: fall back to Next's build id (`process.env.NEXT_BUILD_ID` is not public; simplest: inject the git SHA at build in `npm run build`, e.g. `NEXT_PUBLIC_BUILD=$(git rev-parse --short HEAD)`), never the clock.

**A8. src/lib/sw-source.ts:38-40 vs src/app/offline/page.tsx:11 · wrong.** The offline page says "No connection, *or the site is slow to answer*", but the navigation handler is `fetch(req).catch(() => offline)`: a hung or slow server never rejects, so the user sees a white screen, not this page. Path: cellular with one bar, Railway cold start. Fix: `Promise.race` the fetch with an ~8 s timeout that resolves to the cached offline page (or remove that half of the sentence).

**A9. src/lib/sw-source.ts:8 · wrong (edge).** `addAll([OFFLINE_URL, icon])` caches the offline HTML only. That HTML references the current build's CSS and JS; neither is precached. If a phone installs a new SW (new build) and goes offline before it has loaded one page of that build, the cached offline page renders unstyled (no CSS, no font). Fix: during install, fetch `/offline`, cache it, then also `cache.addAll` the `<link href>`/`<script src>` URLs found in it (or inline the offline page's few styles).

**A10. src/lib/sw-source.ts:38 · slow.** Every navigation is routed through `respondWith(fetch(req))`, so a cold SW start (iOS evicts workers aggressively) adds its boot time to every first navigation while giving nothing in return until a failure. Fix: enable `registration.navigationPreload` in `activate` where supported and use `event.preloadResponse`, or only `respondWith` when the network fails.

**A11. src/app/api/photo/[...key]/route.ts:14,18 and src/components/item-card.tsx:16 · slow (the "thumbnails were slow" item).** Each closet thumbnail is a cookie-gated round trip through Node (`getObject` buffers the whole body, `Cache-Control: private, max-age=3600`); the SW passes `/api/photo/*` straight to the network, so nothing is reused across the hour or across views. Path: open Closet with twenty pieces on cellular → twenty 150–700 ms requests. Fix (as the redesign doc already plans): content-addressed keys → `private, max-age=31536000, immutable`; stream the S3 body instead of buffering; let the SW cache `/api/photo/` cache-first with a bounded, LRU-trimmed cache. Caveat if the SW caches them: the Cache API is per origin, not per user, so on a shared phone a signed-out viewer could be served another member's photo from cache; clear that cache from the SW on logout (postMessage) or key cache names by person id.

**A12. railway.json:5 · wrong (process).** No deploy overlap/grace: the moment the new container is healthy the old one goes, taking the old `/_next/static` with it. Combined with A1/A2 this is why a mid-demo deploy broke open phones. Fix: A1 reload bar (mandatory), and if possible keep the previous build's static assets served (shared `assetPrefix` bucket, or copy the last N `.next/static` dirs forward).

---

## B. Sheet (`src/components/ui/sheet.tsx`) and WebKit

**B1. sheet.tsx:47 · fixed, confirmed.** The body is `min-h-0 flex-auto` (`flex: 1 1 auto`), header and footer `shrink-0`, dialog `max-h-[90dvh]` with the body `overflow-y-auto`. This is correct for WebKit (the `flex-1`/0% basis collapse is gone). The footer variant (used by mirror-sheet, look-screen, fits-screen) keeps the button pinned. OK.

**B2. sheet.tsx:35 · wrong (older iOS).** Bottom anchoring relies on `m-0 h-auto self-end` on a top-layer `<dialog>` (CSS Box Alignment for absolutely positioned boxes). WebKit gained that in 17.4; on an iPhone still on 17.3 or earlier the dialog stretches to 90dvh and sits at the top. Fix: the cross-engine form is `h-fit mt-auto mb-0` (height: fit-content with top margin auto) in place of `h-auto self-end`.

**B3. sheet.tsx:37 · dead-end.** The grab handle (`aria-hidden`, 36×4 bar) promises swipe-to-dismiss and does nothing on drag; the only ways out are the × and the backdrop. Path: every family member's first instinct on a bottom sheet. Fix: either remove the handle or add a small pointer-drag that closes past ~80 px.

**B4. sheet.tsx (all callers with `autoFocus` inputs: row-editor.tsx:101-102, brand-search.tsx:49, inline-add.tsx:52,72, list-editor.tsx:229, size-sheet.tsx:46) · wrong (WebKit).** The dialog is `position: fixed` on the layout viewport; when the iOS keyboard opens, the sheet does not move and its lower half (the Save pill in TextSheet, PriceDateSheet, EditForm) can sit under the keyboard; `dvh` does not shrink for the keyboard on iOS. Also, programmatic `autoFocus` on an element mounted after a tap does not reliably open the keyboard in Safari. Fix: size the sheet with `visualViewport` (`height: window.visualViewport.height`) while an input inside it is focused, or move Save into `footer` and pad the body by the keyboard inset; test on a device.

**B5. globals.css:150 (`html.sheet-open … overflow: hidden`) · wrong (older iOS).** iOS Safari before 16 ignores `overflow: hidden` on html/body for touch scrolling; the page scrolls through the backdrop (the comment admits the symptom). Fix: `overscroll-behavior: contain` is already on the dialog; add `touch-action: none` to `::backdrop`-covered body or use the position-fixed body lock while a sheet is open.

**B6. sheet.tsx:31,40 · a11y OK.** `aria-labelledby` only while open, `showModal()` manages focus and inertness, × is 44×44, Esc reports via `onClose`, reduced motion honoured (globals.css:148). Fine. Minor: `role="listbox"` wrapping `<button role="option">` (person-menu.tsx:39-44, brand-search.tsx:51-56, row-editor.tsx:48-52) is tolerated but VoiceOver may read them as buttons; `role="group"` + `aria-pressed` would be truer.

---

## C. Buttons, pills, fields, inputs

**C1. src/components/ui/button.tsx:50 · wrong (working tree regression).** `busy && "… disabled:shadow-[0_6px_0_0_var(--color-stone)] disabled:translate-y-0 …"`. In HEAD every primary carried that 6 px stone base (LIFT), so a busy button kept its look; in the working tree `LIFT = ""` (button-class.ts:8) and no idle button has a shadow, so the moment a button goes busy it sprouts a 6 px grey slab and jumps. Path: tap "Wear this" / "Save". Fix: drop `disabled:shadow-[…]` and `disabled:translate-y-0` from the busy class list.

**C2. button.tsx:18-21,43,65 · dead-code.** `Shelf`/`SHELF` and the `shelf` prop: default is now `false` and the only callers pass `shelf={false}` (mirror-sheet.tsx:90, closet-grid.tsx:68, confirm-card.tsx:298,346). Remove the wrapper and the prop, or keep the prop as a no-op and delete `Shelf`.

**C3. button-class.ts:7-8 · dead-code.** `export const LIFT = ""` with the comment "kept for the two places that still import it" — grep finds zero importers. Delete.

**C4. button.tsx:53 · wrong (reduced motion).** The busy dot is `animate-pulse` without `motion-reduce:animate-none` (LinkPending has it, link-pending.tsx:9). Fix: add the variant.

**C5. button-class.ts:19 · wrong (touch).** `size="sm"` is `h-10` (40 px) with no hit-area extension; `.pill-sm` gets a 44 px finger via `::after` (globals.css:99-100) but `Button size="sm"` does not. Used in inline-add.tsx:56 and list-editor.tsx:123. Fix: give `sm` the same `relative after:absolute after:-inset-[5px]` or make it `h-11`.

**C6. src/components/ui/field.tsx:9 and list-editor.tsx:228 · wrong (working tree).** Labels still add `tracking-[0.14em]` on top of `.mono`, which the new globals.css (52-59) made sentence-case 13 px Archivo with `letter-spacing: 0`. Wide-tracked sentence case looks like a bug. Fix: drop the tracking utility from both.

**C7. src/components/lists/entry-fields.tsx:49 · wrong (WebKit).** The long-text `<textarea>` is `text-[14px]`; iOS Safari zooms the page when a control under 16 px gets focus and, in standalone mode, does not zoom back. Every other field is 17 px (input.tsx:6) precisely to avoid this. Path: Admin → Lists → edit a photo tip or AI prompt. Fix: `text-[17px]` (or 16).

**C8. entry-fields.tsx:31 and size-sheet.tsx:33 · wrong (touch).** Colour swatch input is 36×36 (`size-9`) and size chips are `h-9` (36 px) with no hit extension. Fix: `size-11` / `h-11` or the `::after` trick.

**C9. src/components/items/row-editor.tsx:104 · dead-end (minor).** TextSheet's Save is `disabled={!ok}` with no text saying why (only when `valid` is passed, e.g. a URL). Path: paste a link without `https://`, Save does nothing. Fix: show the `hint` (or "Needs to start with https://") in red when `!ok && v`.

**C10. src/components/ui/input.tsx · OK.** 44 px tall, 17 px text (no iOS zoom), custom select chevron with `appearance-none`, `type="search"` cancel hidden in closet-search. Fine.

**C11. src/components/ui/banner.tsx:6-10 · dead-code.** `danger` and `info` tones are identical strings; the `tone` prop is only read for the role. Collapse or differentiate.

**C12. src/components/ui/card.tsx:6 vs globals.css:80 · wrong (working tree).** `Card` renders `border border-line bg-paper p-4` (square) while the new `.card` class (16 px radius) exists and nothing uses it; every admin screen is still square. Fix: make `Card` emit `card p-4` and let callers' overrides stand.

---

## D. Toasts (`src/components/ui/toast.tsx`)

**D1. toast.tsx:33 + sheet.tsx (top layer) · dead-end.** Toasts render in a `fixed z-40` host in the page; a native modal `<dialog>` lives in the top layer above everything, including its backdrop. Any toast fired while a sheet stays open is invisible. Concrete case: lists/ask-to-add.tsx:17 fires `toast.ok("Asked · …")` from inside PickSheet, which remains open; the user taps "Ask", the form closes, and nothing else appears to happen. Fix: when a sheet is open, portal the toast host into the open dialog (keep a `document.querySelector("dialog[open]")` target), or make Sheet expose an inline status line and use it there.

**D2. toast.tsx:27 · wrong (timing).** Success toasts live 2 500 ms; errors and action toasts 6 000 ms; none can be dismissed by tap or swipe, and there is no pause on hover/focus. 2.5 s is short for a "did it work?" glance after a 1–2 s action. Fix: 4 s for plain success, tap-to-dismiss on the whole toast, and keep the newest only (the host already slices to the last two).

**D3. toast.tsx:33 · wrong (keyboard).** `bottom: calc(76px + safe-area + 12px)` is relative to the layout viewport; with the iOS keyboard up the toast is behind the keyboard. Path: closet search field focused, a background upload finishes → "Saved" never seen. Fix: offset by `visualViewport` height delta while an input is focused, or anchor toasts to the top when `document.activeElement` is an input.

**D4. toast.tsx:35 · a11y (minor).** Each toast is a *new* element with `role="status"/"alert"`; VoiceOver announces insertion into an existing live region more reliably than a freshly inserted one. Fix: keep one persistent `aria-live="polite"` region in the host and swap its text.

**D5. toast.tsx:24-31 · OK.** Listener registered on mount; module-level emit; the (app) layout keeps the host mounted across client navigations so timers survive. Fine. `.wait` (globals.css:128-134, z-35) sits at the same bottom offset as toasts (z-40), so a wait card and a toast overlap when both show; stack them.

---

## E. Header, nav, person menu, back control

**E1. src/components/header-back.tsx:15-37 · dead-end.** `parentOf` has no rule for `/looks/[id]` or `/looks/new`, so a look page (reached from Fits cards, the look tray, and "In the look ✓" pills) has no back control in the header — against the house rule that back never leaves the header; on an installed iOS app there is no browser back either. Path: Fits → tap a look → stuck with only the tab bar. Fix: add `if (m(/^\/looks\/.+/)) return { href: "/fits", label: "Fits" }` (or `/today` when `?from=today`), and add it to tests/shell/header-back.test.ts.

**E2. header-back.tsx:49 · wrong (touch).** The back link is `h-11 w-10` (40 px wide). Fix: `w-11`.

**E3. src/components/app-nav.tsx:27-30 (working tree) · wrong + dead-end.** The + tab lost its active indication on phones (HEAD had a ring) and has no `aria-current` and no `LinkPending`, so on /add nothing in the bar is marked current and a tap on + gives no in-flight feedback (only the 1-frame `active:scale-95`). Fix: `aria-current` when active, an outline/ring on the circle, and wrap the circle in `LinkPending`.

**E4. app-nav.tsx:21 and app-header.tsx:8 (working tree) · slow (WebKit).** `backdrop-blur` on a fixed bar and a sticky header over a 95 %-opaque background: near-invisible effect, GPU cost on every scroll frame, and WebKit has known sticky+backdrop-filter repaint glitches. Fix: drop `backdrop-blur` (keep `bg-paper/95` or go opaque).

**E5. src/components/header-action.tsx:16 · wrong (minor).** The search icon is portaled into the header after mount, so the right slot is empty on first paint and pops in. Fix: render the icon server-side in the slot via the layout (pass `right` from the page) or reserve the 44 px box.

**E6. src/components/person-menu.tsx:30,41 · dead-end (minor).** Choosing a person awaits `setView` then `router.refresh()`; options are disabled while pending but look identical (no dim, no check moving), and the sheet closes only after the round trip. Path: tap "Family" on cellular, nothing changes for a second, tap again. Fix: optimistic check mark + `opacity-60` while `pending`, or close immediately and refresh.

**E7. src/app/(app)/view-actions.ts:11 · wrong (minor).** The `fc_view` cookie is written unvalidated (any 64-char string, resolved later), lasts a year, and is not cleared on logout (auth/current.ts:59-64 only deletes the session cookie). On a shared phone the next person who signs in opens on the previous person's chosen closet. Fix: validate against `viewableClosets` in the action and `store.delete(VIEW_COOKIE)` in `signOut`.

**E8. src/components/dev-mode-banner.tsx:17 · wrong (a11y).** A permanent banner with `role="alert"` is announced on every page load by VoiceOver. Fix: `role="status"` or none. Also it runs one DB query per render in three layouts while `DEV_MODE=true`; fine for dev, but if `DEV_MODE=true` is ever set in production the 0535 path is live — keep it false there (config, not code).

**E9. src/components/filter-tabs.tsx:35 · slow (minor).** Closing the Categories sheet always `router.refresh()`es, even when nothing changed. Fix: refresh only when ListEditor reports a change.

**E10. src/components/closet-search.tsx:25 · slow (minor).** Each 300 ms pause → `router.replace` → full RSC round trip on cellular, with no in-field pending cue. Fix: 450–500 ms debounce and a small spinner in the field while `useLinkStatus`/transition is pending (closet-tools already dims the count).

**E11. src/components/forbidden.tsx:8 · wrong (minor).** "Back to today" is an underlined text link, the one non-pill tappable in the app. Fix: `pill`.

---

## F. Import queue and the offline promise (root layout)

**F1. src/components/import-queue-provider.tsx:80-85 vs src/app/offline/page.tsx:12 · wrong.** Photos picked while offline are kept in `held` (memory only); the offline page promises "Anything you queued carries on when you're back online", but if the app is closed before the connection returns those photos are gone (only items past `createBatch` reach IndexedDB). Fix: write held files to the same IndexedDB store with `batchId: null` and create the batch on `online`.

**F2. import-queue-provider.tsx:37,120 · slow (minor).** `refresh()` and `pump()` run on every page load of every layout, including /login and /offline (401 → fine, but one extra request and an IndexedDB open per load). Fix: skip when `document.cookie` has no session or mount the provider in (app)/(flow) only.

**F3. import-queue-provider.tsx:50 · slow (minor).** `pendingStore.all()` loads every pending blob into memory on each loop iteration. Fix: `getAllKeys()`/cursor and read one blob at a time.

**F4. src/components/ui/undo-strip.tsx:16,20 · wrong (minor).** The 5 s undo commits on unmount or timer, but not on `pagehide`; killing the app within 5 s of a removal brings the thing back next open. Fix: flush on `pagehide`/`visibilitychange: hidden`.

**F5. src/components/profile/my-brand-sheet.tsx:37 · wrong.** `if (!r.ok) onError?.(r.error); onSaved?.();` — `onSaved` fires even when the save failed, so a caller shows "Saved" and an error together. Fix: `else onSaved?.()`.

---

## G. globals.css tokens, classes, fonts (working tree)

**G1. src/app/layout.tsx:4-5 + globals.css:33 · slow / dead-code.** `--font-mono` now resolves to Archivo and `.mono` uses the sans, yet IBM Plex Mono 400 and 500 CSS are still imported, so two font files are downloaded and never drawn; the two remaining `font-mono` utilities (entry-fields.tsx:33 hex input, invite-sheet.tsx:72 URL) now render proportional. Fix: either delete both Plex imports, or keep `--font-mono` as Plex for those two fields.

**G2. globals.css:18-27 · dead-code.** `--color-background`, `--color-foreground`, `--color-muted`, `--color-surface`, `--color-border` have zero utility uses (`bg-background`, `text-muted`, …). Delete or adopt.

**G3. globals.css:61-62 · dead-code.** `.mono-12`, `.mono-13`: zero uses (`.mono-11` has 31).

**G4. globals.css:80-81,97,102,128-134,158 · dead-code (today).** `.card`, `.stage`, `.pill-accent`, `.pill-on`, `.wait`, `.strip` are defined and unused as of this read (redesign in progress); `.pill[aria-current="true"]` can never match because links set `aria-current="page"`. Fix: use them or drop them; change the selector to `[aria-current="page"]`.

**G5. globals.css:14,29 + button.tsx:50 · dead-code.** `--stone`/`--color-stone` survives only in the busy-shadow leftover (C1). Remove with C1.

**G6. Fonts · slow (first load).** Archivo variable (wdth axis, weights 100–900, 88 KB latin), Instrument Serif 400, all `font-display: swap`, no `<link rel="preload">` (fontsource CSS cannot be preloaded by Next). First paint shows system fonts then swaps; after the SW caches `/_next/static/media/*` it is a one-time cost. No italic file is loaded (good; `em, i, .italic { font-style: normal }` at globals.css:116 is the only italic reference). Fix if wanted: `next/font/local` pointing at the three woff2 files to get preload + `size-adjust`.

**G7. src/app/error.tsx:11, (app)/error.tsx:12, not-found pages, offline/page.tsx:10 · wrong (consistency).** These still use `serif text-[40–44px]` while the v2 system (globals.css:109) reserves serif for the greeting and wordmark. Move to `.title`.

**G8. globals.css:48 (`img { -webkit-user-drag: none }`), 141-148 (sheet radius/animation), 137-138 (safe areas) · OK.** `:hover` is gated behind `@media (hover: hover)` for `.pill`/`.tap` (91,106), and Tailwind 4's `hover:` variant is gated the same way, so no sticky hover on touch. Reduced motion is honoured for `.rise` and the sheet. Dark mode: `color-scheme: light` (globals.css:38, layout.tsx:18) and no `dark:` anywhere — deliberately light-only, consistent.

---

## H. Layouts, manifest, viewport

**H1. src/app/layout.tsx:27-28 + globals.css:39-40 · OK.** `html.h-full`, `body.min-h-full` and CSS `height: 100%`: body is viewport-tall and content overflows to the html scroller; sticky header and `window.scrollY` (remember-closet.tsx) work. `viewportFit: cover` with `.safe-top`/`.safe-bottom` on header and nav; main padding matches the 76 px bar (layout.tsx:32). No `maximumScale`/`user-scalable=no` (good).

**H2. src/app/manifest.ts:11 · wrong (minor).** `orientation: "portrait"` locks an iPad install to portrait; add `id: "/"` for stable PWA identity. `start_url: /today` behind auth redirects to /login when signed out — fine.

**H3. src/app/(app)/layout.tsx:19-22 · OK.** `requirePerson` → redirect, three awaits in `Promise.all`, inline `<style>` for the accent (no CSP exists, so no nonce needed). The SW registrar lives only here, so the worker registers after login; scope `/` then covers (flow) pages too.

**H4. src/components/brand.tsx:8 · wrong (minor).** `<clipPath id="fc-mark">` is a fixed id; two `Mark`s on one page (auth hero + any other) duplicate it. Fix: `useId()`-based id.

**H5. src/components/item-card.tsx:30 · dead-end (minor).** In pick mode a card is `disabled` when the look is full; tapping it does nothing and only `opacity-50` hints why ("Not in the mirror" covers the other case). Fix: `title`/small caption "Look is full" or allow tap → toast.

---

## I. next.config, db, app-url, proxy, scripts

**I1. next.config.ts · unsafe (low).** No `headers()`: no `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`; `poweredByHeader` on. Private family app, but these are five lines. Also no `deploymentId`; with A1/A3 in place it is not needed.

**I2. src/lib/app-url.ts:6 · wrong (config).** Default `http://localhost:3000` in production if `APP_URL` is unset → password-reset and Google callback links point at localhost. `.env.example:7` documents it; consider throwing in production when unset.

**I3. src/lib/db.ts · OK.** Global client only outside production; `PrismaPg` default pool. Fine.

**I4. src/proxy.ts:4,20 · OK.** `/offline`, `/sw.js`, `/manifest.webmanifest`, `/icons`, `/apple-touch-icon.png` are public; `_next/static`, `_next/image`, image extensions bypass. The SW's `addAll("/offline")` therefore cannot be redirected to /login. Good.

**I5. package.json:5-16 · dead-code (minor).** No `lint` script and no eslint dependency, yet files carry `eslint-disable` comments (item-card.tsx:1, match-sheet.tsx:17). Add `next lint`/eslint or remove the comments. `test:e2e` has no `--project` convenience for the phone profile.

---

## J. Tests and Playwright

**J1. playwright.config.ts:16,19-20 · wrong (coverage).** Only two projects, both Chromium: `iphone` is `devices["iPhone 15"]` with `browserName: "chromium"` (Blink with a Safari UA), and `desktop`. WebKit is absent because `use.launchOptions.executablePath = PW_CHROMIUM` applies to *every* project, so a webkit project would try to launch the Chromium binary. This is why the sheet collapse and other WebKit-only layout bugs never failed a run. Fix: move `launchOptions` into the two Chromium projects, add `{ name: "iphone-webkit", use: { ...devices["iPhone 15"] } }` (default browser webkit), install WebKit + deps in the container (`npx playwright install --with-deps webkit`), and gate the slow suites to the webkit project with `test.describe.configure`.

**J2. playwright.config.ts:10,22-27 · slow.** `timeout: 60_000` per test; `webServer` rebuilds the whole app on every run (`npm run build` ≈ minutes, `reuseExistingServer: false`); `workers: 1`, `retries: 0`. Fix: `reuseExistingServer: !process.env.CI`, build once in CI and `next start` here.

**J3. e2e/shell.spec.ts:3-19 · dead-end (coverage).** Checks only that `/manifest.webmanifest`, `/sw.js`, `/icons/icon-192.png`, `/offline`, `/api/health` return 200. Nothing exercises: SW registration and the offline fallback (`context.setOffline(true)` → expect "Can't reach the closet"), the update/reload bar (none exists), toast visibility/timing (one `toast-ok` assertion in admin.spec.ts:116 in the whole suite), nav `aria-current`, header back on a real page, or a stale action (serve a new `/sw.js` version mid-test). Add those once A1/A3 exist.

**J4. vitest.config.mts:6 · coverage.** `environment: "node"`, no jsdom/happy-dom and no component tests, so Sheet/Toast/Button are untested; `tests/shell/header-back.test.ts` is the only shell unit test and it lacks `/looks/*` (E1). Its `describe("dates in sentences")` block (34-38) belongs in a dates test file.

**J5. No CI.** No `.github/workflows`; nothing runs `typecheck`, `test`, or `test:e2e` on push, so a Safari-only break can reach Railway. Add a workflow (or Railway pre-deploy check) that runs vitest and the WebKit e2e project.

---

## K. Dead ends (a tap with no feedback), consolidated

1. Any action button right after a deploy → `UnrecognizedActionError` → generic "Something slipped · Try again" that cannot succeed (A3) or a silently stuck control (A4, A5).
2. Brand "Use/Add" row stuck on "Adding…" after any rejection (brand-search.tsx:37-44).
3. "Is it this one?" stuck on "Looking at {brand}…" after any rejection (match-sheet.tsx:16).
4. "Ask" inside a pick sheet: toast fires behind the modal; only the inline form closes (ask-to-add.tsx:17 + toast.tsx:33).
5. Sheet grab handle: looks draggable, is not (sheet.tsx:37).
6. Look page: no back control in the header (header-back.tsx:15-37).
7. + tab: no pending state and no current marking on /add (app-nav.tsx:27-30).
8. Person menu options while a switch is pending: disabled but unchanged (person-menu.tsx:41).
9. Full look in pick mode: disabled card, no reason shown (item-card.tsx:30).
10. TextSheet Save disabled with no reason (row-editor.tsx:104).
11. Offline on a slow (not dead) network: white screen, never the offline page (sw-source.ts:38-40).
12. Toasts: not dismissable, hidden under the keyboard (toast.tsx:27,33).
13. Plain `<button>` rows with no `:active` style once the native tap highlight is removed (globals.css:44): brand-search.tsx:53,58,63; match-sheet.tsx:27; body-photo-upload.tsx:50,53; size-sheet.tsx:32; list-editor.tsx:141; closet-search.tsx:40 (search icon). Add `tap` or `active:bg-bone`.

## L. Dead code, consolidated

- `LIFT` export (button-class.ts:8); `Shelf`/`SHELF`/`shelf` (button.tsx:18-21,43,65).
- `--color-background/foreground/muted/surface/border`, `--stone` (globals.css:14,18-27,29); `.mono-12`, `.mono-13` (61-62); `.pill[aria-current="true"]` (102); `.card`, `.stage`, `.pill-accent`, `.pill-on`, `.wait`, `.strip` unused as of this read (80-81,97,128-134,158).
- IBM Plex Mono imports (layout.tsx:4-5) now that nothing is mono.
- `Banner` identical `danger`/`info` tones (banner.tsx:6-10).
- `PageHeader.accent` has no distinct styling any more (page-header.tsx:11): it is just a second word.
- `eslint-disable` comments with no eslint (item-card.tsx:1, match-sheet.tsx:17).
- `Service-Worker-Allowed` header (sw.js/route.ts:11).

---

## Files read (working tree at final read, `wc -l`)

src/components/app-header.tsx 16 · app-nav.tsx 44 · auth-hero.tsx 14 · brand.tsx 25 · closet-search.tsx 55 · dev-mode-banner.tsx 21 · filter-tabs.tsx 42 · forbidden.tsx 11 · header-action.tsx 18 · header-back.tsx 53 · import-queue-provider.tsx 138 · item-card.tsx 41 · items/brand-search.tsx 72 · items/match-sheet.tsx 40 · items/row-editor.tsx 130 · link-pending.tsx 10 · lists/ask-to-add.tsx 23 · lists/entry-fields.tsx 62 · lists/inline-add.tsx 80 · lists/list-editor.tsx 235 · lists/parent-picker.tsx 19 · person-menu.tsx 67 · profile/body-photo-upload.tsx 59 · profile/my-brand-sheet.tsx 61 · profile/size-sheet.tsx 53 · remember-closet.tsx 22 · shop/section-pick.tsx 52 · sw-registrar.tsx 11 · ui/banner.tsx 20 · ui/button-class.ts 33 · ui/button.tsx 77 · ui/card.tsx 7 · ui/field.tsx 15 · ui/input.tsx 24 · ui/new-password.tsx 27 · ui/page-header.tsx 16 · ui/password-input.tsx 15 · ui/sheet.tsx 51 · ui/toast.tsx 42 · ui/undo-strip.tsx 38

src/app/layout.tsx 31 · globals.css 159 · (app)/layout.tsx 36 · (app)/error.tsx 20 · (app)/not-found.tsx 16 · (app)/view-actions.ts 12 · error.tsx 19 · not-found.tsx 11 · page.tsx 5 · offline/page.tsx 16 · manifest.ts 20 · sw.js/route.ts 12 · (auth)/layout.tsx 13 · (flow)/layout.tsx 18 · api/health/route.ts 5 · api/photo/[...key]/route.ts 26 · api/import/open/route.ts 12

src/lib/sw-source.ts 42 · app-url.ts 8 · db.ts 15 · cn.ts 4 · proxy.ts 21 · auth/current.ts 64 · auth/dev-mode.ts 10 · people/visibility.ts 76 · closet-memory.ts 24 · import/client-queue.ts 96

next.config.ts 16 · package.json 55 · playwright.config.ts 30 · vitest.config.mts 13 · railway.json 10 · tests/shell/header-back.test.ts 38 · tests/setup.ts 9 · e2e/shell.spec.ts 19 · e2e/helpers.ts 22

Total 2 842 lines. (No `src/app/forbidden.tsx` exists; `src/components/forbidden.tsx` is used by `(app)/admin/layout.tsx:6`.) Also consulted, not in scope: docs/redesign-2026-11-23.md (107 lines, for intent), node_modules/next/dist/esm/client/components/{unrecognized-action-error.js, router-reducer/reducers/server-action-reducer.js, app-router-headers.js} and server/app-render/manifests-singleton.js (to confirm Next 16.4.6 throws on a stale action rather than reloading), @fontsource CSS for the loaded weights.
