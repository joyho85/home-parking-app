
const { json, corsHeaders } = require('./_common');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }
  return json(
    200,
    { ok: true },
    {
      ...corsHeaders(),
      'Set-Cookie': 'parking_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    }
  );
};
