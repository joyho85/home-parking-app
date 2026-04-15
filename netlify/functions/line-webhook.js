const crypto = require('crypto');
const { json, corsHeaders } = require('./_common');

function getSignature(event) {
  return (
    event.headers['x-line-signature'] ||
    event.headers['X-Line-Signature'] ||
    event.headers['X-LINE-Signature'] ||
    ''
  );
}

function verifySignature(body, signature, channelSecret) {
  if (!body || !signature || !channelSecret) return false;

  const expected = crypto
    .createHmac('sha256', channelSecret)
    .update(body)
    .digest('base64');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function replyMessage(replyToken, accessToken, message) {
  if (!replyToken || !accessToken || !message) return;

  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text: message }],
    }),
  });
}

async function fetchLineProfile(userId, accessToken) {
  const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function getAppState() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/app_state?key=eq.home_parking&select=state`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );

  const rows = await res.json();
  return rows?.[0]?.state || {};
}

async function updateAppState(state) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

  await fetch(
    `${SUPABASE_URL}/rest/v1/app_state?key=eq.home_parking`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        state,
        updated_at: new Date().toISOString(),
      }),
    }
  );
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' }, corsHeaders());
  }

  const {
    LINE_CHANNEL_SECRET,
    LINE_CHANNEL_ACCESS_TOKEN,
  } = process.env;

  const rawBody = event.body || '';
  const signature = getSignature(event);

  if (!verifySignature(rawBody, signature, LINE_CHANNEL_SECRET)) {
    return json(401, { error: 'LINE 簽章驗證失敗' }, corsHeaders());
  }

  const payload = JSON.parse(rawBody);
  const events = payload.events || [];

  for (const ev of events) {
    const userId = ev.source?.userId;

    if (!(ev.type === 'message' && ev.message?.type === 'text')) {
      continue;
    }

    const text = ev.message.text.trim();

    // ✅ 管理員綁定
    if (text === 'ADMIN-BIND') {
      const state = await getAppState();
      const settings = state.settings || {};

      const profile = await fetchLineProfile(userId, LINE_CHANNEL_ACCESS_TOKEN);

      let admins = settings.lineAdminUsers || [];

      if (!admins.find(a => a.userId === userId)) {
        admins.push({
          userId,
          displayName: profile?.displayName || '',
          boundAt: new Date().toISOString(),
        });
      }

      await updateAppState({
        ...state,
        settings: {
          ...settings,
          lineAdminUsers: admins,
        },
      });

      await replyMessage(ev.replyToken, LINE_CHANNEL_ACCESS_TOKEN, '管理員綁定成功 ✅');
      continue;
    }

    // ✅ 管理員解除
    if (text === 'ADMIN-UNBIND') {
      const state = await getAppState();
      const settings = state.settings || {};

      let admins = settings.lineAdminUsers || [];
      admins = admins.filter(a => a.userId !== userId);

      await updateAppState({
        ...state,
        settings: {
          ...settings,
          lineAdminUsers: admins,
        },
      });

      await replyMessage(ev.replyToken, LINE_CHANNEL_ACCESS_TOKEN, '已取消通知 ❌');
      continue;
    }

    // ❗其他訊息不處理（讓聊天正常）
  }

  return {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify({ ok: true }),
  };
};