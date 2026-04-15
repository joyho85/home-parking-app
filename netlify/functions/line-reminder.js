const { createClient } = require('@supabase/supabase-js');

const ALERT_DAYS = 7;
const APP_STATE_KEY = 'home_parking';

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

function getSupabase() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('伺服器尚未設定 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.ceil((target - todayStart) / (1000 * 60 * 60 * 24));
}

function buildAdminMessage(matchedTenants) {
  const header = [
    '何家停車場提醒',
    `以下共有 ${matchedTenants.length} 位租戶已進入到期前 7 天，請主動聯絡處理：`,
    '',
  ];

  const lines = matchedTenants.map((tenant) => {
    const daysLeft = daysUntil(tenant.contractEnd);
    return `• ${tenant.name}｜車位 ${tenant.spotNumber}｜到期日 ${tenant.contractEnd}｜剩 ${daysLeft} 天`;
  });

  return [...header, ...lines].join('\n');
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
    .eq('key', APP_STATE_KEY)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.state || null;
}

async function saveState(supabase, state) {
  const { error } = await supabase
    .from('app_state')
    .upsert(
      {
        key: APP_STATE_KEY,
        state,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );

  if (error) throw new Error(error.message);
}

exports.handler = async () => {
  const { LINE_CHANNEL_ACCESS_TOKEN, LINE_ADMIN_USER_ID } = process.env;

  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    return json(500, { error: '未設定 LINE_CHANNEL_ACCESS_TOKEN' });
  }

  try {
    const supabase = getSupabase();
    const appState = await loadState(supabase);
    if (!appState) {
      return json(404, { error: '找不到 app_state' });
    }

    const settings = appState.settings || {};
    const adminUserId = settings.lineAdminUserId || LINE_ADMIN_USER_ID || '';
    if (!adminUserId) {
      return json(400, { error: '尚未綁定管理員 LINE，請先用管理員 LINE 傳送 ADMIN-BIND 給官方帳號。' });
    }

    const tenants = Array.isArray(appState.tenants) ? appState.tenants : [];
    const matchedTenants = [];
    const skipped = [];

    for (let i = 0; i < tenants.length; i += 1) {
      const tenant = tenants[i];
      const daysLeft = daysUntil(tenant.contractEnd);

      const shouldNotify =
        tenant.tenantType !== 'family' &&
        tenant.contractEnd &&
        daysLeft !== null &&
        daysLeft >= 0 &&
        daysLeft <= ALERT_DAYS &&
        !tenant.expiryReminderSentAt;

      if (!shouldNotify) {
        skipped.push({
          name: tenant.name,
          spotNumber: tenant.spotNumber,
          reason: tenant.tenantType === 'family'
            ? '家人自用不通知'
            : tenant.expiryReminderSentAt
              ? '已通知過'
              : '不在 7 天內',
        });
        continue;
      }

      matchedTenants.push({ ...tenant });
      tenants[i] = {
        ...tenant,
        expiryReminderSentAt: new Date().toISOString(),
      };
    }

    console.log(`line-reminder triggered, checked=${tenants.length}, matched=${matchedTenants.length}`);

    if (!matchedTenants.length) {
      return json(200, {
        ok: true,
        checked: tenants.length,
        matched: 0,
        sent: 0,
        skipped,
        results: [],
        message: '目前沒有符合 7 天內提醒條件的租戶。',
      });
    }

    const message = buildAdminMessage(matchedTenants);
    await pushMessage(adminUserId, LINE_CHANNEL_ACCESS_TOKEN, message);
    await saveState(supabase, { ...appState, tenants });

    const results = matchedTenants.map((tenant) => ({
      name: tenant.name,
      spotNumber: tenant.spotNumber,
      contractEnd: tenant.contractEnd,
      sent: true,
    }));

    console.log('line-reminder finished:', JSON.stringify(results, null, 2));

    return json(200, {
      ok: true,
      checked: tenants.length,
      matched: matchedTenants.length,
      sent: 1,
      skipped,
      results,
      message: `已發送 1 則管理員提醒，內含 ${matchedTenants.length} 位 7 天內到期租戶。`,
    });
  } catch (err) {
    console.error('line-reminder failed:', err);
    return json(500, { error: err.message || '提醒執行失敗' });
  }
};
