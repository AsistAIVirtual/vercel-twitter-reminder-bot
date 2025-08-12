// /api/subscribe-tweet.js
import { TwitterApi } from 'twitter-api-v2';

export default async function handler(req, res) {
  // CORS / preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const {
      KV_REST_API_URL,
      KV_REST_API_TOKEN,
      TWITTER_API_KEY,
      TWITTER_API_KEY_SECRET,
      TWITTER_ACCESS_TOKEN,
      TWITTER_ACCESS_TOKEN_SECRET,
    } = process.env;

    for (const [k, v] of Object.entries({ KV_REST_API_URL, KV_REST_API_TOKEN })) {
      if (!v) return res.status(500).json({ ok: false, stage: 'env', error: `Missing env: ${k}` });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { wallet, twitterUsername, token, remindInDays, stakeAmount, dueAt } = body || {};

    // DİKKAT: dueAt zorunlu
    if (!wallet || !twitterUsername || !token || remindInDays == null || !dueAt) {
      return res.status(400).json({ ok: false, stage: 'body', error: 'Missing body fields (need wallet, twitterUsername, token, remindInDays, dueAt)' });
    }

    // Kaydedilecek obje
    const id = `${wallet}:${Date.now()}`;
    const kvKey = `reminder:${id}`;
    const value = {
      id,
      wallet,
      twitterUsername,
      token,
      remindInDays,
      stakeAmount: Number(stakeAmount || 0),
      dueAt,            // <<<< ZORUNLU ALAN
      sent: false       // cron tweet attıktan sonra true yapılır
    };

    // Upstash KV'ye yaz
    const saveRes = await fetch(`${KV_REST_API_URL}/set/${encodeURIComponent(kvKey)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ value }),
    });
    const saveTxt = await saveRes.text();
    if (!saveRes.ok) {
      return res.status(500).json({ ok: false, stage: 'kv:set', error: saveTxt });
    }

    // (İsteğe bağlı) anında onay tweeti
    // Eğer hemen bir "kaydedildi" tweeti atmak istiyorsan bu bloğu açık bırak.
    if (TWITTER_API_KEY && TWITTER_API_KEY_SECRET && TWITTER_ACCESS_TOKEN && TWITTER_ACCESS_TOKEN_SECRET) {
      try {
        const client = new TwitterApi({
          appKey: TWITTER_API_KEY,
          appSecret: TWITTER_API_KEY_SECRET,
          accessToken: TWITTER_ACCESS_TOKEN,
          accessSecret: TWITTER_ACCESS_TOKEN_SECRET,
        });

        const slots = Number(stakeAmount || 0) >= 100000 ? 3 : 1;
        const text =
          `Hey @${twitterUsername}, your reminder has been recorded.\n` +
          `You'll be notified ${remindInDays} days before unlock for ${token}. (Slots: ${slots})`;

        const tweet = await client.v2.tweet(text);
        return res.status(200).json({ ok: true, tweetId: tweet.data.id, id, kvKey });
      } catch (twErr) {
        // Twitter yazma izni yoksa yine de 200 dönelim; kayıt yapıldı.
        console.warn('tweet confirm failed:', twErr?.message || twErr);
        return res.status(200).json({ ok: true, id, kvKey, warn: 'tweet_confirm_failed' });
      }
    }

    // Twitter env yoksa sadece kaydın bilgisini döneriz
    return res.status(200).json({ ok: true, id, kvKey });
  } catch (err) {
    console.error('[subscribe] error', err);
    return res.status(500).json({ ok: false, stage: 'catch', error: String(err?.message || err) });
  }
}
