const { blGet } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');
const { requireAuth } = require('./lib/site-auth');

// Get Price Guide — GET /items/{type}/{no}/price — confirmed against two
// independent real client libraries (go-bricklink-api and bricklink-py),
// which agree on both the query param names (color_id, guide_type,
// new_or_used, country_code, ...) and that {type} in the URL path is the
// same full uppercase word used everywhere else in this app ("MINIFIG",
// "PART", ...). guide_type=stock returns *currently listed* items (not
// past sales), and country_code=US filters server-side to stores located
// in the US — confirmed against a real live response (20 US listings out
// of 64 total for a real item), so no client-side re-filter is needed —
// or possible: each price_detail entry only has quantity, unit_price, and
// shipping_available (plus a redundant, identically-typo'd "qunatity"
// field BrickLink's own API apparently ships) — no seller_country_code,
// no buyer_country_code, no date_ordered, despite a client library's
// PriceDetail struct claiming otherwise. An earlier version of this
// function re-filtered on seller_country_code as a defensive measure,
// which — since that field doesn't exist — silently zeroed out every
// result regardless of the real (correct) server-side filtering.
exports.handler = requireAuth(async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const itemType = params.type;
    const itemNo = params.no;
    if (!itemType || !itemNo) return json(400, { error: 'Missing type or no' });

    const newOrUsed = params.condition === 'U' ? 'U' : 'N';
    const colorId = params.color;

    const query = new URLSearchParams({
      guide_type: 'stock',
      new_or_used: newOrUsed,
      country_code: 'US',
    });
    if (colorId) query.set('color_id', colorId);

    const data = await blGet(`/items/${encodeURIComponent(itemType)}/${encodeURIComponent(itemNo)}/price?${query.toString()}`);

    // Capped to the cheapest 25 — Ryan prices off the bottom of the list,
    // so the long tail of pricier listings isn't useful and just bloats
    // the response (a common item can easily have 60+ active listings).
    const listings = ((data && data.price_detail) || [])
      .map((d) => ({
        quantity: d.quantity,
        unitPrice: d.unit_price,
        shippingAvailable: !!d.shipping_available,
      }))
      .sort((a, b) => Number(a.unitPrice) - Number(b.unitPrice))
      .slice(0, 25);

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
});
