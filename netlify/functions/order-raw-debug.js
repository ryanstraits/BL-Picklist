const { blGet } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');

// Temporary diagnostic endpoint — not used by the app itself. Returns the
// raw order detail from BrickLink so the real shipping-address and
// payment fields can be inspected before building the PirateShip export
// mapping, instead of guessing at a client library's possibly-incomplete
// struct. Delete once that mapping is confirmed.
exports.handler = async (event) => {
  try {
    const orderId = event.queryStringParameters && event.queryStringParameters.id;
    if (!orderId) return json(400, { error: 'Missing id' });

    const order = await blGet(`/orders/${encodeURIComponent(orderId)}`);
    return json(200, order);
  } catch (err) {
    return errorResponse(err);
  }
};
