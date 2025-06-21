import { TwitterApi } from 'twitter-api-v2';
import { v4 as uuidv4 } from 'uuid';

const KV_REST_API_URL = process.env.KV_REST_API_URL;
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;

const client = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_KEY_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});

export default async function handler(req, res) {
  // ✅ CORS ayarları
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST requests allowed' });
  }

  const { twitterUsername, tokenName, days } = req.body;

  if (!twitterUsername || !tokenName || !days) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  const tweet = `@${twitterUsername} Your reminder has been recorded. You'll be notified ${days} days before the unlock of token ${tokenName}.`;

  try {
    await client.v2.tweet(tweet);

    const reminderDate = new Date();
    reminderDate.setDate(reminderDate.getDate() + parseInt(days));

    const reminder = {
      twitterUsername,
      tokenName,
      remindInDays: days,
      remindDate: reminderDate.toISOString()
    };

    await fetch(`${KV_REST_API_URL}/set/reminder:${uuidv4()}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KV_REST_API_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(reminder)
    });

    res.status(200).json({ success: true, tweet });
  } catch (err) {
    console.error('Tweet error:', err);
    res.status(500).json({ error: 'Failed to send tweet', debug: err.message });
  }
}
