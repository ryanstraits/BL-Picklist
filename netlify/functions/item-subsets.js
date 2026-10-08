const { blGet } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');
const { requireAuth } = require('./lib/site-auth');

// Get Item Subsets — GET /items/{type}/{no}/subsets — BrickLink's own bill
// of materials for a set or minifig: every part/fig that makes it up. Not
// yet confirmed against a live response (no path to a real call from this
// sandbox); shape is corroborated by two independent client libraries
// (bl-api-3 and bricklink_py's catalog_item.py), which agree the response
// is an array of groups — { match_no, entries: [...] } — where entries can
// hold more than one item when BrickLink records alternates for the same
// slot. Flattened here into one list; the frontend decides how to group.
//
// break_minifigs/break_subsets are left off (BrickLink's own default,
// false) — a minifig inside a set comes back as one MINIFIG line, matched
// against Ryan's own loose-minifig inventory, not decomposed into its own
// torso/legs/head parts. That's what was actually asked for: "parts and
// figs ... that belong to that set," not a full parts-of-parts breakdown.
exports.handler = requireAuth(async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const itemType = params.type;
    const itemNo = params.no;
    if (!itemType || !itemNo) return json(400, { error: 'Missing type or no' });

    // Fetched alongside the subsets call (not instead of it) — the frontend
    // shows a header card for the set/fig itself (name, View on BrickLink,
    // active US listings) above its parts list, which needs the plain Get
    // Item endpoint's own name/category, not anything subsets returns.
    const [subsetsData, itemData] = await Promise.all([
      blGet(`/items/${encodeURIComponent(itemType)}/${encodeURIComponent(itemNo)}/subsets`),
      blGet(`/items/${encodeURIComponent(itemType)}/${encodeURIComponent(itemNo)}`),
    ]);

    const entries = [];
    (Array.isArray(subsetsData) ? subsetsData : []).forEach((group) => {
      ((group && group.entries) || []).forEach((e) => {
        if (!e || !e.item) return;
        entries.push({
          itemNo: e.item.no,
          name: e.item.name,
          type: e.item.type,
          categoryId: e.item.category_id || 0,
          colorId: e.color_id || 0,
          quantity: e.quantity,
          isAlternate: !!e.is_alternate,
          isCounterpart: !!e.is_counterpart,
        });
      });
    });

    const item = {
      itemNo: (itemData && itemData.no) || itemNo,
      name: (itemData && itemData.name) || '',
      type: (itemData && itemData.type) || itemType,
      categoryId: (itemData && itemData.category_id) || 0,
    };

    return json(200, { item, entries });
  } catch (err) {
    return errorResponse(err);
  }
});
