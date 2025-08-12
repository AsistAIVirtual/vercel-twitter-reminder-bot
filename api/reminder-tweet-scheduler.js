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
  try {
    // KV'den tüm kayıtları al
    const getAll = await fetch(`${KV_REST_API_URL}/keys?pattern=reminder:*`, {
      headers: {
        Authorization: `Bearer ${KV_REST_API_TOKEN}`,
        'Accept': 'application/json',
      },
    });
    const keys = await getAll.json();

    let processed = 0;
    let tweeted = 0;

    for (const key of keys.result || []) {
      const recordRes = await fetch(`${KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
        headers: {
          Authorization: `Bearer ${KV_REST_API_TOKEN}`,
          'Accept': 'application/json',
        },
      });
      const record = await recordRes.json();
      if (!record.dueAt) continue; // dueAt olmayanları atla

      const now = Date.now();
      if (now >= record.dueAt && !record.sent) {
        // Tweet at
        await twitterClient.v2.tweet(
          `Reminder: ${record.token} is unlocking in ${record.remindInDays} days! Wallet: ${record.wallet}`
        );

        // Gönderildi olarak işaretle
        record.sent = true;
        await fetch(`${KV_REST_API_URL}/set/${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${KV_REST_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(record),
        });

        tweeted++;
      }
      processed++;
    }

    return res.status(200).json({ ok: true, processed, tweeted });
  } catch (err) {
    console.error('Scheduler error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
