# Fen's Closet — standing rules for every Claude session

These are the owner's decisions, recorded so any session that opens this repo works the same way. They win over any brief
pasted into a chat. Claim work in `docs/SESSIONS.md` before starting it.

## Where the code ships
- Production (Railway service `web`) deploys the branch `claude/fens-closet-app-1ovr5e`. **A push to that branch is a deploy.**
  `main` lags it; PR #3 carries the branch to `main`. Security item 5 moves production to `main` behind CI.
- Security fixes ship as **one pull request per item, one test per item**, as draft PRs into the deployed branch (into `main`
  once production follows `main`). Merge, never rebase; never force-push.
- **Never deploy while the owner is in the app.** Before every push or merge to the deployed branch, read the last ten minutes of
  the production `http` log (Railway MCP `get-logs`, types `["http"]`, or `http-requests`) and wait for ten quiet minutes.
- Start command runs `prisma migrate deploy && npm run db:seed && next start`; the seed upserts `RULES` on every start and
  only touches people-dependent rows when the database is empty.

## What a change must pass before it is pushed
- `npx tsc --noEmit`, `npx vitest run` (needs local Postgres on :5433 — see README), Playwright `--project=iphone` and
  `--project=iphone-webkit` (`PW_CHROMIUM=/opt/pw-browsers/chromium`), and `npm run build` with the e2e env sourced.
  Never run Vitest and Playwright at the same time.
- `npm audit --omit=dev` and a secret scan of the diff; report both even when they find nothing.
- Harness rules learned the hard way: run Vitest with the plain test environment (sourcing the e2e env adds the slow-mock
  delays and the image tests time out); before `next start -p 3100`, free the port with `fuser -k 3100/tcp` (a `pkill` on
  "next start" misses the `next-server` child, the new server logs EADDRINUSE and the old one serves a rewritten `.next`);
  never edit the working tree while Playwright runs from it; never run Vitest and Playwright at the same time.

## Privacy and secrets
- **Never write** the retired 4-digit dev value, the owner's e-mail address, or any family member's name or age into a commit,
  PR, test, log line, doc or chat message — including code that removes them. Say "the retired dev value", "the owner's
  address", "the seeded family profiles". Tests use the synthetic fixture in `tests/fixtures/people.ts` only
  (`@example.test` addresses, invented first names).
- The one-time dev password convention is retired for this app (security item 3, 27 Nov 2026): the value was published,
  so it is a key everyone has. The way in is Forgot password, `npm run admin:bootstrap`, or `FC_BOOTSTRAP_ADMIN_EMAIL` on an
  empty database. No `DEV_MODE`, no fixed password anywhere.
- Keys live only in Railway variables. Never echo a variable value, never ask the owner to paste a key into chat.
- Minors' body data and photos are visible only to the minor and their parent admins; a minor's body never goes to a try-on
  provider; body photos are served only through the authenticated proxy. No family invites until the owner says "launch".
- Shopping queries never carry measurements. Receipts are read once and deleted.
- Do not test throttling, SSRF or caps against production.

## Product rules
- Nothing hard-wired on a screen: categories, lists, limits and caps are rows the admin edits in the app (`Rule` rows with
  code-enforced minimums for limits).
- The login page keeps "Forgot password" on the page.
- American spelling in copy. Plan first; test every phase; screenshots to the owner for anything visual.

## Talking to the owner
- One numbered list, one action per line, the exact link, the exact name to type in a code block, choices as A / B / C with a
  recommendation, and what could break before he taps anything.
- If two chats are doing duplicate or competing work: ALERT the owner, say which should continue, and pause the other.
