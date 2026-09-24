const { blGet } = require('./lib/bricklink');
const { extractOrderContact } = require('./lib/order-contact');
const { json, errorResponse } = require('./lib/http');
const { requireAuth } = require('./lib/site-auth');

// Candidate rows for a PirateShip CSV export: every PAID order paid via
// Stripe. The list endpoint (GET /orders) doesn't include buyer_email,
// shipping address, or payment method — only the per-order detail
// (GET /orders/{id}) does — so this fetches the PAID list first, then one
// detail call per order to get the fields PirateShip actually needs.
// "Already exported" filtering happens client-side against the durable
// actions store (same pattern as driveThruSent/feedbackSent), not here —
// this endpoint has no notion of export history, it just reports what's
// currently eligible.
exports.handler = requireAuth(async (event) => {
  try {
    const list = await blGet('/orders?direction=in&status=paid');
    const paidOrders = list || [];

    const details = await Promise.allSettled(
      paidOrders.map((o) => blGet(`/orders/${encodeURIComponent(o.order_id)}`))
    );

    const rows = [];
    details.forEach((result) => {
      if (result.status !== 'fulfilled' || !result.value) return;
      const o = result.value;
      const contact = extractOrderContact(o);
      if (!/stripe/i.test(contact.paymentMethod)) return;

      rows.push(Object.assign({}, contact, {
        orderId: String(o.order_id),
        totalCount: o.total_count || 0,
        uniqueCount: o.unique_count || 0,
      }));
    });

    return json(200, rows);
  } catch (err) {
    return errorResponse(err);
  }
});
