const { blPut } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch (e) {
      return json(400, { error: 'Invalid JSON body' });
    }

    const orderId = payload && payload.orderId;
    const trackingNo = payload && String(payload.trackingNo || '').trim();
    if (!orderId || !trackingNo) {
      return json(400, { error: 'orderId and trackingNo are required' });
    }

    // Update Order — PUT /orders/{id} — only applies the fields present in
    // the body (confirmed against a real client library's UpdateOrder,
    // which sends just this shape when only the tracking number is being
    // set), so this doesn't touch status, payment, cost, or anything else.
    await blPut(`/orders/${encodeURIComponent(orderId)}`, {
      shipping: { tracking_no: trackingNo },
    });

    return json(200, { ok: true });
  } catch (err) {
    return errorResponse(err);
  }
};
