const { json, errorResponse } = require('./lib/http');
const { makeSessionCookie, makeSessionToken, getPassword, COOKIE_NAME, COOKIE_MAX_AGE_SECONDS } = require('./lib/site-auth');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (e) { /* falls through to the empty-password rejection below */ }

    const expected = getPassword();
    // Ignores stray spaces/newlines at either end — a password copied out of
    // the Netlify dashboard often carries one. Only this comparison is
    // lenient; sessions are still signed with the stored value as-is, so
    // nobody already logged in is signed out by this.
    const supplied = typeof body.password === 'string' ? body.password.trim() : '';
    if (!expected || supplied !== expected.trim()) {
      return json(401, { error: 'Incorrect password' });
    }

    // Both a Set-Cookie header AND the raw token in the body — the
    // frontend self-sets document.cookie from the latter, since that's
    // the one that actually works reliably (see lib/site-auth.js).
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Set-Cookie': makeSessionCookie(),
      },
      body: JSON.stringify({ ok: true, cookieName: COOKIE_NAME, token: makeSessionToken(), maxAge: COOKIE_MAX_AGE_SECONDS }),
    };
  } catch (err) {
    return errorResponse(err);
  }
};
