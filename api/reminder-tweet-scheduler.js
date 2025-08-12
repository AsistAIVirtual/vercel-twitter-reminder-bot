// /api/reminder-tweet-scheduler.js
import { TwitterApi } from 'twitter-api-v2';

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

function upstash(path, init={}) {
  return fetch(`${KV_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      Accept: 'application/json',
      ...(init.headers||{}),
    },
  });
}

// CORS (isteğe bağlı)
function cors(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok:false, error:'Method Not Allowed' });

  if (!KV_URL || !KV_TOKEN) {
    return res.status(500).json({ ok:false, error:'Missing Upstash envs' });
  }

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

  // Twitter client (varsa)
  let tw = null;
  try {
    tw = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_KEY_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
    });
  } catch(e){
    // tweet atamazsak da taramayı yapalım
  }

  try {
    // 1) Tüm reminder anahtarlarını çek
    // Not: Upstash’ta doğru yol /keys/<pattern>
    const keysRes = await upstash(`/keys/reminder:*`);
    const keysJson = await keysRes.json().catch(() => null);
    const keys = Array.isArray(keysJson?.result) ? keysJson.result : [];
    stats.keysFetched = keys.length;

    // 2) Her anahtarı işle
    for (const key of keys) {
      try {
        const gRes = await upstash(`/get/${encodeURIComponent(key)}`);
        if (!gRes.ok) { stats.getErrors++; failures.push({ key, stage:'kv:get', status:gRes.status }); continue; }
        const gJson = await gRes.json().catch(() => (stats.parseErrors++, null));
        // Upstash iki şekilde dönebilir:
        // A) { result: { value: {...} } }
        // B) { result: {...} }
        const reminder = gJson?.result?.value ?? gJson?.result;
        if (!reminder || typeof reminder !== 'object') {
          stats.parseErrors++; failures.push({ key, stage:'parse', msg:'no reminder' }); continue;
        }
        stats.itemsLoaded++;

        // dueAt’i oku (ISO string ya da timestamp olabilir)
        let dueAtRaw = reminder.dueAt || reminder.remindDate; // backward-compat
        if (!dueAtRaw) { stats.parseErrors++; failures.push({ key, stage:'parse', msg:'no dueAt' }); continue; }

        const dueAtMs = typeof dueAtRaw === 'number'
          ? dueAtRaw
          : new Date(dueAtRaw).getTime();

        if (!Number.isFinite(dueAtMs)) { stats.parseErrors++; failures.push({ key, stage:'parse', msg:'bad dueAt', val: dueAtRaw }); continue; }

        const sent = !!reminder.sent;

        if (sent) { stats.skippedSent++; continue; }
        if (dueAtMs > now.getTime()) { stats.skippedFuture++; continue; }

        stats.dueNow++;

        // Tweet at
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
          reminder.sent = true;
          await upstash(`/set/${encodeURIComponent(key)}`, {
            method:'POST',
            headers:{ 'Content-Type':'application/json' },
            body: JSON.stringify({ value: reminder }),
          });
          stats.tweeted++;
        } catch(e) {
          failures.push({ key, stage:'tweet', msg: e?.data?.errors?.[0]?.message || e?.message || String(e) });
        }
      } catch(e){
        failures.push({ key, stage:'loop', msg: e?.message || String(e) });
      }
    }

    return res.status(200).json({ ok:true, processed: stats.tweeted, tweeted: stats.tweeted, stats, failures });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}
