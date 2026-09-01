const fs = require('fs');
const path = require('path');
const https = require('https');

let cachedCards = null;
let cardsPromise = null;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Card-Crate-Club-Importer' }, timeout: 15000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        fetchJson(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Card database request failed with HTTP ${res.statusCode}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (err) { reject(new Error(`Card database JSON could not be parsed: ${err.message}`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Card database request timed out')));
    req.on('error', reject);
  });
}

function tryLocalDatabase() {
  const candidates = [
    path.resolve(__dirname, '../../card-data/all-cards-index.json'),
    path.resolve(__dirname, '../card-data/all-cards-index.json'),
    path.resolve(process.cwd(), 'CARD CRATE CLUB/card-data/all-cards-index.json'),
    path.resolve(process.cwd(), 'card-data/all-cards-index.json')
  ];

  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(parsed?.cards) && parsed.cards.length) return parsed;
    } catch (err) {
      console.warn(`Could not load card index from ${file}:`, err.message);
    }
  }
  return null;
}

async function loadCards(event) {
  if (cachedCards) return cachedCards;
  if (cardsPromise) return cardsPromise;

  cardsPromise = (async () => {
    let parsed = tryLocalDatabase();

    if (!parsed) {
      const headers = event?.headers || {};
      const host = headers['x-forwarded-host'] || headers.host;
      const proto = headers['x-forwarded-proto'] || 'https';
      if (!host) throw new Error('Card database was not bundled and request host is unavailable');
      parsed = await fetchJson(`${proto}://${host}/card-data/all-cards-index.json`);
    }

    const cards = Array.isArray(parsed?.cards) ? parsed.cards : [];
    if (!cards.length) throw new Error('Card database is empty');
    cachedCards = cards;
    return cards;
  })();

  try {
    return await cardsPromise;
  } catch (err) {
    cardsPromise = null;
    throw err;
  }
}

function norm(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9' -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normNumber(value) {
  let raw = String(value || '').trim();
  if (!raw) return '';
  raw = raw.split('/')[0].trim().toLowerCase();
  raw = raw.replace(/^#/, '').replace(/\s+/g, '');
  if (/^\d+$/.test(raw)) return String(Number(raw));
  const numericPromo = raw.match(/^([a-z]+)0*(\d+)$/i);
  if (numericPromo) return `${numericPromo[1]}${Number(numericPromo[2])}`;
  return raw;
}

function baseName(value) {
  return norm(value)
    .replace(/\b(reverse holo|reverse foil|holofoil|holo foil|normal foil|foil|non holo|unlimited|1st edition|first edition|near mint|lightly played|moderately played|heavily played|damaged)\b/g, ' ')
    .replace(/\b(english|japanese)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSimilarity(a, b) {
  const aa = new Set(baseName(a).split(' ').filter(Boolean));
  const bb = new Set(baseName(b).split(' ').filter(Boolean));
  if (!aa.size || !bb.size) return 0;
  let intersection = 0;
  for (const t of aa) if (bb.has(t)) intersection++;
  return intersection / Math.max(aa.size, bb.size);
}

function setSimilarity(card, rowSet) {
  const rs = norm(rowSet);
  if (!rs) return { score: 0, exact: false };
  const names = [norm(card.setName), norm(card.setId)].filter(Boolean);
  if (names.includes(rs)) return { score: 400, exact: true };
  if (names.some(v => v.includes(rs) || rs.includes(v))) return { score: 200, exact: false };
  const sim = Math.max(...names.map(v => tokenSimilarity(v, rs)), 0);
  if (sim >= 0.8) return { score: 160, exact: false };
  if (sim >= 0.55) return { score: 80, exact: false };
  return { score: -80, exact: false };
}

function score(card, row) {
  const cn = baseName(card.name);
  const rn = baseName(row.name);
  const cnum = normNumber(card.number);
  const rnum = normNumber(row.number);
  const numberExact = !!rnum && cnum === rnum;

  let s = 0;
  let nameStrength = 0;

  if (rn) {
    if (cn === rn) { s += 500; nameStrength = 1; }
    else if (cn.startsWith(rn) || rn.startsWith(cn)) { s += 300; nameStrength = 0.85; }
    else if (cn.includes(rn) || rn.includes(cn)) { s += 220; nameStrength = 0.75; }
    else {
      const sim = tokenSimilarity(cn, rn);
      nameStrength = sim;
      if (sim >= 0.8) s += 260;
      else if (sim >= 0.6) s += 160;
      else if (sim >= 0.45 && numberExact) s += 80;
      else if (!numberExact) return -1;
    }
  }

  const setScore = setSimilarity(card, row.set);
  s += setScore.score;

  if (rnum) {
    if (numberExact) s += 650;
    else if (rn && nameStrength >= 0.75) s -= 220;
    else return -1;
  }

  if (!numberExact && (!rn || nameStrength < 0.6)) return -1;
  return s;
}

function confidence(best, second, row) {
  const exactName = baseName(best.card.name) === baseName(row.name);
  const exactSet = row.set && setSimilarity(best.card, row.set).exact;
  const exactNumber = row.number && normNumber(best.card.number) === normNumber(row.number);
  const gap = best.score - (second?.score ?? -9999);

  if (exactNumber && exactSet && (!row.name || exactName)) return 'exact';
  if (exactNumber && exactName && gap >= 100) return 'exact';
  if (exactName && exactSet && gap >= 150) return 'high';
  if (best.score >= 900 && gap >= 180) return 'high';
  if (gap >= 250 && best.score >= 500) return 'medium';
  return 'review';
}

function cardOut({ card }) {
  return {
    id: card.id,
    name: card.name,
    setId: card.setId,
    setName: card.setName,
    number: card.number,
    rarity: card.rarity || '',
    image: card.image || ''
  };
}

function matchOneRow(cards, row, index) {
  try {
    const candidates = [];
    for (const card of cards) {
      const s = score(card, row);
      if (s >= 0) candidates.push({ card, score: s });
    }
    candidates.sort((a, b) => b.score - a.score);
    const top = candidates.slice(0, 6);
    if (!top.length) return { index, status: 'unmatched', row, match: null, alternatives: [] };

    const level = confidence(top[0], top[1], row);
    return {
      index,
      status: level === 'review' ? 'review' : 'matched',
      confidence: level,
      row,
      match: cardOut(top[0]),
      alternatives: top.slice(1).map(cardOut)
    };
  } catch (err) {
    console.error(`Collection matcher failed on row ${index}:`, err);
    return { index, status: 'unmatched', row, match: null, alternatives: [], error: 'Row could not be matched' };
  }
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'POST required' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const rows = Array.isArray(payload.rows) ? payload.rows.slice(0, 500) : [];
  if (!rows.length) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'No rows supplied' }) };
  }

  let cards;
  try {
    cards = await loadCards(event);
  } catch (err) {
    console.error('Collection matcher database load failed:', err);
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ error: 'Card database unavailable', detail: err.message })
    };
  }

  const results = rows.map((row, index) => matchOneRow(cards, row, index));
  const counts = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, { matched: 0, review: 0, unmatched: 0 });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ results, counts })
  };
};
