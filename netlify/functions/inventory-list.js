const { blGet } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');
const { requireAuth } = require('./lib/site-auth');

// Get Inventory List — GET /inventories — confirmed against a real live
// response (842 real rows, no pagination: BrickLink returns everything in
// one call). Normalized to the same row shape the rest of the app already
// uses (csvObjToInventoryRow's fields), plus inventoryId, which is what
// inventory-update.js needs to know which live listing to PUT. Notably
// absent from BrickLink's own data: any bin/location field — the "Bin"
// shown on the Add Inventory page comes entirely from Ryan's own CSV
// export, not from BrickLink, so this list can't show or search by bin.
exports.handler = requireAuth(async () => {
  try {
    const data = await blGet('/inventories');
    const items = (Array.isArray(data) ? data : []).map((row) => ({
      inventoryId: row.inventory_id,
      key: 'bl-' + row.inventory_id,
      itemNo: (row.item && row.item.no) || '',
      type: (row.item && row.item.type) || 'PART',
      name: (row.item && row.item.name) || '',
      colorId: row.color_id || 0,
      colorName: row.color_name || '',
      quantity: row.quantity,
      newOrUsed: row.new_or_used === 'U' ? 'U' : 'N',
      unitPrice: row.unit_price || '',
      description: row.description || '',
      remarks: row.remarks || '',
    }));
    return json(200, { items });
  } catch (err) {
    return errorResponse(err);
  }
});
