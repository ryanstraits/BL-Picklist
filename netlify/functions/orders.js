const { blGet } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');
const { requireAuth } = require('./lib/site-auth');

const EXCLUDED_STATUS = 'COMPLETED';

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
      .filter((o) => statusParam || o.status !== EXCLUDED_STATUS)
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
