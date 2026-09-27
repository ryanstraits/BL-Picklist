const { blGet } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');
const { requireAuth } = require('./lib/site-auth');

exports.handler = requireAuth(async (event) => {
  try {
    // direction=in: orders where this API user is the seller (orders coming
    // in from buyers). direction=out would be orders this user placed as a
    // buyer on someone else's store — not what a seller pick list wants.
    //
    // No `filed` param here, so BrickLink defaults to filed=false (unfiled
    // orders only) — deliberately: a Completed order now stays visible on
    // this list until it's filed (Ryan's own "File order" action here, or
    // filing it directly on BrickLink's Orders Received page — either one
    // sets the same is_filed flag on BrickLink's side), rather than the
    // earlier time-based 7-day cutoff this replaced. Filed history is what
    // /api/order-stats is for, via its own explicit filed=true/false calls.
    const statusParam = event.queryStringParameters && event.queryStringParameters.status;
    const query = statusParam
      ? `/orders?direction=in&status=${encodeURIComponent(statusParam)}`
      : '/orders?direction=in';

    const data = await blGet(query);

    const orders = (data || [])
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
