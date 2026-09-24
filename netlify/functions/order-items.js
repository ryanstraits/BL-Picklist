const { blGet } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');
const { requireAuth } = require('./lib/site-auth');

function extractOrderId(event) {
  if (event.queryStringParameters && event.queryStringParameters.id) {
    return event.queryStringParameters.id;
  }
  // Fallback for when the redirect rewrite preserves the original path.
  const match = /\/orders\/([^/]+)\/items/.exec(event.path || '');
  return match ? decodeURIComponent(match[1]) : null;
}

exports.handler = requireAuth(async (event) => {
  try {
    const orderId = extractOrderId(event);
    if (!orderId) return json(400, { error: 'Missing order id' });

    // The API returns a list of batches (an item split across multiple
    // batches when it was added to the order at different times).
    const batches = await blGet(`/orders/${encodeURIComponent(orderId)}/items`);

    const items = [];
    (batches || []).forEach((batch) => {
      (batch || []).forEach((entry) => {
        items.push({
          itemNo: entry.item.no,
          name: entry.item.name,
          type: entry.item.type,
          categoryId: entry.item.category_id,
          colorId: entry.color_id,
          qty: entry.quantity,
          newOrUsed: entry.new_or_used,
          unitPrice: entry.unit_price,
          description: entry.description || '',
          remarks: entry.remarks || '',
          weight: entry.weight,
        });
      });
    });

    return json(200, items);
  } catch (err) {
    return errorResponse(err);
  }
});
