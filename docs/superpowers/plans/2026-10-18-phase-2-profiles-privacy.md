# Phase 2: Profiles & Privacy — Implementation Plan

**Goal:** Every person has a body profile, a style profile and favorite brands/stores, with body data private by default. Parents see a minor's data; nobody else sees it unless granted. Shop-for-someone and body-data visibility are grants the owner controls on their own screen. Invite flow verified end-to-end.

**Spec:** `docs/PLAN.md` §3 Profiles / People & access, §4 screens 11–14, Phase 2. Screens are undrawn: build from DESIGN.md components (header, serif title, mono labels, 42px rows, rule-bounded strips, primary/secondary buttons), screenshot batch for approval at the end.

## Global constraints
- Nothing hard-wired: measurement kinds and style words are editable lists (admin Lists page + inline `+ Add`), not columns.
- Body data (measurements, sizes, fit notes, body photos) is visible only to: the owner, parents of a minor owner, and people the owner explicitly granted. Admins get no automatic access to an adult's body data.
- A minor's body data can never be granted beyond the family; a minor's screen shows the fixed list (self + parents) and no grant control.
- Body photos for a minor exist only while a parent approval is on record (Mya: approved by Jeff, seeded). Parents toggle it on the admin People page.
- Shop-for-someone: owner grants shoppers; parents are implicitly shoppers for their minors.
- All photos keep going through `/api/photo` with `canViewKey` extended for `bodies/<ownerId>/…` keys.

## Tasks
1. **Schema + lists**: `MeasurementKind {name, unit}` and `StyleWord` as list kinds (registry + seed); `BodyProfile {personId, fitNotes, heightCm?, weightKg?}` → simplified to `BodyMeasurement {personId, kindId, value}`; `BodySizeByBrand {personId, brandId, categoryId?, size}`; `BodyPhoto {personId, bucketKey, takenAt}`; `StyleProfile` via M:N `Person.lovedColors`, `Person.avoidColors`, `Person.styleWords`; `FavoriteBrand`/`FavoriteStore` as M:N; `BodyDataGrant {ownerId, viewerId}`; `ShopForGrant {ownerId, shopperId}`; `MinorBodyImageApproval {minorId, approvedById, approvedAt}`. Seed Mya's approval by Jeff. Migration via `npm run db:new-migration`.
2. **Visibility service** (`src/lib/people/visibility.ts`): `canSeeBodyData(viewer, ownerId)`, `canShopFor(viewer, ownerId)`, `bodyPhotosAllowed(ownerId)`, `canViewKey` for `bodies/` keys. Tests: Olivia cannot see Mya; Jeff can; grant lets Olivia see Jeff; minors cannot grant.
3. **Profile services** (`src/lib/profiles/service.ts`): read/update measurements, sizes by brand, fit notes, style (colors, words), favorites, grants, minor approval; body photo add/remove. Tests.
4. **Screens**: `/profile` hub (rows with live summaries), `/profile/body`, `/profile/style`, `/profile/brands`, `/profile/settings` (saved zip, who can see my body profile, who can shop for me). Viewing another person via the switcher shows their profile read-only with body data hidden unless permitted. Admin People → person page gets the "Body photos" approval row for minors.
5. **Invite end-to-end**: e2e: invite Olivia-like new person → accept → personal closet + empty profile exist; Olivia logged in sees Mya's profile without body data.
6. **Acceptance**: deploy, screenshots batch, report.
