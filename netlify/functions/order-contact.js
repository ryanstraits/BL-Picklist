const { blGet } = require('./lib/bricklink');
const { extractOrderContact } = require('./lib/order-contact');
const { json, errorResponse } = require('./lib/http');

function extractOrderId(event) {
  if (event.queryStringParameters && event.queryStringParameters.id) {
    return event.queryStringParameters.id;
  }
  const match = /\/orders\/([^/]+)\/contact/.exec(event.path || '');
  return match ? decodeURIComponent(match[1]) : null;
}

exports.handler = async (event) => {
  try {
    const orderId = extractOrderId(event);
    if (!orderId) return json(400, { error: 'Missing order id' });

    const order = await blGet(`/orders/${encodeURIComponent(orderId)}`);
    return json(200, extractOrderContact(order || {}));
  } catch (err) {
    return errorResponse(err);
  }
};
