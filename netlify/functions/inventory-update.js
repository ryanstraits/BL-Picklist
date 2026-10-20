const { blPut } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');
const { requireAuth } = require('./lib/site-auth');

// Update Inventory — PUT /inventories/{inventory_id} — a partial update per
// BrickLink's own documented behavior for this endpoint (only the fields
// sent are changed; everything else on the listing is left alone), which
// is why this only ever sends the six fields Manage Inventory lets Ryan
// edit — quantity, unit_price, new_or_used, description, remarks,
// stock room — plus sale_rate when a sale starts or ends, and never
// color_id or the item itself, both of which are part of a listing's
// identity, not something you'd "edit" after the fact.
async function updateOne(item) {
  const payload = {
    quantity: item.quantity,
    unit_price: String(item.unitPrice || ''),
    new_or_used: item.newOrUsed === 'U' ? 'U' : 'N',
    description: item.description || '',
    remarks: item.remarks || '',
    // Same is_stock_room/stock_room_id pairing inventory-create.js uses,
    // and the same reasoning for when stock_room_id is included at all —
    // is_stock_room:false is what actually signals "not in a stock room"
    // (BrickLink only validated an omitted stock_room_id there, not an
    // empty string, so clearing a room sends the flag alone rather than
    // risking an empty value this endpoint hasn't been tested against).
    is_stock_room: !!item.stockRoomId,
  };
  if (item.stockRoomId) payload.stock_room_id = item.stockRoomId;
  // Only sent when the caller asks for it (starting/ending a sale) — every
  // other edit leaves it out, and a partial update leaves it as it was.
  const asksForSaleRate = item.saleRate !== undefined && item.saleRate !== null;
  const wantsSaleRate = asksForSaleRate && Number.isInteger(item.saleRate) && item.saleRate >= 0 && item.saleRate <= 99;
  if (asksForSaleRate && !wantsSaleRate) throw new Error('Sale rate must be a whole number from 0 to 99');
  if (wantsSaleRate) payload.sale_rate = item.saleRate;
  const updated = await blPut(`/inventories/${encodeURIComponent(item.inventoryId)}`, payload);
  // BrickLink returns the listing as it now stands. A 200 that quietly
  // didn't apply the rate would leave a "sale" nobody is getting, so check
  // it rather than trust the status — a missing field reads as 0.
  if (wantsSaleRate) {
    const applied = Number(updated && updated.sale_rate) || 0;
    if (applied !== item.saleRate) {
      throw new Error(`BrickLink accepted the update but reports a sale rate of ${applied}%, not ${item.saleRate}%`);
    }
  }
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
    // Sequential, not Promise.all — same reasoning as inventory-create.js:
    // these are live writes to BrickLink, and each row needs its own
    // clean result even if an earlier one fails. Malformed items are
    // reported the same way, per-item, rather than 400ing the whole
    // request — a single row missing inventoryId/quantity (BrickLink can
    // return quantity: 0 for a listing) would otherwise silently block
    // every other item in a large batch too.
    const results = [];
    for (const item of items) {
      if (!item || !item.inventoryId || !item.quantity) {
        results.push({ key: item && item.key, success: false, error: 'Missing inventoryId or quantity — this listing can\'t be updated' });
        continue;
      }
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
