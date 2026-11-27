# Review E — Shop, Store, Brands, Lists, Profiles, Rules, Tips, Help

Scope: `src/lib/shop/**`, `src/lib/store/**`, `src/lib/brands/**`, `src/lib/lists/**`, `src/lib/profiles/**`, `src/lib/rules.ts`, `src/lib/rules-kind.ts`, `src/lib/tips.ts`, `src/app/(app)/shop/**`, `src/app/(app)/profile/**`, `src/app/(app)/help/**`, tests under `tests/shop|store|lists|profiles`, e2e specs for shop / profile / looking-for / brand-feed / store / help, the rules admin page (read because the brief asked about validation, mirrorEngine and the accent injection), and the listed Prisma models. Every file in scope was read in full with `cat -n`; the four parsing claims marked **(verified)** were reproduced with a scratch script against the exact regexes. No file was edited.

Severity words: **breaks** (feature does not work), **wrong** (works, wrong result), **slow**, **unsafe** (privacy / SSRF), **dead-end** (tap with no feedback or no way forward), **dead-code**.

## Top ten, in the order I would fix them

| # | Where | Severity | One line |
|---|-------|----------|----------|
| 1 | `profile/brands/page.tsx:19` + `lib/profiles/brands.ts:23` | unsafe | Any family member who switches the header to a minor sees the minor's sizes by brand ("Tops L · Bottoms 32"). |
| 2 | `lib/shop/page.ts:81,94-108` + `lib/shop/engine.ts:193` | unsafe | Store page fetch follows redirects with no re-check, and `og:image` is fetched with no guard at all: a pasted link can make the server call `169.254.169.254` or `*.railway.internal`. |
| 3 | `lib/rules-kind.ts:68-74` + `lib/rules.ts:10-14` | breaks | Setting "Hours between store searches" to 0 (the documented Off) turns the row into an On/Off toggle whose "Off" silently means 24 hours; no way back without the database. |
| 4 | `lib/shop/wants.ts:104-116` + `looking-for/[wantId]/want-screen.tsx:25-26,69-71` | breaks / dead-end | A want whose first search fails is "Searching the stores…" forever: Edit / Search now / Found it disabled, the page reloads every 3 s, and the sweep retries (and re-pays Claude) every 30 min. |
| 5 | `lib/shop/page.ts:26` | wrong | `content="Women's Ribbed Tank"` is read as "Women" **(verified)**: half of clothing titles have an apostrophe, and the verdict card and AI read get the wrong name. |
| 6 | `lib/shop/engine.ts:261-266` + `shop/page.tsx:22-25` | slow | Shop page runs ~100 sequential DB round trips before first paint (`listRecent` is 20 × 2–4 queries, `shoppingFor` is N people × 2, plus a dozen more awaits). |
| 7 | `lib/ai/claude.ts:19,45` | slow | Anthropic client has no timeout (SDK default 10 min) × `maxRetries: 2` × one JSON retry: a hung call pins a lookup job for up to 30 min while the phone shows "Judging it… 900s". |
| 8 | `lib/shop/engine.ts:98-123` + `lib/shop/products.ts:5-9` | unsafe | "Queries never carry measurements" is enforced only by prompt text; the same Claude call sees sizes and measurements and writes the Serper queries, and nothing scrubs them in code. |
| 9 | `lib/lists/service.ts:106-128` + `prisma/schema.prisma:601` | wrong | Deleting a brand from Lists cascades every person's `BodySizeByBrand` rows silently; stores/colors/sections drop out of favorites and loved/avoid lists with no warning. |
| 10 | `profile/settings/page.tsx:14` | slow | `listCalendars` does a Google token refresh + API call (10 s timeout) sequentially on every Settings open once a calendar is connected. |

---

## A. Privacy and authorization

**A1. Minor's (and any adult's) sizes by brand readable by anyone in the family — unsafe (high).**
`src/app/(app)/profile/brands/page.tsx:19` calls `listMyBrands(owner.id)`; `src/lib/profiles/brands.ts:23-32` returns `BodySizeByBrand` rows with no viewer parameter; `favorites-editor.tsx:58-66` renders "My sizes by brand" with `Tops L · Bottoms 32` for every row. Only `likely` is gated on `canSeeBodyData` (brands/page.tsx:21). `visibility.ts:49` defines body data as "measurements, sizes, fit notes, body photos", and `viewableClosets` (visibility.ts:9) lets any member switch the header to any person.
Path: Olivia (adult member, not a parent) taps her name → Mya → Profile → "Favorite brands & stores" → reads Mya's sizes. Same for Jeff's sizes to Brittney without a grant. The body page itself is correctly gated (`getBodyProfile`, service.ts:55), so the Profile row says "Private" while the Brands page leaks the same numbers. The unit test `tests/profiles/my-brands.test.ts:62` reads `listMyBrands(mya.id)` with no viewer, so nothing catches it.
Fix: give `listMyBrands` a `viewer` and return `sizes: []` (or hide the whole section) unless `canSeeBodyData(viewer, ownerId)`, and add the sibling assertion to the test.

