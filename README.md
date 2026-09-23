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
netlify/functions/pirateship-export.js  → GET /api/pirateship-export (PAID+Stripe orders, mapped for a PirateShip CSV import)
netlify/functions/order-contact.js    → GET /api/orders/:id/contact (buyer email/address/payment method/tracking number)
netlify/functions/update-tracking.js  → POST /api/update-tracking (writes tracking number to BrickLink)
netlify/functions/inventory-create.js → POST /api/inventory-create (BrickScan CSV import, writes new listings to BrickLink)
netlify/functions/price-guide.js      → GET /api/price-guide?type=&no=&condition=&color= (active US listings, for pricing)
netlify/functions/lib/bricklink.js    → shared OAuth1.0a request helper
netlify/functions/lib/order-contact.js → shared BrickLink order → buyer-contact mapping (used by order-contact.js and pirateship-export.js)
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
- **Export to PirateShip** — a button above the orders list.
  `GET /api/pirateship-export` pulls every PAID order, fetches each one's
  full detail (`GET /orders/{id}` — the only endpoint that returns
  `buyer_email` and the fully-separated `shipping.address` fields; the
  list endpoint doesn't), and keeps only the ones paid via Stripe
  (`payment.method` containing "Stripe" — confirmed against a real
  order's response, e.g. `"Credit/Debit (Powered by Stripe)"`). The
  frontend filters out orders already exported (tracked durably via
  `/api/pick-state?key=actions`, a third key alongside Drive
  Thru/feedback — same union-merge pattern, so an order exported from
  one device won't show up again on another), builds a CSV client-side
  matching PirateShip's import columns (Email/Name/Address/Address Line
  2/City/State/Zipcode/Country/Order ID/Order Items), and downloads it.
  Pounds/Length/Width/Height are left blank on purpose: BrickLink's
  `total_weight` field has no confirmed unit for this account, and
  guessing wrong could produce a wrong postage cost/label — fill those in
  on PirateShip's side same as always.
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
  `GET /api/orders/:id/contact` (same underlying order-detail call and
  field mapping as the PirateShip export, factored into
  `lib/order-contact.js` so both share it — this one isn't limited to
  Stripe/PAID orders, it just shows whatever the order has). Two buttons:
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
  alone. Shows min/avg/max and the full for-sale list sorted lowest
  price first; tapping a listing fills that row's Price field. Cached
  per item+color+condition combination (editing color or condition
  refetches; qty/price/remarks don't) so re-opening an already-checked
  panel doesn't re-hit the API.
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
