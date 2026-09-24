const { blPost } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');
const { requireAuth } = require('./lib/site-auth');

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
    // mail_me is a query param on this endpoint (not a JSON body field,
    // unlike the status-update endpoints) — false means don't CC the seller.
    await blPost(`/orders/${encodeURIComponent(orderId)}/drive_thru?mail_me=false`);
    return json(200, { orderId, sent: true });
  } catch (err) {
    return errorResponse(err);
  }
});
