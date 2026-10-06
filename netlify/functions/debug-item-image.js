const { blGet } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');
const { requireAuth } = require('./lib/site-auth');

// TEMPORARY — diagnoses the "wrong color photo" bug report (27145,
// Minifigure Utility Belt, color Red showing yellow) from inside this
// sandbox, which has no outbound network access to bricklink.com at all
// (confirmed: direct curl attempts to img.bricklink.com/www.bricklink.com
// are rejected by this session's own egress proxy policy). Only the
// deployed Netlify Function has real internet access to BrickLink's CDN,
// so this reports — instead of guessing — exactly what each candidate
// image URL from item-image.js actually does for a specific order's item:
// HTTP status, byte size, and whether it's the color-aware or
// color-agnostic kind. Remove once diagnosed.
const TYPE_LETTERS = {
  PART: 'P', SET: 'S', MINIFIG: 'M', BOOK: 'B', GEAR: 'G',
  CATALOG: 'C', INSTRUCTION: 'I', ORIGINAL_BOX: 'O', UNSORTED_LOT: 'U',
};

async function probe(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BL-Picklist/1.0)' } });
    const buf = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    return { url, status: res.status, ok: res.ok, bytes: buf ? buf.length : 0, contentType: res.headers.get('content-type') || null };
  } catch (err) {
    return { url, status: null, ok: false, bytes: 0, error: err.message };
  }
}

exports.handler = requireAuth(async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const orderId = params.orderId;
    let itemType = params.type;
    let itemNo = params.no;
    let colorId = params.color;
    let newOrUsed = params.nu;

    // If given an order id, pull the real item straight from BrickLink
    // (optionally narrowed with itemNo if the order has more than one
    // line) so the probe uses the exact type/colorId/newOrUsed BrickLink
    // itself reports, not a guessed color id.
    if (orderId) {
      const batches = await blGet(`/orders/${encodeURIComponent(orderId)}/items`);
      const all = [];
      (batches || []).forEach((batch) => (batch || []).forEach((entry) => all.push(entry)));
      const match = itemNo ? all.find((e) => e.item.no === itemNo) : all[0];
      if (!match) return json(404, { error: 'No matching item on that order', available: all.map((e) => e.item.no) });
      itemType = match.item.type;
      itemNo = match.item.no;
      colorId = String(match.color_id);
      newOrUsed = match.new_or_used;
    }

    if (!itemNo) return json(400, { error: 'Need either orderId or (type, no, color, nu)' });

    const letter = TYPE_LETTERS[itemType] || 'P';
    const nu = newOrUsed === 'U' ? 'U' : 'N';
    const color = encodeURIComponent(colorId || '0');
    const no = encodeURIComponent(itemNo);

    const candidates = [
      { tier: 'hires', colorAware: true, url: `https://img.bricklink.com/ItemImage/${letter}${nu}/${color}/${no}.png` },
      { tier: 'small', colorAware: true, url: `https://img.bricklink.com/${letter}/${color}/${no}.jpg` },
      { tier: 'large', colorAware: false, url: `https://www.bricklink.com/${letter}L/${no}.jpg` },
      { tier: 'large', colorAware: false, url: `https://www.bricklink.com/${letter}L/${no}.gif` },
      { tier: 'small-generic', colorAware: false, url: `https://img.bricklink.com/${letter}/${no}.jpg` },
    ];

    const probes = await Promise.all(candidates.map(async (c) => ({ ...c, ...(await probe(c.url)) })));

    let catalogApiImageUrl = null;
    let catalogApiError = null;
    try {
      const data = await blGet(`/items/${encodeURIComponent(itemType)}/${encodeURIComponent(itemNo)}`);
      catalogApiImageUrl = (data && data.image_url) || null;
    } catch (err) {
      catalogApiError = err.message;
    }
    const catalogApiProbe = catalogApiImageUrl ? { tier: 'catalog-api', colorAware: false, ...(await probe(catalogApiImageUrl)) } : null;

    return json(200, {
      resolvedFrom: orderId ? { orderId, itemType, itemNo, colorId, newOrUsed: nu } : { itemType, itemNo, colorId, newOrUsed: nu },
      probes: probes.concat(catalogApiProbe ? [catalogApiProbe] : []),
      catalogApiError,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
