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
npm run db:seed                 # 4 people, Family closet, default lists, rules
npm run dev                     # http://localhost:3000
```
In DEV mode (`DEV_MODE=true`) the seed gives `jeff@everbowl.com` the one-time password `0535`.
To reset it later: `npm run db:reset-dev-password`.

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
