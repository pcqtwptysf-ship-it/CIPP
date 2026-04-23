const { Redis } = require('@upstash/redis');

const buildKey = (doc, key) => `cipp:${doc || 'default'}:${key || 'state'}`;
const redis = Redis.fromEnv();

module.exports = async function handler(req, res) {
  const doc = (req.query && req.query.doc) || 'default';
  const key = (req.query && req.query.key) || 'state';
  const storageKey = buildKey(doc, key);

  // Health check for client-side probeStorage.
  if (req.method === 'GET' && req.query && req.query.ping === '1') {
    return res.status(200).json({ ok: true, provider: 'upstash-redis' });
  }

  try {
    if (req.method === 'GET') {
      const value = await redis.get(storageKey);
      return res.status(200).json({ value: typeof value === 'string' ? value : null });
    }

    if (req.method === 'POST') {
      const { value } = req.body || {};
      if (typeof value !== 'string') {
        return res.status(400).json({ error: 'value must be a string' });
      }
      await redis.set(storageKey, value);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      await redis.del(storageKey);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'storage_unavailable', detail: err && err.message ? err.message : 'unknown' });
  }
};
