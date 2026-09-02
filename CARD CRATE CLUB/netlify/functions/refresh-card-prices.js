const { getFirebaseAdmin, json, requireUser } = require('./_shared');

const TCGCSV_BASE = 'https://tcgcsv.com/tcgplayer/3';
const FRESH_MS = 4 * 60 * 1000;
const FUNCTION_BUDGET_MS = 22000;

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeVariant(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeNumber(value) {
  const raw = String(value || '').trim().toLowerCase().split('/')[0].trim();
  return /^\d+$/.test(raw) ? String(Number(raw)) : raw;
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
    reverseholo: ['reverseholofoil'], reverseholofoil: ['reverseholofoil'], reversefoil: ['reverseholofoil'],
    firstedition: ['1steditionholofoil', '1steditionnormal'], '1stedition': ['1steditionholofoil', '1steditionnormal'],
    unlimited: ['unlimitedholofoil', 'unlimitednormal'],
    shadowless: ['shadowlessholofoil', 'shadowlessnormal']
  };
  return map[v] || [];
}

function finiteMarket(row) {
  const n = Number(row?.marketPrice ?? row?.market);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function choosePrice(rows, requestedVariant = '', rarity = '', name = '') {
  const valid = (rows || []).filter(row => finiteMarket(row) != null);
  if (!valid.length) return { status: 'unavailable', variant: null, marketPrice: null };

  const requested = variantKeys(requestedVariant);
  if (requested.length) {
    const exact = valid.filter(row => requested.includes(normalizeVariant(row.subTypeName)));
    if (exact.length === 1) return { status: 'exact-variant', variant: exact[0].subTypeName, marketPrice: finiteMarket(exact[0]) };
  }

  if (valid.length === 1) return { status: 'exact', variant: valid[0].subTypeName, marketPrice: finiteMarket(valid[0]) };

  const r = normalizeText(rarity);
  const n = normalizeText(name);
  const normal = valid.find(row => normalizeVariant(row.subTypeName) === 'normal');
  const holo = valid.find(row => normalizeVariant(row.subTypeName) === 'holofoil');

  if ((r === 'common' || r === 'uncommon' || r === 'rare') && normal) {
    return { status: 'inferred', variant: normal.subTypeName, marketPrice: finiteMarket(normal) };
  }
  if ((r.includes('holo') || /\b(ex|gx|v|vmax|vstar)\b/.test(n)) && holo) {
    return { status: 'inferred', variant: holo.subTypeName, marketPrice: finiteMarket(holo) };
  }

  const ordinary = valid.filter(row => !/(reverse|1st|first|unlimited|shadowless)/i.test(String(row.subTypeName || '')));
  if (ordinary.length === 1) {
    return { status: 'inferred', variant: ordinary[0].subTypeName, marketPrice: finiteMarket(ordinary[0]) };
  }

  return { status: 'ambiguous', variant: null, marketPrice: null };
}

function extractProductId(url) {
  const match = String(url || '').match(/\/product\/(\d+)/i);
  return match ? Number(match[1]) : null;
}

function productNumber(product) {
  const direct = product?.number || product?.cardNumber;
  if (direct) return normalizeNumber(direct);
  for (const row of product?.extendedData || []) {
    const key = normalizeText(row?.name || row?.displayName || '');
    if (key === 'number' || key === 'card number') return normalizeNumber(row?.value || '');
  }
  const nameMatch = String(product?.name || '').match(/#\s*([a-z0-9-]+)/i);
  return nameMatch ? normalizeNumber(nameMatch[1]) : '';
}

function resolveProduct(item, products) {
  const linkedId = extractProductId(item.tcgplayerUrl);
  if (linkedId) {
    const linked = products.find(p => Number(p.productId) === linkedId);
    if (linked) return linked;
  }

  const wantedName = normalizeText(item.name);
  const wantedNumber = normalizeNumber(item.number);
  let best = null;
  let bestScore = -9999;

  for (const product of products || []) {
    const name = normalizeText(product.name || product.cleanName || '');
    const number = productNumber(product);
    let score = 0;

    if (wantedName && name === wantedName) score += 140;
    else if (wantedName && name.includes(wantedName)) score += 85;
    else if (wantedName && wantedName.includes(name)) score += 55;

    if (wantedNumber && number === wantedNumber) score += 180;
    else if (wantedNumber && number) score -= 120;

    if (score > bestScore) {
      bestScore = score;
      best = product;
    }
  }

  const minimum = wantedNumber ? 180 : 130;
  return bestScore >= minimum ? best : null;
}

function resolveGroup(setName, groups) {
  const wanted = normalizeText(setName);
  if (!wanted) return null;
  let best = null;
  let bestScore = -1;

  for (const group of groups || []) {
    const name = normalizeText(group.name);
    let score = -1;
    if (name === wanted) score = 120;
    else if (name.endsWith(wanted)) score = 105;
    else if (name.includes(wanted)) score = 85;
    else if (wanted.includes(name)) score = 65;
    if (score > bestScore) {
      bestScore = score;
      best = group;
    }
  }

  return bestScore >= 85 ? best : null;
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
  const v = normalizeVariant(variant || item.priceVariant || item.variance || '') || 'auto';
  return `${language}__${cardId}__${v}`.replace(/\//g, '_');
}

async function commitWrites(db, writes) {
  let committed = 0;
  for (let start = 0; start < writes.length; start += 300) {
    const chunk = writes.slice(start, start + 300);
    const batch = db.batch();
    for (const write of chunk) batch.set(write.ref, write.data, { merge: true });
    await batch.commit();
    committed += chunk.length;
  }
  return committed;
}

exports.handler = async function(event = {}) {
  const startedAt = Date.now();
  const deadline = startedAt + FUNCTION_BUDGET_MS;

  try {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();

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
      return json(200, { updatedPrices: 0, updatedCollectionRows: 0, waiting: 0, message: 'All eligible collection prices are fresh.' });
    }

    const groupsPayload = await fetchJson(`${TCGCSV_BASE}/groups`, 5000);
    const groups = groupsPayload.results || [];
    const bySet = new Map();

    for (const candidate of candidates) {
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
    const collectionWrites = [];
    const now = admin.firestore.FieldValue.serverTimestamp();
    let setsProcessed = 0;
    let cardsResolved = 0;
    let cardsAmbiguous = 0;
    let cardsUnmatched = 0;
    const processedRefs = new Set();

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
          const product = resolveProduct(entry.item, products);
          if (!product) {
            cardsUnmatched += 1;
            continue;
          }

          const picked = choosePrice(
            rowsByProduct.get(Number(product.productId)) || [],
            entry.item.priceVariant || entry.item.variance || '',
            entry.item.rarity || '',
            entry.item.name || ''
          );

          const key = priceKey(entry.item, picked.variant);
          const master = {
            key,
            cardId: entry.cardId,
            language: 'en',
            name: entry.item.name || product.name || '',
            set: entry.item.set || group.name || '',
            number: entry.item.number || '',
            requestedVariant: entry.item.variance || entry.item.priceVariant || null,
            marketPrice: picked.marketPrice,
            pricingStatus: picked.status,
            priceVariant: picked.variant,
            tcgplayerProductId: Number(product.productId),
            tcgplayerUrl: entry.item.tcgplayerUrl || product.url || '',
            source: 'tcgcsv-tcgplayer',
            updatedAt: now
          };
          priceWrites.push({ ref: db.collection('cardPrices').doc(key), data: master });

          if (picked.marketPrice != null) {
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
                tcgplayerUrl: entry.item.tcgplayerUrl || product.url || ''
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
                priceSource: 'master-tcgcsv-tcgplayer'
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
