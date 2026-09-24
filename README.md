# BL-Picklist

A phone/tablet-friendly pick-list app for open BrickLink orders. Netlify
Functions hold the BrickLink Store API credentials and sign every request
with OAuth 1.0a; the static frontend never sees them.

```
public/index.html                     → the app (order list → checklist)
netlify/functions/orders.js           → GET /api/orders
netlify/functions/order-items.js      → GET /api/orders/:id/items (flattened)
netlify/functions/colors.js           → GET /api/colors (cached)
netlify/functions/item-image.js       → GET /api/item-image?type=&no= (proxied photo)
netlify/functions/update-order-status.js → POST /api/update-order-status (writes to BrickLink)
netlify/functions/pick-state.js       → GET/POST /api/pick-state (durable "picked" state + Drive Thru/feedback completion, via ?key=state|actions)
netlify/functions/order-messages.js   → GET /api/orders/:id/messages
netlify/functions/send-drive-thru.js  → POST /api/send-drive-thru (writes to BrickLink)
netlify/functions/member-rating.js    → GET /api/member-rating?username=
netlify/functions/post-feedback.js    → POST /api/feedback (writes to BrickLink)
netlify/functions/order-status-check.js → GET /api/orders/:id/status-check?buyer= (Drive Thru/feedback already done on BL?)
netlify/functions/order-contact.js    → GET /api/orders/:id/contact (buyer email/address/payment method/tracking number)
netlify/functions/update-tracking.js  → POST /api/update-tracking (writes tracking number to BrickLink)
netlify/functions/inventory-create.js → POST /api/inventory-create (BrickScan CSV import, writes new listings to BrickLink)
netlify/functions/price-guide.js      → GET /api/price-guide?type=&no=&condition=&color= (active US listings, for pricing)
netlify/functions/lib/bricklink.js    → shared OAuth1.0a request helper
netlify/functions/lib/order-contact.js → shared BrickLink order → buyer-contact mapping
```

A branch/commit checkpoint, `fork-point-pre-api-expansion`, marks the app
right before the four functions below were added (order messages, Drive
Thru, buyer rating, feedback) — see `CLAUDE.md` for how to roll back to it
if they end up making the app feel more complicated than useful.

## Setup

