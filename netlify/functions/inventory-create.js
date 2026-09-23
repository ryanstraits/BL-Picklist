const { blPost } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');

// Create Inventory — POST /inventories — confirmed against a real client
// library's Item struct (go-bricklink-api): the request body nests the
// catalog item under "item" ({no, type}), with color_id, quantity,
// new_or_used, unit_price, description, and remarks as siblings. This
// creates the listing live/immediately — there's no staging or review
// endpoint in the Store API, unlike BrickLink's own website upload flow,
// which is why the review step lives in the frontend instead: nothing
// reaches BrickLink until the seller approves each row there.
//
// item.type is sent as the full uppercase word ("MINIFIG", "PART", ...),
// matching the shape BrickLink's Order Items endpoint returns (confirmed
// against real order data elsewhere in this app) — NOT independently
// confirmed for this specific endpoint, since Create Inventory has no
// safe read-only way to check it first. Worth watching the first real
// submission closely; a wrong casing here would show up as a clear
// per-item error below rather than silently doing the wrong thing.
async function createOne(item) {
  const payload = {
    item: { no: item.itemNo, type: item.type },
    color_id: item.colorId || 0,
    quantity: item.quantity,
    new_or_used: item.newOrUsed === 'U' ? 'U' : 'N',
    unit_price: String(item.unitPrice || ''),
  };
  if (item.description) payload.description = item.description;
  if (item.remarks) payload.remarks = item.remarks;

  const data = await blPost('/inventories', payload);
  return { key: item.key, success: true, inventoryId: (data && data.inventory_id) || null };
}

exports.handler = async (event) => {
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
      if (!item || !item.itemNo || !item.type || !item.quantity) {
        return json(400, { error: 'Each item requires itemNo, type, and quantity' });
      }
    }

    // Sequential, not Promise.all — these are live writes to BrickLink
    // (rate-limited, order doesn't matter but concurrency risk does), and
    // this way every item still gets a clean per-row result even if an
    // earlier one fails, rather than a concurrent batch's error handling
    // getting tangled.
    const results = [];
    for (const item of items) {
      try {
        results.push(await createOne(item));
      } catch (err) {
        results.push({ key: item.key, success: false, error: err.message || 'BrickLink rejected this item' });
      }
    }

    return json(200, { results });
  } catch (err) {
    return errorResponse(err);
  }
};
