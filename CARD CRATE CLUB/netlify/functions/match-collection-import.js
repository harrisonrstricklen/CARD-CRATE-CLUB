const fs = require('fs');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../../card-data/all-cards-index.json');
let cache = null;

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

function baseName(value) {
  return norm(value)
    .replace(/\b(reverse holo|reverse foil|holofoil|holo foil|normal foil|foil|non holo|unlimited|1st edition|first edition|near mint|lightly played|moderately played|heavily played|damaged|english|japanese)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normNumber(value) {
  let raw = String(value || '').trim();
  if (!raw) return '';
  raw = raw.split('/')[0].trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '');
  if (/^\d+$/.test(raw)) return String(Number(raw));
  const promo = raw.match(/^([a-z]+)0*(\d+)$/i);
  if (promo) return `${promo[1]}${Number(promo[2])}`;
  return raw;
}

function pushMap(map, key, card) {
  if (!key) return;
  const list = map.get(key);
  if (list) list.push(card);
  else map.set(key, [card]);
}

function loadIndex() {
  if (cache) return cache;
  const parsed = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  const cards = Array.isArray(parsed.cards) ? parsed.cards : [];
  const byNumber = new Map();
  const byName = new Map();
  const bySet = new Map();

  for (const card of cards) {
    card.__name = baseName(card.name);
    card.__set = norm(card.setName);
    card.__setId = norm(card.setId);
    card.__number = normNumber(card.number);
    pushMap(byNumber, card.__number, card);
    pushMap(byName, card.__name, card);
    pushMap(bySet, card.__set, card);
    pushMap(bySet, card.__setId, card);
  }

  cache = { cards, byNumber, byName, bySet };
  return cache;
}

function tokenSimilarity(a, b) {
  const aa = new Set(baseName(a).split(' ').filter(Boolean));
  const bb = new Set(baseName(b).split(' ').filter(Boolean));
  if (!aa.size || !bb.size) return 0;
  let hit = 0;
  for (const t of aa) if (bb.has(t)) hit++;
  return hit / Math.max(aa.size, bb.size);
}

function setScore(card, rowSet) {
  const rs = norm(rowSet);
  if (!rs) return 0;
  if (card.__set === rs || card.__setId === rs) return 420;
  if (card.__set.includes(rs) || rs.includes(card.__set)) return 220;
  const sim = tokenSimilarity(card.__set, rs);
  if (sim >= .8) return 170;
  if (sim >= .55) return 90;
  return -100;
}

function score(card, row) {
  const rn = baseName(row.name);
  const rnum = normNumber(row.number);
  let s = setScore(card, row.set);

  if (rnum) {
    if (card.__number === rnum) s += 700;
    else s -= 350;
  }

  if (rn) {
    if (card.__name === rn) s += 550;
    else if (card.__name.startsWith(rn) || rn.startsWith(card.__name)) s += 320;
    else if (card.__name.includes(rn) || rn.includes(card.__name)) s += 230;
    else {
      const sim = tokenSimilarity(card.__name, rn);
      if (sim >= .8) s += 260;
      else if (sim >= .6) s += 160;
      else if (rnum && card.__number === rnum && sim >= .4) s += 70;
      else s -= 260;
    }
  }
  return s;
}

function candidatePool(index, row) {
  const rnum = normNumber(row.number);
  const rn = baseName(row.name);
  const rs = norm(row.set);
  const seen = new Map();
  const add = list => (list || []).forEach(card => seen.set(card.id, card));

  // Exact card number is the strongest narrowing signal and normally leaves
  // only a few dozen cards across all sets instead of scanning 20k cards.
  if (rnum) add(index.byNumber.get(rnum));
  if (rn) add(index.byName.get(rn));
  if (rs) add(index.bySet.get(rs));

  // If exact indexes did not find enough candidates, use a small name-based
  // expansion rather than a full fuzzy pass through the whole database.
  if (seen.size < 3 && rn) {
    const firstToken = rn.split(' ')[0];
    for (const [name, cards] of index.byName) {
      if (name === rn || name.startsWith(firstToken) || rn.startsWith(name.split(' ')[0])) add(cards);
      if (seen.size > 180) break;
    }
  }

  return [...seen.values()];
}

function cardOut(card) {
  return { id: card.id, name: card.name, setId: card.setId, setName: card.setName, number: card.number, rarity: card.rarity || '', image: card.image || '' };
}

function matchRow(index, row, i) {
  const pool = candidatePool(index, row);
  if (!pool.length) return { index: i, status: 'unmatched', row, match: null, alternatives: [] };

  const ranked = pool
    .map(card => ({ card, score: score(card, row) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  if (!ranked.length) return { index: i, status: 'unmatched', row, match: null, alternatives: [] };

  const best = ranked[0];
  const second = ranked[1];
  const rn = baseName(row.name);
  const rs = norm(row.set);
  const rnum = normNumber(row.number);
  const exactName = !!rn && best.card.__name === rn;
  const exactNumber = !!rnum && best.card.__number === rnum;
  const exactSet = !!rs && (best.card.__set === rs || best.card.__setId === rs);
  const gap = best.score - (second?.score ?? -9999);

  let confidence = 'review';
  if (exactNumber && exactName && exactSet) confidence = 'exact';
  else if (exactNumber && exactSet && gap >= 80) confidence = 'high';
  else if (exactNumber && exactName && gap >= 100) confidence = 'high';
  else if (exactName && exactSet && gap >= 140) confidence = 'high';
  else if (best.score >= 900 && gap >= 150) confidence = 'medium';

  return {
    index: i,
    status: confidence === 'review' ? 'review' : 'matched',
    confidence,
    row,
    match: cardOut(best.card),
    alternatives: ranked.slice(1).map(x => cardOut(x.card))
  };
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'POST required' }) };

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const rows = Array.isArray(payload.rows) ? payload.rows.slice(0, 250) : [];
  if (!rows.length) return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'No rows supplied' }) };

  try {
    const index = loadIndex();
    const results = rows.map((row, i) => matchRow(index, row, i));
    const counts = results.reduce((a, r) => { a[r.status]++; return a; }, { matched: 0, review: 0, unmatched: 0 });
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify({ results, counts }) };
  } catch (err) {
    console.error('Collection import matcher failed:', err);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Collection matcher failed', detail: err.message }) };
  }
};
