const { blGet } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');
const { requireAuth } = require('./lib/site-auth');

// TEMPORARY — hit this once from Ryan's own phone/browser (already
// logged into the site) to pull a baseline for the shipping-box-size
// rubric, then delete this file. Same pattern as the earlier temporary
// debug endpoint used to confirm real inventory-update/create field
// names: a read-only GET that surfaces real BrickLink data Ryan can
// relay back in chat, without ever putting his site password or
// BrickLink credentials in front of Claude directly.
//
// For every non-completed order (same set the Orders screen shows):
// piece count and total weight both come straight from the orders list
// itself — no per-order items call needed. Originally this fetched each
// order's items and summed a per-piece weight × quantity, on the
// assumption BrickLink didn't hand back an order-level total; Ryan
// correctly guessed otherwise. The Order resource's own `total_weight`
// field (confirmed via a real client library's struct definition —
// funwithbots/go-bricklink-api's orders.Header) is BrickLink's own
// computed total for the order, a string in kilograms (a real captured
// example value of "1.03" only makes sense as kilograms — as grams
// that's a single sliver of plastic, not a shippable order), which is
// both more authoritative than a manual per-item sum and cheaper to
// fetch.
exports.handler = requireAuth(async () => {
  try {
    const orders = await blGet('/orders?direction=in');
    const nonCompleted = (orders || []).filter((o) => o.status !== 'COMPLETED');

    const rows = nonCompleted.map((o) => ({
      orderId: String(o.order_id),
      buyer: o.buyer_name,
      status: o.status,
      date: o.date_ordered,
      pieces: o.total_count,
      uniqueLots: o.unique_count,
      totalWeightKg: o.total_weight !== undefined && o.total_weight !== null ? Number(o.total_weight) : null,
    }));

    return json(200, { rows });
  } catch (err) {
    return errorResponse(err);
  }
});
