const { blGet } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');
const { requireAuth } = require('./lib/site-auth');

// No status filter alone isn't enough for full history — BrickLink's Get
// Orders also splits orders into "filed" (archived off the Orders
// Received page) and "unfiled" (still showing there), independent of
// status, via a `filed` query param. Two independent client libraries'
// own docs agree: "Indicates whether the result retrieves filed or
// un-filed orders" (default false = unfiled only) — a binary switch
// between the two sets, not an "include filed too" toggle. Without this,
// this endpoint (and this app's own /api/orders, which is deliberately
// left alone — it's a pick list, meant to show only current/unfiled
// work) would silently miss anything Ryan has ever filed away, which is
// exactly the gap Ryan reported: stats "only pulling in the orders that
// are on the orders page". Two calls, merged and de-duped by order_id
// (BrickLink's ID space, so no real risk of a collision — the de-dupe
// is just defensive) — still cheap: 2 unpaginated calls total for full
// order history, not one per order or per year.
exports.handler = requireAuth(async () => {
  try {
    const [unfiledResult, filedResult] = await Promise.allSettled([
      blGet('/orders?direction=in&filed=false'),
      blGet('/orders?direction=in&filed=true'),
    ]);

    // Tagging each order with which of the two calls it actually came
    // from is a more reliable "is this filed?" signal than trusting a raw
    // is_filed field on the order object would be — filed=true and
    // filed=false are BrickLink's own documented binary split of the same
    // account's orders, so whichever call returned a given order_id *is*
    // its filed status, no separate field to go missing or drift out of
    // sync.
    const seen = new Set();
    const orders = [];
    [{ result: unfiledResult, filed: false }, { result: filedResult, filed: true }].forEach(({ result, filed }) => {
      if (result.status === 'fulfilled' && Array.isArray(result.value)) {
        result.value.forEach((o) => {
          if (o && !seen.has(o.order_id)) {
            seen.add(o.order_id);
            orders.push({ order: o, filed });
          }
        });
      }
    });

    const rows = orders.map(({ order: o, filed }) => ({
      orderId: String(o.order_id),
      status: o.status,
      // buyer/uniqueCount/filed added for Order Lookup, which reuses this
      // same full-history fetch to search across filed and unfiled orders
      // alike (unlike /api/orders, which is deliberately unfiled-only —
      // see above) — Sales Stats itself never needed any of the three.
      buyer: o.buyer_name,
      date: o.date_ordered,
      totalCount: o.total_count,
      uniqueCount: o.unique_count,
      grandTotal: (o.cost && o.cost.grand_total) || null,
      currencyCode: (o.cost && o.cost.currency_code) || null,
      filed,
    }));
    return json(200, rows);
  } catch (err) {
    return errorResponse(err);
  }
});
