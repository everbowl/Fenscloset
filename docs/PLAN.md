# Fen's Closet — Build Plan (v1, awaiting approval)

Status: APPROVED by Jeff on 2026-10-18. Decisions: Q1 B (remove.bg), Q2 A (Opus 5.5 everywhere), Q3 B (Twilio SMS invites), Q4 B (Jeff creates the Railway project), Q5 A (new Anthropic key), Q6 B (www is the real site; GoDaddy forwards the bare domain), Q7 A (no shareable board images), Q8 A (Olivia = member), Q9 B (Jeff creates `main`). Design: the approved Fen's Closet identity v1 package (DESIGN.md) is the only look; Q12 A (full Fits screen: calendar, photo of the night, share within the family, per-fit visibility, Phase 3); Q13 A (any family member can view another member's closet and fits, respecting privacy rules; minors visible only to their parents); Q14 A (keep the neutral rack hero photo on sign-in).
Branch: `claude/fens-closet-app-1ovr5e`
Domain: fenscloset.com (GoDaddy)

---

## 1. Stack (what the app is made of, and why)

| Layer | Choice | Why this and not something else |
|---|---|---|
| App framework | **Next.js 15 (App Router) + TypeScript + React 19** | One codebase serves the mobile web app, the desktop app, and the API. One Railway service to run. Best PWA story in the ecosystem. |
| UI | **Tailwind CSS + Radix primitives** (own component set, no heavy kit) | Fast, mobile-first, fully controllable look. No third-party design lock-in. |
| Database | **Postgres on Railway + Prisma ORM** | Relational data (people, items, closets, wear history) is a textbook Postgres job. Prisma gives typed queries and safe migrations. |
| Photo storage | **Railway Storage Bucket (S3-compatible)** | Phones upload straight to the bucket with presigned URLs, so the API never holds a 10 MB photo in memory. $0.015/GB-month, free egress. |
| Image processing | **sharp** (Node) | Resize, thumbnails, outfit-board compositing, perceptual hashes for duplicate detection. |
| Background removal | **remove.bg API** (Q1 = B) | Best-in-class edges. Per-image fee; cutouts are cached so each photo is sent once. |
| AI | **Claude API** (`claude-opus-5-5`, vision) | Auto-tagging, label reading, selfie check-in reading, outfit generation, shopping fit verdicts. See Q2 for the model choice. |
| Auth | **Built in-house**: argon2id password hashing, server-side sessions in Postgres, httpOnly cookies, email reset tokens, invite tokens | No third-party auth vendor, no monthly fee, no lock-in. Full control of DEV MODE rules. |
| Email | **Resend** (free tier: 3,000 emails/month) | Forgot-password emails and invite emails from `@fenscloset.com`. |
| Text invites | **Twilio SMS** (Q3 = B) + email via Resend | Real text messages with the invite link. |
| Weather | **Open-Meteo** (free, no API key) + Open-Meteo Geocoding + Zippopotam.us for zip → coordinates (free) | Hourly temp/rain/wind for 16 days, no signup. Attribution line "Weather by Open-Meteo" is required by their license. |
| Calendar | **Google Calendar API** via Google OAuth (free) | Each person connects their own Google account. |
| PWA | Web manifest + service worker (Serwist) + IndexedDB upload queue | Installable on iPhone home screen; batch uploads survive closing the app. |
| Hosting | **Railway**: 1 web service, 1 Postgres, 1 bucket, (optionally) 1 background-removal service | All secrets live in Railway environment variables. Nothing in code. |
| Deploys | GitHub → Railway auto-deploy from `main`; PR branches build previews | |

### Founder-level calls baked into this stack
- **Duplicate detection without a vector database.** Perceptual hash (pHash) of the cutout + Claude's tags (same category + dominant color + brand) catches real duplicates. A vector DB would add a service and cost for no gain at 800 items.
- **No background jobs server.** The upload queue lives on the phone (IndexedDB) and the server processes each photo on request. Resumable, shows "42 of 150 done", survives app closes. No Redis, no worker fleet.
- **Outfit boards are rendered in the app**, not pre-generated images. Instant, zero storage. A "Share as image" button can be added later if wanted (see Q7).
- **Photos of a minor stay inside Railway** if Q1 = A. This is the single biggest privacy decision in the plan.

