
const { json, requireSession, corsHeaders } = require('./_common');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }
  const result = requireSession(event);
  if (!result.ok) {
    return json(200, { authenticated: false }, corsHeaders());
  }
  return json(200, { authenticated: true, username: result.payload.username }, corsHeaders());
};
