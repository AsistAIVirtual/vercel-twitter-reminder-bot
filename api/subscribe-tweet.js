// /api/subscribe-tweet.js
export default async function handler(req, res) {
  // OPTIONS için hızlı yanıt (CORS preflight)
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });

  try {
    console.log('[subscribe] start');

    const {
      KV_REST_API_URL,
      KV_REST_API_TOKEN,
      // Twitter env'leri şimdilik gerekmez; V2'de kullanacağız
      TWITTER_API_KEY,
      TWITTER_API_KEY_SECRET,
      TWITTER_ACCESS_TOKEN,
      TWITTER_ACCESS_TOKEN_SECRET,
    } = process.env;

    // KV olmazsa 500 verelim (teşhis net olsun)
    for (const [k, v] of Object.entries({ KV_REST_API_URL, KV_REST_API_TOKEN })) {
      if (!v) return res.status(500).json({ ok: false, stage: 'env', error: `Missing env: ${k}` });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { wallet, twitterUsername, token, remindInDays, stakeAmount } = body || {};
    if (!wallet || !twitterUsername || !token || remindInDays == null) {
      return res.status(400).json({ ok: false, stage: 'body', error: 'Missing body fields' });
    }

    // KV yaz
    console.log('[subscribe] kv write start');
    const kvKey = `reminder:${wallet}:${Date.now()}`;
    const kvRes = await fetch(`${KV_REST_API_URL}/set/${encodeURIComponent(kvKey)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/json', // <— BU ÇOK ÖNEMLİ
      },
      body: JSON.stringify({
        value: { wallet, twitterUsername, token, remindInDays, stakeAmount },
      }),
    });
    const kvTxt = await kvRes.text();
    console.log('[subscribe] kv status', kvRes.status, kvTxt);
    if (!kvRes.ok) return res.status(500).json({ ok: false, stage: 'kv', error: kvTxt });

    // Slot hesabı (kuralın)
    const slots = Number(stakeAmount || 0) >= 100000 ? 3 : 1;

    // Tweeti şimdilik simüle edelim (önce 500 zincirini kırıyoruz)
    const simulatedTweetId = String(Date.now());
    console.log('[subscribe] done (simulated tweet)');
    return res.status(200).json({ ok: true, tweetId: simulatedTweetId, slots });
  } catch (err) {
    console.error('[subscribe] error', err);
    return res.status(500).json({ ok: false, stage: 'catch', error: String(err?.message || err) });
  }
}
