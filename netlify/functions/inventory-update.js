const { blPut } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');
const { requireAuth } = require('./lib/site-auth');

// Update Inventory — PUT /inventories/{inventory_id} — a partial update per
// BrickLink's own documented behavior for this endpoint (only the fields
// sent are changed; everything else on the listing is left alone), which
// is why this only ever sends the five fields Manage Inventory lets Ryan
// edit — quantity, unit_price, new_or_used, description, remarks — and
// never color_id or the item itself, both of which are part of a listing's
// identity, not something you'd "edit" after the fact.
async function updateOne(item) {
  const payload = {
    quantity: item.quantity,
    unit_price: String(item.unitPrice || ''),
    new_or_used: item.newOrUsed === 'U' ? 'U' : 'N',
    description: item.description || '',
    remarks: item.remarks || '',
  };
  await blPut(`/inventories/${encodeURIComponent(item.inventoryId)}`, payload);
  return { key: item.key, success: true };
}

exports.handler = requireAuth(async (event) => {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch (e) {
      return json(400, { error: 'Invalid JSON body' });
    }

    const items = (payload && payload.items) || [];
    if (!Array.isArray(items) || !items.length) {
      return json(400, { error: 'items must be a non-empty array' });
    }
    for (const item of items) {
      if (!item || !item.inventoryId || !item.quantity) {
        return json(400, { error: 'Each item requires inventoryId and quantity' });
      }
    }

    // Sequential, not Promise.all — same reasoning as inventory-create.js:
    // these are live writes to BrickLink, and each row needs its own
    // clean result even if an earlier one fails.
    const results = [];
    for (const item of items) {
      try {
        results.push(await updateOne(item));
      } catch (err) {
        results.push({ key: item.key, success: false, error: err.message || 'BrickLink rejected this update' });
      }
    }

    return json(200, { results });
  } catch (err) {
    return errorResponse(err);
  }
});
