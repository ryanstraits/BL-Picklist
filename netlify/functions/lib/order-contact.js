// Shared mapping from a full BrickLink order detail (GET /orders/{id}) to
// the flat buyer-contact shape both the order detail page and the
// PirateShip export need — the list endpoint (GET /orders) doesn't carry
// buyer_email, shipping.address, or payment.method at all, only the
// per-order detail call does.
function extractOrderContact(order) {
  const addr = (order.shipping && order.shipping.address) || {};
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
  };
}

module.exports = { extractOrderContact };
