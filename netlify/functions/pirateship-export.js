const { blGet } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');

// Candidate rows for a PirateShip CSV export: every PAID order paid via
// Stripe. The list endpoint (GET /orders) doesn't include buyer_email,
// shipping address, or payment method — only the per-order detail
// (GET /orders/{id}) does — so this fetches the PAID list first, then one
// detail call per order to get the fields PirateShip actually needs.
// "Already exported" filtering happens client-side against the durable
// actions store (same pattern as driveThruSent/feedbackSent), not here —
// this endpoint has no notion of export history, it just reports what's
// currently eligible.
exports.handler = async (event) => {
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
      const method = (o.payment && o.payment.method) || '';
      if (!/stripe/i.test(method)) return;

      const addr = (o.shipping && o.shipping.address) || {};
      rows.push({
        orderId: String(o.order_id),
        email: o.buyer_email || '',
        name: (addr.name && addr.name.full) || '',
        address1: addr.address1 || '',
        address2: addr.address2 || '',
        city: addr.city || '',
        state: addr.state || '',
        postalCode: addr.postal_code || '',
        countryCode: addr.country_code || '',
        totalCount: o.total_count || 0,
        uniqueCount: o.unique_count || 0,
      });
    });

    return json(200, rows);
  } catch (err) {
    return errorResponse(err);
  }
};
