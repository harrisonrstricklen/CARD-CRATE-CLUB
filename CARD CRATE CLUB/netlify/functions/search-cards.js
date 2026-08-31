const fs = require('fs');
const path = require('path');

// Search Card Crate Club's generated card database locally, then enrich the
// small result set with live TCGplayer pricing from the Pokemon TCG API.
const INDEX_PATH = path.resolve(__dirname, '../../card-data/all-cards-index.json');
const SETS_PATH = path.resolve(__dirname, '../../card-data/all-sets/index.json');
let cachedCards = null;
let cachedSets = null;

function normalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9' -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeNumber(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (/^\d+$/.test(raw)) return String(Number(raw));
  return raw;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadDatabase() {
  if (!cachedCards) {
    const parsed = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    cachedCards = Array.isArray(parsed.cards) ? parsed.cards : [];
  }
  if (!cachedSets) {
    const parsed = JSON.parse(fs.readFileSync(SETS_PATH, 'utf8'));
    cachedSets = new Map((parsed.sets || []).map(set => [String(set.id), set]));
  }
  return { cards: cachedCards, sets: cachedSets };
}

function scoreCard(card, query, tokens, setQuery) {
  const name = normalize(card.name);
  const setName = normalize(card.setName);
  const number = normalize(card.number);
  const haystack = `${name} ${setName} ${number}`;
  let score = 0;

  if (query) {
    if (name === query) score += 1000;
    else if (name.startsWith(query)) score += 700;
    else if (name.includes(query)) score += 500;
    for (const token of tokens) {
      if (name === token) score += 120;
      else if (name.startsWith(token)) score += 80;
      else if (name.includes(token)) score += 55;
      else if (setName.includes(token)) score += 35;
      else if (number === token) score += 30;
      else if (haystack.includes(token)) score += 10;
    }
  }

  if (setQuery) {
    if (setName === setQuery) score += 300;
    else if (setName.startsWith(setQuery)) score += 180;
    else if (setName.includes(setQuery)) score += 100;
  }
  return score;
}

function apiHeaders() {
  const headers = {};
  if (process.env.POKEMONTCG_API_KEY) headers['X-Api-Key'] = process.env.POKEMONTCG_API_KEY;
  return headers;
}

async function upstreamDexSearch(params) {
  const clauses = [];
  if (params.q) clauses.push(`name:"${params.q}*"`);
  if (params.dex) clauses.push(`nationalPokedexNumbers:${params.dex}`);
  if (params.number) clauses.push(`number:${params.number}`);
  if (params.set) clauses.push(`set.name:"${params.set}*"`);
  const queryString = clauses.join(' ');
  const apiUrl = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(queryString)}&pageSize=48&orderBy=-set.releaseDate`;
  const response = await fetch(apiUrl, { headers: apiHeaders() });
  if (!response.ok) throw new Error(`Upstream API returned ${response.status}`);
  return response.json();
}

// Local search stays reliable. Pricing gets several independent attempts with
// increasing delays before we give up, so a transient API hiccup is far less
// likely to leave a selected card without its TCGplayer market value.
async function fetchLiveDetails(cards) {
  if (!cards.length) return new Map();
  const ids = cards.map(card => String(card.id || '').trim()).filter(Boolean);
  if (!ids.length) return new Map();

  const clauses = ids.map(id => `id:${id}`).join(' OR ');
  const apiUrl = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(clauses)}&pageSize=${Math.min(ids.length, 48)}`;
  const retryDelays = [0, 450, 1000, 2000];
  let lastError = null;

  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    if (retryDelays[attempt]) await sleep(retryDelays[attempt]);
    try {
      const response = await fetch(apiUrl, {
        headers: apiHeaders(),
        signal: AbortSignal.timeout(7000)
      });
      if (!response.ok) throw new Error(`Pricing API returned ${response.status}`);
      const payload = await response.json();
      const liveMap = new Map((payload.data || []).map(card => [String(card.id), card]));
      if (liveMap.size) return liveMap;
      throw new Error('Pricing API returned no matching cards');
    } catch (error) {
      lastError = error;
      console.warn(`Live pricing attempt ${attempt + 1}/${retryDelays.length} failed:`, error.message || error);
    }
  }

  console.warn('Live TCGplayer pricing unavailable after retries:', lastError);
  return new Map();
}

exports.handler = async function (event) {
  const params = event.queryStringParameters || {};
  const nameRaw = (params.q || '').trim();
  const dexRaw = (params.dex || '').trim();
  const numberRaw = (params.number || '').trim().split('/')[0].trim();
  const setRaw = (params.set || '').trim();

  if (!nameRaw && !dexRaw && !numberRaw) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Provide "q" (name), "dex" (Pokédex number), and/or "number" (card number).' }) };
  }

  if (dexRaw) {
    try {
      const data = await upstreamDexSearch({ q: nameRaw, dex: dexRaw, number: numberRaw, set: setRaw });
      return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' }, body: JSON.stringify(data) };
    } catch (error) {
      return { statusCode: 502, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Pokédex-number search is temporarily unavailable. Name and card-number searches still work locally.' }) };
    }
  }

  try {
    const { cards, sets } = loadDatabase();
    const query = normalize(nameRaw);
    const tokens = query ? query.split(' ').filter(Boolean) : [];
    const setQuery = normalize(setRaw);
    const wantedNumber = normalizeNumber(numberRaw);
    const matches = [];

    for (const card of cards) {
      const cardName = normalize(card.name);
      const cardSet = normalize(card.setName);
      const cardNumber = normalizeNumber(card.number);
      const haystack = `${cardName} ${cardSet} ${normalize(card.number)}`;
      if (wantedNumber && cardNumber !== wantedNumber) continue;
      if (setQuery && !cardSet.includes(setQuery)) continue;
      if (tokens.length && !tokens.every(token => haystack.includes(token))) continue;
      matches.push({ card, score: scoreCard(card, query, tokens, setQuery) });
    }

    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aSet = sets.get(String(a.card.setId));
      const bSet = sets.get(String(b.card.setId));
      const dateCompare = String(bSet?.releaseDate || '').localeCompare(String(aSet?.releaseDate || ''));
      if (dateCompare) return dateCompare;
      return String(a.card.name || '').localeCompare(String(b.card.name || ''));
    });

    const selected = matches.slice(0, 48).map(({ card }) => card);
    const liveDetails = await fetchLiveDetails(selected);

    const data = selected.map(card => {
      const set = sets.get(String(card.setId)) || {};
      const live = liveDetails.get(String(card.id));
      return {
        id: card.id,
        name: card.name,
        number: card.number,
        rarity: card.rarity || live?.rarity || null,
        supertype: card.supertype || live?.supertype || null,
        set: {
          id: card.setId,
          name: card.setName,
          series: set.series || live?.set?.series || '',
          printedTotal: set.printedTotal || live?.set?.printedTotal || null,
          total: set.total || live?.set?.total || null,
          releaseDate: set.releaseDate || live?.set?.releaseDate || ''
        },
        images: {
          small: live?.images?.small || card.image || '',
          large: live?.images?.large || card.image || ''
        },
        tcgplayer: live?.tcgplayer || null,
        cardmarket: live?.cardmarket || null
      };
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
      body: JSON.stringify({ data, count: data.length, totalCount: matches.length, source: 'local-search-live-pricing-retries' })
    };
  } catch (error) {
    console.error('Local card database search failed:', error);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Could not search the local card database. Please try again.' }) };
  }
};
