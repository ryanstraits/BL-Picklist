const TYPE_LETTERS = {
  PART: "P", SET: "S", MINIFIG: "M", BOOK: "B", GEAR: "G",
  CATALOG: "C", INSTRUCTION: "I", ORIGINAL_BOX: "O", UNSORTED_LOT: "U"
};

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; BL-Picklist/1.0)",
};

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

  const letter = TYPE_LETTERS[params.type] || "P";
  const colorId = params.color || "0";
  const newOrUsed = params.nu === "U" ? "U" : "N";

  // Try the larger, color-specific catalog photo first; fall back to the
  // small generic one (no color variants, but reliably present) if that
  // particular item/color combo has no hi-res photo.
  const hiResUrl = `https://img.bricklink.com/ItemImage/${letter}${newOrUsed}/${encodeURIComponent(colorId)}/${encodeURIComponent(itemNo)}.png`;
  const fallbackUrl = `https://img.bricklink.com/${letter}/${encodeURIComponent(itemNo)}.jpg`;

  try {
    let res = await fetch(hiResUrl, { headers: FETCH_HEADERS });
    let tier = "hires";
    if (!res.ok) {
      res = await fetch(fallbackUrl, { headers: FETCH_HEADERS });
      tier = "fallback";
    }

    if (!res.ok) {
      return { statusCode: 404, body: "Image not found" };
    }

    const contentType = res.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await res.arrayBuffer());

    return {
      statusCode: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=604800, immutable",
        // Lets the frontend tell whether it got the larger, color-specific
        // photo or had to fall back to the small generic one.
        "X-Image-Tier": tier,
        "X-Image-Bytes": String(buffer.length),
      },
      body: buffer.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 502, body: "Upstream error" };
  }
};
