function json(statusCode, data) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(data),
  };
}

function errorResponse(err) {
  console.error(err);
  const statusCode = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
  return json(statusCode, { error: err.message || 'Upstream error' });
}

module.exports = { json, errorResponse };
