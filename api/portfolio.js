const { Redis } = require('@upstash/redis');

const INDEX_KEY = 'cipp:portfolio:index';

function getRedis() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  return Redis.fromEnv();
}

module.exports = async function handler(req, res) {
  try {
    const redis = getRedis();
    if (!redis) {
      return res.status(503).json({ error: 'redis_not_configured' });
    }

    if (req.method === 'GET') {
      const raw = await redis.get(INDEX_KEY);
      const projects = raw ? JSON.parse(raw) : [];
      return res.status(200).json({ projects: Array.isArray(projects) ? projects : [] });
    }

    if (req.method === 'POST') {
      const entry = req.body || {};
      if (!entry.doc || typeof entry.doc !== 'string') {
        return res.status(400).json({ error: 'doc required' });
      }
      const raw = await redis.get(INDEX_KEY);
      const projects = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(projects) ? projects : [];
      const idx = list.findIndex(p => p.doc === entry.doc);
      const snapshot = {
        doc: entry.doc,
        name: entry.name || '',
        customer: entry.customer || '',
        lead: entry.lead || '',
        phase: entry.phase || 'setup',
        pocType: entry.pocType || '',
        overallPct: entry.overallPct || 0,
        g0Pct: entry.g0Pct || 0,
        g1Pct: entry.g1Pct || 0,
        g2Pct: entry.g2Pct || 0,
        currentGate: entry.currentGate || 'entry',
        updated: entry.updated || new Date().toISOString()
      };
      if (idx >= 0) list[idx] = snapshot;
      else list.push(snapshot);
      list.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
      await redis.set(INDEX_KEY, JSON.stringify(list));
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'portfolio_unavailable', detail: err && err.message ? err.message : 'unknown' });
  }
};
