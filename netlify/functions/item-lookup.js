const { blGet } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');
const { requireAuth } = require('./lib/site-auth');

// Get Item — GET /items/{type}/{no} — just the catalog name for a single
// item. item-subsets.js already fetches this same endpoint alongside a
// set/fig's subsets; this is that call standing alone, for the Wanted
// List's manual add-by-number form, where Ryan's typed in just an item
// number and the row needs a real name instead of staying blank.
exports.handler = requireAuth(async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const itemType = params.type;
    const itemNo = params.no;
    if (!itemType || !itemNo) return json(400, { error: 'Missing type or no' });

    const itemData = await blGet(`/items/${encodeURIComponent(itemType)}/${encodeURIComponent(itemNo)}`);

    return json(200, {
      item: {
        itemNo: (itemData && itemData.no) || itemNo,
        name: (itemData && itemData.name) || '',
        type: (itemData && itemData.type) || itemType,
        categoryId: (itemData && itemData.category_id) || 0,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
});
