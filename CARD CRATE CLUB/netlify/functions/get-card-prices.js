const { getFirebaseAdmin, json, requireUser } = require('./_shared');

function normalizeVariant(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeLanguage(value) {
  const v = String(value || '').toLowerCase();
  return v === 'ja' || v === 'jp' || v.includes('japanese') ? 'ja' : 'en';
}

function norm(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normNumber(value) {
  const raw = String(value || '').trim().toLowerCase().split('/')[0].trim();
  return /^\d+$/.test(raw) ? String(Number(raw)) : raw;
}

function baseCardId(item) {
  return String(item.apiId || item.sourceId || '').trim();
}

function priceKey(item, forceVariant = null) {
  const language = normalizeLanguage(item.language);
  const cardId = baseCardId(item);
  if (!cardId) return '';
  const variant = forceVariant || normalizeVariant(item.priceVariant || item.variance || '') || 'auto';
  return `${language}__${cardId}__${variant}`.replace(/\//g, '_');
}

function identityKey(item, forceVariant = 'auto') {
  const language = normalizeLanguage(item.language);
  const set = norm(item.set || item.setName || '');
  const name = norm(item.name || '');
  const number = normNumber(item.number || '');
  if (!set || !name || !number) return '';
  const variant = forceVariant || normalizeVariant(item.priceVariant || item.variance || '') || 'auto';
  return `${language}__lookup__${set}__${name}__${number}__${variant}`;
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST required' });

  try {
    await requireUser(event);
    const body = JSON.parse(event.body || '{}');
    const items = Array.isArray(body.items) ? body.items.slice(0, 500) : [];
    if (!items.length) return json(200, { prices: {}, resolved: [], count: 0 });

    const admin = getFirebaseAdmin();
    const db = admin.firestore();

    const requestedKeys = items.map(item => priceKey(item));
    const autoKeys = items.map(item => priceKey(item, 'auto'));
    const identityRequestedKeys = items.map(item => identityKey(item, normalizeVariant(item.priceVariant || item.variance || '') || 'auto'));
    const identityAutoKeys = items.map(item => identityKey(item, 'auto'));
    const keys = [...new Set([...requestedKeys, ...autoKeys, ...identityRequestedKeys, ...identityAutoKeys].filter(Boolean))];
    const refs = keys.map(key => db.collection('cardPrices').doc(key));
    const snaps = refs.length ? await db.getAll(...refs) : [];
    const prices = {};

    snaps.forEach((snap, i) => {
      if (!snap.exists) return;
      const data = snap.data() || {};
      const updatedAt = data.updatedAt?.toDate ? data.updatedAt.toDate().toISOString() : null;
      prices[keys[i]] = { ...data, updatedAt };
    });

    const resolved = items.map((item, index) => {
      const candidates = [
        requestedKeys[index],
        autoKeys[index],
        identityRequestedKeys[index],
        identityAutoKeys[index]
      ].filter(Boolean);
      const hitKey = candidates.find(key => prices[key]) || null;
      return {
        index,
        requestedKey: requestedKeys[index] || null,
        hitKey,
        price: hitKey ? prices[hitKey] : null
      };
    });

    return json(200, {
      prices,
      resolved,
      count: resolved.filter(r => r.price && Number(r.price.marketPrice) > 0).length
    });
  } catch (error) {
    console.error('Master price lookup failed:', error);
    return json(error.statusCode || 500, { error: 'Could not load current card prices', detail: error.message });
  }
};

exports.priceKey = priceKey;
exports.identityKey = identityKey;
