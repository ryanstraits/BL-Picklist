// TEMPORARY — verifies the real GET /inventories response shape against
// live data before building the real inventory-list.js endpoint. Delete
// once confirmed.
const { blGet } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');
const { requireAuth } = require('./lib/site-auth');

exports.handler = requireAuth(async () => {
  try {
    const data = await blGet('/inventories');
    return json(200, { count: Array.isArray(data) ? data.length : null, sample: Array.isArray(data) ? data.slice(0, 3) : data });
  } catch (err) {
    return errorResponse(err);
  }
});
