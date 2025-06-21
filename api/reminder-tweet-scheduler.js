
import { TwitterApi } from 'twitter-api-v2';

const client = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_KEY_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});

const KV_REST_API_URL = process.env.KV_REST_API_URL;
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;

export default async function handler(req, res) {
  try {
    const now = new Date().toISOString().slice(0, 10);
    console.log("⏰ Reminder check started for date:", now);

    const keyListRes = await fetch(`${KV_REST_API_URL}/keys/reminder:*`, {
      headers: {
        Authorization: `Bearer ${KV_REST_API_TOKEN}`,
        Accept: "application/json"
      }
    });

    const keyList = await keyListRes.json();
    console.log("Fetched keys:", keyList);

    if (!keyList.result || !Array.isArray(keyList.result)) {
      return res.status(500).json({ error: "Upstash keys not accessible", keyList });
    }

    let remindersSent = 0;

    for (const key of keyList.result) {
      console.log("🔍 Checking key:", key);
      const reminderRes = await fetch(`${KV_REST_API_URL}/get/${key}`, {
        headers: {
          Authorization: `Bearer ${KV_REST_API_TOKEN}`,
          Accept: "application/json"
        }
      });

      const reminderData = await reminderRes.json();
      if (!reminderData || !reminderData.result || !reminderData.result.remindDate) continue;

      const reminder = reminderData.result;
      const reminderDate = reminder.remindDate.slice(0, 10);

      if (reminderDate === now) {
        const tweet = `@${reminder.twitterUsername} Reminder: Token ${reminder.tokenName} will unlock in ${reminder.remindInDays} days!`;
        try {
          await client.v2.tweet(tweet);
          console.log("✅ Tweet sent to:", reminder.twitterUsername);

          await fetch(`${KV_REST_API_URL}/del/${key}`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${KV_REST_API_TOKEN}`,
              Accept: "application/json"
            }
          });

          remindersSent++;
        } catch (err) {
          console.error('🚨 Tweet error:', err);
        }
      }
    }

    res.status(200).json({ success: true, remindersSent });

  } catch (err) {
    console.error("🔥 Scheduler crash:", err);
    res.status(500).json({ error: "Unhandled error", details: err.message || err.toString() });
  }
}
