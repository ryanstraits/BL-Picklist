const { blGet } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Colors basically never change, so cache them in memory for the lambda's
// warm lifetime. This resets on cold start, which is fine — the client
// also caches the response indefinitely in localStorage.
let cache = null;
let cacheTime = 0;

exports.handler = async () => {
  try {
    if (cache && Date.now() - cacheTime < CACHE_TTL_MS) {
      return json(200, cache);
    }

    const data = await blGet('/colors');
    const colors = (data || []).map((c) => ({
      colorId: c.color_id,
      colorName: c.color_name,
      colorCode: c.color_code,
      colorType: c.color_type,
    }));

    cache = colors;
    cacheTime = Date.now();

    return json(200, colors);
  } catch (err) {
    return errorResponse(err);
  }
};
