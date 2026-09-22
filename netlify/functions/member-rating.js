const { blGet } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');

exports.handler = async (event) => {
  try {
    const username = event.queryStringParameters && event.queryStringParameters.username;
    if (!username) return json(400, { error: 'Missing username' });

    const rating = await blGet(`/members/${encodeURIComponent(username)}/ratings`);
    return json(200, rating || {});
  } catch (err) {
    return errorResponse(err);
  }
};
