const { getStore, connectLambda } = require('@netlify/blobs');
const { json, errorResponse } = require('./lib/http');
const { requireAuth } = require('./lib/site-auth');

const STORE_NAME = 'pick-state';
const DEFAULT_KEY = 'state';
// Which blob key to read/write — 'state' (picks, the default, for
// backward compatibility with existing callers), 'actions'
// (driveThruSent/feedbackSent), 'wantedListBank' (the Wanted List
// bank's own cross-lookup items map), or 'activeSale' (the Manage
// Inventory bulk-sale feature's list of running sales — an array). Same store,
// same GET/POST shape, just a different named slot, so this one small
// function covers all of them instead of duplicating the whole
// Blobs-wiring dance per feature. 'sortList' (the Sort page's array of
// sets being ranked) and 'sortSettings' (its editable rates/assumptions)
// are the Sort page's two slots.
const ALLOWED_KEYS = new Set(['state', 'actions', 'wantedListBank', 'activeSale', 'sortList', 'sortSettings']);
// Keys whose value is a JSON array rather than an object.
const ARRAY_KEYS = new Set(['activeSale', 'sortList']);

// This project's functions use the classic AWS Lambda-compatible handler
// signature (exports.handler = async (event) => {...}), not the newer
// Netlify-native one — for that style, Blobs' per-request context arrives
// in event.blobs and has to be registered via connectLambda(event) before
// getStore() can find it. Without this call, getStore() has nothing to
// read and throws MissingBlobsEnvironmentError — which is what was
// actually happening on every single request (both GET and POST) since
// this function was added; the earlier getDeployStore() branching and
// bad push-comparison logic were both real bugs, but neither was the
// actual blocker.
// Merges an incoming 'actions' write into the stored one: the flag maps are
// unions of the truthy keys; boxChoice and spreadsheetLogged take the
// incoming value for any key it mentions (so an explicit change, including
// clearing a box or marking an order not logged, still goes through) and
// keep the rest of what was stored.
function mergeActions(existing, incoming) {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  const merged = { ...base, ...incoming };
  for (const key of ['driveThruSent', 'feedbackSent', 'pickupScheduled']) {
    const union = {};
    for (const src of [base[key], incoming[key]]) {
      if (src && typeof src === 'object') Object.keys(src).forEach((k) => { if (src[k]) union[k] = true; });
    }
    merged[key] = union;
  }
  for (const key of ['boxChoice', 'spreadsheetLogged']) {
    merged[key] = { ...(base[key] || {}), ...(incoming[key] || {}) };
  }
  return merged;
}

exports.handler = requireAuth(async (event) => {
  connectLambda(event);

  const requestedKey = (event.queryStringParameters && event.queryStringParameters.key) || DEFAULT_KEY;
  if (!ALLOWED_KEYS.has(requestedKey)) {
    return { statusCode: 400, body: 'Unsupported key' };
  }

  let store;
  try {
    store = getStore(STORE_NAME);
  } catch (err) {
    return errorResponse(err);
  }

  if (event.httpMethod === 'GET') {
    try {
      const data = await store.get(requestedKey, { type: 'json' });
      return json(200, data || (ARRAY_KEYS.has(requestedKey) ? [] : {}));
    } catch (err) {
      return errorResponse(err);
    }
  }

  if (event.httpMethod === 'POST') {
    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch (e) {
      return { statusCode: 400, body: 'Invalid JSON body' };
    }
    if (ARRAY_KEYS.has(requestedKey)) {
      if (!Array.isArray(payload)) {
        return { statusCode: 400, body: 'Body must be a JSON array' };
      }
    } else if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { statusCode: 400, body: 'Body must be a JSON object' };
    }

    try {
      let toWrite = payload;
      if (requestedKey === 'actions') {
        // The order-action maps only ever grow (a drive thru, feedback or
        // pickup is never "un-sent"), so a write is merged into what's
        // stored instead of replacing it — a client that started with an
        // empty local copy (a wiped phone cache, a fresh browser) and
        // pushed before it had read the stored one used to overwrite the
        // box sizes and sent-flags with its near-empty version.
        const existing = await store.get(requestedKey, { type: 'json' }).catch(() => null);
        toWrite = mergeActions(existing, payload);
      }
      await store.setJSON(requestedKey, toWrite);
      return json(200, { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  }

  return { statusCode: 405, body: 'Method not allowed' };
});
