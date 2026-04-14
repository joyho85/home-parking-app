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

  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
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

  if (!res.ok) {
    const text = await res.text();
    console.error('LINE reply failed:', res.status, text);
  }
}

async function fetchLineProfile(userId, accessToken) {
  if (!userId || !accessToken) return null;
  const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}

function normalizeCode(text = '') {
  return String(text).trim().toUpperCase().replace(/\s+/g, '');
}

async function getAppState() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('伺服器尚未設定 Supabase 環境變數');
  }

  const url = `${SUPABASE_URL}/rest/v1/app_state?key=eq.home_parking&select=state`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`讀取 app_state 失敗: ${res.status} ${text}`);
  }

  const rows = await res.json();
  return rows?.[0]?.state || null;
}

async function updateAppState(state) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const url = `${SUPABASE_URL}/rest/v1/app_state?key=eq.home_parking`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ state, updated_at: new Date().toISOString() }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`更新 app_state 失敗: ${res.status} ${text}`);
  }

  return res.json();
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' }, corsHeaders());
  }

  const {
    LINE_CHANNEL_SECRET,
    LINE_CHANNEL_ACCESS_TOKEN,
  } = process.env;

  if (!LINE_CHANNEL_SECRET || !LINE_CHANNEL_ACCESS_TOKEN) {
    return json(500, { error: '伺服器尚未設定 LINE 環境變數' }, corsHeaders());
  }

  const rawBody = event.body || '';
  const signature = getSignature(event);

  if (!verifySignature(rawBody, signature, LINE_CHANNEL_SECRET)) {
    return json(401, { error: 'LINE 簽章驗證失敗' }, corsHeaders());
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json(400, { error: 'LINE webhook body JSON 格式錯誤' }, corsHeaders());
  }

  const events = Array.isArray(payload.events) ? payload.events : [];

  for (const ev of events) {
    const userId = ev.source?.userId || '';
    console.log('LINE webhook event:', JSON.stringify({
      type: ev.type,
      sourceType: ev.source?.type,
      userId,
      messageType: ev.message?.type || null,
      text: ev.message?.text || null,
      timestamp: ev.timestamp || null,
    }));

    if (ev.type === 'follow' && ev.replyToken) {
      await replyMessage(
        ev.replyToken,
        LINE_CHANNEL_ACCESS_TOKEN,
        '歡迎加入何家停車場通知服務。若你已拿到綁定碼，請直接把綁定碼傳給我，例如：PARK-ABC123。'
      );
      continue;
    }

    if (!(ev.type === 'message' && ev.message?.type === 'text' && ev.replyToken)) {
      continue;
    }

    const incomingText = String(ev.message.text || '').trim();
    const normalized = normalizeCode(incomingText);

    try {
      const appState = await getAppState();
      const tenants = Array.isArray(appState?.tenants) ? appState.tenants : [];
      const tenantIndex = tenants.findIndex(
        t => normalizeCode(t.lineBindingCode || '') === normalized
      );

      if (tenantIndex === -1) {
        await replyMessage(
          ev.replyToken,
          LINE_CHANNEL_ACCESS_TOKEN,
          '找不到這組綁定碼。請確認你傳的是停車場系統裡顯示的綁定碼，例如：PARK-ABC123。'
        );
        continue;
      }

      const profile = await fetchLineProfile(userId, LINE_CHANNEL_ACCESS_TOKEN);
      const tenant = tenants[tenantIndex];
      const updatedTenant = {
        ...tenant,
        lineUserId: userId,
        lineDisplayName: profile?.displayName || tenant.lineDisplayName || '',
        lineBoundAt: new Date().toISOString(),
        expiryReminderSentAt: '',
      };

      tenants[tenantIndex] = updatedTenant;
      await updateAppState({ ...appState, tenants });

      await replyMessage(
        ev.replyToken,
        LINE_CHANNEL_ACCESS_TOKEN,
        `綁定成功 ✅\n${updatedTenant.name}（車位 ${updatedTenant.spotNumber}）已完成 LINE 綁定。之後若租約進入到期前 7 天，系統會自動提醒你一次。`
      );
    } catch (err) {
      console.error('LINE binding failed:', err);
      await replyMessage(
        ev.replyToken,
        LINE_CHANNEL_ACCESS_TOKEN,
        '綁定時發生錯誤，請稍後再試一次，或聯絡停車場管理人。'
      );
    }
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(),
    },
    body: JSON.stringify({ ok: true }),
  };
};
