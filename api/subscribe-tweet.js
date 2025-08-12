import { TwitterApi } from 'twitter-api-v2';

const KV_REST_API_URL = process.env.KV_REST_API_URL;
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;

const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_KEY_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { wallet, token, twitterUsername, remindInDays } = req.body;
    if (!wallet || !token || !twitterUsername || !remindInDays) {
      return res.status(400).json({ error: 'Missing parameters' });
    }

    // dueAt hesaplama
    const now = Date.now();
    const remindInMs = Number(remindInDays) * 24 * 60 * 60 * 1000;
    const dueAt = now + remindInMs;

    // KV key
    const kvKey = `reminder:${wallet}:${dueAt}`;

    // KV value
    const value = {
      wallet,
      token,
      twitterUsername,
      remindInDays: Number(remindInDays),
      dueAt,
      sent: false
    };

    // KV’ye kaydet
    await fetch(`${KV_REST_API_URL}/set/${encodeURIComponent(kvKey)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(value),
    });

    // Kayıt tweet’i at
    await twitterClient.v2.tweet(
      `Your reminder has been recorded. You'll be notified in ${remindInDays} days for token ${token}.`
    );

    return res.status(200).json({ ok: true, dueAt });
  } catch (err) {
    console.error('tweet confirm failed:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
