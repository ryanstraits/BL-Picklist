const { getStore, connectLambda } = require('@netlify/blobs');
const { json, errorResponse } = require('./lib/http');

const STORE_NAME = 'pick-state';
const DEFAULT_KEY = 'state';
// Which blob key to read/write — 'state' (picks, the default, for
// backward compatibility with existing callers) or 'actions'
// (driveThruSent/feedbackSent). Same store, same GET/POST shape, just a
// different named slot, so this one small function covers both instead
// of duplicating the whole Blobs-wiring dance a second time.
const ALLOWED_KEYS = new Set(['state', 'actions']);

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
exports.handler = async (event) => {
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
      return json(200, data || {});
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
      await store.setJSON(requestedKey, payload);
      return json(200, { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  }

  return { statusCode: 405, body: 'Method not allowed' };
};
