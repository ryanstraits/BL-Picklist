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
// possibly larger) photo than either undocumented hotlink pattern below.
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

  const hiResUrl = `https://img.bricklink.com/ItemImage/${letter}${newOrUsed}/${encodeURIComponent(colorId)}/${encodeURIComponent(itemNo)}.png`;
  const fallbackUrl = `https://img.bricklink.com/${letter}/${encodeURIComponent(itemNo)}.jpg`;

  try {
    // Try the two independent, potentially-different-resolution sources
    // concurrently, then pick whichever actually has more detail (bigger
    // file) rather than guessing at a fixed priority.
    const [catalogResult, hiResResult] = await Promise.all([
      tryCatalogApiImage(itemType, itemNo),
      tryFetch(hiResUrl),
    ]);

    let best = null;
    let tier = null;
    if (catalogResult && (!hiResResult || catalogResult.buffer.length >= hiResResult.buffer.length)) {
      best = catalogResult;
      tier = "catalog-api";
    } else if (hiResResult) {
      best = hiResResult;
      tier = "hires";
    }

    if (!best) {
      const fallbackResult = await tryFetch(fallbackUrl);
      if (fallbackResult) {
        best = fallbackResult;
        tier = "fallback";
      }
    }

    if (!best) {
      return { statusCode: 404, body: "Image not found" };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": best.contentType,
        "Cache-Control": "public, max-age=3600",
        // Lets the frontend show whether it got the official Catalog API
        // photo, the color-specific hotlink, or the small generic one,
        // and its actual byte size — no devtools needed to check.
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
