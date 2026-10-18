# Phase 5: Launch checklist

**Goal:** Fen's Closet is ready for the family: every "Done means" item re-verified, the I'm-5 Help screen in the app, DEV MODE off and the 0535 rule retired, secrets rotated where they passed through chat.

## Checklist
1. Help screen (`/help`, screen 20) reachable from the person menu. ✔ built
2. Re-verify "Done means": live at www.fenscloset.com (✔), 4 logins work (Jeff ✔; Brittney, Olivia, Mya after invites), invite flow tested (e2e ✔; real email/text at launch), iPhone tested (Jeff's add-clothes timing test pending), Jeff adds 10 items in under 3 minutes (pending Jeff), I'm-5 guide (✔).
3. Jeff's real-world tests: Shop (3 links, 1 screenshot, 1 dressing-room photo); add 10 items timing.
4. Approvals: desktop layout (D), Shop screens (E), Help screen (F).
5. Secrets: rotate the Google client secret (passed through chat) and the remove.bg key (same); confirm all keys live only in Railway.
6. Launch switch (only on Jeff's "launch"): set `DEV_MODE=false` in Railway (retires 0535 and the banner), invite Brittney, Olivia, Mya from Admin → People (email or text), confirm each can log in and sees only what they should (Mya's body data: Mya + parents only).
7. Merge: open PR #1 for review, merge to `main`, point Railway at `main`, delete the feature branch.
8. After launch: watch Railway logs for a day; weekly cost check (Claude, remove.bg, Railway).
