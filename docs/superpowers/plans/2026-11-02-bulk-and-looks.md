# Bulk wardrobe, sections, looks, copies (Jeff, 2 Nov 2026)

Six asks arrived in one sitting. Each is recorded here with what exists, what gets built, and the questions
Jeff answers in chat (letters and numbers, recommended pick first). Decisions are appended as they land.

## A. Men's and women's mixed in the Shop
- **Cause**: nothing on `Person` says which section they shop in; the Looking-for query writer only guesses
  ("add who it is for when the line implies it"), so "jeans" brought back both.
- **Build**: a `shopSection` list (Men's, Women's, Boys', Girls', Unisex; editable under Lists), one pick per
  person (Profile → Settings; admins on People; a one-tap ask on Shop and Looking-for while unset). Every
  store search carries it: Looking-for queries, the Shop verdict's shopping queries, Go with it, Find a photo
  in this color; results whose title names the other section are dropped.
- **Q A1 (rec.)** Jeff = Men's now, everyone else picks on first Shop open. **A2** Jeff names each person's section.

## B. Build a look from a mix (buy + closet)
- **Build**: "Add to a look" on any store find (Looking-for matches, Shop results, Go with it) and on closet
  pieces in pick mode → a per-person `LookDraft`; a strip "Look · n pieces"; the look screen lists the
  pieces (remove, Buy links), See it on me / On a mannequin; `tryOnLook` takes several store garments
  (today one `extraGarment`); assumption: up to 5 pieces per look.
- **Q B1 (rec.)** saved looks under Fits as a named "Looks" row. **B2** on the Shop page. **B3** no saving.

## C. Bulk loading the wardrobe — built 2 Nov 2026
- **Existed**: /add/store with a link tab (one color, one size, one count per pass) and a receipt tab (one).
- **Built**: the link tab shows "Size for all" (the page's sizes or typed) and a row per color with a count
  stepper, its own size on tap ("change"), its photo (the page's per-color photo, a search pick, or the main
  photo); "Another color" adds a row; "Or tell it in words" (`src/lib/store/words.ts`: Claude, mock in tests)
  fills the rows from a note like "I own 7 of these, all Medium: black ×2, navy, white, grey ×3"; one
  "Add n to closet" (`createStoreRows`). The receipt tab takes many files at once, reads three at a time
  with a progress line, groups lines per receipt (store · date), one "Add n pieces" for all
  (`addReceiptsAction`); each receipt image is deleted after reading, as before.
- **Unchanged until Jeff answers**: every piece still waits on a confirm card (one tap each); the real-photo
  ask still comes after the first wear and every six wears (`photoNudge`).
- **Q C1 (rec.)** link/receipt pieces go straight into the closet, fixable on the piece page. **C2** keep the
  one-tap cards. **C3** a "Confirm all" button.
- **Q C4 (rec.)** a quiet "store photo · add yours" line on the piece page with Add photo right there.
  **C5** a popup next time the piece opens. **C6** leave as is.

## D. "What's needed" on a person's closet page
- **Build**: a strip at the top of the closet with one row per gap, the action in the row: body photos
  (front, side, back), a better body photo when the mirror struggled, pieces still on a store photo, sizes
  missing for a favorite brand, no shop section. "Not now" hides a row for 30 days.
- **Q D1 (rec.)** closet page only. **D2** also one line on Today.

## E. Several shirts in one photo
- **Build**: on the confirm card, "Several pieces in this photo?" → Claude counts them and reads each
  one's color; one piece each, sharing name and size; identical ones become copies (F).
- **Q E1 (rec.)** each piece cropped out as its own photo. **E2** the group photo on all until real ones arrive.

## F. Ten of the same shirt
- **Build**: a copies count on a piece; one closet card "×10"; the piece page lists the copies and their
  state; a real photo attaches to one copy; the clean-out advises when copies sit unworn.
- **Q F1 (rec.)** laundry per copy (one worn → one dirty, nine clean; Today keeps offering it while any copy
  is clean). **F2** the whole stack goes dirty together.

## O. Order
- **O1 (rec.)** Check-in fix (done, 9fb9a1c) → C (done) → F → A → E → D → B. **O2** B before C.

## Decisions
- 2 Nov 2026: A built as A1 while Jeff's answer is pending (Jeff = Men's by the seed; everyone else picks on the Shop or Looking-for the first time, or in Settings → Shops in). A2 would only add the other people's picks.
