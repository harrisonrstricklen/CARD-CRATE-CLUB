const fs = require('fs');
const path = require('path');

// Search Card Crate Club's generated 20k+ card database locally instead of
// depending on the Pokemon TCG API for every Add Card search. This makes name,
// set and card-number searches fast and removes the old public-API failure mode.
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

async function upstreamDexSearch(params) {
  const clauses = [];
  if (params.q) clauses.push(`name:"${params.q}*"`);
  if (params.dex) clauses.push(`nationalPokedexNumbers:${params.dex}`);
  if (params.number) clauses.push(`number:${params.number}`);
  if (params.set) clauses.push(`set.name:"${params.set}*"`);
  const queryString = clauses.join(' ');
  const apiUrl = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(queryString)}&pageSize=48&orderBy=-set.releaseDate`;
  const headers = {};
  if (process.env.POKEMONTCG_API_KEY) headers['X-Api-Key'] = process.env.POKEMONTCG_API_KEY;
  const response = await fetch(apiUrl, { headers });
  if (!response.ok) throw new Error(`Upstream API returned ${response.status}`);
  return response.json();
}

exports.handler = async function (event) {
  const params = event.queryStringParameters || {};
  const nameRaw = (params.q || '').trim();
  const dexRaw = (params.dex || '').trim();
  const numberRaw = (params.number || '').trim().split('/')[0].trim();
  const setRaw = (params.set || '').trim();

  if (!nameRaw && !dexRaw && !numberRaw) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Provide "q" (name), "dex" (Pokédex number), and/or "number" (card number).' })
    };
  }

  // The current compact local index does not yet carry Pokédex numbers. Keep
  // that specialist search available through the upstream API while every
  // normal name/set/card-number search uses our local database.
  if (dexRaw) {
    try {
      const data = await upstreamDexSearch({ q: nameRaw, dex: dexRaw, number: numberRaw, set: setRaw });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
        body: JSON.stringify(data)
      };
    } catch (error) {
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Pokédex-number search is temporarily unavailable. Name and card-number searches still work locally.' })
      };
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

      const score = scoreCard(card, query, tokens, setQuery);
      matches.push({ card, score });
    }

    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aSet = sets.get(String(a.card.setId));
      const bSet = sets.get(String(b.card.setId));
      const dateCompare = String(bSet?.releaseDate || '').localeCompare(String(aSet?.releaseDate || ''));
      if (dateCompare) return dateCompare;
      return String(a.card.name || '').localeCompare(String(b.card.name || ''));
    });

    const data = matches.slice(0, 48).map(({ card }) => {
      const set = sets.get(String(card.setId)) || {};
      return {
        id: card.id,
        name: card.name,
        number: card.number,
        rarity: card.rarity || null,
        supertype: card.supertype || null,
        set: {
          id: card.setId,
          name: card.setName,
          series: set.series || '',
          printedTotal: set.printedTotal || null,
          total: set.total || null,
          releaseDate: set.releaseDate || ''
        },
        images: {
          small: card.image || '',
          large: card.image || ''
        }
      };
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300'
      },
      body: JSON.stringify({ data, count: data.length, totalCount: matches.length, source: 'card-crate-club-local-database' })
    };
  } catch (error) {
    console.error('Local card database search failed:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Could not search the local card database. Please try again.' })
    };
  }
};
