const { blPost } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');
const { requireAuth } = require('./lib/site-auth');

// Create Inventory — POST /inventories — the request body nests the
// catalog item under "item" ({no, type}), with color_id, quantity,
// new_or_used, unit_price, description, and remarks as siblings. This
// creates the listing live/immediately — there's no staging or review
// endpoint in the Store API, unlike BrickLink's own website upload flow,
// which is why the review step lives in the frontend instead: nothing
// reaches BrickLink until the seller approves each row there.
//
// item.type is the full uppercase word ("PART", "MINIFIG", ...) — this
// was briefly changed to a single-letter code ("P", "M", ...) on the
// mistaken assumption that go-bricklink-api's single-letter item-type
// constants applied here; real API testing proved that wrong (BrickLink
// returned "Unparseable value or field: item.type" for the letter code).
// The single-letter codes are specific to BrickLink's *image* CDN URL
// paths (where this app's item-image.js already correctly uses them,
// confirmed against a real captured catalog image URL) — a different
// subsystem from the Store API's JSON fields. A real JS client library
// (ryansh100/bricklink-api's store/inventory.js), whose Create Inventory
// request body matches this app's shape field-for-field, confirms the
// full word is correct for this endpoint.
async function createOne(item) {
  const payload = {
    item: { no: item.itemNo, type: item.type },
    color_id: item.colorId || 0,
    quantity: item.quantity,
    new_or_used: item.newOrUsed === 'U' ? 'U' : 'N',
    unit_price: String(item.unitPrice || ''),
    // BrickLink rejects the request as PARAMETER_MISSING_OR_INVALID
    // ("Parameter [is_retain] is missing") without this — it's not
    // optional/defaulted server-side despite being absent from most
    // client library examples. false matches BrickLink's own classic
    // upload form default: remove the listing once it sells out rather
    // than keep a 0-qty placeholder row.
    is_retain: false,
  };
  if (item.description) payload.description = item.description;
  if (item.remarks) payload.remarks = item.remarks;

  const data = await blPost('/inventories', payload);
  return { key: item.key, success: true, inventoryId: (data && data.inventory_id) || null };
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
});
