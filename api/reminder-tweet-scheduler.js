// reminder-tweet-scheduler.js
import { kv } from '@vercel/kv';
import { TwitterApi } from 'twitter-api-v2';

const client = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

const twitter = client.readWrite;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Only GET requests allowed' });
  }

  try {
    const reminders = await kv.hgetall('reminders');
    if (!reminders || Object.keys(reminders).length === 0) {
      return res.status(200).json({ message: 'No reminders to send' });
    }

    const now = new Date();
    const today = now.toISOString().split('T')[0];

    for (const [key, data] of Object.entries(reminders)) {
      const reminder = JSON.parse(data);
      if (reminder.date === today) {
        await twitter.v2.tweet(
          `Hey @${reminder.username}, your reminder for ${reminder.token} is due today! The token unlock is approaching!`
        );
        await kv.hdel('reminders', key);
      }
    }

    return res.status(200).json({ message: 'Reminders processed.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to send reminders.' });
  }
}