---

## 2. Third-party services and cost

| Service | Used for | Cost | Account/key needed from Jeff? |
|---|---|---|---|
| Railway (already connected to this session as workspace "Everbowl's Projects") | app, Postgres, bucket, optional bg-removal service | Hobby plan $5/mo includes $5 usage. Estimated usage: web ~$5–8, Postgres ~$3–5, bg-removal ~$5–10 (only if Q1 = A), bucket <$0.10. **≈ $15–25/mo total.** | No key — I can create the project myself. Confirm in Q4. |
| Anthropic (Claude API) | auto-tagging, outfits, shopping, selfie read | Opus 5.5: ~$0.02 per item tagged (2 photos + label), ~$0.05 per outfit set, ~$0.01 per selfie. **Initial catalog of ~800 items ≈ $20 one-time. Ongoing ≈ $5–15/mo.** (Haiku 5.5 would be ~40× cheaper for tagging; see Q2.) | Yes — API key. See Q5. |
| Resend | password reset + invite emails | Free (3,000/mo, 100/day). | Yes — account + API key + verify fenscloset.com (I give you the DNS records). |
| Google Cloud (OAuth) | Google Calendar connection | Free. | Yes — OAuth Client ID + Secret. See section 7. |
| Open-Meteo + Zippopotam.us | weather, geocoding | Free, no key. | No. |
| GoDaddy | domain DNS | Already owned. | You add DNS records (exact values provided when ready). See Q6. |
| Twilio (only if Q3 = B) | SMS invites | ~$0.01/msg + ~$1.15/mo number + one-time ~$4 brand registration + carrier campaign fees | Only if chosen. |
| remove.bg (only if Q1 = B) | background removal | ~$0.15–0.22 per image → **~$60–180 one-time** for 400–800 items, then small ongoing | Only if chosen. |

Price sources (third-party roundups; verify on vendor pages): Resend https://www.usecarly.com/blog/resend-pricing/ · remove.bg https://medium.com/@ai-engine/5-best-background-removal-apis-pricing-comparison-22ae9e76b67c · Twilio https://automationatlas.io/answers/twilio-pricing-explained-2026/ · Railway https://docs.railway.com/storage-buckets/billing and https://docs.railway.com/guides/multi-region-api-failover#cost-of-multi-region-replicas · Open-Meteo https://open-meteo.com/ · Google OAuth token expiry https://developers.google.com/health/setup

---

## 3. Data model (Postgres, via Prisma)

Every "list" below is a real table with `id, name, sortOrder, isArchived, createdAt`, editable/creatable/deletable in-app by admins. Seeded with defaults.

**People & access**
- `Person` — name, email, phone, role (`admin` | `member` | `minor`), birthdate, avatar, savedZip, passwordHash, mustChangePassword, devPasswordUsedAt, createdAt
- `Session` — personId, token, expiresAt, userAgent
- `PasswordResetToken`, `InviteToken` (email or link, expires, createdBy, role, parentIds)
- `GuardianLink` — minorId ↔ parentId (Mya ↔ Jeff, Mya ↔ Brittney)
- `BodyDataGrant` — ownerId → viewerId (who may see my body data)
- `ShopForGrant` — ownerId → shopperId (who may shop on my behalf); parents auto-granted for minors
- `MinorBodyImageApproval` — minorId, approvedByParentId, approvedAt (Mya: approved by Jeff)
- `GoogleCalendarConnection` — personId, refreshToken (encrypted), calendarIds[]

**Editable lists (admin-managed, on-screen where used)**
`Category`, `Subcategory` (→ Category), `Color` (name + hex), `Pattern`, `Fabric`, `Season`, `FormalityLevel`, `Occasion`, `Tag`, `Brand`, `Store`, `Closet` (personal per person + "Family"; admins can add more), `CheckInScale` (tan / hair / skin; each with ordered `CheckInOption`s), `Rule` (key/value: `noRepeatDays`, `notWornMonths`, editable per household)

