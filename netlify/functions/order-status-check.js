const { blGet } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');
const { requireAuth } = require('./lib/site-auth');
const { RATING_WORDS } = require('./lib/feedback-rating');

function extractOrderId(event) {
  if (event.queryStringParameters && event.queryStringParameters.id) {
    return event.queryStringParameters.id;
  }
  const match = /\/orders\/([^/]+)\/status-check/.exec(event.path || '');
  return match ? decodeURIComponent(match[1]) : null;
}

exports.handler = requireAuth(async (event) => {
  try {
    const orderId = extractOrderId(event);
    if (!orderId) return json(400, { error: 'Missing order id' });

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

    // BrickLink's own live status for this order, straight off the same
    // per-order detail call already being made here for drive_thru_sent —
    // no extra request. Exists so the frontend can catch a status this app
    // has cached (either the main orders list's last fetch, or Order
    // Lookup's once-per-session snapshot) going stale — e.g. a buyer's own
    // action, or BrickLink auto-completing an order after feedback, moving
    // it out from under a status this app still thinks is current, which
    // otherwise surfaces as a confusing RESOURCE_UPDATE_NOT_ALLOWED /
    // NOT_IN_UPDATABLE_STATUS rejection the next time a status change is
    // attempted from stale data.
    const status = orderResult.status === 'fulfilled' ? (orderResult.value && orderResult.value.status) || null : null;

    // Confirmed field for drive_thru_sent against a real client library's
    // typed struct. The feedback shape is now confirmed against a real
    // response too (via a temporary debug endpoint hit against Ryan's own
    // account): each /orders/{id}/feedback entry has a rating_of_bs field
    // ("B" or "S") marking whether that entry rates the Buyer or the
    // Seller — not, as first guessed, inferable from comparing `from` to
    // the buyer's username (fragile, and wrong in spirit: `from`/`to` on
    // this endpoint don't actually vary in the way that guess assumed).
    // rating_of_bs === "B" is Ryan's own feedback about the buyer (posted
    // by the seller); "S" is the buyer's feedback about Ryan.
    let feedbackAlreadyPosted = false;
    let buyerFeedback = null;
    if (feedbackResult.status === 'fulfilled' && Array.isArray(feedbackResult.value)) {
      feedbackAlreadyPosted = feedbackResult.value.some((f) => f && f.rating_of_bs === 'B');
      const buyerEntry = feedbackResult.value.find((f) => f && f.rating_of_bs === 'S');
      if (buyerEntry) {
        buyerFeedback = {
          rating: RATING_WORDS[buyerEntry.rating] || null,
          comment: buyerEntry.comment || '',
          dateRated: buyerEntry.date_rated || null,
        };
      }
    }

    return json(200, { driveThruSent, feedbackAlreadyPosted, buyerFeedback, status });
  } catch (err) {
    return errorResponse(err);
  }
});
