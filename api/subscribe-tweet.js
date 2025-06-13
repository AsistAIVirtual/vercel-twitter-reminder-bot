import { TwitterApi } from 'twitter-api-v2';

console.log("🟡 DEBUG - Twitter API ENV Values:");
console.log("TWITTER_API_KEY:", process.env.TWITTER_API_KEY);
console.log("TWITTER_API_SECRET:", process.env.TWITTER_API_SECRET);
console.log("TWITTER_ACCESS_TOKEN:", process.env.TWITTER_ACCESS_TOKEN);
console.log("TWITTER_ACCESS_SECRET:", process.env.TWITTER_ACCESS_SECRET);

const client = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

export default async function handler(req, res) {
  // 🔥 CORS headers
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
    res.status(200).json({ success: true, tweet });
  } catch (err) {
    console.error('Tweet error:', err);
    res.status(500).json({ error: 'Failed to send tweet', debug: err });
  }
}
