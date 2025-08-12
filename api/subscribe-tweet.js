// /api/subscribe-tweet.js
export default async function handler(req, res) {
  // CORS (vercel.json zaten ekliyor ama OPTIONS yanıtı da verelim)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const {
      TWITTER_API_KEY,
      TWITTER_API_KEY_SECRET,
      TWITTER_ACCESS_TOKEN,
      TWITTER_ACCESS_TOKEN_SECRET,
      KV_REST_API_URL,
      KV_REST_API_TOKEN,
    } = process.env;

    // Eksik gizli anahtar var mı?
    for (const [k, v] of Object.entries({
      TWITTER_API_KEY,
      TWITTER_API_KEY_SECRET,
      TWITTER_ACCESS_TOKEN,
      TWITTER_ACCESS_TOKEN_SECRET,
      KV_REST_API_URL,
      KV_REST_API_TOKEN,
    })) {
      if (!v) {
        return res.status(500).json({ ok: false, error: `Missing env: ${k}` });
      }
    }

    // Gövdedeki bilgileri al
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { wallet, twitterUsername, token, remindInDays, stakeAmount } = body || {};
    if (!wallet || !twitterUsername || !token || remindInDays == null) {
      return res.status(400).json({ ok: false, error: 'Missing body fields' });
    }

    // Upstash KV'ye kaydet (Accept: application/json çok önemli)
    const kvKey = `reminder:${wallet}:${Date.now()}`;
    const kvRes = await fetch(`${process.env.KV_REST_API_URL}/set/${encodeURIComponent(kvKey)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        value: { wallet, twitterUsername, token, remindInDays, stakeAmount },
      }),
    });
    if (!kvRes.ok) {
      const txt = await kvRes.text();
      return res.status(500).json({ ok: false, error: `KV error: ${txt}` });
    }

    // Hatırlatıcı hakkı: 0 stake => 1, 100k+ => 3
    const slots = Number(stakeAmount || 0) >= 100000 ? 3 : 1;

    // Tweet at (twitter-api-v2 yerine, geçici olarak Vercel Cron/başka servis sorunlarında 500’u engellemek için tweet kısmını sahteleyebilirsin)
    // Burada gerçek Twitter API’nı kullanıyorsan, kendi çalışan tweet kodunu ekleyebilirsin.
    // Şimdilik başarı simülasyonu:
    const simulatedTweetId = String(Date.now());

    return res.status(200).json({
      ok: true,
      tweetId: simulatedTweetId,
      message: `Recorded. ${slots} slot(s).`,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