**Clothes**
- `Item` — ownerId, categoryId, subcategoryId, brandId, storeId, size, fitNotes, purchasePrice, purchaseDate, purchaseUrl, isFavorite, laundryStatus (`clean`|`dirty`|`cleaners`), neverSuggest, phash, aiConfidence, createdAt
- `ItemPhoto` — itemId, kind (`alone` | `worn` | `label` | `cutout`), bucketKey, width, height, isPrimary
- `ItemColor`, `ItemPattern` (M:N), `ItemFabric`, `ItemSeason`, `ItemFormality`, `ItemOccasion`, `ItemTag` (M:N each)
- `ItemCloset` — itemId ↔ closetId (an item can be in personal + Family)
- `ItemShare` — itemId → personId (shared with specific people)
- `ImportBatch` + `ImportBatchEntry` — status per photo (`queued`|`uploaded`|`processing`|`needs_confirm`|`done`|`failed`), for resume + "42 of 150"

**Profiles**
- `BodyProfile` — personId, heightCm, weightKg, measurements JSON (bust/waist/hips/inseam/…), fitNotes
- `BodySizeByBrand` — personId, brandId, categoryId, size
- `BodyPhoto` — personId, bucketKey, takenAt (full-body, for V2)
- `StyleProfile` — personId, lovedColorIds[], avoidColorIds[], styleWords[], neverSuggestItemIds[]
- `FavoriteBrand`, `FavoriteStore` — per person

**Daily**
- `CheckIn` — personId, date, tanOptionId, hairOptionId, skinOptionId, source (`taps`|`selfie`), selfieKey
- `OutfitSuggestion` — personId, date, inputs JSON (weather, occasion, check-in), outfits JSON (3 boards + reasons), togetherSessionId
- `TogetherSession` — mode (`coordinate`|`match`|`contrast`), personIds[], occasion
- `WearLog` — personId, itemId, wornOn, outfitSuggestionId?
- `ShoppingLookup` — personId, forPersonId, source (`link`|`screenshot`|`photo`), input, verdict JSON, similarItemIds[], pairings JSON, recommendations JSON

---

## 4. Screens (mobile-first; same screens work on desktop)

1. **Login** — email + password, "Forgot password" link right on the page. DEV banner when 0535 is active.
2. **Forgot / Reset password** — email → link → new password.
3. **Accept invite** — sets name + password; lands in own closet.
4. **Force password change** — shown after the one-time 0535 login.
5. **Home / Today** — weather strip, today's occasion (from Google Calendar or picked), check-in (taps or selfie), 3 outfit boards with one-line reasons, buttons: Wear this · Swap one piece · More options. "Together" entry point.
6. **Together mode** — pick people, pick Coordinate/Match/Contrast, side-by-side outfit sets.
7. **Closet** — grid of cutouts, filters (category, color, season, laundry, favorite, closet, person), search. Switch between My closet / Family / people who shared with me.
8. **Item detail** — photos (alone/worn/label), all attributes, one-tap laundry toggle, favorite, wear history, "not worn since", share with…, closets, edit/delete.
9. **Add items (batch)** — pick many photos → queue → progress "42 of 150" → one confirm card per item: one tap Accept or quick edits; "Looks like an item you already have" with side-by-side.
10. **Add label photo** — optional per item, reads brand + size.
11. **Profile → Body** — sizes by brand, measurements, height/weight, fit notes, full-body photos, "Who can see this" toggles. Minor: parent-approval switch (Jeff).
12. **Profile → Style** — loved/avoid colors, style words, never-suggest items.
13. **Profile → Brands & Stores** — personal favorites list.
14. **Profile → Settings** — saved zip, Google Calendar connect/disconnect, password, shop-for-me permissions.
15. **Shop** — paste link / upload screenshot / take photo; "shopping for: [me ▾ / Mya / …]"; fit verdict, "you already own similar", 3+ pairing boards, occasional "you might like" with buy links.
16. **Clean-out** — items not worn in X months (X editable here), quick actions.
17. **Admin → People** — add/invite, set role, link minors to parents, remove (with "delete items or move to Family" prompt).
18. **Admin → Lists** — every taxonomy editable here AND inline wherever it appears (e.g., "+ Add category" inside the confirm card).
19. **Admin → Rules** — no-repeat window, not-worn alert months.
20. **Help** — the "how to use it" guide, written like I'm 5.

