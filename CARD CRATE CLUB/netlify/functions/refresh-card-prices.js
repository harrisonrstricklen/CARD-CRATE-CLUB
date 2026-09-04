const { getFirebaseAdmin, json, requireUser } = require('./_shared');
const { normalizeText, normalizeNumber, normalizeVariant, variantKeys, resolveProduct, resolveGroup, choosePrice } = require('./_tcgcsv');

const TCGCSV_BASE = 'https://tcgcsv.com/tcgplayer/3';
const FRESH_MS = 4 * 60 * 1000;
const MASTER_FRESH_MS = 30 * 60 * 1000;
const FUNCTION_BUDGET_MS = 22000;

function normalizeLanguage(value) {
  const v = String(value || '').toLowerCase();
  return v === 'ja' || v === 'jp' || v.includes('japanese') ? 'ja' : 'en';
}

function finiteMarket(row) {
  const n = Number(row?.marketPrice ?? row?.market);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function extractProductId(url) {
  const match = String(url || '').match(/\/product\/(\d+)/i);
  return match ? Number(match[1]) : null;
}

function resolveLinkedProduct(item, products) {
  const linkedId = extractProductId(item.tcgplayerUrl);
  if (linkedId) {
    const linked = products.find(p => Number(p.productId) === linkedId);
    if (linked) return linked;
  }
  return resolveProduct(item, products);
}

async function fetchJson(url, timeout = 4500) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'CardCrateClub/1.0 master-pricing' },
    signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value.seconds) return value.seconds * 1000;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isTrustedFresh(item) {
  const market = Number(item.marketPrice);
  const source = String(item.priceSource || '');
  if (!Number.isFinite(market) || market <= 0) return false;
  if (!source.startsWith('master-') && !source.startsWith('live-')) return false;
  const updated = timestampMs(item.marketPriceUpdatedAt);
  return updated > 0 && Date.now() - updated < FRESH_MS;
}

