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
// piece count comes straight from the orders list (`total_count`, no
// extra call). Weight isn't on that list — only the per-order items
// call has it — so this fetches each order's items too and sums
// weight * quantity. BrickLink's per-item `weight` field is documented
// as that item's own unit weight in grams, not a line total, so this
// assumes multiplying by quantity gives the real order weight; flag it
// if a known order's total looks obviously wrong.
exports.handler = requireAuth(async () => {
  try {
    const orders = await blGet('/orders?direction=in');
    const nonCompleted = (orders || []).filter((o) => o.status !== 'COMPLETED');

    const rows = [];
    for (const o of nonCompleted) {
      let totalWeightG = null;
      try {
        const batches = await blGet(`/orders/${encodeURIComponent(o.order_id)}/items`);
        let sum = 0;
        let sawWeight = false;
        (batches || []).forEach((batch) => {
          (batch || []).forEach((entry) => {
            const w = parseFloat(entry.weight);
            const qty = parseFloat(entry.quantity) || 0;
            if (!isNaN(w)) {
              sum += w * qty;
              sawWeight = true;
            }
          });
        });
        totalWeightG = sawWeight ? Math.round(sum * 100) / 100 : null;
      } catch (e) {
        totalWeightG = null;
      }

      rows.push({
        orderId: String(o.order_id),
        buyer: o.buyer_name,
        status: o.status,
        date: o.date_ordered,
        pieces: o.total_count,
        uniqueLots: o.unique_count,
        totalWeightG,
      });
    }

    return json(200, { rows });
  } catch (err) {
    return errorResponse(err);
  }
});
