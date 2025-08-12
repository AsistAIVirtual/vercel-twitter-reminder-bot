// pages/api/reminder-tweet-scheduler.js
import { TwitterApi } from 'twitter-api-v2';

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
function upstash(path, init = {}) {
  return fetch(`${KV_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  });
}

// GET çıktısını objeye çevirir (A/B/C/D varyasyonları)
function extractReminder(getJson) {
  let raw = getJson?.result;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch {} }
  let val = raw?.value ?? raw;
  if (typeof val === 'string') { try { val = JSON.parse(val); } catch {} }
  return val && typeof val === 'object' ? val : null;
}

function toMs(dueAtRaw) {
  if (typeof dueAtRaw === 'number') return dueAtRaw;
  const t = new Date(dueAtRaw).getTime();
  return Number.isFinite(t) ? t : NaN;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });

  if (!KV_URL || !KV_TOKEN) {
    return res.status(500).json({ ok: false, error: 'Missing Upstash envs' });
  }

  const now = Date.now();
  const stats = {
    keysFetched: 0,
    itemsLoaded: 0,
    dueNow: 0,
    tweeted: 0,
    skippedSent: 0,
    skippedFuture: 0,
    parseErrors: 0,
    getErrors: 0,
  };
  const failures = [];

  // Twitter client (varsa)
  let tw = null;
  try {
    tw = new TwitterApi({
      appKey:    process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_KEY_SECRET,
      accessToken:  process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
    });
  } catch (_) {}

  try {
    // 1) reminder:* keys
    const keysRes = await upstash(`/keys/reminder:*`);
    const keysJson = await keysRes.json().catch(() => null);
    const keys = Array.isArray(keysJson?.result) ? keysJson.result : [];
    stats.keysFetched = keys.length;

    // 2) loop
    for (const key of keys) {
      try {
        const gRes = await upstash(`/get/${encodeURIComponent(key)}`);
        if (!gRes.ok) { stats.getErrors++; failures.push({ key, stage: 'kv:get', status: gRes.status }); continue; }

        const gJson = await gRes.json().catch(() => (stats.parseErrors++, null));
        const reminder = extractReminder(gJson);
        if (!reminder) { stats.parseErrors++; failures.push({ key, stage: 'parse', msg: 'no reminder' }); continue; }
        stats.itemsLoaded++;

        const sent = !!reminder.sent;
        const dueAtMs = toMs(reminder.dueAt || reminder.remindDate);
        if (!Number.isFinite(dueAtMs)) { stats.parseErrors++; failures.push({ key, stage:'parse', msg:'bad dueAt' }); continue; }

        if (sent)       { stats.skippedSent++;   continue; }
        if (dueAtMs > now) { stats.skippedFuture++; continue; }

        stats.dueNow++;

        if (!tw) { failures.push({ key, stage:'tweet', msg:'twitter client not ready' }); continue; }

        const uname = String(reminder.twitterUsername || '').replace(/^@/,'');
        const tok   = reminder.token || reminder.tokenName || 'TOKEN';
        const days  = reminder.remindInDays ?? '?';

        const text =
          `Hey @${uname}, reminder time!\n` +
          `${days} days before unlock for ${tok}.`;

        try {
          await tw.v2.tweet(text);

          // sent:true yaz
          const updated = { ...reminder, sent: true };
          await upstash(`/set/${encodeURIComponent(key)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: updated }),
          });

          stats.tweeted++;
        } catch (e) {
          failures.push({ key, stage:'tweet', msg: e?.data?.errors?.[0]?.message || e?.message || String(e) });
        }
      } catch (e) {
        failures.push({ key, stage:'loop', msg: e?.message || String(e) });
      }
    }

    return res.status(200).json({
      ok: true,
      processed: stats.tweeted,
      tweeted: stats.tweeted,
      stats,
      failures,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
