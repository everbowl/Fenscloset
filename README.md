# Fen's Closet

Private, mobile-first family closet app. Catalog clothes with photos, get daily outfit suggestions, shop smarter.

- Plan: `docs/PLAN.md`
- Implementation plans: `docs/superpowers/plans/`

## Stack
Next.js 16 (App Router, TypeScript) · Prisma 7 + PostgreSQL · Railway (app, Postgres, bucket) · Claude API · remove.bg · Serper (store search) · the mirror: Google Vertex, FASHN, Kling · Resend · Twilio · Open-Meteo · Google Calendar · PWA.

## Local development
```bash
cp .env.example .env            # every variable the app reads, with what each is for; DATABASE_URL must point at a Postgres 16
npm install
npm run db:migrate              # applies migrations
npm run db:seed                 # Family closet, default lists, rules — no people (the repository holds no one's name or address)
npm run dev                     # http://localhost:3000
```
The seed creates no people. For a local admin, add the synthetic household the tests use and give its admin a password
of your own (security item 3 replaces this with `npm run admin:bootstrap`):
```bash
npx tsx e2e/seed-people.ts                               # four invented people with @example.test addresses (tests/fixtures/people-data.ts)
npx tsx e2e/set-password.ts avery@example.test <password> # the fixture admin can now sign in
```

## Tests
```bash
npm run typecheck
npm test                        # Vitest, uses .env.test (separate database)
PW_CHROMIUM=/path/to/chromium npm run test:e2e   # Playwright (iPhone 15 + desktop); omit PW_CHROMIUM if Playwright installed its own browsers
```

## Deploy (Railway)
`railway.json` builds with Railpack and starts with `npx prisma migrate deploy && npm run start`.
Set every variable from `.env.example` in Railway > Variables (the mirror needs at least one engine key: the Google service account, `FASHN_API_KEY` or `KLING_API_KEY`). Health check: `/api/health`.
First deploy: run the seed once (`npm run db:seed`) from a Railway shell or one-off command.
Every push to the deploy branch goes live on its own (Railway builds on push). Before a push, check Railway's http log for ten quiet minutes: a build while someone is in the app is what the "New version ready · Reload" bar is for, but a quiet window is better (Jeff, 26 Nov 2026, 4A).
The site is private: `src/app/robots.ts` disallows every crawler, every page carries a no-index tag, and every response an `X-Robots-Tag` header.

## Variables the code reads (names only)

Every one lives in Railway → `web` → Variables (or a local `.env`), never in the code, a doc or a chat. `.env.example` carries the
same list with a line on each. Security item 12 (PF-06): this table is what a move of the project to another account must carry.

| Variable | For | Required |
|---|---|---|
| `DATABASE_URL` | Postgres | yes |
| `SESSION_SECRET` | signs sessions, upload links and the calendar token key | yes |
| `APP_URL` | the public address every mailed link is built from | yes (reset and invite links point at localhost without it) |
| `NODE_ENV` | `production` on Railway | yes |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PATH_STYLE`, `S3_DIRECT_UPLOADS` | the photo bucket | yes (the two flags optional) |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_TIMEOUT_MS` | tagging, outfits, the Shop's verdicts | key yes |
| `REMOVE_BG_API_KEY` | background removal on added pieces | optional |
| `SERPER_API_KEY` | product search | optional |
| `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_*`, `GOOGLE_IMAGE_HOLD_MS` | the Google try-on, image model and mannequin | optional (one mirror engine is enough) |
| `FASHN_API_KEY`, `FASHN_*` | the FASHN try-on | optional |
| `KLING_API_KEY` (or `KLING_ACCESS_KEY` + `KLING_SECRET_KEY`), `KLING_API_BASE`, `KLING_POLL_MS`, `KLING_TIMEOUT_MS` | the Kling try-on (off by default in Compare) | optional |
| `RESEND_API_KEY`, `EMAIL_FROM` | reset and invite mail; `EMAIL_FROM` must be on a domain verified in Resend to reach anyone but the account's own address | key yes for Forgot password |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | invite texts | optional |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Calendar for the day's plan | optional |
| `UNTIDY_ON_START`, `WANTS_ON_START`, `REQUEUE_ON_START` | background work at boot | optional |
| `FC_BOOTSTRAP_ADMIN_EMAIL` | the first admin of an EMPTY database only; delete after the first sign-in | never on a running site |
| `RAILWAY_GIT_COMMIT_SHA` | set by Railway; the build id | Railway |
| `MOCK_*`, `PW_CHROMIUM`, `SEED_FORCE`, `CI` | tests and local mocks only | never on Railway |

Never set on the service: `HTTP_PROXY` / `HTTPS_PROXY` (the guarded fetch pins its own connections; a proxy would be pinned
instead of the shop), any `MOCK_*`, `DEV_MODE`, `DEV_ADMIN_EMAIL`.

Checked against the production service on 27 Nov 2026 (names only): every variable set there is read by the code; the only
names read but not set are optional ones (the Twilio trio, the two bucket flags, the engine tuning names); no mock or proxy
variable is set. `DEV_MODE` is still set there and comes off with security item 4 (the owner's step).
