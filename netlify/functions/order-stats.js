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

    const seen = new Set();
    const orders = [];
    [unfiledResult, filedResult].forEach((r) => {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) {
        r.value.forEach((o) => {
          if (o && !seen.has(o.order_id)) {
            seen.add(o.order_id);
            orders.push(o);
          }
        });
      }
    });

    const rows = orders.map((o) => ({
      orderId: String(o.order_id),
      status: o.status,
      date: o.date_ordered,
      totalCount: o.total_count,
      grandTotal: (o.cost && o.cost.grand_total) || null,
      currencyCode: (o.cost && o.cost.currency_code) || null,
    }));
    return json(200, rows);
  } catch (err) {
    return errorResponse(err);
  }
});
