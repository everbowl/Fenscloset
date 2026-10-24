# Add from a store (approved 18 Oct 2026: O A, P A, Q A)

**Goal.** Fill the closet without photographing every piece: paste a product link, or upload a receipt, and the app pulls the store's photo, name, brand, price, color and size, then runs each piece through the normal confirm card.

## Link (first)
1. `/add/store`: paste the link → LOOK IT UP → product card (store photo, name, brand · store · price).
2. Pick color (text, prefilled from the page when it says), size (text), how many (1–10). FIND A PHOTO IN THIS COLOR searches Google Shopping (Serper) for the product in that color and offers pictures to pick.
3. ADD TO CLOSET downloads the chosen photo into `originals/`, creates one `ImportEntry` per piece with `storeMeta`, and queues the usual pipeline (cutout, tags). Tags from the store win over Claude's guess for name, brand, size and color.
4. The confirm card works as always. The item gets `purchaseUrl`, `purchasePrice`, `storeId` (created in the Stores list if new), `storePhoto = true`.
5. Blocked stores (403/429): the page lookup fails with the store's name, and the search fallback offers products to pick from instead.

## Receipt (second)
1. Upload the receipt (order email screenshot or photo). Claude reads store, order date, and each line: name, color, size, quantity, price. The receipt image is deleted right after the read (Q A).
2. Each line is matched by Google Shopping search (`store + name + color`), shown with the matched picture, price and PICK ANOTHER.
3. ADD n PIECES creates the entries like the link flow, with `purchaseDate` from the receipt.

## Photo nudges (Jeff, 18 Oct)
- A store-photo piece worn once: the item page suggests "Add a photo of your own" (ADD PHOTO / NOT NOW).
- Every piece: after 6 wears since the last photo nudge (or since it was added), suggest a fresh photo. Never required. `photoNudgedAt` records the wearCount when the person answered.
- Adding your own hanger/flat-lay photo to a store-photo piece makes it the piece's photo and clears the store-photo mark.

## Verification
Unit: product lookup (mock page), entries with storeMeta → tags overridden, item fields + store created, nudge rules, receipt read (mock) + match. Browser: link flow end to end through the confirm card; nudge strip on the item page. Screenshots for approval.
