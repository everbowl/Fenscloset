# Phase 4: Shopping — Implementation Plan

**Goal:** Before buying, a person pastes a store link, uploads a screenshot, or takes a dressing-room photo and gets: a fit verdict for the person they are shopping for, "you already own similar", three or more pairing boards from that person's closet, and (sometimes) a few "you might like" picks with buy links that lean on favorite brands and stores.

**Spec:** `docs/PLAN.md` §3 `ShoppingLookup`, §4 screen 15, Phase 4. Screen is undrawn: build from DESIGN.md components (header, serif title, mono labels, 42px rows, rule-bounded strips, outfit board, primary/secondary buttons); screenshot batch for approval.

## Global constraints
- Shopping for someone else only with permission (`canShopFor`): yourself, your minors, or people who granted you. The "shopping for" switcher lists only those people.
- The verdict uses the target person's body profile (sizes by brand, measurements, fit notes) only if the shopper may see it (`canSeeBodyData`); otherwise the verdict says it is based on style and closet only.
- Nothing hard-wired: verdict wording is Claude's; the "you might like" picks come only from the person's favorite brands/stores list (editable) and the Store list's URLs.
- Store pages are fetched server-side (Railway can reach the web; the dev container cannot, so `MOCK_FETCH=true` serves canned pages in tests). Only the page title, description, price text, and main product image are read; nothing is stored from the page except what the person sees on screen.
- Photos (screenshots, dressing-room shots) go through the signed upload path under a new `shop/<ownerId>/…` kind, viewable by the shopper and the target person (and a minor's parents).
- Keys stay in Railway env. No new keys are needed for Phase 4 (Claude only).

## Assumptions flagged for Jeff
- B1. A link lookup reads the store page's Open Graph title/image/price. Stores that block bots fall back to "paste a screenshot instead".
- B2. The verdict is one of FITS / RISKY / PASS with a one-line reason, plus a size suggestion when the brand is in the person's sizes-by-brand list.
- B3. "Similar owned" uses the same tags-plus-colors match as the duplicate check, loosened (same category, shared color or fabric), top 4 shown.
- B4. Pairings: 3 boards built from the target person's usable closet with the candidate piece pinned as hero, same engine as Today.
- B5. "You might like": at most 3 picks, only when the verdict is PASS or when the closet lacks a pairing category; each pick is a search link on a favorite store (`<store url>/search?q=…`) rather than a scraped product, so nothing is invented.
- B6. Lookups are kept (ShoppingLookup) and listed on the Shop screen as "Recent", newest first, with a remove action.

## Tasks
1. **Schema**: `ShoppingLookup {id, shopperId, forPersonId, source link|screenshot|photo, inputUrl?, inputKey?, title?, imageKey?, priceText?, verdict Json, similarItemIds String[], pairings Json, recommendations Json, createdAt}`; storage kind `shop`; `Store.url` already exists (used for search links). Migration.
2. **Page reader** (`src/lib/shop/page.ts`): fetch + parse OG/meta (title, image, price, brand guess), download the image to `shop/` for the board; mock for tests.
3. **Verdict engine** (`src/lib/shop/engine.ts`): Claude structured call with the candidate (image + text), the target's style profile, sizes/measurements when permitted, and the closet summary → verdict, size note, similar-owned (computed locally), pairings (via outfit engine with pinned hero), recommendations. Mock. Tests: permission gates, PASS/FITS shapes, similar-owned match.
4. **Shop screen** (`/shop`): "Shopping for" switcher (permitted people), three entry buttons (PASTE A LINK / UPLOAD SCREENSHOT / TAKE A PHOTO), result card (image, title, price, verdict strip, "You already own similar" row of thumbs, pairing boards with reasons, "You might like" rows with mono BUY link), Recent list. Desktop: result left, pairings right.
5. **Acceptance**: unit + e2e (link mock, screenshot, photo; shopping for Mya as parent; Olivia cannot shop for Mya), deploy, screenshots, report. Jeff's test: 3 real store links, 1 screenshot, 1 dressing-room photo.
