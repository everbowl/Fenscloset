# Review B — import pipeline, storage, photo proxy, closet

Scope read in full (every line): src/lib/import/**, src/lib/storage.ts, src/lib/photos/**, src/lib/images/**, src/lib/items/**, src/lib/closet/**, src/lib/closet-memory.ts, src/app/(app)/add/**, src/app/(flow)/**, src/app/(app)/closet/**, src/app/api/import/**, src/app/api/photo/**, src/app/api/uploads/**, the ImportEntry/ImportBatch/Item/ItemPhoto/BodyPhoto/Person models in prisma/schema.prisma, plus every collaborator these call into (store fetcher, tagger, Claude client, auth, visibility, jobs, service worker, layouts, Sheet). No files were edited.

Severity words: **breaks** (feature does not work), **wrong** (works but does the wrong thing), **slow**, **unsafe** (privacy/SSRF/abuse), **dead-end** (a tap with no feedback or no way forward), **dead-code**.

---

## A. The two demo failures, root-caused

### A1. Closet thumbnails 150–700 ms each, one-hour cache
`src/app/api/photo/[...key]/route.ts:7-21`, `src/lib/storage.ts:88-106`, `src/lib/photos/visibility.ts:19-42`, `src/lib/auth/session.ts:35-54` — **slow**

Every `<img src="/api/photo/thumbs/...">` in the grid does, in series on the server: (1) `getCurrentPerson()` = one `Session` + `Person` join query, and when the session is in its last 15 days a **write** (`session.update`, session.ts:48-52) on every single image; (2) `canViewKey` = 0 extra queries for the viewer's own thumbs, but for the Family view or anyone else's closet it is `person.findUnique` + (minor) `guardianLink.findUnique` + `itemPhoto.findUnique` = 2–3 more round trips per image (visibility.ts:31-41); (3) `getObject` downloads the **whole object into memory** via `transformToByteArray()` (storage.ts:100) and copies it again into a `Uint8Array` (route.ts:14); no streaming. (4) The response carries `Cache-Control: private, max-age=3600` and **no ETag / Last-Modified** (route.ts:18), so Safari refetches every thumbnail after an hour and can never get a 304. Keys are random per content (rotate, refit, untidy all write new keys), so they are safe to cache for a year.

Path: anyone opens Closet (40–60 tiles). Safari fans out ~6 requests at a time; each costs DB + S3 + the full buffer; the grid paints in waves and looks dead for seconds. The Family tab is 3× worse.

Fix: send `Cache-Control: private, max-age=31536000, immutable` and an `ETag` (the key's file id) with `If-None-Match` → 304; collapse the per-image auth to one query (`itemPhoto.findUnique({ where: { bucketKey }, select: { kind, item: { select: { ownerId, owner: { role, status } } } } })`), stream the S3 body instead of buffering, and refresh the session at most once an hour instead of on every request.

### A2. A store-link add that "never locked in the closet"
Several independent paths produce exactly this symptom. All are realistic.

**A2.1 `src/lib/store/add.ts:212-217` + `src/lib/items/service.ts:81` + `src/lib/import/queue.ts:8` — breaks.** `storeIdByName` is find-then-create with no uniqueness handling, and `Store.name` is `@unique`. "Add 2 to closet" from a store not yet in the Stores list makes two entries; the queue runs 2 at a time; both reach `createItemFromEntry` → both miss `findFirst` → the second `store.create` throws a unique-constraint error. In `process.ts:94-99` that throw is caught, logged as `auto-add from store`, and the entry is left in `needs_confirm` with nothing telling the person. The first piece lands, the second "never locks in". Fix: `upsert`/`create` inside a try that re-reads on P2002 (same for `personalClosetId`, service.ts:65-69, which can create two personal closets).

**A2.2 `src/lib/import/process.ts:92-101` — wrong.** The auto-add (C1) only runs when `tags.categoryId` is set. A store product shot that Claude files as "unknown" (bags, accessories, anything not in the category list) silently becomes a confirm card; the store screen has already said "N added to the closet" (`store-screen.tsx:247`). Fix: when the store knows the category (receipt line / page breadcrumbs) pass it in `storeMeta`; otherwise tell the store screen the piece needs a confirm and link to `/add/<batchId>`.

**A2.3 `src/app/(app)/closet/page.tsx:55` — wrong / dead-end.** `pendingAdds` (the new Tagging cards) renders only when `mine && !narrowed`: not on a category tab, not with a search or filter, never in the Family view. A person who was on the Tops tab (the usual case after adding a top) sees nothing, and the piece is not in the grid either. Fix: show pending cards in every view of the owner's own closet; narrow them by category only when `storeMeta`/`aiResult` know it.

**A2.4 `src/lib/import/queue.ts:9-30` + `src/lib/images/remove-bg.ts:30` + `src/lib/ai/claude.ts:19,45` — breaks (highest-impact).** The queue has exactly two in-flight slots and no watchdog. `removeBackground` calls `fetch` with **no timeout**; the Anthropic client is built with `maxRetries: 2` and the SDK's default 10-minute timeout (no `timeout` option). One hung remove.bg or Claude call holds a slot indefinitely; two hold the whole family's pipeline. `openBatch`'s stale re-queue (service.ts:71) is skipped while `isQueued(e.id)` is true — and it is true, because the hung promise is still in `inFlight`. Nothing recovers until a redeploy. Symptom on screen: Tagging card pulsing "A few seconds" forever; the Waiting screen "Tagging · 1 left" forever. Fix: `signal: AbortSignal.timeout(45_000)` on remove.bg, `new Anthropic({ ..., timeout: 60_000, maxRetries: 1 })`, and a watchdog in `pump()` that drops an in-flight id older than ~3 min and marks the entry failed.

**A2.5 `src/lib/import/service.ts:68-72` — slow / dead-end.** After a container restart (deploy during the demo), an entry stuck in `processing` is only re-queued when someone calls `openBatch` *and* 3 minutes have passed. The Tagging card and the Add counter say "a few seconds" for three minutes with no action offered (`retryEntry` accepts `processing`, but no button calls it for that state). Fix: on process start, requeue every `processing`/`uploaded` entry immediately (instrumentation.ts); on the cards, after ~60 s show "Taking long · Try again".

---

## B. Import pipeline (src/lib/import/**, api/import/**)

| # | Where | Sev | What happens / path / fix |
|---|---|---|---|
| B1 | `queue.ts:8-30` | breaks | Per-process in-memory queue; no timeouts (see A2.4). Also unsafe with >1 Railway replica: both instances process the same entry (double remove.bg/Claude spend, orphaned cutouts). Fix: timeouts + watchdog; or a DB-claimed job (`UPDATE ... WHERE status='uploaded' RETURNING`). |
| B2 | `queue.ts:6` | dead-code | Comment says handlers hand off with `after()`; nothing in src calls `after(`. Works today only because Railway is a long-lived Node process. Fix the comment or use `after()`. |
| B3 | `process.ts:50-82` | slow | Fully serial: remove.bg → Claude tag → (rotate) → thumb → phash → `confirmedDuplicate` (loads up to 2000 items with photos + another Claude call + another S3 GET). 10–25 s per photo, ×2 concurrency → a 20-photo pile is 2–4 min; a store link is "10 to 40 seconds". Fix: run `tagItem(normalized)` concurrently with `removeBackground` (orientation/tags do not need the cutout), start `findLikelyDuplicate`'s item load in parallel, raise concurrency to 3–4 once timeouts exist. |
| B4 | `process.ts:48-58` | dead-code / wrong | `let cutoutKey = entry.cutoutKey` is overwritten in both branches (dead read). On a retry the previous cutout and thumb objects are never deleted → bucket leak per retry. Fix: delete `entry.cutoutKey`/`thumbKey` after the new ones are written. |
| B5 | `process.ts:29` | wrong | A second `processEntry` for an entry already `processing` (two taps on Try again, or two replicas) runs the whole pipeline twice; the later write wins, the earlier objects orphan. Fix: claim with `updateMany({ where: { id, status: { in: [...] } } })` and bail when 0 rows. |
| B6 | `process.ts:93-99` | wrong | Auto-add failure is swallowed (`console.error`) and the person is told nothing (A2.1/A2.2). Fix: record the reason in `entry.error` and surface it on the Tagging card. |
| B7 | `service.ts:22` | dead-code | `include: { _count }` on the open-batch lookup is unused. |
| B8 | `service.ts:46` | slow | `importEntry.findFirst({ where: { originalKey } })` — `originalKey` has no index/unique; full scan per registered photo as the table grows. Fix: `@unique` on `originalKey`. |
| B9 | `service.ts:21-30` + `api/import/batches/route.ts:11` | wrong / dead-end | `total` is added when the phone *picks* photos, before any upload. Pick 20, all uploads fail (HEIC from Files, offline), tap "Remove these": a batch with `total` 20 and 0 entries stays `open` forever (`finishBatchIfDone` is only called from confirm/skip/merge). The Add screen is then stuck in batch mode: "000 / 020 · All done · Nothing waiting", Confirm disabled, no door back to "How are you adding?" (`add-screen.tsx:60,87-144`); "Let them go" only appears when `batch.failed.length > 0`. Also `total` 0 is accepted though the message says 1–2000. Fix: count `total` from entries (or decrement on `dropFailedUploads`) and let `openBatch` close a batch with no live entries. |
| B10 | `service.ts:63` + `(flow)/add/[batchId]/page.tsx:28` | wrong | `openBatch` returns the *newest* open batch, ignoring the `batchId` in the URL. Two open batches can exist after a race in `getOrCreateOpenBatch` (phone + iPad, or a store add racing a photo pick). The older batch's entries are never re-queued and never shown. Fix: `@@unique([personId, status])`-style guard or `openBatch(personId, batchId?)`. |
| B11 | `split.ts:75,95-99` | wrong | Splitting an `uploaded` entry races the worker: the original is marked `skipped`, then `processEntry` (already running) writes `needs_confirm` unconditionally (process.ts:86-89) and the "stepped aside" photo comes back as a card beside its pieces. Fix: only allow split from `needs_confirm`, or guard the final update with `where: { status: "processing" }`. |
| B12 | `split.ts:89-94` | slow | Crops are uploaded and inserted one at a time; parallelise with `Promise.all`. |
| B13 | `pending.ts:30` | slow | Tagging cards use `originalKey` (1600 px, 300–600 KB) in a 214 px tile; ten pending cards ≈ 5 MB through the proxy. Fix: make a 400 px thumb at register time (or use `thumbKey` once it exists). |
| B14 | `rotate-entry.ts:18-25` | slow | Four serial bucket round trips + phash; "Turning…" takes 2–4 s on a 3 MB PNG cutout. Parallelise put(cutout) with makeThumb/put(thumb)/phash. |
| B15 | `client-queue.ts:93` and the same sequence in `confirm-card.tsx:173`, `item-editor.tsx:147`, `store-screen.tsx:296`, `body-photo-upload.tsx:31` | dead-end | `fetch(signed.url, { method: "PUT" })` has no timeout or retry. A stalled cellular PUT hangs forever: the Add counter says "Uploading · 1 left" indefinitely (one of two slots gone), the confirm card says "Saving the photo…" indefinitely. Fix: `AbortSignal.timeout(60_000)` + one retry, surface "Upload timed out · Try again". |
| B16 | `client-queue.ts:94` + `add-screen.tsx:163-171` | wrong | A HEIC that reaches the server (desktop Safari, Files app, AirDrop) fails at `/api/uploads/sign` with "Use a JPEG, PNG or WebP photo."; `plainError` matches neither "heic" nor "unsupported image" and tells the person "Something went wrong. Try again in a moment." — retrying cannot help. Fix: match "jpeg, png or webp" → the screenshot advice. |
| B17 | `import-queue-provider.tsx:50` | slow | `pendingStore.all()` reads **every pending Blob** out of IndexedDB on every loop iteration (after each pair of uploads). 150 photos × ~300 KB = ~45 MB read per iteration on an iPhone. Fix: store metadata rows and `get(id)` one blob at a time. |
| B18 | `import-queue-provider.tsx:87-92` | wrong | Photos are shrunk on the main thread one by one *before* they are written to IndexedDB. Backgrounding Safari mid-way (very common while 150 photos shrink) suspends JS; files not yet written are lost, contrary to "closing the tab mid-batch loses nothing" (client-queue.ts:4-6). Also 150 × ~150 ms canvas work = 20+ s of jank. Fix: write the raw File to IDB first, shrink at upload time (or in a Worker). |
| B19 | `import-queue-provider.tsx:55-66` | slow | `await Promise.all(slice)` waits for both uploads before starting the next pair (not a true pool of 2). Minor. |
| B20 | `import-queue-provider.tsx:123-128` + `tagging-cards.tsx:23-27` + `waiting.tsx:12-15` | slow | Three independent 2.5 s pollers can run on one screen while tagging: the root provider hits `/api/import/open` (which runs `openBatch` with its enqueue scan), and `TaggingCards`/`Waiting` call `router.refresh()`, which re-renders the **entire** closet/confirm page on the server (closet: ~20 queries, see C1). This is the "pages felt dead" feel while a batch runs. Fix: one poller (the provider); have TaggingCards read its `batch` from context and `router.refresh()` only when the counts change. |
| B21 | `api/uploads/put/route.ts:20-22` | unsafe | The whole body is buffered (`req.arrayBuffer()`) before the 12 MB check; a 1 GB PUT from any signed-in member is fully read first. Fix: reject on `Content-Length` > MAX before reading, and stream to S3. |
| B22 | `api/uploads/sign/route.ts:15` | wrong | Blacklist (`cutouts`, `thumbs`) instead of a whitelist: a member can sign uploads into `tryon/`, `mannequin/`, `looks/` (server-generated kinds). Harmless today (owner-only visibility) but should be `["originals","labels","worn","avatars","bodies","checkins","fits","shop","inspo"]`. |
| B23 | `api/uploads/put/route.ts:16` | wrong | A parent may PUT into a minor's key only if the token was signed for it — fine — but the guardian lookup runs even when the signature is already invalid; reorder to verify the token first (cheap) then the DB lookup. Minor. |

## C. Closet listing, sort, filter, item page

| # | Where | Sev | What happens / fix |
|---|---|---|---|
| C1 | `closet/page.tsx:30-56` | slow | Eight **sequential** awaits that do not depend on each other: `resolveView` → `listEntries(category)` → `loadClosetView` → `mirrorConfig` (tryOnState 2 q, mirrorWardrobe 2 q, mirrorEngines, hasBackPhoto) → `countCleanOut` (2× `getRuleNumber` + 2 findMany + groupBy) → `listNeeds` → `Promise.all(...)` → `pendingAdds`. ≈20 queries, ~8 round trips, on every closet render and every 2.5 s poll (B20). `(app)/layout.tsx:22` already ran `resolveView` for the same request (duplicate). Fix: `Promise.all` the independent groups; `cache()` `resolveView`; compute `mirrorConfig` lazily (only when Mirror is tapped) or cache it per request. |
| C2 | `closet/[itemId]/page.tsx:12-16,21` | slow | `generateMetadata` and the page both call `getItemDetail` — the 13-relation include runs twice per item open. Plus `loadItemLists` (13 list queries) + `mirrorConfig` + `wearHistory` every time. Fix: wrap `getItemDetail` in React `cache()`; `select: { name }` for metadata. |
| C3 | `items/query.ts:142-156` (working tree; 132-146 at HEAD) | slow (acceptable) | `loadClosetView` pulls every item with 9 relation arrays plus, since an uncommitted edit made during this review, a `brand` join and `createdAt` for the new `brandName`/`isNew` card fields (`query.ts:34-41,24-25`). Prisma issues one query per relation for the whole set — not N+1 — and sorts/filters in JS. Fine for hundreds; will not scale past a few thousand. The same edit changed `components/item-card.tsx` (4:5 "stage" tile, brand bold, New badge); every tile still loads through `/api/photo/<thumbKey>` with `loading="lazy" decoding="async"`, so A1 applies unchanged. No action now beyond A1. |
| C4 | `items/duplicates.ts:17-23` | slow | `findLikelyDuplicate` loads up to 2000 items with a `colors take 1` and `photos take 1` relation per call, once per processed photo and again on the confirm page for older entries. Fix: select only `id, phash, categoryId, brandId` and fetch the hit's thumb afterwards. |
| C5 | `items/service.ts:310-324` + `item-editor.tsx:129-132,256` | dead-end | "Split one off" copies every photo object (GET+PUT each, serial) — several seconds — while the pill shows no busy state (just `disabled`). Fix: "Splitting…" label; parallelise copies. |
| C6 | `item-editor.tsx:167` | dead-end | Rotate on a saved piece takes 1–3 s with no label change ("Rotate ↻" stays; only `disabled`). Fix: "Turning…" like the confirm card. |
| C7 | `items/service.ts:433-438` | wrong | `deleteItem` deletes the bucket objects but the `ImportEntry` still points at `originalKey/cutoutKey/thumbKey` (`itemId` SetNull); `untidyAll` and `pendingAdds` tolerate missing objects, but `splitEntry`/`readBackForEntry` on such an entry 500. Edge; low. |
| C8 | `items/untidy.ts:80` + `instrumentation.ts:9-12` | wrong (cost) | `UNTIDY_SET` is never recorded while **any** piece fails (`report.failed > 0`); `untidyOnStart` then re-scans every done entry and re-calls remove.bg for the failing ones **every hour, forever**, and again on every deploy — competing with the live import for remove.bg credits/rate limit. Fix: mark `recut:failed:<code>` after N attempts; stop on `no_key`/credit errors. |
| C9 | `items/refit.ts:11-37` | slow | One-time admin tool; serial GET/PUT per cutout, no progress. Fine as admin-only. |
| C10 | `closet/clean-out/clean-out-list.tsx:29-39` | ok | Good: optimistic removal + 6 s undo; errors shown. No finding. |
| C11 | `closet-memory.ts` | ok | Guarded sessionStorage; no finding. |
| C12 | `closet/needs.ts:36-45` | ok | Parallel; minors get no body rows. No finding. |

## D. Photo proxy, storage, privacy

| # | Where | Sev | What happens / fix |
|---|---|---|---|
| D1 | `api/photo/[...key]/route.ts:18` | slow | `max-age=3600`, no ETag (A1). Content-keyed objects → `immutable`, 1 year. |
| D2 | `api/photo/[...key]/route.ts:13-14`, `storage.ts:100` | slow | Full buffering (A1). Stream `res.Body` (a `Readable`) straight into the `Response`. |
| D3 | `storage.ts:108-114` | slow | `objectExists` in S3 mode **downloads the whole object** (`getObject`) to test existence; `mannequin.ts:38` then downloads it again. Use `HeadObjectCommand`. |
| D4 | `photos/visibility.ts:31-41` | slow | 2–3 queries per non-owner thumbnail (A1). One joined query. |
| D5 | `photos/visibility.ts` (all) | ok (privacy) | Checked every kind: owner always; `bodies` → owner/parent/grant with only-me honoured; `tryon` owner-only; `checkins`/`inspo` owner + parents; minor `worn` blocked for non-parents; unconfirmed `originals/cutouts/thumbs` (no ItemPhoto) 404 to everyone but the owner; 404 not 403 (no existence leak). Receipts under `labels/` have no ItemPhoto row → owner-only while they exist. **No privacy finding.** Note only: `canSeeBodyData` trusts that no `BodyDataGrant` exists for a minor (enforced at grant time by `canGrantBodyAccess`); a belt-and-braces `owner.role !== "minor"` check in `canSeeBodyPhotoKey` would cost one query that is already made. |
| D6 | `storage.ts:157-161` + `tryon/kling.ts:33,100` | ok | Presigned GET TTL 900 s for the try-on provider; `assertReady` refuses minors before any key is signed (tryon/index.ts:116,126,136). No finding. |
| D7 | `storage.ts:19` | ok | No HEIC in `IMAGE_TYPES` is intentional; iOS converts on pick. See B16 for the error wording when one slips through. |
| D8 | `auth/session.ts:48-52` via every photo request | slow | Session refresh write on every image when <15 days remain (A1). Throttle to once per hour. |
| D9 | `app/sw.js` / `lib/sw-source.ts:17-41` | ok | The service worker does not intercept `/api/photo` (no stale 404s, but also no help). Fine once D1 is fixed; browser cache does the work. |

## E. Store link, receipts, tagger, outside calls

| # | Where | Sev | What happens / fix |
|---|---|---|---|
| E1 | `shop/page.ts:14-19,81,100` | unsafe (SSRF) | `normalizeUrl` blocks literal private IPv4 ranges and `.local`, but not IPv6 (`[::1]`, `[fd00::]`), decimal/hex IPs (`2130706433`, `0x7f000001`), or hostnames that resolve to private addresses; and both `readProductPage` and `fetchImage` follow redirects (`redirect: "follow"` / default) without re-checking the final host. A member pasting a link to a page that 302s to `http://169.254.169.254/…` or a Railway-internal service makes the server fetch it. Impact is bounded (HTML is only parsed for OG tags; images must be `image/jpeg|png|webp` ≤ 8 MB to be stored), but it is the family's server reaching inside. Fix: resolve DNS and reject private ranges (v4+v6) per hop with `redirect: "manual"`, or route store fetches through an egress allow-list. |
| E2 | `store/match.ts:72-80` | unsafe (SSRF) | `saveRetailPhotos` calls `fetchImage(u)` on `pick.imageUrl`/`page.imageUrl` **without `normalizeUrl`** at all; `pick` is a client-supplied `Product` from `matchEntryAction`/`matchItemAction` (brands/actions.ts:28-36). Any URL string a member sends is fetched. Fix: `normalizeUrl` + E1 checks inside `fetchImage` itself. |
| E3 | `shop/page.ts:87` | slow / unsafe | `res.text()` reads the entire body before `.slice(0, 2_000_000)`; a huge page is fully buffered. Cap by reading the stream to 2 MB. |
| E4 | `shop/page.ts:103` + `store/add.ts:167-168` | wrong | `fetchImage` accepts only `image/jpeg|png|webp`. Store CDNs commonly answer `image/avif`, `image/gif`, `image/jpg`, or `application/octet-stream` → `null` → "The store's photo could not be downloaded" and the **whole add fails** even though the preview showed. Fix: accept AVIF/GIF/octet-stream and sniff with `sharp(buf).metadata()`, transcoding to JPEG. |
| E5 | `store-screen.tsx:181,209,63,348` + `go-with-screen.tsx:109` | wrong / dead-end | Store images are hot-linked with `referrerPolicy="no-referrer"`, `alt=""`, and no `onError`. Many stores 403 hot-links; `http://` images are blocked as mixed content. The person sees an empty bone box and cannot tell whether a photo exists or whether "Add" will work. Fix: `onError` → placeholder text ("Photo will be fetched when added" / "No preview"), or proxy previews through the server fetch that will be used anyway. |
| E6 | `add/store/actions.ts:50-61` + `store-screen.tsx:290-302` | unsafe (privacy promise) | "Each is read once and deleted" holds only if `readReceiptAction` runs. The phone PUTs the receipt into `labels/<me>/…` and *then* calls the action; if the tab is closed, the connection drops, or the action fails to dispatch, the receipt (order number, address, card digits) stays in the bucket forever with no DB row — invisible to admins, never cleaned. Fix: upload and read in one server action (pass the image bytes/`FormData` to the action, never a key), or a lifecycle rule / sweep deleting `labels/` objects with no `ItemPhoto` row older than an hour. |
| E7 | `add/store/actions.ts:53,60` | wrong | The same action accepts *any* of the member's `labels/` keys and deletes it in `finally` — including a label photo already attached to one of their items (dangling `ItemPhoto`). Self-inflicted only. Fix: tag receipt uploads with their own kind or prefix. |
| E8 | `add/store/actions.ts:70-78` | slow | `addReceiptsAction` runs `createStoreEntries` (a 12 s-timeout image fetch each) **serially** across up to 40 receipts × 25 lines inside one server action; "Adding…" for minutes, risk of hitting the action timeout. Fix: `mapLimit(…, 4)`. |
| E9 | `store/add.ts:190-201` | slow | `createStoreRows` likewise serial; 7 colors = 7 serial image downloads + 7 `getOrCreateOpenBatch` round trips. Parallelise with a limit; call `getOrCreateOpenBatch` once. |
| E10 | `store-screen.tsx:247,365` | wrong (copy) | "N added to the closet · Watch them land" is said when the entries are merely uploaded; they may still need a confirm (A2.2) or fail. Fix: "N on their way · tagging now" and link to the batch when a confirm is needed. |
| E11 | `ai/claude.ts:19,45-53` | slow / breaks | No `timeout` on the Anthropic client; `maxRetries: 2` × default 10-min timeout = one tag call can hold a queue slot for 30 min (A2.4). No partial-result handling is needed (structured JSON), but `structured()` retries a bad-JSON answer once (claude.ts:62) — that is fine. Fix: `timeout: 60_000, maxRetries: 1`. |
| E12 | `images/remove-bg.ts:30` | breaks | No `AbortSignal` (A2.4); no retry on 429/5xx (acceptable: becomes a `bg_failed` warning and the original is used). Add the timeout. |
| E13 | `images/thumb.ts:5` | wrong | `normalizeOriginal` re-encodes PNG input to JPEG without `flatten()`; sharp drops alpha onto **black**. A store product PNG with a transparent background → black-background normalized image → if remove.bg fails, the thumb (`makeThumb` flattens white but receives the already-black JPEG) and the AI image have a black background. Fix: `.flatten({ background: "#ffffff" })` before `.jpeg()`. |
| E14 | `ai/tag-item.ts:168-180` | ok | Schema-constrained enums, `pieceCount`, `orientation`; mapping never invents ids. No finding beyond E11. |
| E15 | `items/duplicates.ts:51-55`, `ai/same-garment.ts:25` | ok (by design) | Silent catches return "no hint" — acceptable for a hint; log at debug level so failures are visible. |
| E16 | `images/google-image.ts` | ok | 90 s timeout, backoff, 5-min quota hold. Not used by import. No finding. |

## F. Flow screens: confirm card, waiting, add screen

| # | Where | Sev | What happens / fix |
|---|---|---|---|
| F1 | `add/add-screen.tsx:58` | slow / dead-end | Until `/api/import/open` answers (`loaded`), the Add screen is a blank 380 px bone block with no words — on a slow connection the first thing the person sees on "+" is nothing. Fix: render the three doors immediately; swap to batch mode only when a batch arrives. |
| F2 | `(flow)/add/[batchId]/waiting.tsx` | dead-end | Shows "Tagging · N left · The next piece will appear here" with only an X. If an entry is stuck in `processing` (A2.4/A2.5) there is no Try again / Skip; `retryEntry` already allows `processing` but nothing calls it from here. Fix: after 60–90 s show "Taking long · Try again" and "Skip it". |
| F3 | `confirm-card.tsx:70,298-299` | wrong | One shared `useTransition`: *any* action (edit a row, split, skip, merge) flips the main button to "Saving…" and disables it, even though nothing is being saved. Fix: separate pending flags per action. |
| F4 | `confirm-card.tsx:138-141,199,247` | dead-end | "Several pieces?" / "Split into N" runs a 5–15 s Claude call; the pill is only `disabled`, the card looks frozen (the main button says "Saving…", F3). Fix: "Splitting…" label and a note "Finding each piece…". |
| F5 | `confirm-card.tsx:142` | dead-end | `skip()` ignores the action result; a failed skip leaves the card with no message. Fix: check `r.ok`, show the error. |
| F6 | `add/let-them-go.tsx:20` | dead-end | `abandonBatchAction` result ignored; on failure the sheet closes and the pile stays with no message. Fix: check `ok`. |
| F7 | `add/add-screen.tsx:150`, `failed-actions.tsx:17`, `tagging-cards.tsx:50-52` | dead-end (partial) | "Try again" fires N POSTs; add-screen/failed-actions never check the responses (TaggingCard does). A 403/500 → nothing changes, no message. Fix: check `ok`, toast. |
| F8 | `confirm-card.tsx:54` | wrong | `useState(() => … typeof window !== "undefined" && !sessionStorage…)` differs between server (false) and client (true) render → React hydration mismatch on every card with a duplicate hint (console error, client re-render). Fix: initialise `false` and set in `useLayoutEffect` like `askMore` (line 51). |
| F9 | `confirm-card.tsx:123-133` | slow | Each confirm = server action (createItemFromEntry: ~8 queries + transaction) **then** `router.refresh()` (full page: openBatch, loadTagLists ×7, listMyBrands, entry fetch, maybe findLikelyDuplicate). Two round trips, ~1–2 s on cellular, per photo. Fix: have the action return the next entry's card data (or at least `nextConfirmId`) and `router.replace(?entry=…)` with prefetch. |
| F10 | `(flow)/add/[batchId]/page.tsx:67` + `confirm-card.tsx:210` | slow | The hero is `cutoutKey ?? originalKey`: a 1600 px PNG with alpha is often 1–3 MB, downloaded through the proxy (A1) for each card, and again after Rotate. Fix: write a 1024 px display cutout (or JPEG-with-white) alongside, keep the full PNG for the mirror. |
| F11 | `(flow)/add/[batchId]/page.tsx:56` | wrong (edge) | `findUniqueOrThrow` after `openBatch` chose `nextConfirmId`: confirming the same card from another tab in between → 500 error page. Use `findUnique` and redirect to `/add/<batchId>`. |
| F12 | `add/store/store-screen.tsx` (LinkTab) | ok | Look up / Read it / find a photo / Add all show busy words and errors. No finding beyond E5/E10. |
| F13 | `add/photo-tips.tsx:19` | ok | Toggle in a transition + refresh; fine. |

## G. iOS Safari / WebKit specifics (client components in area)

| # | Where | Sev | Note |
|---|---|---|---|
| G1 | `components/ui/sheet.tsx:47` | ok (fixed today) | `flex-auto` replaces `flex-1` (the `flex: 1 1 0%` child of an auto-height column that Safari sizes to 0). The same `flex-1` pattern remains in `(flow)/add/[batchId]/page.tsx:41`, `waiting.tsx:17`, `confirm-card.tsx:188`, `add-screen.tsx:69,126`; those parents are `min-h-dvh` columns or row flexes, so Safari resolves them — but **check the All-done and Waiting screens on a real iPhone** (they have not been fixed with the Sheet and would collapse the same way if the parent height is ever indefinite). |
| G2 | `sheet.tsx:35` | ok / check | `max-h-[90dvh]` inside a `<dialog>`: on iOS the layout viewport does not shrink for the keyboard, so a sheet with a text field (Rename, Size, Fit notes, store size) can have its Save button under the keyboard; the person must dismiss the keyboard first. Consider `max-h-[80svh]` or pinning the save button as `footer`. |
| G3 | `add-screen.tsx:46` | ok | `<input type="file" accept="image/*" capture="environment">` forces the camera (intended for "Take a photo"); `multiple` correctly omitted. In standalone PWA mode iOS ≥15 handles this. |
| G4 | `client-queue.ts:47-70` | ok / note | `createImageBitmap` honours EXIF on Safari ≥15; canvas re-encode strips EXIF (so the server's `.rotate()` is a no-op for phone uploads — the Claude `orientation` pass is what fixes sideways photos). First halving canvas is ≤ half the camera frame (48 MP → 12 MP) so under iOS's canvas limit. HEIC: see B16. |
| G5 | `closet-grid.tsx:66`, `app-nav.tsx:21`, `confirm-card.tsx:297` | ok | Fixed pick bar sits at `76px + safe-area` above the fixed nav; confirm bar is `sticky bottom-0` with safe-area padding; no `100vh` anywhere (`dvh` only). Good. |
| G6 | `tagging-cards.tsx:23-27` | slow | `setInterval(router.refresh, 2500)` keeps firing in a backgrounded tab until iOS suspends it; pause on `visibilitychange`. |

## H. Dead ends — every tap with no (or misleading) feedback

1. Tagging card "On its way · A few seconds" while the worker is hung or the container restarted (A2.4/A2.5) — no action for `processing`.
2. Waiting screen "Tagging · N left" with only an X (F2).
3. Add screen "All done · Nothing waiting" with Confirm disabled and no way back to the doors when a batch has `total` but no entries (B9).
4. Add screen blank bone block before `/api/import/open` answers (F1).
5. "Uploading · 1 left" forever on a stalled PUT (B15); "Saving the photo…" forever on the confirm card / item page / body photo (B15).
6. "Several pieces?" / "Split into N" — disabled only; main button lies "Saving…" (F3/F4).
7. Skip / Let them go / Try again (add-screen, failed-actions) — result ignored on failure (F5/F6/F7).
8. Item page Rotate and "Split one off" — multi-second with no label change (C5/C6).
9. Store screen: empty bone boxes where hot-linked store images are blocked; no text (E5). "Add N to closet" then fails with "could not be downloaded" after the preview showed (E4).
10. Store screen "N added to the closet" when they are only uploaded / need a confirm (E10, A2.2) and the closet shows nothing on a category tab or Family view (A2.3).
11. HEIC upload failure tells the person to "try again" (B16).

## I. Things checked and found sound

- Key format `kind/ownerId/id.ext` strictly parsed everywhere (`parseKey`); traversal impossible; owner read off the key for visibility.
- Signed upload tokens: HMAC over key|contentType|exp, 600 s, timing-safe compare; put route re-checks owner/guardian and content-type match.
- Receipts are deleted in `finally` when the read action runs (E6 covers the gap when it does not).
- Minors never reach the try-on provider (`assertReady`), body photos need approval (`bodyPhotosAllowed`), `listNeeds` gives minors no body rows.
- `/api/photo` returns 404 for both "not allowed" and "missing".
- Prisma relation loads in the closet are set-based, not per-row (no N+1 in listing/sort/filter).
- `jobs.ts` (go-with) is in-memory by design; a restart yields "That search is gone. Try again." with a working Try again — acceptable, unlike the import queue.
- Service worker never caches API responses.

---

## Files read (full, every line) — line counts

prisma/schema.prisma 1116 · src/lib/storage.ts 169 · src/lib/closet-memory.ts 24 · src/lib/closet/needs.ts 79 · src/lib/images/google-image.ts 83 · src/lib/images/phash.ts 30 · src/lib/images/remove-bg.ts 44 · src/lib/images/rotate.ts 10 · src/lib/images/thumb.ts 38 · src/lib/import/client-queue.ts 96 · src/lib/import/pending.ts 34 · src/lib/import/process.ts 174 · src/lib/import/queue.ts 35 · src/lib/import/rotate-entry.ts 27 · src/lib/import/service.ts 98 · src/lib/import/split.ts 101 · src/lib/items/copies.ts 60 · src/lib/items/duplicates.ts 56 · src/lib/items/query.ts 170 · src/lib/items/refit.ts 37 · src/lib/items/service.ts 443 · src/lib/items/untidy.ts 135 · src/lib/items/views.ts 156 · src/lib/photos/visibility.ts 85

src/app/(app)/add/actions.ts 13 · add-screen.tsx 172 · let-them-go.tsx 25 · page.tsx 13 · photo-tips.tsx 54 · store/actions.ts 83 · store/page.tsx 12 · store/store-screen.tsx 375
src/app/(flow)/layout.tsx 18 · add/[batchId]/actions.ts 94 · confirm-card.tsx 384 · failed-actions.tsx 22 · page.tsx 78 · waiting.tsx 34
src/app/(app)/closet/page.tsx 89 · closet-grid.tsx 79 · closet-tools.tsx 122 · needs-actions.ts 22 · needs-strip.tsx 88 · pick-context.tsx 14 · tagging-cards.tsx 83 · [itemId]/page.tsx 53 · [itemId]/actions.ts 74 · [itemId]/item-editor.tsx 376 · [itemId]/go-with/page.tsx 25 · go-with/actions.ts 52 · go-with/go-with-screen.tsx 148 · clean-out/page.tsx 27 · clean-out/actions.ts 20 · clean-out/clean-out-list.tsx 116
src/app/api/import/batches/route.ts 14 · batches/[id]/entries/route.ts 19 · entries/[id]/process/route.ts 17 · open/route.ts 12 · src/app/api/photo/[...key]/route.ts 26 · src/app/api/uploads/put/route.ts 25 · sign/route.ts 24

Collaborators read in full because the area calls them: src/components/import-queue-provider.tsx 138 · item-card.tsx 41 · ui/sheet.tsx 51 · ui/undo-strip.tsx 38 · profile/body-photo-upload.tsx 59 · remember-closet.tsx 22 · closet-search.tsx 55 · link-pending.tsx 10 · app-nav.tsx 44 · sw-registrar.tsx 11 · src/lib/sw-source.ts 42 · src/app/sw.js/route.ts 12 · src/lib/store/add.ts 217 · store/receipt.ts 104 · store/match.ts 142 · src/lib/shop/page.ts 108 · shop/go-with.ts 127 · src/lib/jobs.ts 75 · src/lib/ai/claude.ts 74 · ai/tag-item.ts 180 · ai/read-label.ts 26 · ai/same-garment.ts 26 · src/lib/auth/current.ts 64 · auth/session.ts 62 · src/lib/people/visibility.ts 76 · src/lib/outfits/cleanout.ts 86 · src/lib/tryon/config.ts 23 · src/lib/tips.ts 31 · src/lib/brands/actions.ts 36 · src/lib/db.ts 15 · src/proxy.ts 21 · src/instrumentation.ts 17 · src/app/layout.tsx 31 · src/app/(app)/layout.tsx 36 · next.config.ts 16

Spot-read (grep/sed, not whole): src/lib/shop/products.ts (fetch timeouts 8 s, `isProductSearchConfigured`), src/lib/tryon/index.ts (`tryOnState`, `assertReady` minor guard), src/lib/tryon/kling.ts (`LINK_TTL_S` 900 s), src/lib/tryon/wardrobe.ts (two queries), src/lib/rules.ts (`getRuleNumber`, uncached), src/lib/profiles/service.ts (`addBodyPhoto` approval check), src/app/(app)/profile/actions.ts (`addBodyPhotoAction`), src/app/globals.css (`.pill`, `.tap`, `safe-*`, `dialog.sheet`), package.json (next 16.4.6, sharp 0.35, @aws-sdk/client-s3, @anthropic-ai/sdk 0.135).

Total fully read: 8,318 lines across 95 files (line counts at the time of reading; `src/lib/items/query.ts` is now 181 lines and `src/components/item-card.tsx` was restyled by an uncommitted edit that landed during the review — both re-read, see C3).
