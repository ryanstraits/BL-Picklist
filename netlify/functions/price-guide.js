const { blGet } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');

// Get Price Guide — GET /items/{type}/{no}/price — confirmed against two
// independent real client libraries (go-bricklink-api and bricklink-py),
// which agree on both the query param names (color_id, guide_type,
// new_or_used, country_code, ...) and that {type} in the URL path is the
// same full uppercase word used everywhere else in this app ("MINIFIG",
// "PART", ...). guide_type=stock returns *currently listed* items (not
// past sales), and country_code filters to stores located in that
// country — exactly "active US listings" for pricing against.
exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const itemType = params.type;
    const itemNo = params.no;
    if (!itemType || !itemNo) return json(400, { error: 'Missing type or no' });

    const newOrUsed = params.condition === 'U' ? 'U' : 'N';
    const colorId = params.color;

    // Temporary diagnostic: a real order returned zero listings despite
    // 20+ visible on bricklink.com for the same item/condition, so this
    // fetches both a country_code=US query and an unfiltered one side by
    // side to see the raw response — confirms whether country_code needs
    // to be paired with region (a real client library enforces that
    // pairing; another doesn't), and the real price_detail field names,
    // rather than guessing again. Remove once the real shape is confirmed.
    if (params.debug === '1') {
      const [withCountry, withoutCountry] = await Promise.all([
        blGet(`/items/${encodeURIComponent(itemType)}/${encodeURIComponent(itemNo)}/price?guide_type=stock&new_or_used=${newOrUsed}&country_code=US`),
        blGet(`/items/${encodeURIComponent(itemType)}/${encodeURIComponent(itemNo)}/price?guide_type=stock&new_or_used=${newOrUsed}`),
      ]);
      return json(200, { withCountry, withoutCountry });
    }

    const query = new URLSearchParams({
      guide_type: 'stock',
      new_or_used: newOrUsed,
      country_code: 'US',
    });
    if (colorId) query.set('color_id', colorId);

    const data = await blGet(`/items/${encodeURIComponent(itemType)}/${encodeURIComponent(itemNo)}/price?${query.toString()}`);

    const listings = ((data && data.price_detail) || [])
      // Defense in depth: country_code should already restrict this
      // server-side, but filtering again here means a change in
      // BrickLink's own filtering behavior fails safe (an empty/short
      // list) rather than silently showing non-US sellers as if they
      // were US ones.
      .filter((d) => d.seller_country_code === 'US')
      .map((d) => ({
        quantity: d.quantity,
        unitPrice: d.unit_price,
        shippingAvailable: !!d.shipping_available,
      }))
      .sort((a, b) => Number(a.unitPrice) - Number(b.unitPrice));

    return json(200, {
      newOrUsed: (data && data.new_or_used) || newOrUsed,
      currencyCode: (data && data.currency_code) || 'USD',
      minPrice: (data && data.min_price) || null,
      avgPrice: (data && data.avg_price) || null,
      maxPrice: (data && data.max_price) || null,
      totalQuantity: (data && data.total_quantity) || 0,
      listings,
    });
  } catch (err) {
    return errorResponse(err);
  }
};