1. Register a consumer + access token at
   [bricklink.com/v2/api/register_consumer.page](https://www.bricklink.com/v2/api/register_consumer.page).
   Register the token against IP **`0.0.0.0`** — Netlify Functions don't
   have a fixed outbound IP, and BrickLink supports `0.0.0.0` as a wildcard
   for cloud-hosted apps.
2. Copy `.env.example` to `.env` and fill in the four values:
   ```
   BL_CONSUMER_KEY=
   BL_CONSUMER_SECRET=
   BL_TOKEN=
   BL_TOKEN_SECRET=
   ```
3. Install dependencies:
   ```
   npm install
   ```
4. Run locally with the Netlify CLI (loads `.env` automatically):
   ```
   npx netlify dev
   ```
   This serves `public/` and proxies `/api/*` to the functions.

## Deploy

Push to Netlify (via `netlify deploy` or a connected Git repo) and set the
same four `BL_*` variables as environment variables in the Netlify site
settings — **not** in the repo. Because the access token is registered
against the permissive `0.0.0.0` wildcard, treat the Consumer Secret and
Token Secret as sensitive as an API key that can move money.

## Notes

- `/api/orders` calls BrickLink with `direction=in` (orders where you're
  the seller) and returns every order status except `COMPLETED` by
  default. Override with `/api/orders?status=paid,packed` etc. if you want
  a narrower set. Order cards and the detail view show a color-coded
  status badge (fresh/paid, packed, shipped/received, cancelled/problem).
- `/api/item-image?type=&no=&color=&nu=` fetches up to three independent
  BrickLink photo sources concurrently — the official Catalog API's
  `image_url`, the color-specific catalog photo
  (`img.bricklink.com/ItemImage/{TYPE}{N|U}/{color_id}/{no}.png`), and
  BrickLink's own "large" size variant (`www.bricklink.com/{TYPE}L/{no}.jpg`,
  the same one linked from BrickLink's own item pages) — and uses
  whichever comes back with the most bytes, since which source actually
  has the most detail varies by item. Falls back to a small generic photo
  (`img.bricklink.com/{TYPE}/{no}.jpg`, no color variants) only if all
  three fail. BrickLink's hotlink protection blocks these when a browser
  requests them directly as an `<img>` subresource (even with no
  `Referer` sent — it appears to key off `Sec-Fetch-*` request metadata,
  which can't be suppressed client-side), so this function fetches
  server-side and streams the bytes back under our own origin. The
  response carries `X-Image-Tier` and `X-Image-Bytes` headers; the
  lightbox fetches via JS (rather than a plain `<img src>`, which can't
  read headers) to show which source and size it got. Each `<img>` falls
  back to a placeholder icon on load failure; tapping a photo opens it
  full-size in an in-page lightbox with pinch/pan/double-tap zoom (built
  on Touch Events, not the browser's native pinch-zoom, which is
  disabled site-wide to avoid accidental zooming while picking).
- Colors are fetched once from `/api/colors` and cached indefinitely in
  `localStorage`, since BrickLink color IDs essentially never change.
- "Picked" state's durable copy lives in Netlify Blobs via `/api/pick-state`
  (a single JSON object, all orders' picks together, GET to read / POST to
  overwrite). `localStorage` is only a fast, offline-capable cache in front
  of it — every pick writes to both immediately, and the app pulls the
  remote copy on load and merges it in (a picked item stays picked if
  *either* side has it picked, so a sync can't accidentally erase
  progress). This is what actually matters on iOS: a standalone
  "Add to Home Screen" web app's `localStorage` can get evicted by iOS
  between launches (worse than a normal Safari tab), which used to look
  like picks resetting after a force-quit. Netlify Blobs isn't tied to a
  device, so it also means picks now sync across phone/iPad if you use
  both. Picked items are keyed by item number + color + condition (not
  list position), since BrickLink doesn't guarantee returning an order's
  items in the same order on every fetch — an old install's
  position-keyed picks get migrated to the new keying automatically the
  first time each order is reopened.
- Tapping an item to pick it toggles just that row's `.picked` class
  directly rather than re-rendering the whole order-detail view — it used
  to call the full render function on every tap, which rebuilds the
  entire item list (including re-running the per-row thumbnail sizing
  pass) each time. Harmless on desktop, but real-world testing on iOS
  turned up a visible bug from it: tapping an item near the bottom of a
  long list would jump to a different scroll position, consistent with
  WebKit's scroll-anchoring heuristics getting confused by the wholesale
  DOM replacement (`.item-row.picked`'s CSS — background, opacity,
  strikethrough, checkmark — has no layout-affecting properties, so the
  surgical class toggle needed no other changes to look right). A sticky
  progress bar in the header (`#topbarProgressRow`, visible only on the
  order-detail view) updates the same way, off the same
  `updatePickedProgress()` call, so picking progress stays visible while
  scrolling through a long list instead of only showing at the top of
  the page.
- Items with quantity > 1 don't pick in a single tap — Ryan's own idea,
  after flagging that it's too easy to mark a 6- or 12-piece lot picked
  after physically counting out only one. Each tap adds 1 to a per-lot
  counter (0/6 → 1/6 → … → 6/6), shown as its own small progress bar
  under the item, with a visibly bigger quantity badge and a distinct
  amber row tint while it's mid-count (vs. the usual green once actually
  complete) — three separate visual cues so a half-picked multi-piece
  lot never reads the same as either an untouched one or a done one.
  Tapping again after reaching the full count wraps back to 0 (a
  deliberate "start the count over" rather than picking past the end).
  A lot only counts toward the order's overall "X of Y lots picked" once
  its own counter is actually full — a qty-1 item's single tap still
  works exactly as it always did.
  Storage-wise, a pick is either the original bare `true`/`false`
  (unchanged for every qty-1 item, and every pick made before this
  feature existed) or `{n, of}` for a qty>1 item's count-in-progress.
  The remote sync's merge logic had to change alongside this: the
  original rule OR'd two sides together by truthiness, which — since a
  `{n, of}` object is truthy regardless of how small `n` is — would have
  silently flattened a genuinely-partial count (say 2 of 6 tapped) into
  a false "fully picked" the moment it synced from a device with no
  record of that lot yet. The merge now compares actual completeness
  (`n >= of`, or the legacy bare `true`) and takes the greater tap count
  when neither side is complete, preserving the same "never lose
  progress" guarantee the original boolean-only merge had.
- There's no auto-refresh; tap "Refresh" in the header to re-pull orders,
  which keeps usage well under BrickLink's 5,000 requests/day limit.
  The list is sorted newest to oldest by `date_ordered`, matching
  BrickLink's own Orders Received page — `/api/orders` doesn't guarantee
  an order, so this sorts client-side right after every fetch.
- The orders list can push a real status change back to BrickLink: a
  "Mark as packed" button on PAID orders and "Mark as shipped" on PACKED
  ones. `/api/update-order-status` only accepts those two target
  statuses (`PUT /orders/{id}/status` on BrickLink's side with
  `{"field":"status","value":...}`) — no free-form status picker, so a
  bad request can't push an order into an unexpected state. Each tap
  requires a confirm dialog first, since — unlike most of the app — this
  writes to a live, buyer-visible order. Once an order is SHIPPED (and
  Drive Thru hasn't been sent yet), that same card slot shows "Send
  Drive Thru" instead — Ryan's actual workflow is pack → ship → drive
  thru, so this makes shipping the natural next tap right after marking
  an order shipped, no trip into the order detail page needed. It's the
  same POST /api/send-drive-thru and the same durable "sent" tracking as
  the order detail page's own Drive Thru button (see below) — send it
  from either place and both stay in sync, and the button disappears
  from the list the same way "Mark as shipped" does once used.
- The order detail page also has three more BrickLink writes/reads, added
  so logging into BrickLink directly (blocked on at least one of Ryan's
  work networks, since it goes through lego.com) is needed less often:
  - **Send Drive Thru** — shown once an order is SHIPPED.
    `POST /orders/{id}/drive_thru?mail_me=false` (a query param, not a
    JSON body, unlike the other writes here). Confirm dialog first, same
    reasoning as the status buttons. "Sent" state lives in
    `/api/pick-state?key=actions`, the same durable Blobs store picks
    use (second key, same store), so the button correctly shows
    "Drive Thru Sent" (grayed out, disabled) on every device and after a
    reload — including when it was sent directly on BrickLink rather
    than through this app: opening an order also calls
    `/api/orders/:id/status-check`, which reads the order's own
    `drive_thru_sent` field (confirmed against a real client library's
    typed struct) and folds that in. That check only ever turns the flag
    *on*, never off, and any failure there just leaves things as
    whatever's already tracked.
  - **Order messages** — `GET /orders/{id}/messages`, shown read-only
    under the item list when an order has any. Fetched alongside items;
    a failure here doesn't block the rest of the order view.
  - **Buyer feedback rating** — `GET /members/{username}/ratings`, shown
    as a small `★ total (praise %)` next to the buyer's name (e.g.
    `★ 1842 (99.6%)`). Confirmed against a live response: the endpoint
    returns `{"rating": {"PRAISE": n, "NEUTRAL": n, "COMPLAINT": n}}`
    (counts, not an overall score), so the badge is a total feedback
    count and the praise percentage computed from those three.
  - **Leave feedback for buyer** — shown once an order is PACKED,
    SHIPPED, RECEIVED, or COMPLETED (PACKED included because Ryan marks
    an order packed as soon as its label is bought, often before it's
    physically picked — well before SHIPPED in his actual workflow):
    pick Praise/Neutral/Complaint, write a
    comment (pre-filled with Ryan's own standard feedback text, still
    editable), confirm (this posts public feedback visible to the buyer
    and everyone on BrickLink), `POST /feedback` with
    `{order_id, rating, comment}` — `rating` is sent as BrickLink's
    numeric code (Praise=0/Neutral=1/Complaint=2), confirmed against a
    real client library's source, since sending the word itself gets
    `PARAMETER_MISSING_OR_INVALID`. Like Drive Thru, "already posted"
    state is tracked durably via `/api/pick-state?key=actions`, so the
    form correctly shows "Feedback sent" everywhere once it's been
    posted from any device — and the same `status-check` call also
    tries to catch feedback posted directly on BrickLink, via
    `GET /orders/{id}/feedback`: any entry whose `from` isn't the buyer
    is assumed to be ours. That shape isn't independently confirmed
    (unlike `drive_thru_sent`), so it's a best guess — worth watching
    the first few real orders to see whether it's actually catching
    this correctly.
- **Order detail page layout** — top to bottom: order summary (with a
  "Mark as packed"/"Mark as shipped" button right there when the order
  is PAID/PACKED — the same `/api/update-order-status` write the orders
  list button does, just reachable without leaving the order; `order`
  is the same object reference the orders list reads, not a copy, so
  marking it here updates the list's badge/button too, no refetch
  needed), a "Jump to items ↓" button (only shown when the order has
  line items — scrolls straight past everything below to the item
  list), the address/tracking block, the payment/cost block, messages,
  Leave Feedback, then "Select all as picked"/"Clear picks for this
  order" — all before the item rows. Feedback and the pick-progress
  buttons both used to render after the items; feedback in particular
  isn't actually gated on pick progress (only order status), so moving
  it up just makes that visible. The same two pick-progress buttons
  still repeat at the very bottom of the page too, for after you've
  scrolled down while picking.
- **Buyer contact block** — shipping address and email, from
  `GET /api/orders/:id/contact` (`GET /orders/{id}` — the only endpoint
  that returns `buyer_email` and the fully-separated `shipping.address`
  fields; the list endpoint doesn't — mapped in `lib/order-contact.js`).
  Two buttons:
  "Copy name & address" copies a standard multi-line name/address block
  (ready to paste into PirateShip's manual address entry) and "Copy
  email" copies just the buyer's email. Uses the Clipboard API with a
  hidden-textarea `execCommand("copy")` fallback for any embedded webview
  that doesn't support it.
- **Tracking number entry** — also in that contact block. If BrickLink
  already has a tracking number on the order (`shipping.tracking_no`),
  it's shown read-only; otherwise there's a text field + Save button.
  `POST /api/update-tracking` writes it with `PUT /orders/{id}`
  (BrickLink's "Update Order" endpoint —
  https://www.bricklink.com/v3/api.page?page=update-order) and body
  `{"shipping":{"tracking_no":"..."}}` — confirmed against the real
  `go-bricklink-api` client library's `UpdateOrder` implementation, which
  sends exactly that shape (only the fields being changed; BrickLink
  ignores anything else in the body, so this can't accidentally touch
  status, payment, or cost). Saving switches the field to the same
  read-only display without needing to reopen the order. Once a
  tracking number exists (BrickLink's or one just saved here), it's a
  link that opens the carrier's tracking page in a new tab — UPS
  (numbers starting "1Z") or USPS (purely numeric, 10+ digits, which
  covers USPS's various service prefixes — 9300/9400/9205/9407/etc —
  without hardcoding just one of them). Anything that doesn't match
  either pattern (FedEx, DHL, a typo) stays plain text rather than
  guessing a carrier and linking to the wrong tracking page.
- **Payment/cost block** — a separate block from the address one (order
  detail page): payment method plus the order's cost breakdown
  (subtotal/shipping/insurance/tax/etc1/etc2/credit/coupon/grand total),
  from the same `order.cost` object `lib/order-contact.js` already reads
  off the order detail fetch. Optional charge rows only render when
  BrickLink actually returned a non-zero value, so a typical order shows
  just Payment/Subtotal/Shipping/Total, not a wall of "$0.00" rows. The
  sales-tax field is a soft guess (a real client library disagreed with
  itself on the field's name/casing/type across two different structs)
  — read-only display, so a miss just shows a blank Tax row, never a bad
  write.
- **Add Inventory** — a separate page (nav button above the orders list,
  "+ Add Inventory"), for adding new listings from a
  [BrickScan](https://apps.apple.com/app/brickscan) CSV export without
  needing to log into BrickLink's own site (blocked on Ryan's work
  network) or use its mobile-unfriendly upload/review flow. Upload a CSV
  → parsed client-side (a small hand-rolled RFC 4180 parser handles
  BrickScan's quoted fields, e.g. item names containing commas) → shown
  as a review screen reusing the order detail page's item-card styling
  (photo via the existing `/api/item-image`, same thumbnail/lightbox) →
  each row's qty/price/condition/color/remarks is editable and can be
  unchecked to skip it → only on "Submit" does anything reach BrickLink.
  `POST /api/inventory-create` creates each selected item individually
  (not one bulk call) via `POST /inventories` (BrickLink's "Create
  Inventory" endpoint), sequentially so one bad row can't take down the
  rest of the batch, and returns a per-row success/error result the
  review screen displays inline — a row that fails stays editable to fix
  and retry, one that succeeds locks and shows its new inventory ID.
  There's no staging/review endpoint in BrickLink's Store API itself
  (unlike its website's own upload flow) — everything up to the actual
  `POST` happens entirely in this app, which is what makes the review
  step possible at all here.
  The CSV's `ITEMTYPE/ITEMID/COLOR/REMARKS/DESCRIPTION/QTY/CONDITION/PRICE`
  columns match BrickLink's own classic inventory-upload format exactly
  (confirmed against a real BrickScan export); the request body's
  `item.type` is sent as the full uppercase word ("MINIFIG", "PART", ...)
  to match what BrickLink's Order Items endpoint is confirmed to return
  elsewhere in this app — but that casing is **not** independently
  confirmed for Create Inventory specifically, since there's no safe
  read-only way to check it first (unlike shipping address or
  `drive_thru_sent`, which were confirmed via a debug endpoint before
  anything shipped). Worth watching the first real submission: a wrong
  casing would show up as a clear per-row error, not a silent failure.
- **Active listings price check** — a "See active US listings" toggle on
  each review card in Add Inventory. `GET /api/price-guide` wraps
  BrickLink's Get Price Guide endpoint (`GET /items/{type}/{no}/price`
  with `guide_type=stock`, i.e. currently-listed items, not past sales)
  filtered server-side to `country_code=US`. Confirmed against two
  independent real client libraries (`go-bricklink-api` and the Python
  `bricklink-py`, which agree on both the query param names and that the
  URL path's `{type}` is the same full uppercase word used everywhere
  else here) — the query param is `new_or_used`, not `condition`; the Go
  client's own internal option-builder actually gets that one wrong,
  caught by cross-checking a second source rather than trusting either
  alone. Shows both New and Used sections side by side — always both,
  regardless of the row's own Condition dropdown, so Ryan can compare
  pricing across conditions before deciding how to list — each with its
  own min/avg/max and its cheapest 25 listings (the backend sorts then
  caps to 25; a common item can have 60+ active listings, and Ryan only
  ever prices off the bottom of the list anyway). Tapping a listing fills
  that row's Price field and syncs its Condition dropdown to match
  whichever section it came from, so a tapped price and the declared
  condition never end up mismatched. Cached per item+color+condition
  combination independently of the row's own Condition (editing color
  refetches both; changing Condition doesn't refetch anything, since both
  are already loaded; qty/price/remarks don't affect it either) so
  re-opening an already-checked panel doesn't re-hit the API. Each
  section also links out to BrickLink's own catalog page (`View on
  BrickLink`), pre-scoped to that section's condition, the row's color
  (if any), and US-only — the URL shape (including the odd `O={...}`
  fragment encoding, and color showing up twice — once as its own `C=`
  param, once inside `O`) was confirmed against two real URLs Ryan
  captured live off bricklink.com, not reconstructed from guesswork.
  `country_code=US` filtering itself is confirmed working correctly
  against a real response (20 of 64 total listings), which ruled out an
  early bug's first suspect. The actual bug was a defensive client-side
  re-filter on `seller_country_code` — a field the Go client's
  `PriceDetail` struct claimed existed but doesn't: each `price_detail`
  entry really only has `quantity`, `unit_price`, and
  `shipping_available` (plus a redundant, identically-typo'd
  `"qunatity"` field BrickLink's own API ships). That re-filter matched
  nothing on every request and silently zeroed the whole list — caught
  by adding a temporary side-by-side raw-response debug endpoint (same
  technique as the order shipping-address/payment confirmations
  earlier), having Ryan hit it against a real item with 20+ known
  listings, and reading the actual field names instead of trusting the
  struct a second time.
- **Top nav** — two persistent category buttons, Orders and Inventory,
  always visible (except while drilled into a single order's detail
  view, which keeps the old "< All orders" back button instead — a
  drill-down, not a top-level page switch). Everything else collapses
  under one of the two: Orders category = order list (default) + Label
  Prep; Inventory category = Manage Inventory (default) + Add
  Inventory. A single secondary "jump to the sibling page" link/button
  sits under the active category rather than a separate button per page
  — its label and click handler are swapped in JS per view
  (`setTopbarNav()`) instead of keeping four always-present buttons
  around, since only one sibling is ever relevant at a time.
- **Label Prep** — a page under the Orders category (shipping labels are
  part of order fulfillment, not inventory), unrelated to BrickLink
  itself: shrinks a 4x6 Pirate Ship shipping-label
  PDF/image, rotates it, and places it in one corner of a fresh 4x6
  canvas, so the blank remainder can be used as tape on small boxes
  (Ryan's own workflow — Labelife, his label printer's app, is too
  clunky to do this shrink/rotate/position itself). Entirely client-side:
  no server round-trip, nothing touches a Netlify Function, so shipping
  labels (real customer addresses) never leave the browser. Rotation and
  position are one-time settings (persisted to `localStorage`), not a
  per-label adjustment — set once for however Ryan actually tapes boxes,
  then every label after that gets the same treatment automatically.
  Content size is locked at a fixed 64% (`LABEL_SCALE`), not user-adjustable:
  the original 50% left a visible gap in Ryan's first real-world test with
  actual Pirate Ship labels, a 25–100% slider went in next to let him tune
  it against his real printer's margins, he found 67% by feel as the
  correct fill size and asked to drop the slider and hardcode that
  number — then, testing the result, clarified he actually wanted a small
  buffer around all three edges the rotated content sits near (top, left,
  and right; bottom is untouched — it's meant to stay mostly blank as the
  tape area), not just flush/filled. At 67% the rotated footprint was
  wider than the canvas itself and briefly overflowed past the left edge
  while sitting flush against the right, so the size was nudged down
  slightly to 64% — just enough for `LABEL_EDGE_BUFFER` (2% of canvas
  width) worth of margin on every edge a given rotation/position touches,
  applied generically per position (not special-cased to top-right).
  PDF rendering uses `pdfjs-dist`, vendored locally under
  `public/vendor/pdfjs/` rather than pulled from a CDN (this app has no
  other external script dependencies, and CDN reachability had already
  been flaky more than once in this session). Deliberately pinned to the
  4.x line, not latest (6.x): 6.3.289 uses
  `Map.prototype.getOrInsertComputed`, a very new JS proposal not yet
  universally supported — it threw `getOrInsertComputed is not a
  function` in real testing. Since `index.html`'s own script is one big
  classic (non-module) script but `pdfjs-dist` ships ESM-only, a small
  bridge module (`public/vendor/pdfjs/pdfjs-bridge.js`) imports it and
  hands it to the rest of the app via `window.pdfjsLib`.
  Output is a PDF (not a PNG) at the label's own physical page size, via
  `pdf-lib`, vendored the same way under `public/vendor/pdf-lib/` (its
  own bridge module hands it to the classic script via `window.PDFLib`;
  pdfjs-dist only reads PDFs, it can't write them). PNG-via-data-URL was
  the original approach, but the download button did nothing on iOS
  Safari/WebKit — the same engine that mishandled `Set-Cookie` from
  `fetch()` earlier in this app — because WebKit doesn't reliably honor
  `<a download>` for `data:` URLs. Switched to a `Blob`/Object URL
  instead, which either downloads directly (desktop browsers) or opens
  in Safari's own PDF viewer with a working Share/Save-to-Files button,
  so it degrades gracefully rather than silently failing. The downloaded
  file keeps the uploaded label's own filename with `-2x3` appended
  (e.g. `label-2x3.pdf`), not a generic name.
- **Manage Inventory** — the default page under the Inventory category,
  for editing Ryan's *existing*
  live BrickLink listings (hundreds of parts/figs, a few dozen sets) —
  different from Add Inventory, which only stages brand-new rows for a
  one-time bulk create. Search-first by design: `GET /inventories`
  returns everything in one unpaginated call (confirmed against real
  data — 842 real rows, no `page`/`cursor` params in the response), so
  the page fetches the whole list once and filters client-side rather
  than rendering ~800 cards at once, which would be slow on a phone and
  mostly useless to scroll through. Results are capped at 50 matches
  with a "refine your search" note past that. Color and the item itself
  aren't editable — both are part of a listing's identity, not something
  you'd change after the fact — and there's no Bin field: BrickLink's
  own inventory data has no such concept at all (confirmed against the
  same real response), so the Bin shown on Add Inventory only ever came
  from Ryan's own CSV export, not from BrickLink.
  Edits are staged locally (same "review, then submit" batch model as
  Add Inventory, not auto-save-per-field) and tracked as dirty against a
  snapshot of what was actually loaded — surviving a change of search
  term — until Submit pushes only the changed rows to
  `PUT /inventories/{id}` (`inventory-update.js`), a partial update per
  BrickLink's documented behavior for that endpoint (only the sent
  fields change; nothing else on the listing is touched). Field names
  for both endpoints (`bulk`, `bind_id`, etc.) were confirmed against a
  real response via a temporary debug endpoint, hit directly by Ryan
  from his phone (same live-verification pattern used earlier for order
  contact/payment fields and price guide data), rather than assumed from
  memory of BrickLink's API — real field names turned out to differ from
  what general knowledge of the API would have guessed (`bulk`, not
  `bulk_qty`).
