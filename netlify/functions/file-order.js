const { blPut } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');
const { requireAuth } = require('./lib/site-auth');

// Update Order (PUT /orders/{id}) accepts an is_filed boolean among a small
// set of updatable fields (shipping, cost, remarks, is_filed) — confirmed
// against two independent client libraries: the Go wrapper's Header struct
// returns IsFiled *bool `json:"is_filed,omitempty"` (the same field name
// order-stats.js/orders.js already read via the `filed` query param on Get
// Orders), and the Python wrapper's update_order() sends exactly
// `{"is_filed": Boolean, ...}` in this same PUT body. Filing here is the
// same action as filing on BrickLink's own Orders Received page — either
// way, the order drops out of Get Orders' default filed=false result set,
// which is what /api/orders already relies on to decide what's still "in
// the pick list" (see orders.js).
exports.handler = requireAuth(async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON body' };
  }

  const { orderId } = payload;
  if (!orderId) {
    return { statusCode: 400, body: 'orderId is required' };
  }

  try {
    await blPut(`/orders/${encodeURIComponent(orderId)}`, { is_filed: true });
    return json(200, { orderId, filed: true });
  } catch (err) {
    return errorResponse(err);
  }
});
