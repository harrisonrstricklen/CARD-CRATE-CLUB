const { getFirebaseAdmin, json } = require('./_shared');

function normalizeVariant(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLanguage(value) {
  const v = String(value || '').toLowerCase();
  return v === 'ja' || v === 'jp' || v.includes('japanese') ? 'ja' : 'en';
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

function finiteMarket(block) {
  const n = Number(block?.market ?? block?.marketPrice);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function safePrice(card, requestedVariant = '') {
  const prices = card?.tcgplayer?.prices || {};
  const valid = Object.entries(prices).filter(([, block]) => finiteMarket(block) != null);
  if (!valid.length) return { status: 'unavailable', variant: null, marketPrice: null };

  const requested = variantKeys(requestedVariant).filter(key => finiteMarket(prices[key]) != null);
  if (requested.length === 1) return { status: 'exact-variant', variant: requested[0], marketPrice: finiteMarket(prices[requested[0]]) };
  if (valid.length === 1) return { status: 'exact', variant: valid[0][0], marketPrice: finiteMarket(valid[0][1]) };

  const rarity = String(card?.rarity || '').toLowerCase();
  const name = String(card?.name || '').toLowerCase();
  const has = key => finiteMarket(prices[key]) != null;
  if ((rarity === 'common' || rarity === 'uncommon' || rarity === 'rare') && has('normal')) return { status: 'inferred', variant: 'normal', marketPrice: finiteMarket(prices.normal) };
  if ((rarity.includes('holo') || /\b(ex|gx|v|vmax|vstar)\b/i.test(name)) && has('holofoil')) return { status: 'inferred', variant: 'holofoil', marketPrice: finiteMarket(prices.holofoil) };

  const ordinary = valid.filter(([key]) => !/(reverse|1st|first|unlimited|shadowless)/i.test(key));
  if (ordinary.length === 1) return { status: 'inferred', variant: ordinary[0][0], marketPrice: finiteMarket(ordinary[0][1]) };
  return { status: 'ambiguous', variant: null, marketPrice: null };
}

function safePriceRows(rows, requestedVariant = '', rarity = '', name = '') {
  const valid = (rows || []).filter(row => finiteMarket(row) != null);
  if (!valid.length) return { status: 'unavailable', variant: null, marketPrice: null };
  const requestedKeys = variantKeys(requestedVariant).map(normalizeVariant);
  const requested = valid.filter(row => requestedKeys.includes(normalizeVariant(row.subTypeName)));
  if (requested.length === 1) return { status: 'exact-variant', variant: requested[0].subTypeName, marketPrice: finiteMarket(requested[0]) };
  if (valid.length === 1) return { status: 'exact', variant: valid[0].subTypeName, marketPrice: finiteMarket(valid[0]) };

  const r = String(rarity || '').toLowerCase();
  const n = String(name || '').toLowerCase();
  const normal = valid.find(row => normalizeVariant(row.subTypeName) === 'normal');
  const holo = valid.find(row => normalizeVariant(row.subTypeName) === 'holofoil');
  if ((r === 'common' || r === 'uncommon' || r === 'rare') && normal) return { status: 'inferred', variant: normal.subTypeName, marketPrice: finiteMarket(normal) };
  if ((r.includes('holo') || /\b(ex|gx|v|vmax|vstar)\b/i.test(n)) && holo) return { status: 'inferred', variant: holo.subTypeName, marketPrice: finiteMarket(holo) };
  const ordinary = valid.filter(row => !/(reverse|1st|first|unlimited|shadowless)/i.test(String(row.subTypeName || '')));
  if (ordinary.length === 1) return { status: 'inferred', variant: ordinary[0].subTypeName, marketPrice: finiteMarket(ordinary[0]) };
  return { status: 'ambiguous', variant: null, marketPrice: null };
}

function priceKey(item) {
  const language = normalizeLanguage(item.language);
  const cardId = String(item.apiId || item.sourceId || '').trim();
  if (!cardId) return '';
  const variant = normalizeVariant(item.priceVariant || item.variance || '') || 'auto';
  return `${language}__${cardId}__${variant}`.replace(/\//g, '_');
}

function apiHeaders() {
  const headers = {};
  if (process.env.POKEMONTCG_API_KEY) headers['X-Api-Key'] = process.env.POKEMONTCG_API_KEY;
  return headers;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function requestCardBatch(ids) {
  const q = ids.map(id => `id:${id}`).join(' OR ');
  const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=${ids.length}`;
  const res = await fetch(url, { headers: apiHeaders(), signal: AbortSignal.timeout(7000) });
  if (!res.ok) throw new Error(`Pokemon TCG API returned ${res.status}`);
  const body = await res.json();
  return body.data || [];
}

async function fetchCardsResilient(ids, deadlineMs) {
  const out = new Map();
  const failed = new Set();
  const queue = [];
  for (let i = 0; i < ids.length; i += 30) queue.push(ids.slice(i, i + 30));

  while (queue.length && Date.now() < deadlineMs) {
    const batch = queue.shift();
    let cards = null;
    let lastError = null;
    for (const delay of [0, 350, 900]) {
      if (Date.now() >= deadlineMs) break;
      if (delay) await sleep(delay);
      try {
        cards = await requestCardBatch(batch);
        break;
      } catch (error) {
        lastError = error;
        console.warn(`Master price batch failed (${batch.length} cards), retrying:`, error.message || error);
      }
    }

    if (cards) {
      const returned = new Set();
      for (const card of cards) {
        const id = String(card.id || '');
        if (!id) continue;
        returned.add(id);
        out.set(id, card);
      }
      const missing = batch.filter(id => !returned.has(String(id)));
      if (missing.length) {
        if (missing.length === 1) failed.add(missing[0]);
        else {
          const half = Math.ceil(missing.length / 2);
          queue.push(missing.slice(0, half), missing.slice(half));
        }
      }
      continue;
    }

    if (batch.length > 1 && Date.now() < deadlineMs) {
      const half = Math.ceil(batch.length / 2);
      queue.push(batch.slice(0, half), batch.slice(half));
    } else {
      for (const id of batch) failed.add(id);
      console.warn('Master price card deferred until next run:', batch.join(','), lastError?.message || lastError || 'unknown error');
    }
  }
  for (const batch of queue) for (const id of batch) failed.add(id);
  return { cards: out, failedIds: [...failed] };
}

function extractProductId(url) {
  const m = String(url || '').match(/\/product\/(\d+)/i);
  return m ? Number(m[1]) : null;
}

function resolveGroupId(setName, groups) {
  const wanted = normalizeText(setName);
  if (!wanted) return null;
  let best = null;
  let bestScore = -1;
  for (const group of groups || []) {
    const g = normalizeText(group.name);
    if (!g) continue;
    let score = -1;
    if (g === wanted) score = 100;
    else if (g.endsWith(wanted)) score = 90;
    else if (g.includes(wanted)) score = 70;
    else if (wanted.includes(g)) score = 50;
    if (score > bestScore) { bestScore = score; best = group.groupId; }
  }
  return bestScore >= 70 ? best : null;
}

async function fetchJson(url, timeout = 5000) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'CardCrateClub/1.0 pricing-cache' },
    signal: AbortSignal.timeout(timeout)
  });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}

// TCGCSV mirrors TCGplayer's product/group market-price exports and updates
// daily. It is a fallback only when the primary Pokemon TCG API cannot return
// live TCGplayer pricing. This prevents imported/stale prices from surviving
// indefinitely just because the primary API is rate-limited or temporarily down.
async function fetchTcgCsvFallback(wanted, primaryLive, deadlineMs) {
  const fallback = new Map();
  if (Date.now() >= deadlineMs - 3000) return fallback;
  const unresolved = [...wanted.entries()].filter(([, item]) => !primaryLive.has(item.apiId) && extractProductId(item.tcgplayerUrl));
  if (!unresolved.length) return fallback;

  let groups;
  try {
    const payload = await fetchJson('https://tcgcsv.com/tcgplayer/3/groups', 4500);
    groups = payload.results || [];
  } catch (error) {
    console.warn('TCGCSV group fallback unavailable:', error.message || error);
    return fallback;
  }

  const byGroup = new Map();
  for (const [key, item] of unresolved) {
    const productId = extractProductId(item.tcgplayerUrl);
    const groupId = resolveGroupId(item.set, groups);
    if (!productId || !groupId) continue;
    if (!byGroup.has(groupId)) byGroup.set(groupId, []);
    byGroup.get(groupId).push({ key, item, productId });
  }

  for (const [groupId, entries] of byGroup) {
    if (Date.now() >= deadlineMs - 2500) break;
    try {
      const payload = await fetchJson(`https://tcgcsv.com/tcgplayer/3/${groupId}/prices`, 4500);
      const rowsByProduct = new Map();
      for (const row of payload.results || []) {
        const id = Number(row.productId);
        if (!rowsByProduct.has(id)) rowsByProduct.set(id, []);
        rowsByProduct.get(id).push(row);
      }
      for (const entry of entries) {
        const picked = safePriceRows(rowsByProduct.get(entry.productId) || [], entry.item.priceVariant || entry.item.variance || '', entry.item.rarity, entry.item.name);
        if (picked.marketPrice != null) fallback.set(entry.key, { ...picked, productId: entry.productId });
      }
      await sleep(120);
    } catch (error) {
      console.warn(`TCGCSV price fallback failed for group ${groupId}:`, error.message || error);
    }
  }
  return fallback;
}

async function commitWrites(db, writes, merge = true) {
  let committed = 0;
  const failedBatches = [];
  for (let i = 0; i < writes.length; i += 350) {
    const chunk = writes.slice(i, i + 350);
    try {
      const batch = db.batch();
      for (const write of chunk) batch.set(write.ref, write.data, merge ? { merge: true } : undefined);
      await batch.commit();
      committed += chunk.length;
    } catch (error) {
      failedBatches.push({ start: i, count: chunk.length, error: error.message || String(error) });
      console.error('Master price Firestore batch deferred:', error);
    }
  }
  return { committed, failedBatches };
}

exports.handler = async function() {
  const startedAt = Date.now();
  const fetchDeadline = startedAt + 22000;

  try {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();
    const collectionSnap = await db.collectionGroup('collection').get();
    const wanted = new Map();

    for (const snap of collectionSnap.docs) {
      const item = snap.data() || {};
      const language = normalizeLanguage(item.language);
      const apiId = String(item.apiId || item.sourceId || '').trim();
      if (!apiId || language !== 'en' || apiId.startsWith('ja:')) continue;
      const key = priceKey(item);
      if (!wanted.has(key)) wanted.set(key, {
        apiId,
        language,
        priceVariant: item.priceVariant || '',
        variance: item.variance || '',
        name: item.name || '',
        set: item.set || '',
        number: item.number || '',
        rarity: item.rarity || '',
        tcgplayerUrl: item.tcgplayerUrl || '',
        owners: []
      });
      wanted.get(key).owners.push({ ref: snap.ref, data: item });
    }

    const uniqueIds = [...new Set([...wanted.values()].map(x => x.apiId))];
    if (!uniqueIds.length) return json(200, { updatedPrices: 0, updatedCollectionRows: 0, uniqueCards: 0, message: 'No English collection cards need pricing yet.' });

    const { cards: live, failedIds } = await fetchCardsResilient(uniqueIds, fetchDeadline);
    const tcgCsv = await fetchTcgCsvFallback(wanted, live, fetchDeadline);
    const priceWrites = [];
    const collectionWrites = [];
    const now = admin.firestore.FieldValue.serverTimestamp();
    let fallbackResolved = 0;

    for (const [key, item] of wanted) {
      const card = live.get(item.apiId);
      const fallback = tcgCsv.get(key);
      let picked;
      let master;

      if (card) {
        picked = safePrice(card, item.priceVariant || item.variance || '');
        master = {
          key, cardId: item.apiId, language: 'en',
          requestedVariant: item.priceVariant || item.variance || null,
          marketPrice: picked.marketPrice, pricingStatus: picked.status, priceVariant: picked.variant,
          name: card.name || item.name, set: card.set?.name || item.set, number: card.number || item.number,
          tcgplayerUrl: card.tcgplayer?.url || item.tcgplayerUrl || '', source: 'tcgplayer', updatedAt: now
        };
      } else if (fallback) {
        picked = fallback;
        fallbackResolved += 1;
        master = {
          key, cardId: item.apiId, language: 'en',
          requestedVariant: item.priceVariant || item.variance || null,
          marketPrice: picked.marketPrice, pricingStatus: picked.status, priceVariant: picked.variant,
          name: item.name, set: item.set, number: item.number,
          tcgplayerUrl: item.tcgplayerUrl || '', tcgplayerProductId: fallback.productId,
          source: 'tcgcsv-tcgplayer', updatedAt: now
        };
      } else {
        continue;
      }

      priceWrites.push({ ref: db.collection('cardPrices').doc(key), data: master });

      if (picked.marketPrice != null) {
        for (const owner of item.owners) {
          collectionWrites.push({
            ref: owner.ref,
            data: {
              cardPriceKey: key,
              value: picked.marketPrice,
              marketPrice: picked.marketPrice,
              marketPriceUpdatedAt: now,
              pricingStatus: picked.status,
              priceVariant: picked.variant,
              priceSource: master.source === 'tcgplayer' ? 'master-tcgplayer' : 'master-tcgcsv-tcgplayer'
            }
          });
        }
      }
    }

    const priceCommit = await commitWrites(db, priceWrites);
    const collectionCommit = await commitWrites(db, collectionWrites);

    return json(200, {
      updatedPrices: priceCommit.committed,
      updatedCollectionRows: collectionCommit.committed,
      uniqueCardsRequested: uniqueIds.length,
      uniqueCardsResolvedPrimary: live.size,
      uniqueCardsResolvedFallback: fallbackResolved,
      deferredCards: Math.max(0, uniqueIds.length - live.size - fallbackResolved),
      primaryDeferredCardIds: failedIds.slice(0, 25),
      failedPriceWriteBatches: priceCommit.failedBatches.length,
      failedCollectionWriteBatches: collectionCommit.failedBatches.length,
      ownedRowsScanned: collectionSnap.size,
      partialSuccess: (live.size + fallbackResolved) < uniqueIds.length || priceCommit.failedBatches.length > 0 || collectionCommit.failedBatches.length > 0,
      durationMs: Date.now() - startedAt
    });
  } catch (error) {
    console.error('Scheduled master price refresh failed before partial processing could complete:', error);
    return json(500, { error: 'Master price refresh failed', detail: error.message });
  }
};
