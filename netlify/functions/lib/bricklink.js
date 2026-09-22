const crypto = require('crypto');
const OAuth = require('oauth-1.0a');

const API_BASE = 'https://api.bricklink.com/api/store/v1';

const REQUIRED_ENV_VARS = ['BL_CONSUMER_KEY', 'BL_CONSUMER_SECRET', 'BL_TOKEN', 'BL_TOKEN_SECRET'];

function getOAuthClient() {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length) {
    const err = new Error(`Missing BrickLink credentials in environment: ${missing.join(', ')}`);
    err.status = 500;
    throw err;
  }

  return OAuth({
    consumer: { key: process.env.BL_CONSUMER_KEY, secret: process.env.BL_CONSUMER_SECRET },
    signature_method: 'HMAC-SHA1',
    hash_function(baseString, key) {
      return crypto.createHmac('sha1', key).update(baseString).digest('base64');
    },
  });
}

// Signs and issues a request against the BrickLink Store API and returns
// the parsed `data` payload, throwing on transport or API errors. `payload`
// (if given) is sent as a raw JSON body — OAuth 1.0a only signs the method
// and URL here, not the body, matching how blGet's signing already works.
async function blRequest(method, path, payload) {
  const oauth = getOAuthClient();
  const token = { key: process.env.BL_TOKEN, secret: process.env.BL_TOKEN_SECRET };
  const url = `${API_BASE}${path}`;

  const headers = oauth.toHeader(oauth.authorize({ url, method }, token));
  const options = { method, headers };
  if (payload !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(payload);
  }

  const res = await fetch(url, options);

  let body;
  try {
    body = await res.json();
  } catch (e) {
    body = null;
  }

  const meta = body && body.meta;
  if (!res.ok || (meta && meta.code >= 300)) {
    const message = (meta && meta.message) || `BrickLink API request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status >= 400 ? res.status : 502;
    err.blMeta = meta;
    throw err;
  }

  return body && body.data;
}

function blGet(path) {
  return blRequest('GET', path);
}

function blPut(path, payload) {
  return blRequest('PUT', path, payload);
}

function blPost(path, payload) {
  return blRequest('POST', path, payload);
}

module.exports = { blGet, blPut, blPost };
