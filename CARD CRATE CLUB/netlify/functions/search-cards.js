const fs = require('fs');
const path = require('path');
const { getFirebaseAdmin } = require('./_shared');
const { resolveTcgcsvCards } = require('./_tcgcsv');

// Card identity/search is local. Routine exact collection lookups read the
// centralized Firestore master price cache, while broad user searches may still
// request live details so adding/identifying a new card stays useful.
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

function normalizeVariant(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function variantKeys(value) {
  const v = normalizeVariant(value);
  const map = {
    normal: ['normal'], nonholo: ['normal'], nonfoil: ['normal'],
    holo: ['holofoil'], holofoil: ['holofoil'], foil: ['holofoil'],
    reverseholo: ['reverseHolofoil'], reverseholofoil: ['reverseHolofoil'], reversefoil: ['reverseHolofoil'],
    firstedition: ['1stEditionHolofoil', '1stEditionNormal'], '1stedition': ['1stEditionHolofoil', '1stEditionNormal'],
    firsteditionholo: ['1stEditionHolofoil'], firsteditionholofoil: ['1stEditionHolofoil'], '1steditionholo': ['1stEditionHolofoil'],
    firsteditionnormal: ['1stEditionNormal'], '1steditionnormal': ['1stEditionNormal'],
    unlimited: ['unlimitedHolofoil', 'unlimitedNormal'], unlimitedholo: ['unlimitedHolofoil'], unlimitedholofoil: ['unlimitedHolofoil'], unlimitednormal: ['unlimitedNormal'],
    shadowless: ['shadowlessHolofoil', 'shadowlessNormal'], shadowlessholo: ['shadowlessHolofoil'], shadowlessnormal: ['shadowlessNormal']
  };
  return map[v] || [];
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

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

function finiteMarket(block) {
  const value = Number(block?.market);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function selectSafeTcgplayerPrice(card, requestedVariant = '') {
  const prices = card?.tcgplayer?.prices || {};
  const valid = Object.entries(prices).filter(([, block]) => finiteMarket(block) != null);
  if (!valid.length) return { status: 'unavailable', variant: null, market: null, prices: {} };
  const requestedKeys = variantKeys(requestedVariant).filter(key => finiteMarket(prices[key]) != null);
  if (requestedKeys.length === 1) {
    const key = requestedKeys[0];
    return { status: 'exact-variant', variant: key, market: finiteMarket(prices[key]), prices: { [key]: prices[key] } };
  }
  if (valid.length === 1) {
    const [variant, block] = valid[0];
    return { status: 'exact', variant, market: finiteMarket(block), prices: { [variant]: block } };
  }
  const rarity = normalize(card?.rarity);
  const name = normalize(card?.name);
  const has = key => finiteMarket(prices[key]) != null;
  const choose = key => ({ status: 'inferred', variant: key, market: finiteMarket(prices[key]), prices: { [key]: prices[key] } });
  if ((rarity === 'common' || rarity === 'uncommon' || rarity === 'rare') && has('normal')) return choose('normal');
  if ((rarity.includes('holo') || /\b(ex|gx|v|vmax|vstar)\b/.test(name)) && has('holofoil')) return choose('holofoil');
  const ordinary = valid.filter(([key]) => !/(reverse|1st|first|unlimited|shadowless)/i.test(key));
  if (ordinary.length === 1) return choose(ordinary[0][0]);
  return { status: 'ambiguous', variant: null, market: null, prices: {} };
}

function sanitizeLiveCard(card, requestedVariant = '') {
  if (!card || typeof card !== 'object') return card;
  const selected = selectSafeTcgplayerPrice(card, requestedVariant);
  const tcgplayer = card.tcgplayer ? { ...card.tcgplayer, prices: selected.prices } : null;
  return {
    ...card,
    tcgplayer,
    pricing: { source: 'tcgplayer', status: selected.status, variant: selected.variant, requestedVariant: requestedVariant || null, market: selected.market }
  };
}

async function upstreamDexSearch(params) {
  const clauses = [];
  if (params.q) clauses.push(`name:"${params.q}*"`);
  if (params.dex) clauses.push(`nationalPokedexNumbers:${params.dex}`);
  if (params.number) clauses.push(`number:${params.number}`);
  if (params.set) clauses.push(`set.name:"${params.set}*"`);
  const queryString = clauses.join(' ');
  const apiUrl = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(queryString)}&pageSize=48&orderBy=-set.releaseDate`;
  const response = await fetch(apiUrl, { headers: apiHeaders(), signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error(`Upstream API returned ${response.status}`);
  const payload = await response.json();
  return { ...payload, data: (payload.data || []).map(card => sanitizeLiveCard(card, params.variant || '')) };
}

async function fetchLiveDetails(cards, requestedVariant = '') {
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
      const response = await fetch(apiUrl, { headers: apiHeaders(), signal: AbortSignal.timeout(7000) });
      if (!response.ok) throw new Error(`Pricing API returned ${response.status}`);
      const payload = await response.json();
      const liveMap = new Map((payload.data || []).map(card => {
        const clean = sanitizeLiveCard(card, requestedVariant);
        return [String(clean.id), clean];
      }));
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

function masterMatchesVariant(row, requestedVariant) {
  const wanted = normalizeVariant(requestedVariant);
  if (!wanted) return true;
  const requested = normalizeVariant(row.requestedVariant || '');
  const resolved = normalizeVariant(row.priceVariant || '');
  const keys = variantKeys(requestedVariant).map(normalizeVariant);
  return requested === wanted || resolved === wanted || keys.includes(resolved);
}

async function fetchMasterPrices(cards, requestedVariant = '') {
  const result = new Map();
  if (!cards.length) return result;
  try {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();
    await Promise.all(cards.map(async card => {
      const id = String(card.id || '').trim();
      if (!id) return;
      const snap = await db.collection('cardPrices').where('cardId', '==', id).limit(12).get();
      const rows = snap.docs.map(doc => doc.data()).filter(row => masterMatchesVariant(row, requestedVariant));
      const usable = rows.filter(row => Number.isFinite(Number(row.marketPrice)) && Number(row.marketPrice) > 0);
      const row = usable.sort((a, b) => {
        const aExact = normalizeVariant(a.requestedVariant || a.priceVariant) === normalizeVariant(requestedVariant) ? 1 : 0;
        const bExact = normalizeVariant(b.requestedVariant || b.priceVariant) === normalizeVariant(requestedVariant) ? 1 : 0;
        return bExact - aExact;
      })[0] || rows[0];
      if (row) result.set(id, row);
    }));
  } catch (error) {
    console.warn('Master price cache lookup failed:', error.message || error);
  }
  return result;
}

function masterCardShape(card, set, master, variantRaw) {
  const market = Number(master?.marketPrice);
  const validMarket = Number.isFinite(market) && market > 0 ? market : null;
  const variant = master?.priceVariant || null;
  const prices = validMarket && variant ? { [variant]: { market: validMarket } } : {};
  return {
    id: card.id,
    name: master?.name || card.name,
    number: master?.number || card.number,
    rarity: card.rarity || null,
    supertype: card.supertype || null,
    set: {
      id: card.setId,
      name: master?.set || card.setName,
      series: set.series || '',
      printedTotal: set.printedTotal || null,
      total: set.total || null,
      releaseDate: set.releaseDate || ''
    },
    images: { small: card.image || '', large: card.image || '' },
    tcgplayer: master?.tcgplayerUrl ? { url: master.tcgplayerUrl, prices } : (validMarket ? { prices } : null),
    pricing: {
      source: 'master-cache',
      status: master?.pricingStatus || (validMarket ? 'exact' : 'unavailable'),
      variant,
      requestedVariant: variantRaw || null,
      market: validMarket
    },
    cardmarket: null
  };
}

exports.handler = async function (event) {
  const params = event.queryStringParameters || {};
  const nameRaw = (params.q || '').trim();
  const dexRaw = (params.dex || '').trim();
  const numberRaw = (params.number || '').trim().split('/')[0].trim();
  const setRaw = (params.set || '').trim();
  const variantRaw = (params.variant || '').trim();

  if (!nameRaw && !dexRaw && !numberRaw) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Provide "q" (name), "dex" (Pokédex number), and/or "number" (card number).' }) };
  }

  if (dexRaw) {
    try {
      const data = await upstreamDexSearch({ q: nameRaw, dex: dexRaw, number: numberRaw, set: setRaw, variant: variantRaw });
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
    const isRoutineExactLookup = Boolean(nameRaw && setRaw && numberRaw && !dexRaw);

    if (isRoutineExactLookup) {
      const masters = await fetchMasterPrices(selected, variantRaw);
      const needsFallback = selected.filter(card => {
        const master = masters.get(String(card.id));
        const market = Number(master?.marketPrice);
        return !(Number.isFinite(market) && market > 0) || !master?.tcgplayerUrl;
      });
      let fallback = new Map();
      if (needsFallback.length) {
        try { fallback = await resolveTcgcsvCards(needsFallback, variantRaw); }
        catch (error) { console.warn('TCGCSV exact fallback failed:', error.message || error); }
      }
      const data = selected.map(card => {
        const id = String(card.id);
        const set = sets.get(String(card.setId)) || {};
        const master = masters.get(id);
        const base = masterCardShape(card, set, master, variantRaw);
        const resolved = fallback.get(id);
        if (!resolved) return base;
        const fallbackMarket = Number(resolved.marketPrice);
        const masterMarket = Number(master?.marketPrice);
        const market = Number.isFinite(masterMarket) && masterMarket > 0 ? masterMarket : (Number.isFinite(fallbackMarket) && fallbackMarket > 0 ? fallbackMarket : null);
        const variant = master?.priceVariant || resolved.priceVariant || null;
        return {
          ...base,
          tcgplayer: {
            ...(base.tcgplayer || {}),
            url: base.tcgplayer?.url || resolved.tcgplayerUrl || '',
            prices: market && variant ? { [variant]: { market } } : (base.tcgplayer?.prices || {})
          },
          pricing: {
            source: Number.isFinite(masterMarket) && masterMarket > 0 ? 'master-cache' : 'tcgcsv-tcgplayer-fallback',
            status: master?.pricingStatus || resolved.pricingStatus || (market ? 'exact' : 'unavailable'),
            variant,
            requestedVariant: variantRaw || null,
            market
          }
        };
      });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' },
        body: JSON.stringify({ data, count: data.length, totalCount: matches.length, source: 'local-search-master-with-tcgcsv-fallback', version: 'pricing-relay-v5' })
      };
    }

    const liveDetails = await fetchLiveDetails(selected, variantRaw);
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
        images: { small: live?.images?.small || card.image || '', large: live?.images?.large || card.image || '' },
        tcgplayer: live?.tcgplayer || null,
        pricing: live?.pricing || { source: 'tcgplayer', status: 'unavailable', variant: null, requestedVariant: variantRaw || null, market: null },
        cardmarket: live?.cardmarket || null
      };
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
      body: JSON.stringify({ data, count: data.length, totalCount: matches.length, source: 'local-search-live-pricing-safe-variants' })
    };
  } catch (error) {
    console.error('Local card database search failed:', error);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Could not search the local card database. Please try again.' }) };
  }
};
