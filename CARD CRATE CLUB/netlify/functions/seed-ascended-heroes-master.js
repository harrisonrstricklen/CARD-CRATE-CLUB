const fs = require('fs');
const path = require('path');
const { getFirebaseAdmin, json } = require('./_shared');

const SET_NAME = 'Ascended Heroes';
const TCGPLAYER_GROUP_ID = 24541;
const BUILD_ID = 'ascended-heroes-en';
const BUILD_VERSION = 3;

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
  const raw = String(value || '').trim().toLowerCase().split('/')[0].trim();
  return /^\d+$/.test(raw) ? String(Number(raw)) : raw;
}

function normVariant(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'auto';
}

function identityKey(card, variant = 'auto') {
  const set = norm(card.setName || card.set?.name || SET_NAME).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const name = norm(card.name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const number = normNumber(card.number);
  return `en__lookup__${set}__${name}__${number}__${variant}`;
}

function market(row) {
  const n = Number(row?.marketPrice ?? row?.market);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function productNumber(product) {
  if (product?.number || product?.cardNumber) return normNumber(product.number || product.cardNumber);
  for (const row of product?.extendedData || []) {
    const key = norm(row?.name || row?.displayName || '');
    if (key === 'number' || key === 'card number') return normNumber(row?.value || '');
  }
  return '';
}

function productRarity(product) {
  for (const row of product?.extendedData || []) {
    const key = norm(row?.name || row?.displayName || '');
    if (key === 'rarity') return String(row?.value || '');
  }
  return '';
}

function productBaseName(product) {
  const raw = String(product?.name || product?.cleanName || '').replace(/\s*-\s*\d+\s*\/\s*\d+\s*$/i, '');
  return norm(raw);
}

function bestProduct(card, products) {
  const wantedName = norm(card.name);
  const wantedNumber = normNumber(card.number);
  const wantedRarity = norm(card.rarity);
  let best = null;
  let bestScore = -Infinity;
  for (const product of products) {
    const number = productNumber(product);
    if (wantedNumber && number !== wantedNumber) continue;
    if (!number) continue;
    const fullName = norm(product.name || product.cleanName || '');
    const baseName = productBaseName(product);
    const rarity = norm(productRarity(product));
    let score = 300;
    if (baseName === wantedName) score += 220;
    else if (fullName === wantedName) score += 200;
    else if (fullName.includes(wantedName) || wantedName.includes(baseName)) score += 90;
    if (wantedRarity && rarity === wantedRarity) score += 40;
    if (score > bestScore) {
      bestScore = score;
      best = product;
    }
  }
  return bestScore >= 300 ? best : null;
}

function chooseDefault(card, rows) {
  const valid = rows.filter(r => market(r) != null);
  if (!valid.length) return null;
  if (valid.length === 1) return valid[0];
  const rarity = String(card.rarity || '').toLowerCase();
  const normal = valid.find(r => normVariant(r.subTypeName) === 'normal');
  const holo = valid.find(r => normVariant(r.subTypeName) === 'holofoil');
  if ((rarity === 'common' || rarity === 'uncommon' || rarity === 'rare') && normal) return normal;
  if ((rarity.includes('holo') || /\b(ex|gx|v|vmax|vstar)\b/i.test(card.name || '')) && holo) return holo;
  const ordinary = valid.filter(r => !/(reverse|1st|first|unlimited|shadowless)/i.test(String(r.subTypeName || '')));
  return ordinary.length === 1 ? ordinary[0] : null;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'CardCrateClub master-set-builder/1.0' },
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}

async function commitChunks(db, writes) {
  let committed = 0;
  for (let i = 0; i < writes.length; i += 350) {
    const batch = db.batch();
    for (const write of writes.slice(i, i + 350)) batch.set(write.ref, write.data, { merge: true });
    await batch.commit();
    committed += Math.min(350, writes.length - i);
  }
  return committed;
}

exports.handler = async function() {
  const started = Date.now();
  try {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();
    const buildRef = db.collection('masterSetBuilds').doc(BUILD_ID);
    const existing = await buildRef.get();
    if (existing.exists && existing.data()?.status === 'complete' && existing.data()?.buildVersion === BUILD_VERSION) {
      return json(200, { skipped: true, message: `${SET_NAME} master catalog is already complete.`, ...existing.data() });
    }

    await buildRef.set({ status: 'running', buildVersion: BUILD_VERSION, setName: SET_NAME, groupId: TCGPLAYER_GROUP_ID, startedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    const indexPath = path.join(__dirname, '../../card-data/all-cards-index.json');
    const raw = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const allCards = Array.isArray(raw) ? raw : (raw.cards || []);
    const setCards = allCards.filter(card => norm(card.setName || card.set?.name) === norm(SET_NAME));
    if (!setCards.length) throw new Error(`No local cards found for ${SET_NAME}`);

    const base = `https://tcgcsv.com/tcgplayer/3/${TCGPLAYER_GROUP_ID}`;
    const [productsPayload, pricesPayload] = await Promise.all([
      fetchJson(`${base}/products`),
      fetchJson(`${base}/prices`)
    ]);
    const products = productsPayload.results || [];
    const priceRows = pricesPayload.results || [];
    const pricesByProduct = new Map();
    for (const row of priceRows) {
      const id = Number(row.productId);
      if (!pricesByProduct.has(id)) pricesByProduct.set(id, []);
      pricesByProduct.get(id).push(row);
    }

    const writes = [];
    const report = [];
    let matchedCards = 0;
    let cardsWithDefaultPrice = 0;
    let variantPriceDocs = 0;
    const now = admin.firestore.FieldValue.serverTimestamp();

    for (const card of setCards) {
      const product = bestProduct(card, products);
      if (!product) {
        report.push({ cardId: card.id, name: card.name, number: card.number, status: 'unmatched' });
        continue;
      }
      matchedCards++;
      const productId = Number(product.productId);
      const rows = pricesByProduct.get(productId) || [];
      const defaultRow = chooseDefault(card, rows);
      const baseData = {
        cardId: card.id,
        language: 'en',
        name: card.name,
        set: SET_NAME,
        number: card.number || '',
        rarity: card.rarity || productRarity(product) || '',
        tcgplayerProductId: productId,
        tcgplayerUrl: `https://www.tcgplayer.com/product/${productId}`,
        source: 'tcgcsv-tcgplayer-master-set',
        updatedAt: now
      };

      for (const row of rows) {
        const m = market(row);
        if (m == null) continue;
        const variant = normVariant(row.subTypeName);
        const key = `en__${card.id}__${variant}`.replace(/\//g, '_');
        const data = { ...baseData, key, marketPrice: m, pricingStatus: 'exact-variant', priceVariant: row.subTypeName || variant };
        writes.push({ ref: db.collection('cardPrices').doc(key), data });
        const aliasKey = identityKey(card, variant);
        writes.push({ ref: db.collection('cardPrices').doc(aliasKey), data: { ...data, key: aliasKey, aliasFor: key } });
        variantPriceDocs++;
      }

      if (defaultRow && market(defaultRow) != null) {
        const key = `en__${card.id}__auto`.replace(/\//g, '_');
        const data = { ...baseData, key, marketPrice: market(defaultRow), pricingStatus: 'master-default', priceVariant: defaultRow.subTypeName || null };
        writes.push({ ref: db.collection('cardPrices').doc(key), data });
        const aliasKey = identityKey(card, 'auto');
        writes.push({ ref: db.collection('cardPrices').doc(aliasKey), data: { ...data, key: aliasKey, aliasFor: key } });
        cardsWithDefaultPrice++;
      }
      report.push({ cardId: card.id, name: card.name, number: card.number, status: 'matched', productId, variants: rows.filter(r => market(r) != null).length, defaultPrice: defaultRow ? market(defaultRow) : null, defaultVariant: defaultRow?.subTypeName || null });
    }

    const committed = await commitChunks(db, writes);
    const durationMs = Date.now() - started;
    const unmatched = report.filter(r => r.status === 'unmatched');
    const summary = {
      status: 'complete',
      buildVersion: BUILD_VERSION,
      setName: SET_NAME,
      groupId: TCGPLAYER_GROUP_ID,
      localCards: setCards.length,
      tcgplayerProducts: products.length,
      tcgplayerPriceRows: priceRows.length,
      matchedCards,
      unmatchedCards: unmatched.length,
      cardsWithDefaultPrice,
      variantPriceDocs,
      priceDocsWritten: committed,
      durationMs,
      unmatchedSample: unmatched.slice(0, 25),
      completedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    await buildRef.set(summary, { merge: true });
    return json(200, summary);
  } catch (error) {
    console.error('Ascended Heroes master set build failed:', error);
    try {
      const admin = getFirebaseAdmin();
      await admin.firestore().collection('masterSetBuilds').doc(BUILD_ID).set({ status: 'failed', error: error.message, failedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    } catch {}
    return json(500, { error: 'Master set build failed', detail: error.message });
  }
};
