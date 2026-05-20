const { Redis } = require('@upstash/redis');

const STORAGE_SUFFIX = 'cipp:poc:v2';
const MEETING_IDS = ['weekly', 'gateReview', 'reviewPoint', 'retro'];
const MEETING_LABELS = {
  weekly: 'Weekly · CIPP Steuerung',
  gateReview: 'Gate-Review · CIPP',
  reviewPoint: 'Review Point · CIPP',
  retro: 'Retro · CIPP'
};

const DE_WEEKDAYS = {
  montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6, sonntag: 0
};
const ICS_BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function getRedis() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  return Redis.fromEnv();
}

function buildStorageKey(doc) {
  return `cipp:${doc || 'default'}:${STORAGE_SUFFIX}`;
}

function icsEscape(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatIcsLocal(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}

function parseDateTime(startDate, startTime) {
  if (!startDate) return null;
  const [y, m, day] = startDate.split('-').map(Number);
  const [h, min] = (startTime || '10:00').split(':').map(Number);
  if (!y || !m || !day) return null;
  const d = new Date(y, m - 1, day, h || 10, min || 0, 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

function weekdayFromGerman(name) {
  if (!name) return null;
  const n = String(name).toLowerCase().trim();
  if (DE_WEEKDAYS[n] !== undefined) return DE_WEEKDAYS[n];
  return null;
}

function ensureMeetingSchedule(state) {
  const org = state.org || {};
  const meetings = state.meetings || {};
  MEETING_IDS.forEach(id => {
    if (!meetings[id]) meetings[id] = { done: false };
    const m = meetings[id];
    if (m.durationMin == null) m.durationMin = id === 'gateReview' ? 90 : 60;
    if (!m.recurrence) m.recurrence = id === 'weekly' ? 'WEEKLY' : 'NONE';
    if (!m.location) m.location = 'Microsoft Teams · CIPP Obeya';
    if (!m.timezone) m.timezone = 'Europe/Berlin';
    if (id === 'weekly') {
      if (!m.startTime && org.weeklyTime) m.startTime = org.weeklyTime;
      if (!m.startTime) m.startTime = '10:00';
    } else if (!m.startTime) {
      m.startTime = '10:00';
    }
  });
  return meetings;
}

function buildEventLines(meetingId, state, doc) {
  const meetings = ensureMeetingSchedule(state);
  const m = meetings[meetingId];
  if (!m) return [];
  const meta = state.meta || {};
  const org = state.org || {};
  const label = MEETING_LABELS[meetingId] || meetingId;
  const project = meta.name || 'CIPP PoC';
  const summary = `${label} · ${project}`;
  const start = parseDateTime(m.startDate, m.startTime);
  if (!start) return [];

  const end = new Date(start.getTime() + (m.durationMin || 60) * 60000);
  const uid = `cipp-${doc}-${meetingId}@nxtgn`;
  const desc = [
    `PoC: ${project}`,
    `Kunde: ${meta.customer || '—'}`,
    `NXTGN PM: ${org.nxtgnPm || '—'}`,
    `CIPP 2.0 — Termin im System öffnen für Auto-Agenda.`
  ].join('\\n');

  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
    `DTSTART;TZID=${m.timezone || 'Europe/Berlin'}:${formatIcsLocal(start)}`,
    `DTEND;TZID=${m.timezone || 'Europe/Berlin'}:${formatIcsLocal(end)}`,
    `SUMMARY:${icsEscape(summary)}`,
    `DESCRIPTION:${icsEscape(desc)}`,
    `LOCATION:${icsEscape(m.location || '')}`
  ];

  if (meetingId === 'weekly' && m.recurrence === 'WEEKLY') {
    const wd = weekdayFromGerman(org.weeklyDay);
    if (wd !== null) {
      lines.push(`RRULE:FREQ=WEEKLY;BYDAY=${ICS_BYDAY[wd]}`);
    } else {
      lines.push('RRULE:FREQ=WEEKLY');
    }
  }

  lines.push('END:VEVENT');
  return lines;
}

function buildIcsCalendar(state, doc) {
  const meta = state.meta || {};
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NXTGN//CIPP 2.0//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:CIPP · ${icsEscape(meta.name || 'PoC')}`,
    'X-WR-TIMEZONE:Europe/Berlin',
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Berlin',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    'TZNAME:CEST',
    'DTSTART:19700329T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    'TZNAME:CET',
    'DTSTART:19701025T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'END:STANDARD',
    'END:VTIMEZONE'
  ];

  MEETING_IDS.forEach(id => {
    lines.push(...buildEventLines(id, state, doc));
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const doc = (req.query && req.query.doc) || 'default';

  try {
    const redis = getRedis();
    if (!redis) {
      return res.status(503).json({ error: 'redis_not_configured' });
    }

    const raw = await redis.get(buildStorageKey(doc));
    if (!raw) {
      return res.status(404).send('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n');
    }

    let state;
    try {
      state = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      return res.status(500).json({ error: 'invalid_state' });
    }

    const ics = buildIcsCalendar(state, doc);
    const filename = `cipp-${doc}-termine.ics`;

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).send(ics);
  } catch (err) {
    return res.status(500).json({
      error: 'calendar_unavailable',
      detail: err && err.message ? err.message : 'unknown'
    });
  }
};
