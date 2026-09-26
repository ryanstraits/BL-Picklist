const { blPost } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');
const { requireAuth } = require('./lib/site-auth');
const { RATING_CODES } = require('./lib/feedback-rating');

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

  const { orderId, rating, comment } = payload;
  const trimmedComment = typeof comment === 'string' ? comment.trim() : '';
  if (!orderId || !(rating in RATING_CODES) || !trimmedComment) {
    return { statusCode: 400, body: 'orderId, a supported rating (Praise/Neutral/Complaint), and a comment are required' };
  }

  try {
    await blPost('/feedback', { order_id: Number(orderId), rating: RATING_CODES[rating], comment: trimmedComment });
    return json(200, { ok: true });
  } catch (err) {
    return errorResponse(err);
  }
});
