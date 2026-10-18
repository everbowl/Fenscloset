# Phase 1: Add Clothes & Closet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jeff adds 10 real items from his iPhone in under 3 minutes: pick photos, the app cuts backgrounds, tags each piece with Claude, and he confirms each with one tap.

**Architecture:** Photos go straight from the phone to the Railway bucket via presigned PUT (resized client-side to ≤1600px). A batch queue persisted in the database (and mirrored in IndexedDB for resume) processes entries one by one on request: remove.bg → cutout PNG → thumbnail → perceptual hash → Claude vision tags (structured output constrained to the editable lists) → `needs_confirm`. The confirm screen (design 03) creates the Item. Photos are served through an authenticated proxy route so privacy rules apply to every image.

**Tech Stack:** Next.js 16, Prisma 7, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, sharp, remove.bg REST, `@anthropic-ai/sdk` (claude-opus-5-5, structured outputs, server-side fallbacks), Vitest, Playwright. `MOCK_AI=true` makes remove.bg and Claude return canned results for tests.

**Spec:** `docs/PLAN.md` §3 Clothes, §4 screens 7–10; design package DESIGN.md §5 Item card, List row, Rule-bounded strip, Progress; screens 02 and 03.

## Global Constraints
- Every taxonomy value shown comes from the editable lists; the confirm rows offer inline `+ Add` (InlineAdd) so an admin never leaves the screen.
- Photos of any person are never public: the only image URL is `/api/photo/<key>` behind the session and visibility check.
- Target: one tap per item when tags are right; processing runs ahead of the user so the next confirm is ready.
- No red, no rounded corners, mono labels, per DESIGN.md.
- Secrets: `ANTHROPIC_API_KEY`, `REMOVE_BG_API_KEY`, `S3_*` via env only.

## Review Focus
1. Closing the browser mid-batch and reopening must resume at the same entry with the same counter (Task 4 test: batch state survives reload).
2. A remove.bg failure (quota, bad image) must leave the entry retryable with the original photo still usable as the item photo, never a stuck batch (Task 3 test).
3. Claude returning a color/category that isn't in the lists must map to "unknown" and show the row for the user to pick, never crash or invent a list entry (Task 5 test).
4. Duplicate detection must not flag two different black tees as the same unless the hash says so; "SAME?" merges photos into the existing item instead of creating a second one (Task 6 test).
5. Viewing another person's closet (Q13 A) must hide items that person has not shared when they are not in the Family closet… wait: per spec, closets are browsable by family; only body data is private. Test: Olivia sees Mya's closet grid, but a minor's worn photos are shown only to the minor and parents (Task 8 test).

---

### Task 1: Schema expansion (items, photos, tags, batches)
**Files:** Modify `prisma/schema.prisma`; new migration `phase1_items`.
**Interfaces:** `Item` gains `name, brandId?, storeId?, size?, fitNotes?, purchasePrice?, purchaseDate?, purchaseUrl?, isFavorite, laundryStatus (clean|dirty|cleaners), neverSuggest, phash?, aiConfidence Json?, updatedAt`; implicit M:N `colors Color[]`, `patterns Pattern[]`, `fabrics Fabric[]`, `seasons Season[]`, `formalities FormalityLevel[]`, `occasions Occasion[]`, `tags Tag[]`; `ItemPhoto {id, itemId, kind alone|worn|label|cutout|thumb, bucketKey, width, height, isPrimary, createdAt}`; `ItemShare {itemId, personId}`; `ImportBatch {id, personId, status open|done, createdAt}`; `ImportEntry {id, batchId, order, originalKey, status queued|uploaded|processing|needs_confirm|done|failed|skipped, cutoutKey?, thumbKey?, labelKey?, phash?, aiResult Json?, error?, itemId?, updatedAt}`.
- [ ] Write models; `npx prisma migrate dev --name phase1_items`; extend `inUseCount` in `src/lib/lists/service.ts` for colors/patterns/… via relation counts; tests in `tests/lists/service.test.ts` pass. Commit.

### Task 2: Bucket client, presigned uploads, photo proxy
**Files:** Create `src/lib/storage.ts`, `src/app/api/uploads/sign/route.ts`, `src/app/api/photo/[...key]/route.ts`, `tests/storage.test.ts` (uses a local in-memory S3 stub via `MOCK_S3=true` → filesystem under scratch).
**Interfaces:** `signUpload({personId, contentType}) → {key, url, headers}` (key = `originals/<personId>/<cuid>.jpg`, 10-min PUT); `putObject(key, buf, contentType)`, `getObject(key) → Buffer`, `deleteObject(key)`; `canViewKey(person, key)` (owner, Family closet, shared-with, or parent of minor owner); `GET /api/photo/<key>` streams with `Cache-Control: private, max-age=3600`.
- [ ] Tests: sign returns owner-scoped key; proxy 404s for other people's keys unless shared. Commit.

