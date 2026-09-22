const { getStore } = require('@netlify/blobs');
const { json, errorResponse } = require('./lib/http');

const STORE_NAME = 'pick-state';
const STATE_KEY = 'state';

// Always the global store: this site only ever runs one real deploy
// context (production, straight from this branch — confirmed via the
// deploy metadata), so there's no separate preview/staging usage to
// protect against here. An earlier version branched to getDeployStore()
// for "non-production", which crashed the function outright
// (MissingBlobsEnvironmentError, thrown synchronously outside any
// try/catch) because that mode needs deploy-scoped environment wiring
// this runtime doesn't provide — every write silently failed as a
// result, since the frontend's push is fire-and-forget.
exports.handler = async (event) => {
  let store;
  try {
    store = getStore(STORE_NAME);
  } catch (err) {
    return errorResponse(err);
  }

  if (event.httpMethod === 'GET') {
    try {
      const state = await store.get(STATE_KEY, { type: 'json' });
      return json(200, state || {});
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
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { statusCode: 400, body: 'Body must be a JSON object' };
    }

    try {
      await store.setJSON(STATE_KEY, payload);
      return json(200, { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  }

  return { statusCode: 405, body: 'Method not allowed' };
};
