const { getStore, getDeployStore } = require('@netlify/blobs');
const { json, errorResponse } = require('./lib/http');

const STORE_NAME = 'pick-state';
const STATE_KEY = 'state';

// Global store (survives every deploy) in production; a deploy-scoped store
// everywhere else, so a local test or preview deploy can't clobber real
// picking progress. This site's production context deploys straight from
// this branch, so real usage always hits the global store.
function getBlobStore() {
  return process.env.CONTEXT === 'production' ? getStore(STORE_NAME) : getDeployStore(STORE_NAME);
}

exports.handler = async (event) => {
  const store = getBlobStore();

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
