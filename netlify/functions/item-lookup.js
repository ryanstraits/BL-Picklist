const { blGet } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');
const { requireAuth } = require('./lib/site-auth');

// Get Item — GET /items/{type}/{no} — just the catalog name for a single
// item. item-subsets.js already fetches this same endpoint alongside a
// set/fig's subsets; this is that call standing alone, for the Wanted
// List's manual add-by-number form, where Ryan's typed in just an item
// number and the row needs a real name instead of staying blank — and,
// for the Sort page, the item's catalog weight.
exports.handler = requireAuth(async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const itemType = params.type;
    const itemNo = params.no;
    if (!itemType || !itemNo) return json(400, { error: 'Missing type or no' });

    const itemData = await blGet(`/items/${encodeURIComponent(itemType)}/${encodeURIComponent(itemNo)}`);

    // For a minifig on request (sets=1): how many sets it comes in, from the
    // supersets list — the Sort page's rarity index needs it. A failure just
    // leaves it out rather than failing the whole lookup.
    let setCount = null;
    if (itemType === 'MINIFIG' && params.sets === '1') {
      try {
        const supersets = await blGet(`/items/MINIFIG/${encodeURIComponent(itemNo)}/supersets`);
        const sets = new Set();
        (Array.isArray(supersets) ? supersets : []).forEach((group) => {
          ((group && group.entries) || []).forEach((e) => {
            if (e && e.item && e.item.type === 'SET') sets.add(e.item.no);
          });
        });
        setCount = sets.size;
      } catch (e) { /* leave setCount null */ }
    }

    return json(200, {
      item: {
        itemNo: (itemData && itemData.no) || itemNo,
        name: (itemData && itemData.name) || '',
        type: (itemData && itemData.type) || itemType,
        categoryId: (itemData && itemData.category_id) || 0,
        // Catalog weight in grams (0 when BrickLink has none) — the Sort
        // page values leftover bulk by weight.
        weightG: Number(itemData && itemData.weight) || 0,
        // Year BrickLink lists the item as released (0 when unknown).
        yearReleased: Number(itemData && itemData.year_released) || 0,
        setCount,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
});
