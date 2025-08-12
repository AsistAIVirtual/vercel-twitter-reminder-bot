import { TwitterApi } from 'twitter-api-v2';

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });

  try {
    const {
      KV_REST_API_URL,
      KV_REST_API_TOKEN,
      TWITTER_API_KEY,
      TWITTER_API_KEY_SECRET,
      TWITTER_ACCESS_TOKEN,
      TWITTER_ACCESS_TOKEN_SECRET,
    } = process.env;

    // env kontrol
    for (const [k, v] of Object.entries({
      KV_REST_API_URL, KV_REST_API_TOKEN,
      TWITTER_API_KEY, TWITTER_API_KEY_SECRET,
      TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET,
    })) {
      if (!v) return res.status(500).json({ ok: false, stage: 'env', error: `Missing env: ${k}` });
    }

    // body
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { wallet, twitterUsername, token, remindInDays, stakeAmount } = body || {};
    if (!wallet || !twitterUsername || !token || remindInDays == null) {
      return res.status(400).json({ ok: false, stage: 'body', error: 'Missing body fields' });
    }

    // KV kaydı
    const kvKey = `reminder:${wallet}:${Date.now()}`;
    const kvRes = await fetch(`${KV_REST_API_URL}/set/${encodeURIComponent(kvKey)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ value: { wallet, twitterUsername, token, remindInDays, stakeAmount } }),
    });
    const kvTxt = await kvRes.text();
    if (!kvRes.ok) return res.status(500).json({ ok: false, stage: 'kv', error: kvTxt });

    // tweet metni
    const slots = Number(stakeAmount || 0) >= 100000 ? 3 : 1;
    const text =
      `Hey @${twitterUsername}, your reminder has been recorded.\n` +
      `You'll be notified in ${remindInDays} days before the unlock of token $${token}. (Slots: ${slots})`;

    // tweet at
    const client = new TwitterApi({
      appKey: TWITTER_API_KEY,
      appSecret: TWITTER_API_KEY_SECRET,
      accessToken: TWITTER_ACCESS_TOKEN,
      accessSecret: TWITTER_ACCESS_TOKEN_SECRET,
    });

    const tweet = await client.v2.tweet(text); // başarılıysa id döner
    return res.status(200).json({ ok: true, tweetId: tweet.data.id, slots });
  } catch (err) {
    // Twitter yazma izni yoksa tipik hata: 403 "You are not allowed to create a Tweet"
    return res.status(500).json({ ok: false, stage: 'catch', error: String(err?.message || err) });
  }
}