Design rules: one primary action per screen, big tap targets, no modal-inside-modal, edits save in place, every list has "+ Add" where it is used.

---

## 5. Phases (each finished and tested before the next starts)

**Phase 0 — Foundation & live URL** (goal: you can log in on your phone at fenscloset.com)
- Repo scaffold, Railway project + Postgres + bucket, env vars, CI build.
- Auth: login, forgot/reset password (Resend), sessions, DEV MODE 0535 one-time rule + on-site alert + chat alert.
- Seed 4 people (Jeff, Brittney, Olivia, Mya) + Family closet + all default lists.
- Admin → People, Lists, Rules (all editable).
- PWA shell (installable). Custom domain fenscloset.com + www.
- Tests: login all 4 people; 0535 works once then forces change; forgot-password email arrives; installs on iPhone.

**Phase 1 — Add clothes & closet** (the most important flow)
- Direct-to-bucket uploads, batch queue with resume + progress, background removal, Claude auto-tagging, label reading, confirm card, duplicate detection, item detail, laundry status, favorites, closets + sharing.
- Test: Jeff adds 10 real items in < 3 minutes on iPhone.

**Phase 2 — Profiles & privacy**
- Body profile (+ full-body photos for V2), style profile, favorite brands/stores, visibility grants, minor rules + parent approval, shop-for-someone grants, invite flow (email + share link) end-to-end.
- Test: invite a new person, confirm they get their own closet/profiles; verify Mya's data is invisible to Olivia.

**Phase 3 — Daily outfits & wear tracking**
- Weather (location → zip → ask), Google Calendar occasion + override, check-in (taps or selfie), 3 outfit boards + reasons, Wear this / Swap / More, Together mode, wear log, no-repeat window, dirty-skip, not-worn alerts + clean-out.
- Test: full morning flow for 2 people, together mode for 3.

**Phase 4 — Shopping**
- Link / screenshot / dressing-room photo → fit verdict, similar-owned, 3+ pairings, occasional recommendations with buy links leaning on favorite brands/stores.
- Test: 3 real store links, 1 screenshot, 1 dressing-room photo.

**Phase 5 — Launch checklist**
- All "Done means" items re-verified, the I'm-5 guide, DEV MODE turned off, 0535 rule retired.

**V2 — Virtual try-on** (not started until you approve providers: cost/image, quality, photo storage location, minors policy.)

---

## 6. DEV MODE rules (as specified)
- Env var `DEV_MODE=true` on Railway. Seeded admin `jeff@everbowl.com` / `0535`, `mustChangePassword=true`.
- 0535 is valid for exactly ONE login. On use: site shows a persistent red banner "DEV password in use — change it now", the next screen is forced password change, and I report it in chat.
- When `DEV_MODE=false` (or when any other person's account is activated), the 0535 path is disabled entirely.

---

## 7. What I need from Jeff (with links) — nothing blocks Phase 0 except Railway confirmation

1. **Approve this plan** and answer Q1–Q8 below.
2. **Anthropic API key** → https://console.anthropic.com/settings/keys → "Create Key" → paste it here (or tell me to reuse one — Q5).
3. **Resend** → https://resend.com/signup → then https://resend.com/api-keys → "Create API Key" → paste here. Then https://resend.com/domains → "Add Domain" → `fenscloset.com` → I'll tell you exactly which 3 records to add at GoDaddy.
4. **Google OAuth** (needed for Phase 3, not before):
   a. https://console.cloud.google.com/projectcreate → name it "Fens Closet" → Create.
   b. https://console.cloud.google.com/apis/library/calendar-json.googleapis.com → Enable.
   c. https://console.cloud.google.com/auth/overview → "Get started" → App name "Fen's Closet", support email yours, Audience: **External**, finish.
   d. https://console.cloud.google.com/auth/clients → "Create client" → Web application → I'll give you the exact redirect URL to paste.
   e. https://console.cloud.google.com/auth/audience → **Publish app** (otherwise Google logs everyone out every 7 days). Family members will see a one-time "Google hasn't verified this app" screen → tap Advanced → Continue. That is expected for a private app.
   f. Paste Client ID + Client Secret here.
5. **GoDaddy DNS** → https://dcc.godaddy.com/control/portfolio/fenscloset.com/settings → DNS → I'll give the exact records once Railway issues them (Q6 decides which records).
6. **Family emails** for Brittney, Olivia, Mya (so their logins and invites go to the right place).

---

## 8. Questions for Jeff (answer with the letter)

**Q1 — Background removal.**
A) Self-hosted open-source model (`rembg`) in a second Railway service. ~$5–10/mo, no per-image fee, photos never leave Railway. ~3–6 s per photo, runs in the background queue. **(Recommended)**
B) remove.bg API. Best-in-class edges. ~$0.15–0.22/image → ~$60–180 one-time for the initial catalog, photos are sent to a third party.
C) Run the model inside the main app (no second service). Free, but RAM spikes to ~1.5 GB during batches and can slow the app.

