const { blGet } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');
const { requireAuth } = require('./lib/site-auth');

// TEMPORARY — hit this once from Ryan's own phone/browser (already
// logged into the site) to confirm the real shape of BrickLink's
// feedback endpoints before building the "buyer left feedback" icon on
// the orders list and the feedback display on the order detail page
// Ryan asked for. Delete this file once confirmed.
//
// A real client library (funwithbots/go-bricklink-api) documents:
//   - a Feedback resource with from/to/rating/comment/date_rated and a
//     rating_of_bs field ("B" or "S") marking whether an entry rates the
//     buyer or the seller
//   - a bulk GET /feedback?direction=in|out endpoint (same in/out
//     convention as GET /orders — in = feedback given TO this user, out =
//     given BY this user), which would let "did anyone leave me feedback"
//     be answered in one call instead of one per order
// None of this is independently confirmed against a real response yet —
// this app currently only calls the per-order GET /orders/{id}/feedback
// (in order-status-check.js), and only to guess at Ryan's OWN posted
// feedback (any entry not from the buyer), never at feedback the buyer
// left. This endpoint dumps both the bulk in/out calls and a handful of
// real per-order feedback calls side by side.
exports.handler = requireAuth(async () => {
  try {
    const [inResult, outResult] = await Promise.allSettled([
      blGet('/feedback?direction=in'),
      blGet('/feedback?direction=out'),
    ]);

    const orders = await blGet('/orders?direction=in');
    const candidateOrders = (orders || [])
      .filter((o) => ['RECEIVED', 'COMPLETED', 'SHIPPED', 'PACKED'].includes(o.status))
      .slice(0, 6);

    const perOrderFeedback = [];
    for (const o of candidateOrders) {
      try {
        const fb = await blGet(`/orders/${encodeURIComponent(o.order_id)}/feedback`);
        perOrderFeedback.push({ orderId: String(o.order_id), buyer: o.buyer_name, status: o.status, feedback: fb });
      } catch (e) {
        perOrderFeedback.push({ orderId: String(o.order_id), buyer: o.buyer_name, status: o.status, error: e.message });
      }
    }

    return json(200, {
      feedbackDirectionIn: inResult.status === 'fulfilled' ? inResult.value : { error: (inResult.reason && inResult.reason.message) || String(inResult.reason) },
      feedbackDirectionOut: outResult.status === 'fulfilled' ? outResult.value : { error: (outResult.reason && outResult.reason.message) || String(outResult.reason) },
      perOrderFeedback,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
