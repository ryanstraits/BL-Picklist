const { blGet } = require('./lib/bricklink');
const { json, errorResponse } = require('./lib/http');

const DEFAULT_STATUS = 'pending,processing';

exports.handler = async (event) => {
  try {
    const status = (event.queryStringParameters && event.queryStringParameters.status) || DEFAULT_STATUS;
    const data = await blGet(`/orders?direction=out&status=${encodeURIComponent(status)}`);

    const orders = (data || []).map((o) => ({
      orderId: String(o.order_id),
      status: o.status,
      buyer: o.buyer_name,
      date: o.date_ordered,
      totalCount: o.total_count,
      uniqueCount: o.unique_count,
    }));

    return json(200, orders);
  } catch (err) {
    return errorResponse(err);
  }
};
