const { getFirebaseAdmin, json, requireUser } = require('./_shared');

function normalizeVariant(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeLanguage(value) {
  const v = String(value || '').toLowerCase();
  return v === 'ja' || v === 'jp' || v.includes('japanese') ? 'ja' : 'en';
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
    const keys = [...new Set([...requestedKeys, ...autoKeys].filter(Boolean))];
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
      const requestedKey = requestedKeys[index];
      const autoKey = autoKeys[index];
      const hitKey = (requestedKey && prices[requestedKey]) ? requestedKey : ((autoKey && prices[autoKey]) ? autoKey : null);
      return {
        index,
        requestedKey,
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
