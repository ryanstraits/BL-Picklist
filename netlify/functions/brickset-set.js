const { json, errorResponse } = require('./lib/http');
const { requireAuth } = require('./lib/site-auth');

// Brickset set lookup — Brickset API v3, getSets with a full set number
// ("75021-1"). Backs the Sort List in two ways: it is the fallback for a set's
// name/year/theme/pieces/weight when BrickLink can't be reached, and its
// ownedBy / wantedBy counts (how many Brickset members own / want the set)
// feed the Demand score as wanted / (wanted + owned).
//
// Needs the BRICKSET_API_KEY environment variable (set in the Netlify
// dashboard, never committed). Brickset counts only getSets calls against a key's
// daily limit, so the page caches what comes back.
//
// Written from Brickset's v3 documentation
// (https://brickset.com/article/52664/api-version-3-documentation): methods are
// https://brickset.com/api/v3.asmx/{method}; getSets takes apiKey, userHash
// (only for owned/wanted) and params, a JSON string; success is
// {"status":"success","matches":n,"sets":[...]}, an error is
// {"status":"error","message":"..."}. Each set has number, numberVariant, name,
// year, theme, themeGroup, subtheme, pieces, minifigs (a count),
// dimensions.weight, collections.ownedBy / collections.wantedBy and
// LEGOCom.US.retailPrice. The units of dimensions.weight aren't stated there;
// Brickset's own pages show kilograms, so a value under 100 is treated as kg and
// anything larger as grams. Not yet run against the live service.
const ENDPOINT = 'https://brickset.com/api/v3.asmx/getSets';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function weightGrams(w) {
  const n = num(w);
  if (!(n > 0)) return 0;
  return n < 100 ? Math.round(n * 1000) : Math.round(n);
}

async function callBrickset(apiKey, setNumber) {
  const params = JSON.stringify({ setNumber, pageSize: 5 });
  const query = new URLSearchParams({ apiKey, userHash: '', params });
  let res = await fetch(`${ENDPOINT}?${query.toString()}`);
  if (!res.ok) {
    // Some ASMX setups only take a form POST.
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: query.toString(),
    });
  }
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch (e) { body = null; }
  if (!body) throw new Error(`Brickset returned an unreadable response (${res.status})`);
  return body;
}

exports.handler = requireAuth(async (event) => {
  try {
    const raw = ((event.queryStringParameters || {}).no || '').trim();
    if (!raw) return json(400, { error: 'Missing set number' });
    const setNumber = /-\d+$/.test(raw) ? raw : `${raw}-1`;

    const apiKey = process.env.BRICKSET_API_KEY;
    if (!apiKey) return json(501, { error: 'BRICKSET_API_KEY isn\'t set on this site' });

    const body = await callBrickset(apiKey, setNumber);
    if (body.status !== 'success') {
      return json(502, { error: `Brickset: ${body.message || 'request failed'}` });
    }
    const set = ((body.sets || []).filter((s) => `${s.number}-${s.numberVariant}` === setNumber)[0]) || (body.sets || [])[0];
    if (!set) return json(404, { error: `Brickset has no set ${setNumber}` });

    const owned = num(set.collections && set.collections.ownedBy);
    const wanted = num(set.collections && set.collections.wantedBy);
    return json(200, {
      setNumber: `${set.number}-${set.numberVariant}`,
      name: set.name || '',
      year: num(set.year),
      theme: set.theme || '',
      themeGroup: set.themeGroup || '',
      subtheme: set.subtheme || '',
      pieces: num(set.pieces),
      minifigs: num(set.minifigs),
      weightG: weightGrams(set.dimensions && set.dimensions.weight),
      ownedBy: owned,
      wantedBy: wanted,
      retailUS: num(set.LEGOCom && set.LEGOCom.US && set.LEGOCom.US.retailPrice),
      imageURL: (set.image && (set.image.imageURL || set.image.thumbnailURL)) || '',
      bricksetURL: set.bricksetURL || '',
    });
  } catch (err) {
    return errorResponse(err);
  }
});
