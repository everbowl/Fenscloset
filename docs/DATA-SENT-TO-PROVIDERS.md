# What leaves the app, and to whom

Security item 8 (FC-05). Every outside service the code talks to, what goes there, and from which file. The last two columns
are for the owner to fill in from each provider's own terms; nothing here states a provider's policy. A row changes only when
the code changes; keep this file next to the code.

| Provider | What is sent | From | Retention / training-use terms (owner fills in) | Checked on, by |
|---|---|---|---|---|
| Anthropic (Claude) | Garment photos and labels for tagging, splitting a flat-lay into pieces, reading a size label, judging whether two photos show the same garment; store page text and store photos for the Shop's verdict and matches; the person's own typed notes (what they own, what they are looking for); outfit requests built from closet item names and the weather; inspiration photos a person uploads for their style read; **check-in selfies of adults** (minors' selfies are no longer sent: security item 8, decision C1) | `src/lib/ai/claude.ts` (every call), callers: `ai/tag-item.ts`, `ai/read-label.ts`, `ai/same-garment.ts`, `import/split.ts`, `store/words.ts`, `store/receipt.ts`, `store/match.ts`, `shop/engine.ts`, `shop/wants.ts`, `shop/go-with.ts`, `outfits/engine.ts`, `outfits/together.ts`, `profiles/inspiration.ts`, `checkins/service.ts`, `tryon/garment-check.ts` | | |
| FASHN | An adult's body photo plus the garment photos of the look (never a minor's body) | `src/lib/tryon/fashn.ts`, gated in `src/lib/tryon/index.ts` | | |
| Google Vertex AI | Try-on: an adult's body photo plus garment photos (never a minor's); image model: the dressed picture for a redraw or a styling pass; mannequin: garment photos only | `src/lib/tryon/google.ts`, `src/lib/images/google-image.ts`, `src/lib/tryon/mannequin.ts` | | |
| Kling (Kuaishou) | An adult's body photo plus the garment photo as two 15-minute signed links, deleted when the task ends (never a minor's); off by default in Compare | `src/lib/tryon/kling.ts`, `src/lib/tryon/engines.ts` | | |
| remove.bg | Garment photos (background removal) | `src/lib/images/remove-bg.ts`, callers `import/process.ts`, `items/untidy.ts` | | |
| Serper (Google Shopping) | Shopping queries: garment words, brand, the person's shop section and store preferences; **never a measurement or a size by body** (scrubbed and tested) | `src/lib/shop/products.ts`, callers `shop/engine.ts`, `shop/wants.ts`, `shop/brand-feed.ts`, `shop/go-with.ts` | | |
| Resend | E-mail addresses and the mails themselves (reset links, invite links) | `src/lib/email.ts`, callers `auth/reset.ts`, `auth/invite.ts` | | |
| Twilio | Phone numbers and invite texts (links) | `src/lib/sms.ts`, caller `auth/invite.ts` | | |
| Google Calendar | OAuth tokens (encrypted at rest here), event titles and times for the day's plan | `src/lib/plans/google.ts` | | |
| Open-Meteo | Coordinates derived from a saved zip code or the phone's location (no account) | `src/lib/weather/*` | | |
| zippopotam.us | A US zip code, to get coordinates (no account) | `src/lib/weather/*` | | |

Not sent anywhere: passwords (hashed here), session tokens, body measurements, sizes by brand, a minor's body or face.

Spend caps (security item 8): every paid call above (Anthropic, FASHN, Google Vertex, Kling, remove.bg, Serper) goes through
`chargeAi()` first; the caps are admin-editable rules under Admin → Rules → Advanced → AI allowance, per person per day and
one ceiling per household per day, each with a floor of 1.
