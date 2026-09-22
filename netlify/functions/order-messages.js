const { blGet } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');

function extractOrderId(event) {
  if (event.queryStringParameters && event.queryStringParameters.id) {
    return event.queryStringParameters.id;
  }
  const match = /\/orders\/([^/]+)\/messages/.exec(event.path || '');
  return match ? decodeURIComponent(match[1]) : null;
}

exports.handler = async (event) => {
  try {
    const orderId = extractOrderId(event);
    if (!orderId) return json(400, { error: 'Missing order id' });

    const messages = await blGet(`/orders/${encodeURIComponent(orderId)}/messages`);

    const mapped = (messages || []).map((m) => ({
      subject: m.subject,
      body: m.body,
      from: m.from,
      to: m.to,
      dateSent: m.dateSent,
    }));

    return json(200, mapped);
  } catch (err) {
    return errorResponse(err);
  }
};
