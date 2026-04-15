const { createClient } = require('@supabase/supabase-js');

const ALERT_DAYS = 7;

function getSupabase() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

async function push(userId, token, text) {
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to: userId,
      messages: [{ type: 'text', text }],
    }),
  });
}

exports.handler = async () => {
  const supabase = getSupabase();
  const { LINE_CHANNEL_ACCESS_TOKEN } = process.env;

  const { data } = await supabase
    .from('app_state')
    .select('state')
    .eq('key', 'home_parking')
    .maybeSingle();

  const state = data?.state || {};
  const tenants = state.tenants || [];
  const settings = state.settings || {};
  const admins = settings.lineAdminUsers || [];

  let notifyList = [];

  for (let t of tenants) {
    const days = daysUntil(t.contractEnd);

    if (
      t.tenantType !== 'family' &&
      days !== null &&
      days >= 0 &&
      days <= ALERT_DAYS &&
      !t.expiryReminderSentAt
    ) {
      notifyList.push({
        name: t.name,
        spot: t.spotNumber,
        date: t.contractEnd,
        days,
      });
    }
  }

  if (notifyList.length === 0) {
    return { statusCode: 200, body: 'no reminder' };
  }

  let message =
    '🚗 停車場到期提醒\n\n' +
    notifyList
      .map(
        t => `• ${t.name}（${t.spot}）\n  到期日：${t.date}（剩 ${t.days} 天）`
      )
      .join('\n\n');

  for (const admin of admins) {
    await push(admin.userId, LINE_CHANNEL_ACCESS_TOKEN, message);
  }

  // ✅ 標記已通知
  const updatedTenants = tenants.map(t => {
    const hit = notifyList.find(n => n.name === t.name);
    if (hit) {
      return { ...t, expiryReminderSentAt: new Date().toISOString() };
    }
    return t;
  });

  await supabase
    .from('app_state')
    .update({
      state: { ...state, tenants: updatedTenants },
    })
    .eq('key', 'home_parking');

  return {
    statusCode: 200,
    body: JSON.stringify({ sent: notifyList.length }),
  };
};