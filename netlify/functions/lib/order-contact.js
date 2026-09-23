// Shared mapping from a full BrickLink order detail (GET /orders/{id}) to
// the flat buyer-contact shape both the order detail page and the
// PirateShip export need — the list endpoint (GET /orders) doesn't carry
// buyer_email, shipping.address, or payment.method at all, only the
// per-order detail call does.
function extractOrderContact(order) {
  const addr = (order.shipping && order.shipping.address) || {};
  const cost = order.cost || {};
  return {
    email: order.buyer_email || '',
    name: (addr.name && addr.name.full) || '',
    address1: addr.address1 || '',
    address2: addr.address2 || '',
    city: addr.city || '',
    state: addr.state || '',
    postalCode: addr.postal_code || '',
    countryCode: addr.country_code || '',
    paymentMethod: (order.payment && order.payment.method) || '',
    trackingNo: (order.shipping && order.shipping.tracking_no) || '',
    // Sales tax field naming is inconsistent across sources for this API
    // (a client library disagreed with itself on casing/whether it's a
    // string amount or a boolean flag) — this is read-only display, so a
    // miss here just shows a blank row rather than risking a bad write.
    cost: {
      currencyCode: cost.currency_code || '',
      subtotal: cost.subtotal || '',
      shipping: cost.shipping || '',
      insurance: cost.insurance || '',
      tax: cost.salesTax_collected_by_BL || cost.salesTax_collected_by_bl || cost.tax || '',
      etc1: cost.etc1 || '',
      etc2: cost.etc2 || '',
      credit: cost.credit || '',
      coupon: cost.coupon || '',
      grandTotal: cost.grand_total || '',
    },
  };
}

module.exports = { extractOrderContact };
