const { json, errorResponse } = require('./lib/http');
const { makeSessionCookie, makeSessionToken, getPassword, COOKIE_NAME, COOKIE_MAX_AGE_SECONDS } = require('./lib/site-auth');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (e) { /* falls through to the empty-password rejection below */ }

    const expected = getPassword();
    if (!expected || body.password !== expected) {
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
