// pages/api/subscribe-tweet.js
import { TwitterApi } from 'twitter-api-v2';

/* ------------ CORS ------------ */
function cors(res) {
  // production'da istersen domainlerini yaz: https://virgenscan.org, https://www.virgenscan.org
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/* ------------ Upstash helpers ------------ */
const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

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

// Upstash GET normalizer (objeyi her durumda döndürür)
async function kvGetObj(key) {
  const r = await upstash(`/get/${encodeURIComponent(key)}`);
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  let raw = j?.result;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch {} }
  let val = raw?.value ?? raw;
  if (typeof val === 'string') { try { val = JSON.parse(val); } catch {} }
  return val && typeof val === 'object' ? val : null;
}

async function kvSetObj(key, value) {
  const r = await upstash(`/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`KV set failed (${r.status}): ${t}`);
  }
}

/* ------------ Twitter client (optional) ------------ */
function getTwitterClient() {
  const { TWITTER_API_KEY, TWITTER_API_KEY_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET } = process.env;
  if (!TWITTER_API_KEY || !TWITTER_API_KEY_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_TOKEN_SECRET) {
    return null;
  }
  return new TwitterApi({
    appKey: TWITTER_API_KEY,
    appSecret: TWITTER_API_KEY_SECRET,
    accessToken: TWITTER_ACCESS_TOKEN,
    accessSecret: TWITTER_ACCESS_TOKEN_SECRET,
  });
}

/* ------------ Handler ------------ */
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ ok: false, error: 'Method Not Allowed' });

  try {
    if (!KV_URL || !KV_TOKEN) {
      return res.status(500).json({ ok: false, error: 'Missing Upstash envs' });
    }

    // Body parse & validation
    const raw = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    let { wallet, twitterUsername, token, remindInDays, stakeAmount, dueAt } = raw;

    wallet = String(wallet || '').trim();
    twitterUsername = String(twitterUsername || '').replace(/^@/, '').trim();
    token = String(token || '').trim();
    const remind = Number(remindInDays);
    const stake  = Number(stakeAmount || 0);

    if (!wallet || !twitterUsername || !token || !Number.isFinite(remind)) {
      return res.status(400).json({ ok: false, error: 'Missing fields: wallet, twitterUsername, token, remindInDays' });
    }
    if (!dueAt) {
      return res.status(400).json({ ok: false, error: 'Missing field: dueAt (ISO datetime)' });
    }
    const due = new Date(dueAt);
    if (isNaN(due.getTime())) {
      return res.status(400).json({ ok: false, error: 'Invalid dueAt (must be ISO datetime string)' });
    }

    // Rights by stake: <100k => 1, >=100k => 3
    const rights = stake >= 100000 ? 3 : 1;

    // ---- LIMIT CHECK ---- (count unsent reminders for this wallet)
    const listRes = await upstash(`/keys/reminder:${wallet}:*`);
    const listJson = await listRes.json().catch(() => null);
    const keys = Array.isArray(listJson?.result) ? listJson.result : [];

    let activeCount = 0;
    for (const k of keys) {
      const obj = await kvGetObj(k);
      if (obj && obj.wallet === wallet && obj.sent !== true) activeCount++;
    }

    if (activeCount >= rights) {
      return res.status(200).json({
        ok: false,
        error: 'limit_reached',
        message: `You've reached your reminder limit (${rights} max).`,
        rights,
        activeCount,
      });
    }

    // ---- Create KV record ----
    const id = `${wallet}:${Date.now()}`;
    const kvKey = `reminder:${id}`;
    const value = {
      id,
      wallet,
      twitterUsername,
      token,
      remindInDays: remind,
      stakeAmount: stake,
      dueAt: due.toISOString(),
      sent: false,
    };

    await kvSetObj(kvKey, value);

    // ---- Optional confirmation tweet (unique ref to avoid duplicate 403) ----
    let tweeted = null;
    try {
      const client = getTwitterClient();
      if (client) {
        const ref = id.slice(-6);
        const text =
          `Hey @${twitterUsername}, your reminder has been recorded.\n` +
          `You'll be notified ${remind} days before unlock for ${token}. (Slots: ${rights})\n` +
          `Ref:${ref}`;
        const tw = await client.v2.tweet(text);
        tweeted = tw?.data?.id || null;
      }
    } catch (e) {
      console.warn('tweet confirm failed:', e?.data?.errors?.[0]?.message || e?.message || String(e));
    }

    return res.status(200).json({
      ok: true,
      id,
      kvKey,
      tweeted,
      rights,
      activeCount: activeCount + 1, // after creation
    });
  } catch (err) {
    console.error('[subscribe] error', err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
