// /api/ping.js
export default function handler(req, res) {
  // Basit CORS
  res.setHeader('Access-Control-Allow-Origin', '*'); // test için * (sonra domainini koyarız)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  return res.status(200).json({ ok: true, msg: 'pong' });
}
