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
    '何家停車場提醒',
    `您好，${tenant.name}（車位 ${tenant.spotNumber}）的租約將於 ${tenant.contractEnd} 到期。`,
    `目前距離到期還有 ${daysLeft} 天。`,
    '若需續租，請盡快與我們聯絡，謝謝。',
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
    .select('state, updated_at')
    .eq('key_name', 'home_parking')
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.state || null;
}

async function saveState(supabase, state) {
  const { error } = await supabase
    .from('app_state')
    .upsert(
      {
        key_name: 'home_parking',
        state,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key_name' }
    );

  if (error) throw new Error(error.message);
}

exports.handler = async (event) => {
  const { LINE_CHANNEL_ACCESS_TOKEN } = process.env;
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    return json(500, { error: '伺服器尚未設定 LINE_CHANNEL_ACCESS_TOKEN' });
  }

  let dryRun = false;

  try {
    if (event.httpMethod === 'GET' && event.queryStringParameters?.dryRun === '1') {
      dryRun = true;
    }

    if (event.httpMethod === 'POST' && event.body) {
      try {
        const body = JSON.parse(event.body || '{}');
        dryRun = Boolean(body.dryRun);
      } catch {
        return json(400, { error: 'JSON 格式錯誤' });
      }
    }

    const supabase = getSupabase();
    const appState = await loadState(supabase);
    const tenants = Array.isArray(appState?.tenants) ? appState.tenants : [];

    const results = [];
    const skipped = [];
    let matched = 0;
    let checked = tenants.length;
    let sent = 0;

    console.log(`line-reminder triggered, tenants=${checked}, dryRun=${dryRun}`);

    for (let i = 0; i < tenants.length; i += 1) {
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
          spotNumber: tenant.spotNumber,
          reason: !tenant.lineUserId
            ? '未綁定 LINE'
            : tenant.tenantType === 'family'
              ? '家人自用不通知'
              : tenant.expiryReminderSentAt
                ? '已通知過'
                : '不在 7 天內',
        });
        continue;
      }

      matched += 1;
      const message = buildMessage(tenant, daysLeft);

      if (dryRun) {
        results.push({
          name: tenant.name,
          spotNumber: tenant.spotNumber,
          daysLeft,
          sent: false,
          dryRun: true,
          message,
        });
        continue;
      }

      await pushMessage(tenant.lineUserId, LINE_CHANNEL_ACCESS_TOKEN, message);

      tenants[i] = {
        ...tenant,
        expiryReminderSentAt: new Date().toISOString(),
      };

      sent += 1;
      results.push({
        name: tenant.name,
        spotNumber: tenant.spotNumber,
        daysLeft,
        sent: true,
      });
    }

    if (!dryRun && appState) {
      await saveState(supabase, { ...appState, tenants });
    }

    console.log(`line-reminder finished, matched=${matched}, sent=${sent}`);

    return json(200, {
      ok: true,
      checked,
      matched,
      sent,
      skipped,
      results,
      dryRun,
      message: dryRun
        ? `預覽完成，共 ${matched} 位符合 7 天內提醒條件。`
        : `提醒檢查完成，共發送 ${sent} 則 LINE 通知。`,
    });
  } catch (err) {
    console.error('line-reminder failed:', err);
    return json(500, { error: err.message || '提醒執行失敗' });
  }
};