const crypto = require('crypto');
const { json } = require('./http');

// Netlify's own visitor-access-control (site-wide password gate) isn't
// available on this team's plan — confirmed by the API rejecting every
// variant (password, plain password, even the SSO-only option) with a
// 422. This is the app-level substitute: a shared secret (SITE_PASSWORD,
// a Netlify env var, never committed) gates every function below via
// requireAuth(), plus the frontend shows a password screen before
// rendering anything. Session state is a signed cookie, not a server-side
// session store — stateless, needs no database, and rotating
// SITE_PASSWORD invalidates every previously issued cookie for free,
// since the signature is over that same secret.
//
// Note: updating SITE_PASSWORD's value alone does not take effect on its
// own — Netlify Functions read env vars as they were at deploy time, not
// live per-request, so a fresh deploy (even with no code changes) is
// required afterward for a changed value to actually reach getPassword().
const COOKIE_NAME = 'bl_site_auth';
const AUTHORIZED_VALUE = 'authorized';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180; // ~180 days

function getPassword() {
  return process.env.SITE_PASSWORD || '';
}

function sign(value) {
  return crypto.createHmac('sha256', getPassword()).update(value).digest('hex');
}

function makeSessionCookie() {
  const token = AUTHORIZED_VALUE + '.' + sign(AUTHORIZED_VALUE);
  return COOKIE_NAME + '=' + encodeURIComponent(token)
    + '; Path=/; Max-Age=' + COOKIE_MAX_AGE_SECONDS + '; HttpOnly; Secure; SameSite=Lax';
}

function clearedSessionCookie() {
  return COOKIE_NAME + '=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax';
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const eq = part.indexOf('=');
    if (eq === -1) return;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  });
  return out;
}

function isAuthorized(event) {
  if (!getPassword()) return false; // fail safe if the env var isn't set yet
  const headers = event.headers || {};
  const cookieHeader = headers.cookie || headers.Cookie || '';
  const token = parseCookies(cookieHeader)[COOKIE_NAME] || '';
  const dot = token.lastIndexOf('.');
  if (dot === -1) return false;
  const value = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (value !== AUTHORIZED_VALUE) return false;
  const expected = sign(value);
  if (expected.length !== sig.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

// Wraps a function handler so every other endpoint stays a one-line
// change (`exports.handler = requireAuth(async (event) => {...})`)
// instead of repeating the same check inside each try block.
function requireAuth(handler) {
  return async (event, context) => {
    if (!isAuthorized(event)) return json(401, { error: 'Not authorized' });
    return handler(event, context);
  };
}

module.exports = { requireAuth, isAuthorized, makeSessionCookie, clearedSessionCookie, getPassword };
