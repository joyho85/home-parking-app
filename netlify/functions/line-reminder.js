const { createClient } = require('@supabase/supabase-js');

const ALERT_DAYS = 7;

function getSupabase() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('伺服器尚未設定 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.ceil((target - todayStart) / (1000 * 60 * 60 * 24));
}

function buildMessage(tenant, daysLeft) {
  return [
    '🚗 圳民停車場提醒',
    `您好，${tenant.name}（車位 ${tenant.spotNumber}）的租約將於 ${tenant.contractEnd} 到期。`,
    `目前距離到期還有 ${daysLeft} 天。`,
    '若需續租，請盡快與我們聯絡，謝謝 🙏',
  ].join('\n');
}

async function pushMessage(userId, accessToken, text) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      to: userId,
      messages: [{ type: 'text', text }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE push 失敗: ${res.status} ${body}`);
  }
}

async function loadState(supabase) {
  const { data, error } = await supabase
    .from('app_state')
    .select('state')
    .eq('key', 'home_parking')
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.state || null;
}

async function saveState(supabase, state) {
  const { error } = await supabase
    .from('app_state')
    .upsert(
      {
        key: 'home_parking',
        state,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );

  if (error) throw new Error(error.message);
}

exports.handler = async (event) => {
  const { LINE_CHANNEL_ACCESS_TOKEN } = process.env;

  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    return json(500, { error: '未設定 LINE_CHANNEL_ACCESS_TOKEN' });
  }

  try {
    const supabase = getSupabase();
    const appState = await loadState(supabase);
    const tenants = Array.isArray(appState?.tenants) ? appState.tenants : [];

    const results = [];
    const skipped = [];

    let matched = 0;
    let sent = 0;
    let checked = tenants.length;

    console.log(`🔥 line-reminder triggered, tenants=${checked}`);

    for (let i = 0; i < tenants.length; i++) {
      const tenant = tenants[i];
      const daysLeft = daysUntil(tenant.contractEnd);

      const shouldNotify =
        tenant.tenantType !== 'family' &&
        tenant.lineUserId &&
        tenant.contractEnd &&
        daysLeft !== null &&
        daysLeft >= 0 &&
        daysLeft <= ALERT_DAYS &&
        !tenant.expiryReminderSentAt;

      if (!shouldNotify) {
        skipped.push({
          name: tenant.name,
          reason:
            !tenant.lineUserId
              ? '未綁定 LINE'
              : tenant.tenantType === 'family'
              ? '家人自用'
              : tenant.expiryReminderSentAt
              ? '已通知過'
              : '不在7天內',
        });
        continue;
      }

      matched++;

      const message = buildMessage(tenant, daysLeft);

      try {
        await pushMessage(
          tenant.lineUserId,
          LINE_CHANNEL_ACCESS_TOKEN,
          message
        );

        tenants[i] = {
          ...tenant,
          expiryReminderSentAt: new Date().toISOString(),
        };

        sent++;

        results.push({
          name: tenant.name,
          sent: true,
        });
      } catch (err) {
        console.error('LINE 發送失敗:', err);
        results.push({
          name: tenant.name,
          sent: false,
          error: err.message,
        });
      }
    }

    if (appState) {
      await saveState(supabase, { ...appState, tenants });
    }

    console.log('matched:', matched);
    console.log('sent:', sent);
    console.log('skipped:', JSON.stringify(skipped, null, 2));
    console.log('results:', JSON.stringify(results, null, 2));

    return json(200, {
      ok: true,
      checked,
      matched,
      sent,
      skipped,
      results,
    });
  } catch (err) {
    console.error('❌ line-reminder failed:', err);
    return json(500, { error: err.message });
  }
};