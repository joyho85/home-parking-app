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

// ✅ 判斷是不是綁定碼（關鍵！！）
function isBindingCode(text) {
  return /^PARK-[A-Z0-9]+$/.test(text);
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
  return rows?.[0]?.state || null;
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
    const userId = ev.source?.userId || '';

    // 👉 加好友
    if (ev.type === 'follow' && ev.replyToken) {
      await replyMessage(
        ev.replyToken,
        LINE_CHANNEL_ACCESS_TOKEN,
        '歡迎加入圳民停車場通知服務！請輸入綁定碼，例如：PARK-ABC123'
      );
      continue;
    }

    // 👉 只處理文字訊息
    if (!(ev.type === 'message' && ev.message?.type === 'text')) {
      continue;
    }

    const text = ev.message.text.trim();

    // ❗❗重點：不是綁定碼 → 完全不回 ❗❗
    if (!isBindingCode(text)) {
      continue;
    }

    try {
      const appState = await getAppState();
      const tenants = appState?.tenants || [];

      const index = tenants.findIndex(
        t => normalizeCode(t.lineBindingCode) === normalizeCode(text)
      );

      if (index === -1) {
        await replyMessage(
          ev.replyToken,
          LINE_CHANNEL_ACCESS_TOKEN,
          '找不到這組綁定碼，請確認是否正確'
        );
        continue;
      }

      const profile = await fetchLineProfile(userId, LINE_CHANNEL_ACCESS_TOKEN);
      const tenant = tenants[index];

      const updatedTenant = {
        ...tenant,
        lineUserId: userId,
        lineDisplayName: profile?.displayName || '',
        lineBoundAt: new Date().toISOString(),
        expiryReminderSentAt: '',
      };

      tenants[index] = updatedTenant;
      await updateAppState({ ...appState, tenants });

      await replyMessage(
        ev.replyToken,
        LINE_CHANNEL_ACCESS_TOKEN,
        `綁定成功 ✅\n${updatedTenant.name}（車位 ${updatedTenant.spotNumber}）已完成 LINE 綁定`
      );
    } catch (err) {
      console.error(err);
      await replyMessage(
        ev.replyToken,
        LINE_CHANNEL_ACCESS_TOKEN,
        '系統錯誤，請稍後再試'
      );
    }
  }

  return {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify({ ok: true }),
  };
};