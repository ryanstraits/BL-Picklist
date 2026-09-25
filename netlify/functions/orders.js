const { blGet } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');
const { requireAuth } = require('./lib/site-auth');

const EXCLUDED_STATUS = 'COMPLETED';

// Ryan wants a Completed order to stick around for a while after it goes
// Completed (buyer-side or his own new "Mark as completed" button) rather
// than vanishing from the list the instant it happens — enough runway to
// notice if something's actually wrong with it before it drops off for
// good. date_status_changed is documented by the same real Go client
// library (funwithbots/go-bricklink-api's Header struct) that already got
// is_retain/is_stock_room and total_weight's existence right, and — unlike
// total_weight — that struct is used for GetOrderHeaders() itself, i.e.
// the orders-LIST call this endpoint already makes, so no extra per-order
// fetch is needed to use it. It isn't independently confirmed against a
// real captured response the way total_weight eventually was, though; if
// it's ever missing or unparseable on a real order, this falls back to
// immediately excluding it, i.e. today's behavior, rather than guessing.
const COMPLETED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function isRecentlyCompleted(o) {
  if (o.status !== EXCLUDED_STATUS) return false;
  const changed = o.date_status_changed ? new Date(o.date_status_changed).getTime() : NaN;
  return !isNaN(changed) && Date.now() - changed <= COMPLETED_RETENTION_MS;
}

exports.handler = requireAuth(async (event) => {
  try {
    // direction=in: orders where this API user is the seller (orders coming
    // in from buyers). direction=out would be orders this user placed as a
    // buyer on someone else's store — not what a seller pick list wants.
    const statusParam = event.queryStringParameters && event.queryStringParameters.status;
    const query = statusParam
      ? `/orders?direction=in&status=${encodeURIComponent(statusParam)}`
      : '/orders?direction=in';

    const data = await blGet(query);

    const orders = (data || [])
      .filter((o) => statusParam || o.status !== EXCLUDED_STATUS || isRecentlyCompleted(o))
      .map((o) => ({
        orderId: String(o.order_id),
        status: o.status,
        buyer: o.buyer_name,
        date: o.date_ordered,
        totalCount: o.total_count,
        uniqueCount: o.unique_count,
        orderTotal: (o.cost && (o.cost.grand_total || o.cost.subtotal)) || null,
        currencyCode: (o.cost && o.cost.currency_code) || null,
      }));

    return json(200, orders);
  } catch (err) {
    return errorResponse(err);
  }
});