**Q2 — Claude model.**
A) Opus 5.5 for everything (~$20 one-time for the catalog, ~$5–15/mo). Most accurate tagging and reasoning. **(Recommended)**
B) Haiku 5.5 for auto-tagging only (~$0.50 for the catalog), Opus 5.5 for outfits/shopping. Cheaper, slightly less accurate brand/fabric guesses.

**Q3 — "Text link" invites.**
A) App creates an invite link and opens your phone's Share sheet → you send it by iMessage. $0, nothing to register. **(Recommended)**
B) Real SMS via Twilio. ~$10–20/mo all-in plus carrier registration paperwork (days).

**Q4 — Railway.** Your Railway account (workspace "Everbowl's Projects") is connected to this session.
A) I create a new Railway project named `fenscloset` with Postgres + bucket now. **(Recommended)**
B) You create it and tell me the name.

**Q5 — Anthropic key.**
A) Create a new key at the link above and paste it here. **(Recommended — keeps spend visible per app)**
B) Reuse the key from one of your existing Railway projects (tell me which project).

**Q6 — Root domain `fenscloset.com`.** GoDaddy's DNS cannot point a bare domain (no "www") at Railway directly; this is a GoDaddy limitation.
A) Move DNS to Cloudflare (free): change 2 nameservers at GoDaddy, then both `fenscloset.com` and `www.fenscloset.com` work perfectly and you get free image caching. One-time 10-minute task, I walk you through it. **(Recommended)**
B) Keep GoDaddy DNS: `www.fenscloset.com` is the real site; GoDaddy forwards `fenscloset.com` → `www`. Zero nameserver change, slightly less clean.

**Q7 — Outfit boards as shareable images.** Not in your spec; I am NOT building it unless you say yes.
A) No, boards in the app only.
B) Yes, add a "Share as image" button.

**Q8 — Olivia (21) is an adult.** Default role:
A) `member` (controls her own privacy; Jeff/Brittney see nothing of her body data unless she grants it). **(Recommended, matches your spec)**
B) `admin`.


## Phase 1 status (2026-10-18)

Screens approved by Jeff (12-screen batch: Add, uploading, ready, Confirm, colour picker, All done, Closet, Family closet, Item detail, row picker, person switcher). Built and tested (56 unit, 20 browser): bucket storage + photo proxy with privacy rules, remove.bg → thumb → hash → Claude tagging bounded to the lists, resumable add-clothes batches, confirm step (design 03) with duplicate merge, closet grid (design 02), item detail, person switcher with the Family closet. Live tagging waits on `ANTHROPIC_API_KEY` and `REMOVE_BG_API_KEY` in Railway. Deviation flagged for Jeff: uploads relay through the app (`PUT /api/uploads/put`) instead of a direct presigned PUT, because Railway bucket CORS is unverified; `S3_DIRECT_UPLOADS=true` switches to direct once CORS is set.


## Phase 2 status (2026-10-18)

Built and tested (60 unit, 22 browser): body profile (editable measurement list, sizes by brand, fit notes, full-body photos), style profile (loved/avoid colours, editable style words, never-suggest), favorite brands & stores, privacy grants (body data viewers, shop-for), minor body-photo approval (Mya by Jeff, seeded; parents toggle it on the People page), invite flow verified end-to-end (new person gets closet + empty profile; a minor's body data invisible to a sibling until the owner grants it; minors cannot grant). Undrawn screens built from spec parts; screenshot batch sent for approval.
