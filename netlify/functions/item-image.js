const { blGet } = require("./lib/bricklink");

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
exports.handler = async (event) => {
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
  // tier, try every plausible variant and let the biggest surviving file
  // win — same idea as picking between the Catalog API and hotlink CDN.
  const urlCandidates = [
    { tier: "hires", url: `https://img.bricklink.com/ItemImage/${letter}${newOrUsed}/${color}/${no}.png` },
    { tier: "large", url: `https://www.bricklink.com/${letter}L/${no}.jpg` },
    { tier: "large", url: `https://www.bricklink.com/${letter}L/${no}.gif` },
    { tier: "small", url: `https://img.bricklink.com/${letter}/${color}/${no}.jpg` },
    { tier: "small", url: `https://img.bricklink.com/${letter}/${no}.jpg` },
  ];

  try {
    const fetches = urlCandidates
      .map((c) => tryFetch(c.url).then((result) => ({ result, tier: c.tier })))
      .concat([tryCatalogApiImage(itemType, itemNo).then((result) => ({ result, tier: "catalog-api" }))]);

    const settled = await Promise.all(fetches);

    let best = null;
    let tier = null;
    for (const { result, tier: t } of settled) {
      if (result && (!best || result.buffer.length > best.buffer.length)) {
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
};
