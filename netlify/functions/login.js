
const { json, createSessionToken, corsHeaders } = require('./_common');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' }, corsHeaders());
  }

  const { APP_USERNAME, APP_PASSWORD, SESSION_SECRET } = process.env;
  if (!APP_USERNAME || !APP_PASSWORD || !SESSION_SECRET) {
    return json(500, { error: '伺服器尚未設定 APP_USERNAME / APP_PASSWORD / SESSION_SECRET' }, corsHeaders());
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'JSON 格式錯誤' }, corsHeaders());
  }

  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  if (username !== APP_USERNAME || password !== APP_PASSWORD) {
    return json(401, { error: '帳號或密碼錯誤' }, corsHeaders());
  }

  const token = createSessionToken(username, SESSION_SECRET);
  return json(
    200,
    { ok: true, username },
    {
      ...corsHeaders(),
      'Set-Cookie': `parking_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`,
    }
  );
};
