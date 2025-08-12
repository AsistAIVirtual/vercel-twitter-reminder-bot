import { TwitterApi } from 'twitter-api-v2';

const client = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_KEY_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});

const KV_REST_API_URL = process.env.KV_REST_API_URL;
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;

async function kvJson(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${KV_REST_API_TOKEN}`,
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, json };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });

  try {
    const now = new Date();

    // 1) reminder:* anahtarlarını al
    const { ok: keysOk, json: keysJson } = await kvJson(`${KV_REST_API_URL}/keys/reminder:*`);
    if (!keysOk || !Array.isArray(keysJson?.result)) {
      return res.status(200).json({ ok: true, processed: 0, note: 'no keys' });
    }

    let processed = 0;

    for (const key of keysJson.result) {
      // 2) reminder objesini çek
      const { ok: getOk, json: getJson } = await kvJson(`${KV_REST_API_URL}/get/${encodeURIComponent(key)}`);
      if (!getOk) continue;

      // Upstash GET formatı: { result: { value: {...} } }  (bazı eski kayıtlarda {result:{...}} olabilir)
      const reminder = getJson?.result?.value ?? getJson?.result;
      if (!reminder) continue;

      // 3) dueAt (yeni) ya da remindDate (eski) alanını oku
      const dueStr = reminder.dueAt || reminder.remindDate; // ISO string bekliyoruz
      if (!dueStr) continue;

      const dueAt = new Date(dueStr);
      if (isNaN(dueAt.getTime())) continue;
      if (reminder.sent) continue;                 // zaten gönderilmişse geç
      if (dueAt.getTime() > now.getTime()) continue; // zamanı gelmemişse geç

      // 4) tweet metni
      const uname = String(reminder.twitterUsername || '').replace(/^@/, '');
      const token = reminder.token || reminder.tokenName || 'TOKEN';
      const days  = reminder.remindInDays ?? '?';

      const text =
        `Hey @${uname}, reminder time!\n` +
        `${days} days before unlock for ${token}.`;

      try {
        await client.v2.tweet(text);

        // 5) sent=true işaretle (ya da istersen tamamen sil)
        reminder.sent = true;
        await fetch(`${KV_REST_API_URL}/set/${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${KV_REST_API_TOKEN}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ value: reminder }),
        });

        processed++;
      } catch (e) {
        // yazma izni vb. sorunlarda düşmesin
        console.error('tweet fail:', key, e?.message || e);
      }
    }

    return res.status(200).json({ ok: true, processed });
  } catch (e) {
    console.error('scheduler crash:', e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
