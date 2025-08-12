import { TwitterApi } from 'twitter-api-v2';

const KV_REST_API_URL   = process.env.KV_REST_API_URL;
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;

function upstash(url, init = {}) {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${KV_REST_API_TOKEN}`,
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  });
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')   return res.status(405).json({ ok: false, error: 'Method Not Allowed' });

  const startedAt = new Date();
  const now = new Date();

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

  try {
    if (!KV_REST_API_URL || !KV_REST_API_TOKEN) {
      console.error('ENV MISSING', { KV_REST_API_URL: !!KV_REST_API_URL, KV_REST_API_TOKEN: !!KV_REST_API_TOKEN });
      return res.status(500).json({ ok: false, error: 'Missing Upstash envs' });
    }

    // 1) reminder:* anahtarlarını çek
    const keysRes = await upstash(`${KV_REST_API_URL}/keys/reminder:*`);
    const keysJson = await keysRes.json().catch(() => null);
    const keys = Array.isArray(keysJson?.result) ? keysJson.result : [];
    stats.keysFetched = keys.length;
    console.log('[scheduler] keys:', stats.keysFetched);

    if (!keys.length) {
      return res.status(200).json({ ok: true, processed: 0, stats, note: 'no reminder keys' });
    }

    // 2) Twitter client (varsa)
    let twitterClient = null;
    try {
      twitterClient = new TwitterApi({
        appKey:        process.env.TWITTER_API_KEY,
        appSecret:     process.env.TWITTER_API_KEY_SECRET,
        accessToken:   process.env.TWITTER_ACCESS_TOKEN,
        accessSecret:  process.env.TWITTER_ACCESS_TOKEN_SECRET,
      });
    } catch (e) {
      console.warn('[scheduler] Twitter client init failed (will still mark due, but cannot tweet):', e?.message || e);
    }

    // 3) Tüm anahtarları dolaş
    for (const key of keys) {
      try {
        const gRes = await upstash(`${KV_REST_API_URL}/get/${encodeURIComponent(key)}`);
        if (!gRes.ok) {
          stats.getErrors++;
          failures.push({ key, stage: 'kv:get', status: gRes.status });
          continue;
        }
        const gJson = await gRes.json().catch(() => (stats.parseErrors++, null));
        // Upstash GET formatı: { result: { value: {...} } } veya { result: {...} }
        const reminder = gJson?.result?.value ?? gJson?.result;
        if (!reminder) { stats.parseErrors++; failures.push({ key, stage: 'parse', msg: 'no reminder' }); continue; }

        stats.itemsLoaded++;

        // Alanları oku
        const sent   = !!reminder.sent;
        const dueStr = reminder.dueAt || reminder.remindDate; // backward-compat
        if (!dueStr) { failures.push({ key, stage: 'parse', msg: 'no dueAt' }); continue; }

        const dueAt = new Date(dueStr);
        if (isNaN(dueAt.getTime())) { failures.push({ key, stage: 'parse', msg: 'bad dueAt', dueStr }); continue; }

        console.log('[scheduler] check', { key, sent, dueAt: dueAt.toISOString(), now: now.toISOString() });

        if (sent) { stats.skippedSent++; continue; }
        if (dueAt.getTime() > now.getTime()) { stats.skippedFuture++; continue; }

        // Zamanı gelmiş
        stats.dueNow++;

        if (!twitterClient) {
          // Tweet atamıyorsak bile en azından sent=true işaretlemeyelim; tekrar dener.
          failures.push({ key, stage: 'tweet', msg: 'twitter client not initialized' });
          continue;
        }

        const uname = String(reminder.twitterUsername || '').replace(/^@/, '');
        const token = reminder.token || reminder.tokenName || 'TOKEN';
        const days  = reminder.remindInDays ?? '?';

        const text =
          `Hey @${uname}, reminder time!\n` +
          `${days} days before unlock for ${token}.`;

        try {
          await twitterClient.v2.tweet(text);
          // sent = true
          reminder.sent = true;
          await upstash(`${KV_REST_API_URL}/set/${encodeURIComponent(key)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: reminder }),
          });
          stats.tweeted++;
          console.log('[scheduler] tweeted', { key });
        } catch (e) {
          failures.push({ key, stage: 'tweet', msg: e?.data?.detail || e?.message || String(e) });
          console.error('[scheduler] tweet fail', { key, err: e?.message || e });
        }
      } catch (e) {
        failures.push({ key, stage: 'loop', msg: e?.message || String(e) });
        console.error('[scheduler] loop error', { key, err: e?.message || e });
      }
    }

    const elapsedMs = Date.now() - startedAt.getTime();
    return res.status(200).json({
      ok: true,
      processed: stats.tweeted,
      stats,
      failures: failures.slice(0, 10), // ilk 10 hatayı döndür
      elapsedMs,
    });
  } catch (e) {
    console.error('[scheduler] crash', e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