function priceKey(item, variant) {
  const language = normalizeLanguage(item.language);
  const cardId = String(item.apiId || item.sourceId || '').trim();
  const v = normalizeVariant(variant || '') || 'auto';
  return `${language}__${cardId}__${v}`.replace(/\//g, '_');
}

function slug(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function identityKey(item, variant) {
  const language = normalizeLanguage(item.language);
  const set = slug(item.set || item.setName || '');
  const name = slug(item.name || '');
  const number = normalizeNumber(item.number || '');
  if (!set || !name || !number) return '';
  const v = normalizeVariant(variant || '') || 'auto';
  return `${language}__lookup__${set}__${name}__${number}__${v}`;
}

function selectedVariant(item) {
  return item.variance || item.priceVariant || '';
}

function orderedVariantKeys(item) {
  const requested = variantKeys(selectedVariant(item));
  if (!requested.length) return ['auto'];
  if (requested.length === 1) return requested;
  const rarity = normalizeText(item.rarity || '');
  const name = normalizeText(item.name || '');
  const holoLikely = rarity.includes('holo') || /\b(ex|gx|v|vmax|vstar)\b/.test(name);
  return requested.slice().sort((a, b) => {
    const score = key => holoLikely ? (key.includes('holofoil') ? 2 : 1) : (key.includes('normal') && !key.includes('reverse') ? 2 : 1);
    return score(b) - score(a);
  });
}

async function fetchMasterRows(db, keys) {
  const rows = new Map();
  const unique = [...new Set(keys.filter(Boolean))];
  for (let start = 0; start < unique.length; start += 300) {
    const chunk = unique.slice(start, start + 300);
    const snaps = await db.getAll(...chunk.map(key => db.collection('cardPrices').doc(key)));
    snaps.forEach((snap, index) => {
      if (snap.exists) rows.set(chunk[index], snap.data() || {});
    });
  }
  return rows;
}

function freshMasterHit(item, rows) {
  for (const variant of orderedVariantKeys(item)) {
    const key = priceKey(item, variant);
    const row = rows.get(key);
    const market = Number(row?.marketPrice);
    const updated = timestampMs(row?.updatedAt);
    if (Number.isFinite(market) && market > 0 && updated > 0 && Date.now() - updated < MASTER_FRESH_MS) {
      return { key, row, market };
    }
  }
  return null;
}

async function commitWrites(db, writes) {
  const unique = new Map();
  for (const write of writes) unique.set(write.ref.path, write);
  const list = [...unique.values()];
  let committed = 0;
  for (let start = 0; start < list.length; start += 300) {
    const chunk = list.slice(start, start + 300);
    const batch = db.batch();
    for (const write of chunk) batch.set(write.ref, write.data, { merge: true });
    await batch.commit();
    committed += chunk.length;
  }
  return committed;
}

function masterRow({ entry, product, group, variant, marketPrice, now, status = 'master-variant' }) {
  const tcgplayerProductId = Number(product.productId);
  return {
    cardId: entry.cardId,
    language: 'en',
    name: entry.item.name || product.name || '',
    set: entry.item.set || group.name || '',
    number: entry.item.number || '',
    requestedVariant: null,
    marketPrice,
    pricingStatus: status,
    priceVariant: variant,
    tcgplayerProductId,
    tcgplayerUrl: entry.item.tcgplayerUrl || product.url || `https://www.tcgplayer.com/product/${tcgplayerProductId}`,
    source: 'tcgcsv-tcgplayer',
    updatedAt: now
  };
}

exports.handler = async function(event = {}) {
  const startedAt = Date.now();
  const deadline = startedAt + FUNCTION_BUDGET_MS;

  try {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();

    let snapshot;
    if (event.httpMethod === 'POST') {
      const user = await requireUser(event);
      snapshot = await db.collection('users').doc(user.uid).collection('collection').get();
    } else {
      snapshot = await db.collectionGroup('collection').get();
    }

    const candidates = [];
    for (const docSnap of snapshot.docs) {
      const item = docSnap.data() || {};
      const language = normalizeLanguage(item.language);
      const cardId = String(item.apiId || item.sourceId || '').trim();
      if (!cardId || language !== 'en' || cardId.startsWith('ja:')) continue;
      if (isTrustedFresh(item)) continue;
      candidates.push({ ref: docSnap.ref, item, cardId, updatedMs: timestampMs(item.marketPriceUpdatedAt) });
    }

    candidates.sort((a, b) => {
      const aHas = Number(a.item.marketPrice) > 0 ? 1 : 0;
      const bHas = Number(b.item.marketPrice) > 0 ? 1 : 0;
      if (aHas !== bHas) return aHas - bHas;
      return a.updatedMs - b.updatedMs;
    });

    if (!candidates.length) {
      return json(200, { updatedPrices: 0, updatedCollectionRows: 0, masterCacheHits: 0, waiting: 0, message: 'All eligible collection prices are fresh.' });
    }

    // First satisfy stale collection rows from the shared master archive.
    // External TCGCSV traffic is only used for variants that are missing or stale here.
    const masterKeys = candidates.flatMap(entry => orderedVariantKeys(entry.item).map(variant => priceKey(entry.item, variant)));
    const masterRows = await fetchMasterRows(db, masterKeys);
    const collectionWrites = [];
    const processedRefs = new Set();
    let masterCacheHits = 0;

    for (const entry of candidates) {
      const hit = freshMasterHit(entry.item, masterRows);
      if (!hit) continue;
      const row = hit.row;
      masterCacheHits += 1;
      processedRefs.add(entry.ref.path);
      collectionWrites.push({
        ref: entry.ref,
        data: {
          cardPriceKey: hit.key,
          value: hit.market,
          valueSource: 'master-market',
          marketPrice: hit.market,
          marketPriceUpdatedAt: now,
          pricingStatus: row.pricingStatus || 'master-variant',
          priceVariant: row.priceVariant || selectedVariant(entry.item) || null,
          priceSource: 'master-cache',
          tcgplayerUrl: row.tcgplayerUrl || entry.item.tcgplayerUrl || '',
          retryCount: 0,
          retryReason: null,
          matchStatus: 'verified'
        }
      });
    }

    const externalCandidates = candidates.filter(entry => !processedRefs.has(entry.ref.path));
    if (!externalCandidates.length) {
      const updatedCollectionRows = await commitWrites(db, collectionWrites);
      return json(200, {
        updatedPrices: 0,
        updatedCollectionRows,
        masterCacheHits,
        variantsCached: 0,
        cardsResolved: masterCacheHits,
        cardsAmbiguous: 0,
        cardsUnmatched: 0,
        setsProcessed: 0,
        eligibleCards: candidates.length,
        waiting: 0,
        partialSuccess: false,
        durationMs: Date.now() - startedAt
      });
    }

    const groupsPayload = await fetchJson(`${TCGCSV_BASE}/groups`, 5000);
    const groups = groupsPayload.results || [];
    const bySet = new Map();

    for (const candidate of externalCandidates) {
      const setKey = normalizeText(candidate.item.set);
      if (!setKey) continue;
      if (!bySet.has(setKey)) bySet.set(setKey, []);
      bySet.get(setKey).push(candidate);
    }

    const setEntries = [...bySet.entries()].sort((a, b) => {
      const aUnpriced = a[1].filter(x => !(Number(x.item.marketPrice) > 0)).length;
      const bUnpriced = b[1].filter(x => !(Number(x.item.marketPrice) > 0)).length;
      return bUnpriced - aUnpriced;
    });

    const priceWrites = [];
    let setsProcessed = 0;
    let cardsResolved = masterCacheHits;
    let cardsAmbiguous = 0;
    let cardsUnmatched = 0;
    let variantsCached = 0;

    for (const [, entries] of setEntries) {
      if (Date.now() >= deadline - 5000) break;
      const group = resolveGroup(entries[0].item.set, groups);
      if (!group) {
        cardsUnmatched += entries.length;
        continue;
      }

      try {
        const [productsPayload, pricesPayload] = await Promise.all([
          fetchJson(`${TCGCSV_BASE}/${group.groupId}/products`, 4500),
          fetchJson(`${TCGCSV_BASE}/${group.groupId}/prices`, 4500)
        ]);
        setsProcessed += 1;
        const products = productsPayload.results || [];
        const rowsByProduct = new Map();
        for (const row of pricesPayload.results || []) {
          const id = Number(row.productId);
          if (!rowsByProduct.has(id)) rowsByProduct.set(id, []);
          rowsByProduct.get(id).push(row);
        }

        for (const entry of entries) {
          const product = resolveLinkedProduct(entry.item, products);
          if (!product) {
            cardsUnmatched += 1;
            continue;
          }

          const productRows = rowsByProduct.get(Number(product.productId)) || [];
          const validRows = productRows.filter(row => finiteMarket(row) != null && row.subTypeName);

          // Store every available exact printing once in the shared archive.
          for (const row of validRows) {
            const variant = String(row.subTypeName || '').trim();
            const marketPrice = finiteMarket(row);
            if (!variant || marketPrice == null) continue;
            const data = masterRow({ entry, product, group, variant, marketPrice, now });
            const key = priceKey(entry.item, variant);
            priceWrites.push({ ref: db.collection('cardPrices').doc(key), data: { ...data, key } });
            const lookupKey = identityKey(entry.item, variant);
            if (lookupKey) priceWrites.push({ ref: db.collection('cardPrices').doc(lookupKey), data: { ...data, key: lookupKey } });
            variantsCached += 1;
          }

          const requestedVariant = selectedVariant(entry.item);
          const picked = choosePrice(
            productRows,
            requestedVariant,
            entry.item.rarity || '',
            entry.item.name || ''
          );

          if (picked.marketPrice != null) {
            const key = priceKey(entry.item, picked.variant);
            const requestedSpecific = normalizeVariant(requestedVariant);
            if (!requestedSpecific) {
              const autoKey = priceKey(entry.item, 'auto');
              const autoData = masterRow({ entry, product, group, variant: picked.variant, marketPrice: picked.marketPrice, now, status: 'master-default' });
              priceWrites.push({ ref: db.collection('cardPrices').doc(autoKey), data: { ...autoData, key: autoKey } });
              const identityAutoKey = identityKey(entry.item, 'auto');
              if (identityAutoKey) priceWrites.push({ ref: db.collection('cardPrices').doc(identityAutoKey), data: { ...autoData, key: identityAutoKey } });
            }

            cardsResolved += 1;
            processedRefs.add(entry.ref.path);
            collectionWrites.push({
              ref: entry.ref,
              data: {
                cardPriceKey: key,
                value: picked.marketPrice,
                valueSource: 'master-market',
                marketPrice: picked.marketPrice,
                marketPriceUpdatedAt: now,
                pricingStatus: picked.status,
                priceVariant: picked.variant,
                priceSource: 'master-tcgcsv-tcgplayer',
                tcgplayerUrl: entry.item.tcgplayerUrl || product.url || `https://www.tcgplayer.com/product/${Number(product.productId)}`,
                retryCount: 0,
                retryReason: null,
                matchStatus: 'verified'
              }
            });
          } else if (picked.status === 'ambiguous') {
            cardsAmbiguous += 1;
            processedRefs.add(entry.ref.path);
            collectionWrites.push({
              ref: entry.ref,
              data: {
                marketPrice: null,
                value: null,
                valueSource: 'needs-variant',
                marketPriceUpdatedAt: now,
                pricingStatus: 'ambiguous',
                priceSource: 'master-tcgcsv-tcgplayer',
                retryReason: 'Multiple exact TCGplayer printings remain possible.'
              }
            });
          }
        }
      } catch (error) {
        console.warn(`Master price set deferred: ${entries[0].item.set}`, error.message || error);
      }
    }

    const updatedPrices = await commitWrites(db, priceWrites);
    const updatedCollectionRows = await commitWrites(db, collectionWrites);
    const waiting = Math.max(0, candidates.length - processedRefs.size);

    return json(200, {
      updatedPrices,
      updatedCollectionRows,
      masterCacheHits,
      variantsCached,
      cardsResolved,
      cardsAmbiguous,
      cardsUnmatched,
      setsProcessed,
      eligibleCards: candidates.length,
      waiting,
      partialSuccess: waiting > 0,
      durationMs: Date.now() - startedAt
    });
  } catch (error) {
    console.error('Master price refresh failed:', error);
    return json(error.statusCode || 500, { error: 'Master price refresh failed', detail: error.message });
  }
};