### Task 3: Processing pipeline (bg removal, thumb, hash, tags)
**Files:** Create `src/lib/images/remove-bg.ts`, `src/lib/images/phash.ts`, `src/lib/images/thumb.ts`, `src/lib/ai/claude.ts`, `src/lib/ai/tag-item.ts`, `src/lib/ai/read-label.ts`, `src/lib/import/process.ts`, `tests/images/phash.test.ts`, `tests/ai/tag-item.test.ts`, `tests/import/process.test.ts`.
**Interfaces:** `removeBackground(buf) → Buffer(png)` (throws `RemoveBgError(code)`; `MOCK_AI` returns input); `phash(buf) → string` (64-bit hex, 8×8 DCT-free average hash on 32px gray); `hamming(a,b)`; `makeThumb(buf, 400) → Buffer`; `tagItem({image, lists}) → TagResult {name, categoryId?, subcategoryId?, colorIds[], patternId?, fabricId?, fabricConfidence, seasonIds[], formalityId?, brandText?, sizeText?, confidence}` using structured outputs with enums built from the lists; `readLabel(image) → {brand?, size?}`; `processEntry(entryId)` runs the chain, writes keys/aiResult, sets `needs_confirm`, or `failed` with `error` (original photo retained).
- [ ] Read `claude-api` skill TypeScript README before writing `claude.ts`; model `claude-opus-5-5`, `fallbacks: "default"`, adaptive thinking omitted (vision tag is simple; effort `low`).
- [ ] Tests with MOCK_AI: pipeline sets statuses; failure path retryable; unknown list values → null. Commit.

### Task 4: Batch queue UI (pick → upload → progress, resumable)
**Files:** Create `src/app/(app)/add/page.tsx` (replace placeholder), `src/app/(app)/add/picker.tsx`, `src/lib/import/client-queue.ts`, `src/app/(app)/add/actions.ts`, `src/app/api/import/route.ts`, `e2e/add-items.spec.ts`.
**Interfaces:** `createBatch(count) → batchId`; `registerEntries(batchId, keys[])`; client: resize via canvas, PUT to signed URL, register, then call `POST /api/import/<entryId>/process` with concurrency 2; progress strip `042 / 150`; on reload, `GET /api/import/open` restores the batch and continues.
- [ ] e2e (MOCK_AI, MOCK_S3): pick 3 fixture photos, see counter, reload mid-way, counter continues. Commit.

### Task 5: Confirm screen (design 03) and item creation
**Files:** Create `src/app/(app)/add/[batchId]/confirm/page.tsx`, `confirm-card.tsx`, `row-editor.tsx`, `src/lib/items/service.ts`, `tests/items/service.test.ts`.
**Interfaces:** `createItemFromEntry(entryId, edits) → Item` (adds to owner's personal closet; copies cutout/thumb/original photos); rows: CATEGORY, COLOUR, FABRIC (`(best guess)` when confidence < 0.6), SEASON, DRESS CODE, BRAND · SIZE (`Scan the label`); each row opens a Sheet listing entries from the list with InlineAdd; `RENAME`; `SKIP`; `X` keeps progress; `LOOKS RIGHT · NEXT` → next `needs_confirm` entry; camera button → add label/worn photo.
- [ ] Tests: create item with M:N tags; missing category keeps entry in needs_confirm. Commit.

### Task 6: Duplicate detection and merge
**Files:** Create `src/lib/items/duplicates.ts`, `tests/items/duplicates.test.ts`; modify `confirm-card.tsx` (rule-bounded strip with thumbnail + `SAME?`).
**Interfaces:** `findLikelyDuplicate(personId, {phash, categoryId, colorIds, brandId}) → {itemId, score} | null` (hamming ≤ 10, or same category+primary color+brand); `mergeIntoItem(entryId, itemId)` adds photos to the existing item, marks entry done.
- [ ] Commit.

### Task 7: Closet grid (design 02) and item detail
**Files:** Replace `src/app/(app)/closet/page.tsx`; create `src/app/(app)/closet/[itemId]/page.tsx`, `item-editor.tsx`, `src/components/item-card.tsx`, `src/components/filter-tabs.tsx`, `e2e/closet.spec.ts`.
**Interfaces:** grid of `ItemCard {thumb, name, meta "CATEGORY · WORN n× | LAUNDRY | AT CLEANERS | NEW"}`; filter tabs from categories (+ `EDIT` → inline list editor for admins); search by name/brand; count `N PIECES`; item detail: photos, rows editable in place (same RowEditor), one-tap laundry cycle, favorite, closets (personal/Family/custom), share with people, delete (with confirm), purchase info, fit notes, size.
- [ ] e2e: add → appears in grid → open → toggle laundry → word changes in grid. Commit.

### Task 8: Person switcher and viewing others (Q13 A)
**Files:** Modify `src/components/person-menu.tsx` → `person-switcher.tsx`; `src/lib/people/visibility.ts`; `tests/people/visibility.test.ts`.
**Interfaces:** `viewableClosets(viewer) → [{personId|family, label}]`; `canSeeWornPhoto(viewer, ownerId)` (owner, parents of minor; adults' worn photos visible to family unless the item is unshared… per spec worn photos are item photos, not body data → visible to family; minors' worn photos: minor + parents only).
- [ ] Commit.

### Task 9: Acceptance
- [ ] Deploy; Jeff adds 10 real items on iPhone; measure time; screenshots of every new screen sent for approval in one batch.
