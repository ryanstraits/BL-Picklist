const { blGet } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');

function extractOrderId(event) {
  if (event.queryStringParameters && event.queryStringParameters.id) {
    return event.queryStringParameters.id;
  }
  const match = /\/orders\/([^/]+)\/status-check/.exec(event.path || '');
  return match ? decodeURIComponent(match[1]) : null;
}

exports.handler = async (event) => {
  try {
    const orderId = extractOrderId(event);
    if (!orderId) return json(400, { error: 'Missing order id' });
    const buyer = (event.queryStringParameters && event.queryStringParameters.buyer) || null;

    // Both are best-effort: if either call fails, that piece just reports
    // false rather than failing the whole check — this only ever adds
    // "already done" information on top of what the app tracks itself,
    // never removes it.
    const [orderResult, feedbackResult] = await Promise.allSettled([
      blGet(`/orders/${encodeURIComponent(orderId)}`),
      blGet(`/orders/${encodeURIComponent(orderId)}/feedback`),
    ]);

    const driveThruSent = orderResult.status === 'fulfilled'
      && !!(orderResult.value && orderResult.value.drive_thru_sent);

    // Confirmed field for drive_thru_sent against a real client library's
    // typed struct; the feedback shape is NOT independently confirmed —
    // best guess is that /orders/{id}/feedback returns an array with a
    // "from" field per entry, and any entry not from the buyer is ours.
    // If that guess is wrong this just always reports false, same
    // fail-safe posture as the buyer rating badge.
    let feedbackAlreadyPosted = false;
    if (feedbackResult.status === 'fulfilled' && Array.isArray(feedbackResult.value)) {
      feedbackAlreadyPosted = feedbackResult.value.some((f) => f && f.from && f.from !== buyer);
    }

    return json(200, { driveThruSent, feedbackAlreadyPosted });
  } catch (err) {
    return errorResponse(err);
  }
};
