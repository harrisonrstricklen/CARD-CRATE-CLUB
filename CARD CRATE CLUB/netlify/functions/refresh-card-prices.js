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

async function fetchCards(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 35) {
    const batch = ids.slice(i, i + 35);
    const q = batch.map(id => `id:${id}`).join(' OR ');
    const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=${batch.length}`;
    const res = await fetch(url, { headers: apiHeaders(), signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`Pokemon TCG API returned ${res.status}`);
    const body = await res.json();
    for (const card of body.data || []) out.set(String(card.id), card);
  }
  return out;
}

exports.handler = async function() {
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
      if (!wanted.has(key)) wanted.set(key, { apiId, language, priceVariant: item.priceVariant || '', variance: item.variance || '' });
    }

    const uniqueIds = [...new Set([...wanted.values()].map(x => x.apiId))];
    if (!uniqueIds.length) return json(200, { updated: 0, uniqueCards: 0, message: 'No English collection cards need pricing yet.' });

    const live = await fetchCards(uniqueIds);
    const writes = [];
    const now = admin.firestore.FieldValue.serverTimestamp();

    for (const [key, item] of wanted) {
      const card = live.get(item.apiId);
      if (!card) continue;
      const picked = safePrice(card, item.priceVariant || item.variance || '');
      writes.push({
        ref: db.collection('cardPrices').doc(key),
        data: {
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
        }
      });
    }

    for (let i = 0; i < writes.length; i += 400) {
      const batch = db.batch();
      for (const write of writes.slice(i, i + 400)) batch.set(write.ref, write.data, { merge: true });
      await batch.commit();
    }

    return json(200, { updated: writes.length, uniqueCards: uniqueIds.length, ownedRowsScanned: collectionSnap.size });
  } catch (error) {
    console.error('Scheduled master price refresh failed:', error);
    return json(500, { error: 'Master price refresh failed', detail: error.message });
  }
};
