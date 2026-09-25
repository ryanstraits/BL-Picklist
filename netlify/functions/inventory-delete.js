const { blDelete } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');
const { requireAuth } = require('./lib/site-auth');

// Delete Inventory — DELETE /inventories/{inventory_id} — confirmed against
// a real client library (ryansh100/bricklink-api's store/inventory.js),
// the same one whose is_retain/is_stock_room fields already proved
// accurate against Ryan's live account for Create Inventory. Removes the
// listing from BrickLink entirely and immediately — there's no undo once
// this succeeds, which is why the frontend only ever calls this after its
// own explicit confirm prompt, same as every other live write in this app.
async function deleteOne(item) {
  await blDelete(`/inventories/${encodeURIComponent(item.inventoryId)}`);
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
      if (!item || !item.inventoryId) {
        return json(400, { error: 'Each item requires inventoryId' });
      }
    }

    // Sequential, not Promise.all — same reasoning as inventory-create.js
    // and inventory-update.js: these are live writes to BrickLink, and
    // each row needs its own clean result even if an earlier one fails.
    const results = [];
    for (const item of items) {
      try {
        results.push(await deleteOne(item));
      } catch (err) {
        results.push({ key: item.key, success: false, error: err.message || 'BrickLink rejected this delete' });
      }
    }

    return json(200, { results });
  } catch (err) {
    return errorResponse(err);
  }
});
