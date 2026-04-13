
const crypto = require('crypto');

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

function getCookie(event, name) {
  const raw = event.headers.cookie || event.headers.Cookie || '';
  const parts = raw.split(';').map(x => x.trim());
  for (const part of parts) {
    const [k, ...rest] = part.split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function createSessionToken(username, secret) {
  const payload = JSON.stringify({
    username,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 30,
  });
  const encoded = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifySessionToken(token, secret) {
  if (!token || !secret) return null;
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function requireSession(event) {
  const secret = process.env.SESSION_SECRET;
  const token = getCookie(event, 'parking_session');
  const payload = verifySessionToken(token, secret);
  if (!payload) {
    return { ok: false, response: json(401, { error: '尚未登入或登入已過期' }) };
  }
  return { ok: true, payload };
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  };
}

module.exports = { json, getCookie, createSessionToken, verifySessionToken, requireSession, corsHeaders };
