const { json, errorResponse } = require('./lib/http');
const { isAuthorized } = require('./lib/site-auth');

// Lets the frontend check "is my existing cookie still good?" on page
// load without needing a real API call (and its 401) as the trigger.
exports.handler = async (event) => {
  try {
    if (!isAuthorized(event)) return json(401, { error: 'Not authorized' });
    return json(200, { ok: true });
  } catch (err) {
    return errorResponse(err);
  }
};
