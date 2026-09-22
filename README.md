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
netlify/functions/pick-state.js       → GET/POST /api/pick-state (durable "picked" state)
netlify/functions/order-messages.js   → GET /api/orders/:id/messages
netlify/functions/send-drive-thru.js  → POST /api/send-drive-thru (writes to BrickLink)
netlify/functions/member-rating.js    → GET /api/member-rating?username=
netlify/functions/post-feedback.js    → POST /api/feedback (writes to BrickLink)
netlify/functions/lib/bricklink.js    → shared OAuth1.0a request helper
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
- The orders list can push a real status change back to BrickLink: a
  "Mark as packed" button on PAID orders and "Mark as shipped" on PACKED
  ones. `/api/update-order-status` only accepts those two target
  statuses (`PUT /orders/{id}/status` on BrickLink's side with
  `{"field":"status","value":...}`) — no free-form status picker, so a
  bad request can't push an order into an unexpected state. Each tap
  requires a confirm dialog first, since — unlike most of the app — this
  writes to a live, buyer-visible order.
- The order detail page also has three more BrickLink writes/reads, added
  so logging into BrickLink directly (blocked on at least one of Ryan's
  work networks, since it goes through lego.com) is needed less often:
  - **Send Thank You (Drive Thru)** — shown once an order is SHIPPED.
    `POST /orders/{id}/drive_thru?mail_me=false` (a query param, not a
    JSON body, unlike the other writes here). Confirm dialog first, same
    reasoning as the status buttons. There's no way to ask BrickLink
    whether one's already been sent for an order, so the app just
    disables the button in memory after a successful send — that only
    lasts for the current page load; a fresh reload of the app shows the
    button as sendable again even though BrickLink already has it on
    record.
  - **Order messages** — `GET /orders/{id}/messages`, shown read-only
    under the item list when an order has any. Fetched alongside items;
    a failure here doesn't block the rest of the order view.
  - **Buyer feedback rating** — `GET /members/{username}/ratings`, shown
    as a small `★ score` next to the buyer's name. The response shape
    isn't confirmed against live BrickLink docs (couldn't reach them from
    the sandbox this was built in), so it reads a few plausible field
    names defensively and just shows nothing if none match, rather than
    risk a wrong number — worth checking against a real order.
  - **Leave feedback for buyer** — shown once an order is SHIPPED,
    RECEIVED, or COMPLETED: pick Praise/Neutral/Complaint, write a
    comment, confirm (this posts public feedback visible to the buyer
    and everyone on BrickLink), `POST /feedback` with
    `{order_id, rating, comment}`. Like Drive Thru, a successful post
    just hides the form in memory for the current page load — no local
    record survives a reload, so the form can reappear even though
    BrickLink will reject a second submission for the same order.
