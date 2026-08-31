const fs = require('fs');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../../card-data/all-cards-index.json');
let cachedCards = null;

function loadCards() {
  if (!cachedCards) {
    const parsed = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    cachedCards = Array.isArray(parsed.cards) ? parsed.cards : [];
  }
  return cachedCards;
}

function norm(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9' -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normNumber(value) {
  const raw = String(value || '').trim().split('/')[0].trim().toLowerCase();
  if (/^\d+$/.test(raw)) return String(Number(raw));
  return raw;
}

function score(card, row) {
  const cn = norm(card.name);
  const cs = norm(card.setName);
  const cnum = normNumber(card.number);
  const rn = norm(row.name);
  const rs = norm(row.set);
  const rnum = normNumber(row.number);

  let s = 0;
  if (rn) {
    if (cn === rn) s += 500;
    else if (cn.startsWith(rn) || rn.startsWith(cn)) s += 250;
    else if (cn.includes(rn) || rn.includes(cn)) s += 120;
    else return -1;
  }
  if (rs) {
    if (cs === rs) s += 400;
    else if (cs.includes(rs) || rs.includes(cs)) s += 180;
    else s -= 100;
  }
  if (rnum) {
    if (cnum === rnum) s += 650;
    else return -1;
  }
  return s;
}

function confidence(best, second, row) {
  const exactName = norm(best.card.name) === norm(row.name);
  const exactSet = row.set && norm(best.card.setName) === norm(row.set);
  const exactNumber = row.number && normNumber(best.card.number) === normNumber(row.number);
  const gap = best.score - (second?.score ?? -9999);

  if (exactNumber && exactSet && (!row.name || exactName)) return 'exact';
  if (exactNumber && exactName) return 'exact';
  if (exactName && exactSet && gap >= 150) return 'high';
  if (best.score >= 800 && gap >= 200) return 'high';
  if (gap >= 250 && best.score >= 500) return 'medium';
  return 'review';
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

  const cards = loadCards();
  const results = rows.map((row, index) => {
    const candidates = [];
    for (const card of cards) {
      const s = score(card, row);
      if (s >= 0) candidates.push({ card, score: s });
    }
    candidates.sort((a, b) => b.score - a.score);
    const top = candidates.slice(0, 4);
    if (!top.length) return { index, status: 'unmatched', row, match: null, alternatives: [] };

    const level = confidence(top[0], top[1], row);
    const cardOut = ({ card }) => ({
      id: card.id,
      name: card.name,
      setId: card.setId,
      setName: card.setName,
      number: card.number,
      rarity: card.rarity || '',
      image: card.image || ''
    });

    return {
      index,
      status: level === 'review' ? 'review' : 'matched',
      confidence: level,
      row,
      match: cardOut(top[0]),
      alternatives: top.slice(1).map(cardOut)
    };
  });

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
