const { blGet } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');
const { requireAuth } = require('./lib/site-auth');

// No status filter — BrickLink returns orders in every status when none
// is specified (confirmed by a real client library's own docstring: "If
// you don't specify this value, this method retrieves orders in any
// status"), unlike this app's own /api/orders, which is built for the
// pick list and defaults to excluding COMPLETED. One unpaginated call
// regardless of how many years of history that covers — the same
// "returns everything in one call" behavior already confirmed for
// /inventories — so a full-history stats page costs exactly the one
// request /api/orders already costs, not one request per order or per
// year. Deliberately kept to the same lightweight per-order fields
// /api/orders already returns; aggregation by year/month happens
// client-side (same "backend fetches, frontend rolls up" split already
// used for Manage Inventory's stats banner).
exports.handler = requireAuth(async () => {
  try {
    const orders = await blGet('/orders?direction=in');
    const rows = (orders || []).map((o) => ({
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
