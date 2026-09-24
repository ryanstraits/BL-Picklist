const { blGet } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');
const { requireAuth } = require('./lib/site-auth');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Categories basically never change, so cache them in memory for the
// lambda's warm lifetime — same pattern as colors.js. Used to build the
// item-type → theme/category browse screen on Manage Inventory: each
// inventory row already carries a category_id (confirmed against a real
// captured order-items response, see order-items.js), and BrickLink's
// category tree (parent_id, 0 = root) lets that be walked up to a
// top-level "theme" for Sets/Minifigs — parts get grouped by their own
// physical-category tree instead, since parts mostly don't have a real
// theme.
let cache = null;
let cacheTime = 0;

exports.handler = requireAuth(async () => {
  try {
    if (cache && Date.now() - cacheTime < CACHE_TTL_MS) {
      return json(200, cache);
    }

    const data = await blGet('/categories');
    const categories = (data || []).map((c) => ({
      categoryId: c.category_id,
      categoryName: c.category_name,
      parentId: c.parent_id,
    }));

    cache = categories;
    cacheTime = Date.now();

    return json(200, categories);
  } catch (err) {
    return errorResponse(err);
  }
});
