
const { createClient } = require('@supabase/supabase-js');
const { json, requireSession, corsHeaders } = require('./_common');

function getSupabase() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('伺服器尚未設定 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  const auth = requireSession(event);
  if (!auth.ok) {
    return { ...auth.response, headers: { ...(auth.response.headers || {}), ...corsHeaders() } };
  }

  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    return json(500, { error: err.message }, corsHeaders());
  }

  const stateKey = 'home_parking';

  if (event.httpMethod === 'GET') {
    const { data, error } = await supabase
      .from('app_state')
      .select('state, updated_at')
      .eq('key', stateKey)
      .maybeSingle();

    if (error) {
      return json(500, { error: error.message }, corsHeaders());
    }

    return json(200, { state: data?.state || null, updated_at: data?.updated_at || null }, corsHeaders());
  }

  if (event.httpMethod === 'POST') {
    let body = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return json(400, { error: 'JSON 格式錯誤' }, corsHeaders());
    }

    if (!body.state || typeof body.state !== 'object') {
      return json(400, { error: '缺少 state 物件' }, corsHeaders());
    }

    const { error } = await supabase
      .from('app_state')
      .upsert(
        {
          key: stateKey,
          state: body.state,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      );

    if (error) {
      return json(500, { error: error.message }, corsHeaders());
    }

    return json(200, { ok: true }, corsHeaders());
  }

  return json(405, { error: 'Method not allowed' }, corsHeaders());
};
