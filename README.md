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
The seed creates no people. The first admin comes from a reset link (there is no bootstrap password anywhere):
```bash
npm run admin:bootstrap -- --email you@example.test --print   # prints a single-use, 60-minute link; open it and choose a password
```
It refuses while an admin with a password exists. On a fresh Railway environment, set `FC_BOOTSTRAP_ADMIN_EMAIL` before the
first deploy instead, use Forgot password on the sign-in page, then delete the variable. Tests and e2e specs use the synthetic
household in `tests/fixtures/people.ts`.

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
Every push to the deploy branch goes live on its own (Railway builds on push). Before a push, check Railway's http log for ten quiet minutes: a build while someone is in the app is what the "New version ready · Reload" bar is for, but a quiet window is better (the owner, 26 Nov 2026, 4A).
The site is private: `src/app/robots.ts` disallows every crawler, every page carries a no-index tag, and every response an `X-Robots-Tag` header.
