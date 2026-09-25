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
// piece count comes straight from the orders list, no extra call.
// Weight has now been tried two ways and both need cross-checking in
// one pass rather than costing Ryan another round trip:
//   1. `total_weight` on the orders-LIST response (GET /orders) — a
//      real client library's struct said this exists there, but every
//      row came back null against Ryan's real account, so either it's
//      single-order-only, a different field name, or genuinely unset.
//   2. This round adds the single-order detail call (GET /orders/{id})
//      in case `total_weight` only lives there, AND keeps the original
//      manual per-item sum (weight × quantity from GET
//      /orders/{id}/items) as a fallback that's known to at least
//      return numbers (just not confirmed accurate). Any raw key
//      containing "weight" on the order-detail object is also dumped
//      so a differently-named field would still show up.
exports.handler = requireAuth(async () => {
  try {
    const orders = await blGet('/orders?direction=in');
    const nonCompleted = (orders || []).filter((o) => o.status !== 'COMPLETED');

    const rows = [];
    for (const o of nonCompleted) {
      let detailWeightFields = {};
      try {
        const detail = await blGet(`/orders/${encodeURIComponent(o.order_id)}`);
        Object.keys(detail || {}).forEach((k) => {
          if (k.toLowerCase().includes('weight')) detailWeightFields[k] = detail[k];
        });
      } catch (e) {
        detailWeightFields = { error: e.message };
      }

      let computedFromItemsG = null;
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
        computedFromItemsG = sawWeight ? Math.round(sum * 100) / 100 : null;
      } catch (e) {
        computedFromItemsG = null;
      }

      rows.push({
        orderId: String(o.order_id),
        buyer: o.buyer_name,
        status: o.status,
        date: o.date_ordered,
        pieces: o.total_count,
        uniqueLots: o.unique_count,
        listTotalWeight: o.total_weight !== undefined ? o.total_weight : null,
        detailWeightFields,
        computedFromItemsG,
      });
    }

    return json(200, { rows });
  } catch (err) {
    return errorResponse(err);
  }
});
