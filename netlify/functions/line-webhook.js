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
      messages: [
        {
          type: 'text',
          text: message,
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('LINE reply failed:', res.status, text);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' }, corsHeaders());
  }

  const { LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN } = process.env;
  if (!LINE_CHANNEL_SECRET) {
    return json(500, { error: '伺服器尚未設定 LINE_CHANNEL_SECRET' }, corsHeaders());
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
    console.log('LINE webhook event:', JSON.stringify({
      type: ev.type,
      sourceType: ev.source?.type,
      userId: ev.source?.userId || null,
      messageType: ev.message?.type || null,
      text: ev.message?.text || null,
      timestamp: ev.timestamp || null,
    }));

    if (
      ev.type === 'message' &&
      ev.message?.type === 'text' &&
      ev.replyToken &&
      LINE_CHANNEL_ACCESS_TOKEN
    ) {
      await replyMessage(
        ev.replyToken,
        LINE_CHANNEL_ACCESS_TOKEN,
        '已收到訊息。LINE webhook 測試成功，之後會再接上租戶綁定與到期提醒功能。'
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