**A2. `sizeNote` from body data shown to a shop-for grantee without a body grant — unsafe (low-medium).**
`src/lib/shop/engine.ts:238` lets anyone who `canShopFor` read a lookup; the stored verdict carries `sizeNote` ("size M by your Everlane size", engine.ts:105/111) computed when the *shopper* could see body data. `shop-screen.tsx:235` prints it. `listRecent` (engine.ts:262) filters to the viewer's own lookups, but `/shop?for=X&l=<id>` (page.tsx:23) is not filtered. Minors can't grant, so this is adult-to-adult (Jeff grants Brittney shop-for only; Jeff's own lookup id is in a URL he shares or she sees over his shoulder).
Fix: in `getLookup` null `sizeNote` and set `usedBodyData:false` when `!(await canSeeBodyData(viewer, row.forPersonId))`.

**A3. Fit notes go to Claude for shoppers who may not see body data — unsafe (low).**
`engine.ts:209` and `go-with.ts:79` call `styleContext(forPersonId)`, which (`lib/outfits/catalog.ts:106-110`) includes `bodyProfile.fitNotes`; `bodyContext` (engine.ts:93) adds the same line again when allowed. So Brittney (shop-for only) judging for Jeff sends "Fit notes: short torso, size up in jackets" in the prompt and the `reason` may echo it.
Fix: strip the Fit-notes line from `style` in `lookup`/`goWith` when `canSeeBodyData` is false (or give `styleContext` an `includeFit` flag).

**A4. Measurements are kept out of Serper queries by prompt only — unsafe (medium).**
`engine.ts:116` puts `body.text` (sizes by brand, measurements with units, fit notes) in the `decide()` prompt; the same call returns `shoppingQueries` (engine.ts:107-123); `findProducts` (engine.ts:127-132) → `withSection` → `searchProducts` (products.ts:95) → Serper, with no scrub. The only guard is "Never put sizes or measurements in a query" in the system text and schema description. `products.ts:5-9` documents the rule as a guarantee. `wants.ts` and `go-with.ts` never see body data, so they are fine.
Fix: add `scrubQuery()` in products.ts that drops tokens like `\b\d{2}x\d{2}\b`, `\b(xxs|xs|s|m|l|xl|xxl)\b`, `\b\d+(\.\d+)?\s?(in|cm|lb|")\b`, "size \w+", and apply it in `searchProducts`; or ask for the queries in a second Claude call that has no body block. Add a unit test that feeds a verdict containing "32x30" and asserts the fetch body never carries it.

**A5. Inspiration board text visible to the whole family while the copy says "Seen by you only" — wrong/unsafe (medium).**
`profile/style/page.tsx:21` calls `listInspiration(owner.id)` (`lib/profiles/inspiration.ts:63`, no viewer); `inspiration-board.tsx:52` says "Seen by you only" / "you and your parents". The photo keys are private (`tests/profiles/inspiration.test.ts:36-42` shows `canViewKey` refuses a non-parent), so a sibling who switches to Jeff → Style sees gray tiles with broken images (`inspiration-board.tsx:62`) and, on tap, the full "style DNA" text: summary, words, shapes, colors, pieces.
Fix: in style/page.tsx pass `[]` unless viewer is owner or a parent (reuse `assertCanEdit`'s rule), and hide the section for others.

**A6. A revoked shopper keeps the wants they created — unsafe (low).**
`lib/shop/wants.ts:36-38` `access()` = `askedById === viewer.id || canShopFor(...)`. After Jeff removes Brittney from "Shop for me", she can still open, edit, delete and re-search the wants she added for him.
Fix: drop the `askedById` shortcut; `canShopFor` already covers the owner and parents.

**A7. Confirmed fine.** `profiles/service.ts:48-52` `assertCanEdit` is owner-or-parent only (an admin who is not a parent cannot edit another adult); `setBodyViewers`/`setShoppers` (221-240) are owner-only and refuse minors via `canGrantBodyAccess`; `setMinorBodyImageApproval` (243) requires a parent admin; `getBodyProfile` gates on `canSeeBodyData`; `tryOnLookupAction` (shop/actions.ts:115-119) uses `tryOnState`, which returns `minor`/`not_you` (tryon/index.ts:113-120), so a minor's piece is dressed on the mannequin only. `setShopSection` (service.ts:212) correctly allows shoppers. `rememberShopForAction` checks `canShopFor`.

## B. Outside calls: SSRF, timeouts, retries, error paths

**B1. Store page fetch: redirect and DNS bypass of the hostname guard — unsafe (high).**
`src/lib/shop/page.ts:14-20` blocks `localhost`, `127.`, `10.`, `192.168.`, `172.16-31`, `0.`, `169.254.`, `.local` by *string pattern on the typed hostname*. `page.ts:81` then does `fetch(u, { redirect: "follow" })`: a page that answers `302 Location: http://169.254.169.254/latest/meta-data/` or `http://postgres.railway.internal:5432/` is followed with no check, and `res.url` becomes `inputUrl` (engine.ts:192). A hostname that resolves to a private address (`evil.example.com → 127.0.0.1`, `metadata.google.internal`, `100.64.x.x`) passes the regex. `shopifyVariants` (store/add.ts:89) fetches `${origin}/products/x.json` on the post-redirect origin too.
Path: a family member pastes a link they were texted.
Fix: fetch with `redirect: "manual"`, re-run `normalizeUrl` on each `Location` (cap 5 hops), and before each hop resolve the host with `dns.lookup({ all: true })`, rejecting loopback, RFC1918, 100.64/10, 169.254/16, ::1, fc00::/7 and `*.internal`.

**B2. `og:image` / JSON-LD image fetched with no guard — unsafe (high).**
`page.ts:94-108` `fetchImage(imageUrl)` has no `normalizeUrl` and follows redirects; `engine.ts:193` passes `page.imageUrl` straight from the HTML; `store/match.ts:72-82` `saveRetailPhotos` does the same for Serper picks. (`store/add.ts:166` *does* call `normalizeUrl` on its copy, so the pattern exists.) The content-type check limits exfiltration but the request is still made (blind SSRF / internal port probing). It also buffers the whole body before the 8 MB check (page.ts:104-105).
Fix: route every image fetch through the guarded fetcher from B1 and check `content-length` (or stream with a cap) before buffering.

**B3. Page body read unbounded — slow/unsafe (medium).**
`page.ts:87` `(await res.text()).slice(0, 2_000_000)` reads the entire body first and never checks `content-type`; a link to a 300 MB file is swallowed into memory, bounded only by the 12 s timeout.
Fix: reject non-`text/html` responses and read the body as a stream, stopping at 2 MB.

**B4. Claude client has no timeout — slow (high).**
`src/lib/ai/claude.ts:19` `new Anthropic({ apiKey, maxRetries: 2 })` (SDK default timeout 10 min) and `structured()` retries once more on bad JSON (claude.ts:62). A lookup makes three Claude calls (read, decide, composeLooks); one hung call keeps the job "running" for up to ~30 min; `shop-screen.tsx:66-71` polls every 2 s the whole time, and the same-key dedupe (`startLookup`) means a second tap joins the stuck job.
Fix: construct with `timeout: 60_000` (or pass `{ timeout }` per request) and map the SDK timeout to a `ShopError("The judge took too long. Try again.")`.

**B5. Serper failures are silent — dead-end (low).**
`products.ts:58` throws on non-2xx, `products.ts:100` swallows it to `[]` with `console.error`; `searchWeb` (products.ts:135,140) likewise. No retry, 8 s timeout. The Shop shows no product row and the Looking-for row says "Nothing in the stores yet" after a 500/429.
Fix: return `{ products, failed: string[] }` and show "The stores didn't answer; try Refresh" on the row.

**B6. Receipt matching fans out without a limit — slow (medium).**
`store/receipt.ts:92-103` runs every line (≤ 25) in `Promise.all`; each does `searchWeb` + `searchProducts` + `lookupProduct` (page fetch 12 s + Shopify JSON 8 s) — up to ~100 concurrent outbound calls per receipt, and `e2e/store.spec.ts:43` uploads two receipts at once. Serper 429s are swallowed (B5) so lines just get fewer picks.
Fix: process lines with concurrency 3–4 (`p-limit` or a manual queue) and dedupe the per-store web search.

**B7. Style-match actions are strictly sequential — slow (medium).**
`store/match.ts:92-98` and `117-123`: `readProductPage` (12 s) → `loadTagLists` → `ensureBrand` → Claude `detailsFromDescription` → `saveRetailPhotos` (two sequential 12 s fetches) → DB, all inside one server action the phone waits on (worst case ~50 s, past Safari's patience per the jobs.ts note).
Fix: `Promise.all([readProductPage, loadTagLists])`, then `Promise.all([detailsFromDescription, saveRetailPhotos])`, and fetch the two photos in parallel.

**B8. Bulk add downloads row photos one at a time — slow (low).**
`store/add.ts:196-199` `createStoreRows` awaits `createStoreEntries` per row (each `fetchImage` + `putObject`), up to 30 rows.
Fix: run rows through `Promise.all` in chunks of 4; keep `order` by assigning batch slots first.

**B9. Confirmed fine.** All outside calls have `AbortSignal.timeout` (Serper 8 s, page 12 s, image 12 s, Shopify 8 s, Google 10 s). `readProductPage` maps 403/429/503 to a clear "blocks link previews" message and `lookupProduct` falls back to a word search (add.ts:115-121). `exactPick`, `detailsFromDescription`, `shopifyVariants` catch and degrade.

## C. Sweep scheduler and background jobs

**C1. The sweep can overlap itself — wrong (medium).**
`lib/shop/wants.ts:232-237`: `setInterval(run, 30 min)` with an `async run` — the interval does not wait. A sweep that outlives 30 min (many wants × 8 s Serper × first-time Claude parses, or a stalled Claude call per B4) overlaps the next, and both bypass the per-want job key by calling `searchWant` directly.
Fix: self-reschedule with `setTimeout` after `run` settles, guarded by a module-level `sweeping` flag.

**C2. Manual search and sweep race on the same want — wrong (medium).**
`wants.ts:98-116` reads `row.matches` and `row.newCount`, searches, then writes; `sweepWants` (wants.ts:213-215) calls it directly while a user's `startWantSearch` job (wants.ts:119-121) may be running the same want. Last writer wins: matches found by one run disappear, `newCount` is off. `openWant` (wants.ts:186) zeroing `newCount` concurrently has the same lost-update shape.
Fix: have the sweep use the same `want|<id>` job (await each) so one runs at a time, or do the merge inside `db.$transaction` with the row locked, and use `newCount: { increment: added }`.

**C3. A failed first search strands the want and the screen — breaks / dead-end (high).**
`wants.ts:104-108` parse → `searchProducts` → `update` (114): on any throw (Claude down, bad JSON, DB hiccup) nothing is written, so `queries` stays `[]` and `lastSearchedAt` stays `null`. Consequences: (a) `sweepWants` (wants.ts:212) picks it up every 30 min forever and pays a Claude parse each time; (b) `want-screen.tsx:25` `running = … || (!lastSearchedAt && !foundAt)` → "Searching the stores…" forever, `Search now`/`Edit`/`Found it` disabled (lines 69-71), `useRefreshWhile` (line 26, `use-want-search.ts:76-83`) calls `router.refresh()` every 3 s for as long as the page is open; (c) `looking-for-screen.tsx:36` reloads the whole list every 3 s while any such row exists. Only Remove works.
Path: add a want while `ANTHROPIC_API_KEY` is rate-limited or Serper is down; the row never recovers until a later sweep happens to succeed.
Fix: in `searchWant` catch, write `lastSearchedAt: now` (and a `lastError` text column) so the row reads "Nothing yet · checked just now · the stores didn't answer", re-enable the buttons, and stop the 3-second refresh after N tries.

**C4. Joining someone else's job returns "gone" — dead-end (medium).**
Job keys `want|<id>` (wants.ts:120) and `brandfeed|<personId>` (brand-feed.ts:61) omit the viewer; `startJob` (jobs.ts:35) returns the live job owned by the *first* caller; `jobStatus` (jobs.ts:55-58) returns null for anyone else; `looking-for/actions.ts:63` / `shop/actions.ts:96` turn null into "That search/refresh is gone. Try again." and `use-want-search.ts:39` shows the Banner. Path: both parents open the Shop for Mya within the same minute (the feed auto-refreshes when stale, `shop-screen.tsx:161`) → the second sees an error toast while the refresh is actually running; same when the minor taps Search now while a parent's search runs.
Fix: let `jobStatus` accept any viewer who passes the job's access rule (store an `canRead(viewerId)` predicate on the job), or key by viewer and accept the duplicate work.

**C5. Every server process sweeps — slow (low).**
`src/instrumentation.ts:13-16` starts `wantsOnStart` in each Node process; with a second Railway replica, or a dev server pointed at the same DB, two sweeps run (jobs.ts acknowledges "one web process" for jobs, but the sweep has no lock).
Fix: wrap `run()` in `SELECT pg_try_advisory_lock(…)` and skip when not acquired.

**C6. Confirmed fine.** `startLookup` key includes the viewer and the person, so two shoppers never share a lookup job; `startJob` cleans `running` and keeps `byId` 10 min; `settled()` returns quick results in-call; `instrumentation` skips non-node runtimes and honours `WANTS_ON_START=false`.

## D. Rules page

**D1. Rule kind is read from the stored value, so 0 and 1 turn number rules into toggles — breaks (high) (verified).**
`src/lib/rules-kind.ts:68-74`: `ruleKind` returns `"onoff"` when the value is in `ON_WORDS`/`OFF_WORDS`, which include `"1"` and `"0"`. `RULE_COPY.wantSweepHours` (rules-kind.ts:28) tells the admin "0 turns the automatic search off". After saving 0, the next render of `rule-form.tsx:68-71` shows On / Off pills; tapping one calls `setRule` (rules.ts:51-55) which stores `"on"`/`"off"`; `getRuleNumber` (rules.ts:10-14) reads `Number("off") = NaN` → fallback **24**, so "Off" silently turns the daily store search back on, and there is no number input any more to type 24 or 0 (the `number` branch of `setRule` is unreachable for that row). Same trap for `noRepeatDays = 1`, `laundryCycleDays = 1`, `needSnoozeDays = 0`, and any size band set to 1.
Path: admin → Rules → Shop → types 0 → leaves the field → reloads.
Fix: decide the kind from the key (`RULE_ONOFF_KEYS`, `RULE_COLOR_KEYS`, `RULE_TEXT_KEYS`, else number), never from the value; add a unit test for `ruleKind({ key: "wantSweepHours", value: "0" }) === "number"`.

**D2. "Any color" picker saves on blur — dead-end (low).**
`admin/rules/rule-form.tsx:80` `<input type="color" … onBlur={() => save(value)}>`. On iOS Safari the native color popover often dismisses without blurring the input, so the preview pill changes but "✓ Saved" never appears until the admin taps elsewhere; presets save immediately (line 76), so the two paths feel different.
Fix: save in `onChange` (debounced 300 ms) like the presets.

**D3. Confirmed fine.** `accentColor()` (rules.ts:22-25) re-validates `#RRGGBB` on read and `setRule` validates on write, so `<style>{`:root{--accent:${accent}}`}</style>` in `(app)/layout.tsx:26` and `(flow)/layout.tsx:13` cannot inject CSS. `mirrorEngine` is validated against `RULE_CHOICES` (rules.ts:41-46), the "compare" option is present, and `rule-form.tsx:64-67` renders it as a `<select>`. `timezone` is validated with `Intl.DateTimeFormat`. `setRuleAction` requires admin and returns errors to the row.

## E. Lists

**E1. Deleting a list entry silently destroys or detaches body and profile data — wrong (medium).**
`src/lib/lists/service.ts:106-128` `inUseCount` checks items only for brand/store/color/season/etc. Schema: `BodySizeByBrand.brand … onDelete: Cascade` (schema.prisma:601) → deleting a **brand** (no items yet) wipes every family member's sizes in it with no message; `Person.favoriteBrands/favoriteStores/lovedColors/avoidColors` are implicit m:n (schema:60-64, 207-208, 277, 289) → deleting a **store** or **color** silently drops it from everyone's favorites and loved/avoid lists; `Person.shopSection … onDelete: SetNull` (schema:69) → deleting a **shop section** makes the Shop ask everyone again; `BrandFeed.brands String[]` keeps the dead name until the next refresh. `checkInOption`, `mirrorPose`, `wearOption`, `occasion` have no usage check at all. Items are protected (tested in `tests/lists/service.test.ts:50-77`), people's data is not.
Path: admin → Lists → Brands → Delete "Lululemon" the day after Jeff recorded "Tops L · Bottoms 32".
Fix: extend `inUseCount` with `bodySizeByBrand.count`, `person.count({ favoriteBrands/favoriteStores/lovedColors/avoidColors: { some } })`, `person.count({ shopSectionId })`, `checkIn`/`tryOnChoice` usage for the mirror lists; and steer the UI to Archive.

**E2. `reorderEntries` is not actually in a transaction — wrong/slow (low).**
`service.ts:188-193` opens `db.$transaction(async () => …)` but updates through the outer `d` delegate, so N sequential updates run on separate connections, non-atomically.
Fix: use the `tx` argument (`async (tx) => … (tx as any)[delegate].update`) or build an array of updates for the array form of `$transaction`.

**E3. `countAll` runs 21 counts sequentially — slow (low).** `service.ts:196-200`. Fix: `Promise.all`.

**E4. Store URL is not validated and the recommendation path is guessed — wrong (low).**
`service.ts:99-102` saves any string with `https://` prefixed; `engine.ts:163-164` builds `${base}/search?q=` for "You might like" rows — Amazon (`/s?k=`), Zara (`/search?searchTerm=`) and most others 404.
Fix: validate with `new URL` on save; build store searches as Google `site:<host> <q>` links.

**E5. Confirmed fine.** `createEntry` catches P2002 → "already exists"; `cleanName` caps at 60; closets protected from delete/archive; `requestListEntry` dedupes open asks; `extraData` sanitises hex/unit/prompt/needs/photoTip; `listEntries` orders by sortOrder then name. Rename everywhere is a single `updateEntry` and all pickers read live from the lists.

## F. Shop: performance and correctness

**F1. Shop page is ~100 sequential queries — slow (high).**
`src/app/(app)/shop/page.tsx:20-25`: `requirePerson` → `rememberedShopFor` → `shoppingFor` (people.ts:11-13: `findMany` then `for … await canShopFor` = up to 2 queries per family member, sequential) → `Promise.all([listRecent, getLookup, newMatchCount, openBrandFeed])` where `listRecent` (engine.ts:261-266) takes 20 ids then calls `getLookup` per row (findUnique+include, `canShopFor` ×2 when the shopper differs, `item.findMany`) sequentially → second `Promise.all([tryOnState, sectionOf, listEntries])` → `canDress`. On a remote Postgres at 5–20 ms RTT that is 0.5–2 s of pure round trips every time the Shop opens, before any rendering — the "slow pages" complaint.
Fix: in `listRecent` do one `findMany({ include: { forPerson } })`, gather every `itemId` across rows, one `item.findMany`, build views in memory; cache `canShopFor` per distinct `forPersonId` for the request; fold `shoppingFor` into one query on `guardianLink`/`shopForGrant`; merge the two `Promise.all`s.

**F2. `og:title` / description with an apostrophe is truncated — wrong (high) (verified).**
`src/lib/shop/page.ts:26` `content=["']([^"']*)["']`: `content="Women's Ribbed Tank"` → `Women`; `content="Men's Ludlow Slim-fit Blazer | J.Crew"` → `Men`. Same for `og:description` and `product:brand`. `readCandidate` is told "trust the store title for brand and name" (engine.ts:63), so the verdict card headline becomes "Men"/"Women" and `read.name` and pairings reason follow. `MOCK_PAGE` has no apostrophe so no test sees it.
Fix: `content="([^"]*)"|content='([^']*)'` and take whichever group matched; add "Women's" to `MOCK_PAGE`.

**F3. Hyphenated product names are cut in the store card — wrong (medium) (verified).**
`src/lib/store/add.ts:124` `.replace(/\s*[|–-]\s*[^|–-]*$/, "")` is meant to drop " | Store" but matches the last hyphen anywhere: "Classic V-Neck Tee" → "Classic V", "Ludlow Slim-fit Blazer" → "Ludlow Slim".
Fix: require whitespace around the separator: `/\s+[|–—-]\s+[^|–—-]*$/`.

**F4. Price caps with a thousands separator read as $1 — wrong (low) (verified).**
`src/lib/shop/wants.ts:41-44` `priceCapOf("under $1,200")` → `1`; every match is filtered out and the want says "Nothing in the stores for this yet under $1". `plainQuery` (wants.ts:47-52) leaves ",200" in the search text too.
Fix: `(\d{1,3}(?:,\d{3})+|\d{1,5})` and strip commas before `Number()`.

**F5. Brand feed silently caps at six brands — wrong (low).**
`brand-feed.ts:34` `.slice(0, MAX_BRANDS)` on the alphabetical list; with eight favorites, Vuori and Zara never appear and nothing says so (`brand-feed-brands` line lists only six).
Fix: rotate the window per refresh, or say "showing 6 of 8".

**F6. Favorite-store ranking uses substring matches — wrong (low).**
`products.ts:80` `p.url.toLowerCase().includes(s.replace(/\s+/g, ""))`: "Gap" matches `singapore…`, "On" matches everything.
Fix: compare the URL host against the brand catalog domain or whole-word match on `storeName`.

**F7. Image stored before the AI read, no cleanup, raw sharp errors — slow/wrong (low).**
`engine.ts:197-204` writes the normalized image to storage, then runs three Claude calls; any failure afterwards leaves an orphan object, and a corrupt `og:image` makes `normalizeOriginal` throw a sharp error that reaches the user as "Something went wrong. Try again."
Fix: try/catch the normalize → `ShopError("That picture couldn't be read. Paste a screenshot instead.")`; delete the key on failure.

**F8. `sectionOf` and person prefs loaded three times per lookup — slow (low).**
`engine.ts:210` awaits `sectionOf` after the `Promise.all`; `findProducts` (129), `recommend` (150) and `sectionOf` each re-select the same person row.
Fix: load `{ favoriteStores, favoriteBrands, shopSection }` once at the top of `lookup` and pass it down.

**F9. Confirmed fine.** `startLookup` dedupes the same input per viewer+person; `deleteLookup` removes the stored image; `getLookup` tolerates a deleted item in pairings; `normalizeProduct` rejects non-https links and images; `inOtherSection` keeps titles naming both sections; `mergeMatches` keeps unpriced products under a cap on purpose.

## G. Profile pages

**G1. Settings waits on Google before rendering — slow (high).**
`src/app/(app)/profile/settings/page.tsx:14` `await listCalendars(me.id).catch(() => [])` runs *before* the `Promise.all`; `lib/plans/google.ts` `listCalendars` refreshes the access token and calls the Calendar API with a 10 s timeout. Once Jeff connects his calendar, every Settings open blocks on Google (1–10 s, blank page) just to label the "Calendars" row.
Fix: move it into the `Promise.all` at minimum; better, load the calendar names when the "Calendars" row is tapped.

**G2. Read-only viewers get rows that look tappable and do nothing — dead-end (medium).**
`profile/body/body-editor.tsx:55` (`onClick={() => canEdit && setMeasuring(...)}`), `:80` (fit notes), `:99` and `:122` (photos); `profile/style/style-editor.tsx:22,28-33` (`open = (k) => canEdit && setSheet(k)`). The `Row` component (`components/items/row-editor.tsx:15-25`) always renders a full-width button with a chevron. A spouse with a body-data grant viewing the body page, or anyone viewing another member's Style page, taps "Waist", "Fit notes", "Loved", "Words" and nothing happens.
Fix: render `Row` with `disabled` and no chevron (or as a plain `<div>`) when `!canEdit`.

**G3. Taste-memory "Forget" swallows failures — dead-end (low).**
`profile/style/taste-memory.tsx:16` `await forgetTasteAction(...)` ignores `r.ok`; on a 403/500 the line reappears after refresh with no message.
Fix: check `r.ok` and show the Banner like the other editors.

**G4. Unused size functions — dead-code.**
`src/lib/profiles/service.ts:91-109` `upsertSize` / `removeSize` have no callers in `src` (sizes moved to `setMyBrand`); only `tests/profiles/service.test.ts:102-103` uses them.
Fix: delete both and move the assertion to `setMyBrand`.

**G5. Likely sizes make eight rule queries — slow (low).**
`src/lib/profiles/sizes.ts:34-37` `Promise.all` of eight `getRuleNumber`s on every Body and Brands page.
Fix: one `rule.findMany({ where: { key: { in: [...] } } })`.

**G6. `setMyBrand` trusts `categoryId` and edits a family-wide link — wrong (low).**
`src/lib/profiles/brands.ts:51-61`: `BodySizeByBrand.categoryId` has no FK (schema:597), so a stale id from an open sheet saves a size that renders as "Any"; `brand.url` is shared (`Brand.url`, schema:272), so a minor editing "their" Lululemon link changes it for everyone, and `cleanUrl` accepts any host with a dot.
Fix: validate `categoryId` against active categories; make the brand-link edit admin-only or store it per person.

**G7. Body page runs three extra sequential queries — slow (low).**
`profiles/service.ts:64-67` `categories`, `ownerRole`, `isParentView` after the `Promise.all`.
Fix: include `role` and the guardian link in the first `Promise.all`.

**G8. Confirmed fine.** `profile/page.tsx` gates the Body row on `canSeeBodyData` and shows "Private"; `resolveProfileTarget` computes `canEdit` as owner-or-parent; `setSavedZipAction` validates 5 digits; `inspiration-board.tsx:24-39` handles upload errors with a Banner; `addInspiration` checks key kind and owner.

## H. Client components, iOS Safari

**H1. File picks can reject with no toast — dead-end (low).**
`shop/shop-screen.tsx:101-104` `onFile` awaits `judgeFile` with no try/catch; `judgeFile` (96-100) awaits `shrinkPhoto` (which catches internally) then `new File([blob], …)` and `run(...)`; `run` catches the action but not a throw from `FormData`/`File` construction (a 0-byte blob from a cancelled share sheet, an unsupported HEIC on older WebKit). The buttons re-enable with no message.
Fix: wrap `judgeFile` body in try/catch → `toast.error("Couldn't read that picture.")`.

**H2. A lost job never shows the saved verdict — dead-end (low).**
`shop-screen.tsx:63` and `actions.ts:65`: after a server restart the poll gets "That lookup is gone. Try again." and stops; `engine.ts:222-227` promises the row "is under Recent even when the browser let go", but the screen never refreshes to show it.
Fix: on that error call `router.refresh()` and word it "If it finished, it's under Recent."

**H3. Paste listener re-registered every render — slow (low).**
`shop-screen.tsx:112-120` `useEffect` with no deps adds/removes `document` `paste` on every poll tick.
Fix: hold `judgeFile`/`thinking` in refs and register once.

**H4. Example want names a size — wrong (copy).**
`looking-for/looking-for-screen.tsx:66` offers "white leather sneakers, size 10" one tap before `want-sheet.tsx:18` says "Sizes stay out of the search".
Fix: drop ", size 10".

**H5. Confirmed fine.** `components/ui/sheet.tsx:47` uses `flex-auto` (the WebKit `flex:1 1 0%` auto-height bug is handled, per its own comment); native `<dialog>` with `showModal`, backdrop tap and Esc close; `shop-screen.tsx:181` hidden `<input type=file accept="image/*">` with toggled `capture` is fine on iOS (`.click()` from a tap); drop/paste are desktop-only by design and guarded by `thinking`; horizontal product rows use `-mx-5 … overflow-x-auto snap-x`; polling uses the phone's clock for the seconds; `useUndoable` commits on unmount so leaving the screen doesn't lose a removal.

## I. Help
`help/page.tsx`, `[slug]/page.tsx`, `content.ts`, `cues.tsx`, `steps.ts` are static apart from `getAddTips` for the Add topic; admin-only topic is gated; unknown slug 404s (tested). `content.ts:65` promises "BODY: your sizes… Only you can see them, plus parents for kids" — true only once A1 is fixed. No code findings.

## J. What the tests do and do not cover

Covered: lookup/want/go-with/feed permissions and `usedBodyData=false` for a shop-for grantee (`tests/shop/engine.test.ts:68-83`); sweep cadence and the 0 rule (`wants.test.ts:108-131`, `brand-feed.test.ts:81-100`); Serper cache/interleave/failure (`products.test.ts:23-42`); list CRUD and item-blocked deletes (`tests/lists/service.test.ts`); body/shop grants and minors cannot grant (`tests/profiles/service.test.ts`); rules number + accent save (`e2e/admin.spec.ts:59-75`); the full Looking-for flow, Shop link/photo flow, brand feed, store link + receipts, profile privacy (`e2e/*.spec.ts`).

Not covered (each maps to a finding above): a size/measurement word never reaching the Serper request body (A4; the mock skips Claude so nothing can leak in tests); `meta()` with an apostrophe (F2) and the hyphen stripper (F3); redirect/`og:image` SSRF (B1/B2); `ruleKind` with value "0"/"1" (D1); brand delete cascading sizes (E1); `listMyBrands`/`listInspiration` for a non-parent viewer (A1/A5; `my-brands.test.ts:62` reads Mya's sizes with no viewer and passes); a failed first search leaving `lastSearchedAt` null and the stuck screen (C3); sweep vs manual search concurrency (C1/C2); the Shop page's query count (F1); anything on iOS Safari — Playwright runs Chromium only (sheet.tsx:46 notes the last WebKit-only bug slipped past the suites).

---

## Files read (full, `cat -n`) with line counts

In scope:
- src/lib/shop/engine.ts 274 · page.ts 108 · products.ts 141 · section.ts 50 · people.ts 16 · remember.ts 12 · wants.ts 238 · brand-feed.ts 114 · go-with.ts 127
- src/lib/store/add.ts 217 · match.ts 142 · receipt.ts 104 · words.ts 101
- src/lib/brands/actions.ts 36 · catalog.ts 65
- src/lib/lists/registry.ts 54 · requests.ts 39 · service.ts 200
- src/lib/profiles/brands.ts 68 · inspiration.ts 94 · service.ts 253 · size-options.ts 44 · sizes.ts 45
- src/lib/rules.ts 69 · src/lib/rules-kind.ts 75 · src/lib/tips.ts 31
- src/app/(app)/shop/actions.ts 131 · page.tsx 32 · shop-screen.tsx 402
- src/app/(app)/shop/looking-for/page.tsx 25 · actions.ts 77 · ago.ts 12 · looking-for-screen.tsx 112 · use-want-search.ts 83 · want-sheet.tsx 25 · [wantId]/page.tsx 22 · [wantId]/want-screen.tsx 110
- src/app/(app)/profile/actions.ts 101 · page.tsx 76 · target.ts 24 · body/page.tsx 29 · body/body-editor.tsx 161 · brands/page.tsx 30 · brands/favorites-editor.tsx 79 · settings/page.tsx 27 · settings/settings-editor.tsx 93 · style/page.tsx 31 · style/style-editor.tsx 57 · style/inspiration-board.tsx 94 · style/taste-memory.tsx 34
- src/app/(app)/help/page.tsx 34 · [slug]/page.tsx 45 · content.ts 86 · cues.tsx 107 · steps.ts 11
- tests/shop/brand-feed.test.ts 101 · engine.test.ts 115 · go-with.test.ts 63 · products.test.ts 54 · section.test.ts 45 · wants.test.ts 132
- tests/store/add.test.ts 164 · match.test.ts 118 · words.test.ts 34
- tests/lists/photo-tips.test.ts 38 · requests.test.ts 26 · service.test.ts 97
- tests/profiles/inspiration.test.ts 47 · my-brands.test.ts 106 · service.test.ts 114
- e2e/shop.spec.ts 75 · profile.spec.ts 165 · looking-for.spec.ts 74 · brand-feed.spec.ts 38 · store.spec.ts 67 · help.spec.ts 29
- prisma/schema.prisma (1116): model blocks Person, GuardianLink, SizeOption, Color, Brand, Store, ListRequest, Rule, MeasurementKind, ShopSection, BodyProfile, BodyMeasurement, BodySizeByBrand, BodyDataGrant, ShopForGrant, InspirationLook, WeatherCache, GoWith, Want, BrandFeed, ShoppingLookup

Read in full for context (outside the assigned area):
- src/lib/jobs.ts 75 · src/lib/people/visibility.ts 76 · src/instrumentation.ts 17 · src/lib/ai/claude.ts 74 · src/lib/auth/current.ts 64 · src/app/(app)/view-actions.ts 12
- src/app/(app)/admin/rules/actions.ts 42 · page.tsx 56 · rule-form.tsx 103 · src/app/(app)/layout.tsx 36 · src/app/(flow)/layout.tsx 18
- src/components/ui/sheet.tsx 51 · src/components/items/row-editor.tsx 130 · src/components/ui/undo-strip.tsx 38 · src/components/shop/section-pick.tsx 52

Read in part (the referenced function only): src/lib/outfits/catalog.ts `styleContext` (95-140) · src/lib/storage.ts `IMAGE_TYPES`/`newKey`/`parseKey` · src/lib/import/client-queue.ts `shrinkPhoto` · src/lib/tryon/index.ts `tryOnState`/`setTryOnEnabled` (113-127) · src/lib/plans/google.ts `listCalendars` · e2e/admin.spec.ts 55-80 (rules test) plus a grep of its lists coverage.

Not read (used by these screens but in the components area): components/profile/my-brand-sheet.tsx, body-photo-upload.tsx, size-sheet.tsx; components/items/brand-search.tsx; components/lists/inline-add.tsx, ask-to-add.tsx; components/looks/add-to-look.tsx, look-tray.tsx; components/ui/banner, button, input, field, page-header, toast.
