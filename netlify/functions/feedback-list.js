const { blGet } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');
const { requireAuth } = require('./lib/site-auth');
const { RATING_WORDS } = require('./lib/feedback-rating');

// GET /feedback?direction=in|out — confirmed live against Ryan's real
// account via a temporary debug endpoint. Same in/out convention as
// GET /orders (in = feedback given TO thebrickstud, out = FROM
// thebrickstud), but each direction mixes two different roles: Ryan is
// both a seller (fulfilling the orders this app manages) and, on his own
// separate purchases elsewhere on BrickLink, a buyer — and BrickLink
// doesn't split those into different endpoints. The `rating_of_bs` field
// ("B" or "S") is what actually distinguishes them: "S" on a
// direction=in entry is a buyer rating Ryan as seller (what this feature
// wants); "B" there is some other store rating Ryan as their buyer, on
// an order this app has never heard of. Symmetrically, "B" on a
// direction=out entry is Ryan rating one of his own buyers (confirmed by
// every sampled entry's comment matching this app's own default feedback
// text); "S" there is Ryan rating a store he bought from personally.
// Filtering each direction to the one role this app cares about is what
// keeps this from ever mislabeling an unrelated personal-purchase order.
exports.handler = requireAuth(async () => {
  try {
    const [inResult, outResult] = await Promise.allSettled([
      blGet('/feedback?direction=in'),
      blGet('/feedback?direction=out'),
    ]);

    const received = {};
    if (inResult.status === 'fulfilled' && Array.isArray(inResult.value)) {
      inResult.value.forEach((f) => {
        if (f && f.rating_of_bs === 'S' && f.order_id) {
          received[String(f.order_id)] = {
            rating: RATING_WORDS[f.rating] || null,
            comment: f.comment || '',
            dateRated: f.date_rated || null,
          };
        }
      });
    }

    const given = {};
    if (outResult.status === 'fulfilled' && Array.isArray(outResult.value)) {
      outResult.value.forEach((f) => {
        if (f && f.rating_of_bs === 'B' && f.order_id) {
          given[String(f.order_id)] = true;
        }
      });
    }

    return json(200, { received, given });
  } catch (err) {
    return errorResponse(err);
  }
});
