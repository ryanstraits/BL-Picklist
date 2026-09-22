const { blPut } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');

// Deliberately narrow: this app only ever drives an order from PAID to
// PACKED (once everything's picked) or PACKED to SHIPPED, never a
// free-form status picker. Anything else gets rejected before it reaches
// BrickLink.
const ALLOWED_STATUSES = new Set(['PACKED', 'SHIPPED']);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON body' };
  }

  const { orderId, status } = payload;
  if (!orderId || !ALLOWED_STATUSES.has(status)) {
    return { statusCode: 400, body: 'orderId and a supported status (PACKED or SHIPPED) are required' };
  }

  try {
    // /orders/{id}/status updates order status; the separate
    // /orders/{id}/payment_status endpoint is for payment status instead.
    await blPut(`/orders/${encodeURIComponent(orderId)}/status`, { field: 'status', value: status });
    return json(200, { orderId, status });
  } catch (err) {
    return errorResponse(err);
  }
};
