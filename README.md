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
  default, with one exception: a `COMPLETED` order still shows for 7 days
  after `date_status_changed` (`COMPLETED_RETENTION_MS` in `orders.js`) —
  Ryan wants a completed order to stay visible for a while (whether the
  buyer marked it Completed on their end, or Ryan used the order's own new
  "Mark as completed" action) so anything actually wrong with it has a
  chance to surface before it drops off the list for good, rather than
  vanishing the instant it completes. `date_status_changed` isn't
  independently confirmed against a real captured response the way
  `total_weight` eventually was (see below) — it's documented by the same
  real Go client library (`funwithbots/go-bricklink-api`'s `Header`
  struct) that already got `is_retain`/`is_stock_room` right, and that
  struct is what backs the orders-LIST call this endpoint already makes,
  so (unlike `total_weight`) no extra per-order fetch is needed to read
  it. If it's ever missing or unparseable on a real order, the order falls
  back to being excluded immediately — today's behavior — rather than
  guessing. Override with `/api/orders?status=paid,packed` etc. if you
  want a narrower set (the retention window only applies to the default,
  no-status-param request). Order cards and the detail view show a
  color-coded status badge (fresh/paid, packed, shipped/received,
  complete, cancelled/problem) — `complete` is a deliberately separate
  tone from `waiting`, even though they render with the same neutral gray,
  since conflating the two was exactly the kind of thing that caused the
  "Not Applicable" color bug earlier in this app's history.
  `/api/update-order-status` now also accepts `COMPLETED` as a target
  (alongside the existing `PACKED`/`SHIPPED`), so a "Mark as completed"
  button appears on the orders list and the order detail page once an
  order is `SHIPPED` or `RECEIVED` — Ryan's own way to close out an order
  without waiting on the buyer to do it from their end. On the orders
  list this sits in the same single-action-button slot Send Drive Thru
  already uses for a `SHIPPED` order, so it only shows once Drive Thru's
  already been sent (or immediately for `RECEIVED`); on the order detail
  page it's an independent row, so it appears alongside Send Drive Thru
  rather than replacing it. The "Total value of orders in process" stat on
  the orders list explicitly excludes `COMPLETED` orders now that they can
  actually appear in the list — otherwise a completed order's total would
  have kept counting as "in process" for the rest of its 7-day visibility
  window.
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
- Each item block on the order-detail page has a small "View on
  BrickLink ↗" link (`bricklinkCatalogUrl()`, the same deep-link builder
  Add Inventory's price-guide panel already used) that opens that exact
  item/color/condition's catalog page, scoped to US listings — a plain
  external link, not the embedded price-guide panel Add Inventory has;
  Ryan just wants to jump out to BrickLink's own page from here.
  `onclick="event.stopPropagation()"` keeps a tap on the link from also
  toggling the row's picked state, the same guard the price-guide link
  already used. This surfaced the same "Not Applicable" color-name bug
  fixed once before on the Add Inventory and Manage Inventory screens —
  BrickLink's own colors list has a real, non-zero-id color literally
  named "Not Applicable" (used for colorless items like minifigs, sets,
  instructions), so filtering on `colorId` truthiness alone doesn't
  catch it. The first fix filtered the exact string "Not Applicable",
  which the order-detail block was missing entirely — but Ryan's real
  data kept showing the tag afterward on all three item types anyway,
  on every screen, meaning the exact-string guard itself was wrong
  somewhere (BrickLink's actual value likely isn't the bare, unpunctuated
  string the earlier fix assumed). Replaced with one shared
  `isRealColorName()` (used by all three screens instead of three
  independent copies of the same check, which is exactly how the exact
  first fix quietly went stale) that matches on the substring
  "applicable" rather than the whole string — no real BrickLink color
  name would ever contain that word, so it's a punctuation-proof
  catch-all regardless of the exact wording BrickLink sends.
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
- **Session resilience** — a 401 from any API call (an expired/missing
  session cookie mid-use, not just on first load) now shows an explicit
  message on the login gate ("your session needs to be refreshed... your
  in-progress work is still here") instead of silently bouncing back to
  it with no explanation. On successful re-login, the app now resumes
  whatever view was active (`resumeCurrentView()`) instead of always
  landing back on the orders list — added after Ryan's first real Add
  Inventory submit appeared to do nothing and nothing showed up on
  BrickLink: a mid-submit 401 does fire a real `window.alert` in testing
  (confirmed with Playwright), but with the login gate silently
  reappearing underneath it and no way back to the reviewed-but-
  unsubmitted batch except re-uploading the CSV, a dismissed or
  unnoticed alert could easily look exactly like "nothing happened" —
  consistent with this app's prior history of WebKit dialog/cookie
  flakiness on iOS. `handleInventorySubmit` also now treats a 200
  response with a missing/malformed `results` array as an error rather
  than silently doing nothing — that shape shouldn't be reachable given
  `inventory-create.js`'s own code, but if it ever happened it would
  otherwise look identical to this same silent-failure symptom.
- **USPS pickup reminder** — a highlighted banner on the orders list
  (only, never on an individual order page — Ryan's own workflow varies
  on when pickup gets scheduled relative to picking an order, so it
  isn't tied to any single order's state machine) showing a count of
  PACKED orders not yet confirmed, with a single "I've scheduled pickup"
  button. Deliberately not a link out to USPS or PirateShip's own
  sites — Ryan schedules pickup by hand through PirateShip's web app
  (having given up on pulling shipping/carrier data in after hitting a
  wall with UPS's API, with USPS looking harder still for the payoff),
  and an in-app link would likely open logged out anyway. The button is
  a manual "mental note cleared" acknowledgment, not a real action
  against any API. Tracked per order (`pickupScheduled`, keyed by
  orderId) via the same durable `/api/pick-state?key=actions` store and
  union-merge pattern as Drive Thru/feedback — clicking it marks every
  currently-unconfirmed PACKED order at once, but a *new* order reaching
  PACKED afterward surfaces the banner again for just that order, since
  an earlier confirmed pickup obviously doesn't cover it.
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
  and retry, one that succeeds locks and shows its new inventory ID. The
  submit button itself tracks only what's still pending (checked and not
  yet successfully submitted) rather than everything checked, so after a
  partial success it re-labels to "Submit N items" for just what's left
  and reads "All items added" (disabled) once nothing is — it used to
  count every checked row regardless of outcome, so it never grayed out
  and stayed clickable even with nothing left to actually submit. The
  running total (sum of price × qty across checked rows) got its own
  prominent bold line above the row count, instead of being buried as a
  clause in that small subheading text. Both the total and the submit
  button are also mirrored into a sticky row in the topbar header
  (`#topbarInventorySubmitRow`, kept in sync alongside the in-page
  copies — same dual pattern as the order-detail page's sticky
  pick-progress bar), so they stay reachable while scrolling a long
  review list instead of only living at the very top/bottom of it.
  There's no staging/review endpoint in BrickLink's Store API itself
  (unlike its website's own upload flow) — everything up to the actual
  `POST` happens entirely in this app, which is what makes the review
  step possible at all here.
  The CSV's `ITEMTYPE/ITEMID/COLOR/REMARKS/DESCRIPTION/QTY/CONDITION/PRICE`
  columns match BrickLink's own classic inventory-upload format exactly
  (confirmed against a real BrickScan export). The request body's
  `item.type` is the full uppercase word ("MINIFIG", "PART", ...). Ryan's
  first real submission got a bare `PARAMETER_MISSING_OR_INVALID` with no
  field-level detail (see the `blRequest` error-message fix below — at the
  time this app was only surfacing BrickLink's short `message`, not the
  more specific `description`), which was misdiagnosed as `item.type`
  needing BrickLink's single-letter code ("P", "M", "S", ...) — a mapping
  that exists in `item-image.js` for a different purpose (building catalog
  image CDN URLs) and was applied here on the mistaken assumption it also
  applied to this JSON field, cross-checked at the time only against a Go
  client library's constants file rather than another Create Inventory
  call site. That fix made things worse in a way that was newly
  diagnosable: with the `description` field now surfaced, BrickLink
  rejected the letter code explicitly as `Unparseable value or field:
  item.type`, i.e. not a recognized enum value at all — proving the
  letter code was never valid for this endpoint. Reverted to the full
  word, now corroborated by a real JS client library
  (`ryansh100/bricklink-api`'s `store/inventory.js`) whose Create
  Inventory request body matches this app's shape field-for-field and
  confirms the full word is correct. Verified by exercising the real
  `inventory-create.js` handler directly in Node with `blPost` mocked out
  (not just a hand-written stub) across all 9 item types, confirming each
  serializes as its full word — not by a live BrickLink write, since that
  would create real listings on Ryan's store. This is what the original
  submission was actually blocked on all along — the `description`-
  surfacing fix paid off immediately here, turning a bare
  `PARAMETER_MISSING_OR_INVALID` into `Parameter [is_retain] is missing`,
  a field this app's request body didn't send at all. `is_retain`
  ("whether the item retains in inventory after it is sold out") isn't
  optional/defaulted server-side despite being absent from most client
  library examples; the request body now always sends `is_retain: false`,
  matching BrickLink's own classic upload form default (remove the
  listing once it sells out rather than keep a 0-qty placeholder row).
  BrickLink then rejected the same way on `is_stock_room` ("Parameter
  [is_stock_room] is missing") — same story as `is_retain`, required but
  not defaulted server-side. Unlike `is_retain`, this one's a real choice
  Ryan sometimes wants (stock room = hidden from buyers, hold-only
  inventory), so each review card got a "Stock Room" dropdown (No / A / B
  / C) next to Color ID, defaulting to No/blank on every row but editable
  before submit. `is_stock_room` is derived server-side from whether a
  `stock_room_id` was picked (`is_stock_room: !!item.stockRoomId`) rather
  than tracked as a separate flag, and `stock_room_id` itself is only
  included in the request when non-blank.
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
  alone. Still fetches both New and Used — always both, regardless of the
  row's own Condition dropdown, so Ryan can compare pricing across
  conditions before deciding how to list — but the two sides used to
  render as fully separate lists of up to 25 listings each, which on a
  phone meant a lot of scrolling to compare them or to get back to the
  toggle button afterward. The listing rows are now merged into one
  cheapest-first list, capped at 25 total across both conditions
  combined, with a small New/Used badge on each row next to its price
  instead of condition being implied by which section a row sat in (the
  backend still returns each condition's own cheapest-25 independently —
  merging and re-capping happens client-side). The min/avg/max/for-sale
  stats stay as two separate lines above the list, one per condition,
  since those are BrickLink's own aggregate across *all* of that
  condition's active listings, not just whichever of them made the
  merged top 25. A "▲ Collapse" button repeats at the bottom of the list,
  doing the same thing as tapping the toggle button back at the top —
  added after the merge still left up to 25 rows to scroll back up past
  otherwise. Tapping a listing fills that row's Price field and syncs the
  Condition dropdown to match whichever condition that row actually was,
  so a tapped price and the declared condition never end up mismatched.
  Cached per item+color+condition combination independently of the row's
  own Condition (editing color refetches both; changing Condition doesn't
  refetch anything, since both are already loaded; qty/price/remarks
  don't affect it either) so re-opening an already-checked panel doesn't
  re-hit the API. A single "View on BrickLink" link sits above the two
  stats lines (there used to be one per condition — Ryan only wants the
  one, since he doesn't split his own browsing by condition either),
  pre-scoped to the row's color (if any) and US-only but *not* to a
  condition, so it opens BrickLink's own catalog page showing New and
  Used together. `bricklinkCatalogUrl(row, cond)`'s `cond` argument is
  optional for exactly this — passed by the order-detail and Manage
  Inventory item links (which do want one specific condition), omitted
  here, which drops the `"cond"` key from the URL's `O={...}` fragment
  entirely rather than sending an empty/invalid value. The URL shape
  (including the odd `O={...}` fragment encoding, and color showing up
  twice — once as its own `C=` param, once inside `O`) was confirmed
  against two real URLs Ryan captured live off bricklink.com, not
  reconstructed from guesswork — dropping the `cond` key for the
  combined-conditions case is an inference from that same shape, not
  independently confirmed against a captured no-condition URL.
  `country_code=US` filtering itself is
  confirmed working correctly against a real response (20 of 64 total
  listings), which ruled out an early bug's first suspect. The actual bug
  was a defensive client-side re-filter on `seller_country_code` — a
  field the Go client's `PriceDetail` struct claimed existed but doesn't:
  each `price_detail` entry really only has `quantity`, `unit_price`, and
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
  one-time bulk create. `GET /inventories`
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
  When the search box is empty, the screen defaults to a browse screen
  instead of a bare "type to search" hint: item type breakdown (PART,
  MINIFIG, SET, ...) → within a type, a theme/category breakdown → the
  filtered item list at that point, reusing the same item cards search
  results use. Each inventory row already carries a `category_id`
  (confirmed against a real captured order-items response, see
  `order-items.js`); a new `GET /categories` endpoint (`categories.js`,
  same in-memory-cache pattern as `colors.js`) supplies BrickLink's
  category tree (`category_id`/`category_name`/`parent_id`), which gets
  walked from each item's leaf category up to its top-level ancestor
  (`parent_id` 0) client-side. For Sets and Minifigs that top-level
  ancestor is a real LEGO theme (Star Wars, Technic, City, ...); for
  Parts it's BrickLink's own physical-category tree (Bricks, Plates, ...)
  since most parts don't have a real theme — the browse screen says so
  explicitly rather than mislabeling that grouping as "theme". Searching
  still works exactly as before and takes over the results area
  regardless of where you've drilled into the browse screen; clearing the
  search returns to wherever you left off browsing.
  Once you're down at a flat item list — either a theme's items or the
  Recently Added list below — a sort control offers item number
  (low→high, the longstanding default, or high→low) and, when dates are
  available, newest/oldest first. A top-level "Recently Added" tile
  (next to the type breakdown) shows items added in the last 15 or 30
  days (toggleable, defaults to 30), counted and filtered from the same
  `dateCreated` field the date sort uses. That field (BrickLink's
  `date_created` on the Inventory resource) is passed through by
  `inventory-list.js` but isn't yet confirmed against a real captured
  response the way the rest of the shape is — it's documented by the
  same real JS client library (`ryansh100/bricklink-api`) that already
  proved reliable once this session (it correctly predicted the
  `is_retain`/`is_stock_room` requirement Ryan's live API testing then
  confirmed). Both the date sort options and the Recently Added tile
  check at runtime whether any row actually has a `dateCreated` and
  quietly don't appear if not, rather than offering a feature that can't
  work — so this needs Ryan's next real visit to Manage Inventory to
  confirm one way or the other.
  Every card here (search results, a theme's item list, Recently Added —
  they all reuse `manageInventoryCardHtml()`) also has the same "View on
  BrickLink ↗" link the order-detail page's item blocks have, built by
  the same `bricklinkCatalogUrl()`. Submitting is a "Submit N changes to
  BrickLink" button that, like Add Inventory's, is mirrored into a
  sticky topbar row (`#topbarManageSubmitRow`, synced from the same
  `updateManageInventorySubmitBar()` that already kept the in-page one
  current on every field edit) so it's reachable without scrolling to
  the bottom of a long edit session — shown only while there's at least
  one unsaved change, same as the in-page copy.
  A stats banner (lot count, total item/piece count, total $ value —
  `manageInventoryStats()`) sits above the tiles/list at every level of
  the browse screen: overall totals across the whole inventory at the
  top, that type's totals once you've picked a type, and that
  theme/category's (or Recently Added's) totals once you're down to a
  flat list. "Lots" and "items" are deliberately two different numbers —
  a lot is one listing (BrickLink's own unit, one row per
  item+color+condition), items is the sum of quantities across those
  lots — which is also what the flat list's old plain "N items" count
  was actually mislabeling (it was counting lots, not pieces); that
  label is gone now that the full stats banner covers it. The $ figure
  has its own "total value" caption underneath, matching the "lots"/
  "items" captions on the other two numbers (lowercase, same as those).
  A dirty row (unsaved edits) is highlighted with a plain amber
  background (`.item-row.row-dirty`, same `--accent-soft` tint
  `.item-row.partial` already uses for a mid-count multi-qty pick on
  the order-detail page) rather than the left-edge accent bar it used
  to have (`box-shadow: inset 3px 0 0`) — that bar read as visually
  off-center rather than as a highlight.
  The submit bar (in-page and its sticky topbar mirror) now also shows
  a "Cancel changes" button next to Submit whenever there's at least
  one dirty row, reverting every dirty row to its loaded snapshot
  (`handleManageInventoryCancel()` — purely local, no BrickLink call,
  since nothing's reached BrickLink yet at that point) after a confirm
  prompt, the same way Submit's own confirm prompt guards the opposite
  action.
  Every editable Price field (here and on Add Inventory) is normalized
  to exactly three decimal places by a shared `formatPriceInput()` at
  the moment a row's `unitPrice` is first set — from BrickLink's own
  `unit_price` on load, from a CSV import, or from tapping a
  price-guide suggestion — rather than only at display time the way
  `formatCurrency()` already worked. BrickLink's own value carries an
  extra trailing zero past that (e.g. `"0.1500"`), which used to show up
  verbatim in the editable field itself. Three, not two: real BrickLink
  precision goes to tenths of a cent — a genuine convention for common
  parts priced in bulk (e.g. $0.015 each across a 1000-piece lot) — so
  rounding to two decimals the way `formatCurrency()`'s aggregate-total
  display does would have silently truncated a real sub-cent price
  rather than just trimming a padding zero.
  Each card also has a "Delete" button — a dedicated one, not a
  quantity-zero workaround (BrickLink's real delete is its own endpoint,
  `DELETE /inventories/{id}`, confirmed against the same client library
  that already proved accurate once for Create Inventory's `is_retain`/
  `is_stock_room` requirement). Marking a row for delete fits the same
  "review, then submit" staging model as an edit rather than deleting
  immediately: it counts as dirty, tints the whole card the danger color
  (same `--danger-soft`-on-transparent-border pattern `.row-dirty`
  already uses with `--accent-soft`), disables its fields (nothing to
  edit on something about to be deleted), and shows an "Undo delete" in
  the button's place until Submit is actually tapped and confirmed. A
  submit with both edits and deletions pending fires `PUT
  /inventories/{id}` for the edited rows and the new `inventory-delete.js`
  (`DELETE /inventories/{id}`) for the marked ones in parallel, one
  request per endpoint; a deleted row that succeeds is spliced out of the
  list entirely on response, rather than lingering as a "deleted" success
  card for something that no longer exists on BrickLink to edit or
  delete again. Cancel clears a pending delete mark the same way it
  reverts a field edit.
- **Order weight + box choice** — on the order detail page, toward the
  start of laying groundwork for a future shipping-box-size suggestion.
  Weight shows in lbs/oz (`formatWeightLbOz()`) under the order total,
  sourced from `contact.weightG`. That field comes from BrickLink's own
  `total_weight` on the single-order detail call (`GET /orders/{id}`) —
  confirmed via a temporary debug endpoint
  (`netlify/functions/debug-box-baseline.js`, still present, not yet
  deleted) against 7 of Ryan's real orders: `total_weight` isn't present
  on the orders-list endpoint at all (always null there), only shows up
  on the per-order detail call, and its value is in **grams**, not
  kilograms as an initial third-party source suggested — confirmed by
  matching it exactly against a manual per-item weight × quantity sum on
  every order checked.
  Below that, a "Box used" row (Large/Medium/Small/Mailer buttons,
  `renderBoxChoiceSection()`) lets Ryan record which of his three box
  sizes or the small mailer he actually used for that order. This is
  manual by design for now — Ryan is building up a real dataset (his own
  choices cross-referenced against each order's piece count, weight, and
  value: small/cheap → mailer, figs/expensive → box "to ensure shipping
  integrity" is the working hypothesis) over the next few weeks/months,
  which will eventually replace this manual field with an automatic
  suggestion. Tracked as `boxChoice` (orderId → "large"/"medium"/"small"/
  "mailer"), synced durably the same way as `driveThruSent`/
  `feedbackSent`/`pickupScheduled` — `/api/pick-state?key=actions`, merged
  with `mergeChoiceMap()` (value-preferring, since a string choice has no
  meaningful boolean OR the way the other three's completion flags do).
