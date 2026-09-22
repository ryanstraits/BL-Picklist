const { blPost } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');

// BrickLink's feedback "rating" field is a plain integer code, not the
// word itself — confirmed against a real client library's source
// (funwithbots/go-bricklink-api, util/rating.go): its Rating type is an
// int with Praise=0/Neutral=1/Complaint=2, and has no MarshalJSON, so the
// wire value is the bare number. The frontend still speaks in the human
// words; this is the only place that needs to know the numeric mapping.
const RATING_CODES = { Praise: 0, Neutral: 1, Complaint: 2 };

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
};
