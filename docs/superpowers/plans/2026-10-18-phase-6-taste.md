# Phase 6 — Make outfitting great (taste loops)

**Goal:** the looks engine stops being "fine" and starts feeling like a stylist who knows the person. Three feedback loops plus one wow feature, approved by Jeff 18 Oct 2026 (Q21 A visual ranking, Q22 A taste memory, Q23 A inspiration + "how did it go?", Q24 B virtual try-on adults only, opt-in).

## Done means
1. **Visual ranking** ✔ — text pass drafts count+2 looks, vision pass sees the cutouts and keeps the best (`rankVisually`).
2. **Taste memory** ✔ — WEAR THIS / passes / swaps recorded (`LookFeedback`), 90-day digest in every prompt, FORGET on the Style page.
3. **"How did it go?"** — a fit gets one of LOVED IT · FINE · NEVER AGAIN the day after. Fits panel shows the three taps; Today shows a one-line strip for yesterday's unrated fit. Loved and never-again lines join the taste digest.
4. **Inspiration board** — on the Style page: upload screenshots of looks you like (Instagram, Pinterest, a magazine). Claude reads each into style DNA (summary, silhouettes, color pairings, formality, pieces, words). Tiles with a sheet showing what it read, REMOVE per tile. The digest joins the style context. Photos live under `inspo/`, visible to the owner and a minor's parents only. Nothing leaves the house except the image to Claude.
5. **Virtual try-on** — adults only, opt-in per person in Settings, never minors. Provider decision pending (Q25): A Google Vertex AI Virtual Try-On (strongest data terms, Jeff already has Google Cloud; service account in Railway) vs B FASHN.ai (one API key, fastest to wire). Built behind a provider interface with a mock so the UI, privacy gate and tests exist before the key does.
6. **Style rules** (editable list per person, admins can edit) — queued after 3–5.

## Privacy rules that bind this phase
- Inspiration images and try-on images of a person are that person's (plus parents for minors). Try-on never runs for minors.
- Shopping queries and try-on prompts never carry measurements.
- Every learned line and every inspiration tile can be removed by the owner or a parent.

## Verification
- Unit: fits rating + yesterday strip, taste digest with loved / never-again lines, inspiration read (mock) + context + remove, try-on gate (minor → refused, opt-out → refused).
- Browser: rate a fit from Fits and from the Today strip; add and remove an inspiration tile; try-on button hidden for minors and before opt-in.
- Screenshots of the Style page (inspiration), Fits panel (rating) and Today strip for approval.
