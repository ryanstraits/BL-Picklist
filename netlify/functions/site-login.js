const { json, errorResponse } = require('./lib/http');
const { makeSessionCookie, getPassword } = require('./lib/site-auth');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (e) { /* falls through to the empty-password rejection below */ }

    const expected = getPassword();
    if (!expected || body.password !== expected) {
      return json(401, { error: 'Incorrect password' });
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Set-Cookie': makeSessionCookie(),
      },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    return errorResponse(err);
  }
};
