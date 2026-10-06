const { blGet } = require("./lib/bricklink");
const { requireAuth } = require("./lib/site-auth");

const TYPE_LETTERS = {
  PART: "P", SET: "S", MINIFIG: "M", BOOK: "B", GEAR: "G",
  CATALOG: "C", INSTRUCTION: "I", ORIGINAL_BOX: "O", UNSORTED_LOT: "U"
};

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; BL-Picklist/1.0)",
};

async function tryFetch(url) {
  try {
    const res = await fetch(url, { headers: FETCH_HEADERS });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, contentType };
  } catch (err) {
    return null;
  }
}

// The official, documented Catalog API — may return a different (and
// possibly larger) photo than any of the undocumented hotlink patterns.
async function tryCatalogApiImage(itemType, itemNo) {
  if (!itemType) return null;
  try {
    const data = await blGet(`/items/${encodeURIComponent(itemType)}/${encodeURIComponent(itemNo)}`);
    if (!data || !data.image_url) return null;
    return tryFetch(data.image_url);
  } catch (err) {
    return null;
  }
}

// Requests made directly from a browser <img> tag carry Sec-Fetch-* metadata
// that BrickLink's hotlink protection blocks, even with no Referer sent —
// but a plain server-side fetch (no such headers) goes through fine. So we
// fetch the image here and stream the bytes back under our own origin.
exports.handler = requireAuth(async (event) => {
  const params = event.queryStringParameters || {};
  const itemNo = params.no;
  if (!itemNo) {
    return { statusCode: 400, body: "Missing item number" };
  }

  const itemType = params.type;
  const letter = TYPE_LETTERS[itemType] || "P";
  const colorId = params.color || "0";
  const newOrUsed = params.nu === "U" ? "U" : "N";
  const no = encodeURIComponent(itemNo);
  const color = encodeURIComponent(colorId);

  // BrickLink's undocumented photo URLs aren't consistent across item
  // types — e.g. minifigs' "large" photo is a .jpg with no color segment,
  // while parts' is a .gif and the small thumbnail needs a color segment
  // parts don't need for minifigs. Rather than guess one fixed shape per
  // tier, try every plausible variant — but "biggest file wins" (the
  // original rule) can only arbitrate between sources that are actually
  // picturing the requested color in the first place. The "large" hotlink
  // URLs, the no-color small thumbnail, and the Catalog API's image_url
  // all carry the item's one default/primary photo regardless of which
  // color was asked for — only the two `color`-segment URLs actually vary
  // per color. If one of those succeeds, it wins outright over every
  // color-agnostic candidate even when a color-agnostic file is larger;
  // confirmed live by Ryan (27145 Minifigure Utility Belt, color Red):
  // the generic default-color photo (yellow) was winning the byte-size
  // race over the correct red thumbnail, so the picklist showed the
  // wrong color entirely. Color-agnostic sources only get used when no
  // color-aware one came back at all (a genuine 404, or colorId 0 for an
  // item color doesn't apply to).
  const urlCandidates = [
    { tier: "hires", colorAware: true, url: `https://img.bricklink.com/ItemImage/${letter}${newOrUsed}/${color}/${no}.png` },
    { tier: "small", colorAware: true, url: `https://img.bricklink.com/${letter}/${color}/${no}.jpg` },
    { tier: "large", colorAware: false, url: `https://www.bricklink.com/${letter}L/${no}.jpg` },
    { tier: "large", colorAware: false, url: `https://www.bricklink.com/${letter}L/${no}.gif` },
    { tier: "small-generic", colorAware: false, url: `https://img.bricklink.com/${letter}/${no}.jpg` },
  ];

  try {
    const fetches = urlCandidates
      .map((c) => tryFetch(c.url).then((result) => ({ result, tier: c.tier, colorAware: c.colorAware })))
      .concat([tryCatalogApiImage(itemType, itemNo).then((result) => ({ result, tier: "catalog-api", colorAware: false }))]);

    const settled = await Promise.all(fetches);
    const succeeded = settled.filter((s) => s.result);
    const colorAwareHits = succeeded.filter((s) => s.colorAware);
    const pool = colorAwareHits.length ? colorAwareHits : succeeded;

    let best = null;
    let tier = null;
    for (const { result, tier: t } of pool) {
      if (!best || result.buffer.length > best.buffer.length) {
        best = result;
        tier = t;
      }
    }

    if (!best) {
      return { statusCode: 404, body: "Image not found" };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": best.contentType,
        "Cache-Control": "public, max-age=86400",
        // Lets the frontend show which source/size actually won — no
        // devtools needed to check.
        "X-Image-Tier": tier,
        "X-Image-Bytes": String(best.buffer.length),
      },
      body: best.buffer.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 502, body: "Upstream error" };
  }
});
