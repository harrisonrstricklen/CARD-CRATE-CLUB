const { getFirebaseAdmin, json } = require('./_shared');

function normalizeVariant(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
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
  const n = Number(block?.market);
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

// Pricing refreshes are intentionally partial-success. One bad API request or
// one troublesome card must never cancel prices that were successfully found.
// Failed cards are left untouched and will be tried again on the next schedule.
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
      // An upstream 200 response can still omit individual IDs. Retry only the
      // missing IDs independently instead of discarding the successful cards.
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

  // Anything not reached before the function deadline is deferred, not failed.
  for (const batch of queue) for (const id of batch) failed.add(id);
  return { cards: out, failedIds: [...failed] };
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
      // Do not undo earlier successful chunks. The next scheduled run will retry
      // these documents from the master source.
      failedBatches.push({ start: i, count: chunk.length, error: error.message || String(error) });
      console.error('Master price Firestore batch deferred:', error);
    }
  }
  return { committed, failedBatches };
}

exports.handler = async function() {
  const startedAt = Date.now();
  // Leave several seconds for Firestore writes before Netlify's scheduled
  // function execution limit is reached.
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
      if (!wanted.has(key)) wanted.set(key, { apiId, language, priceVariant: item.priceVariant || '', variance: item.variance || '', owners: [] });
      wanted.get(key).owners.push({ ref: snap.ref, data: item });
    }

    const uniqueIds = [...new Set([...wanted.values()].map(x => x.apiId))];
    if (!uniqueIds.length) return json(200, { updatedPrices: 0, updatedCollectionRows: 0, uniqueCards: 0, message: 'No English collection cards need pricing yet.' });

    const { cards: live, failedIds } = await fetchCardsResilient(uniqueIds, fetchDeadline);
    const priceWrites = [];
    const collectionWrites = [];
    const now = admin.firestore.FieldValue.serverTimestamp();

    for (const [key, item] of wanted) {
      const card = live.get(item.apiId);
      if (!card) continue; // Keep the previous master price; retry next run.
      const picked = safePrice(card, item.priceVariant || item.variance || '');
      const master = {
        key,
        cardId: item.apiId,
        language: 'en',
        requestedVariant: item.priceVariant || item.variance || null,
        marketPrice: picked.marketPrice,
        pricingStatus: picked.status,
        priceVariant: picked.variant,
        name: card.name || '',
        set: card.set?.name || '',
        number: card.number || '',
        tcgplayerUrl: card.tcgplayer?.url || '',
        source: 'tcgplayer',
        updatedAt: now
      };
      priceWrites.push({ ref: db.collection('cardPrices').doc(key), data: master });

      if (picked.marketPrice != null) {
        for (const owner of item.owners) {
          const oldMarket = Number(owner.data.marketPrice);
          const oldValue = Number(owner.data.value);
          const wasAutoPriced = Number.isFinite(oldMarket) && Number.isFinite(oldValue) && Math.abs(oldValue - oldMarket) < 0.02;
          const patch = {
            cardPriceKey: key,
            marketPrice: picked.marketPrice,
            marketPriceUpdatedAt: now,
            pricingStatus: picked.status,
            priceVariant: picked.variant,
            priceSource: 'master-tcgplayer'
          };
          if (wasAutoPriced) patch.value = picked.marketPrice;
          collectionWrites.push({ ref: owner.ref, data: patch });
        }
      }
    }

    const priceCommit = await commitWrites(db, priceWrites);
    const collectionCommit = await commitWrites(db, collectionWrites);

    return json(200, {
      updatedPrices: priceCommit.committed,
      updatedCollectionRows: collectionCommit.committed,
      uniqueCardsRequested: uniqueIds.length,
      uniqueCardsResolved: live.size,
      deferredCards: failedIds.length,
      deferredCardIds: failedIds.slice(0, 25),
      failedPriceWriteBatches: priceCommit.failedBatches.length,
      failedCollectionWriteBatches: collectionCommit.failedBatches.length,
      ownedRowsScanned: collectionSnap.size,
      partialSuccess: failedIds.length > 0 || priceCommit.failedBatches.length > 0 || collectionCommit.failedBatches.length > 0,
      durationMs: Date.now() - startedAt
    });
  } catch (error) {
    console.error('Scheduled master price refresh failed before partial processing could complete:', error);
    return json(500, { error: 'Master price refresh failed', detail: error.message });
  }
};
