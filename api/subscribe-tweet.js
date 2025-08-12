// /api/subscribe-tweet.js
import { TwitterApi } from 'twitter-api-v2';

// ---- helpers ----
function cors(res) {
  // yayın domainini ekle; istersen '*' yapabilirsin
  res.setHeader('Access-Control-Allow-Origin', 'https://www.virgenscan.org');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Upstash REST çağrısı
async function kvSet(key, value) {
  const url = `${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    // Upstash en sağlıklısı: { value: ... } sarmalı
    body: JSON.stringify({ value }),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`KV set failed (${r.status}): ${txt}`);
  }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });

  try {
    // ---- env kontrolü ----
    const need = ['KV_REST_API_URL', 'KV_REST_API_TOKEN'];
    for (const k of need) {
      if (!process.env[k]) return res.status(500).json({ ok: false, error: `Missing env: ${k}` });
    }

    // ---- body ----
    const raw = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    let { wallet, twitterUsername, token, remindInDays, stakeAmount, dueAt } = raw;

    // temizlemeler
    wallet = String(wallet || '').trim();
    twitterUsername = String(twitterUsername || '').replace(/^@/, '').trim();
    token = String(token || '').trim();
    const remind = Number(remindInDays);
    const stake = Number(stakeAmount || 0);

    // doğrulama
    if (!wallet || !twitterUsername || !token || !Number.isFinite(remind)) {
      return res.status(400).json({ ok: false, error: 'Missing body fields (wallet, twitterUsername, token, remindInDays required)' });
    }
    if (!dueAt) {
      return res.status(400).json({ ok: false, error: 'Missing body field: dueAt (ISO datetime)' });
    }
    // dueAt ISO mu?
    const due = new Date(dueAt);
    if (isNaN(due.getTime())) {
      return res.status(400).json({ ok: false, error: 'Invalid dueAt (must be ISO datetime string)' });
    }

    // ---- KV kaydı ----
    const id = `${wallet}:${Date.now()}`;
    const kvKey = `reminder:${id}`;
    const value = {
      id,
      wallet,
      twitterUsername,
      token,
      remindInDays: remind,
      stakeAmount: stake,
      dueAt: due.toISOString(), // string olarak saklıyoruz
      sent: false,
    };

    await kvSet(kvKey, value);

    // ---- (opsiyonel) onay tweeti ----
    // Not: duplicate 403 yaşamamak için benzersiz ref ekliyoruz.
    let tweeted = null;
    try {
      if (
        process.env.TWITTER_API_KEY &&
        process.env.TWITTER_API_KEY_SECRET &&
        process.env.TWITTER_ACCESS_TOKEN &&
        process.env.TWITTER_ACCESS_TOKEN_SECRET
      ) {
        const client = new TwitterApi({
          appKey: process.env.TWITTER_API_KEY,
          appSecret: process.env.TWITTER_API_KEY_SECRET,
          accessToken: process.env.TWITTER_ACCESS_TOKEN,
          accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
        });

        const slots = stake >= 100000 ? 3 : 1;
        const ref = id.slice(-6); // benzersiz kuyruk
        const text =
          `Hey @${twitterUsername}, your reminder has been recorded.\n` +
          `You'll be notified ${remind} days before unlock for ${token}. (Slots: ${slots})\n` +
          `Ref:${ref}`;

        const tw = await client.v2.tweet(text);
        tweeted = tw?.data?.id || null;
      }
    } catch (e) {
      // onay tweeti başarısız olsa bile kayıt yapıldı: 200 döndürüyoruz
      console.warn('tweet confirm failed:', e?.data?.errors?.[0]?.message || e?.message || String(e));
    }

    return res.status(200).json({ ok: true, id, kvKey, tweeted });
  } catch (err) {
    console.error('[subscribe] error', err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
