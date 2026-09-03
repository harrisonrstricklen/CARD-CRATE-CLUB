// Shared TCGCSV resolver used by exact card lookup and master pricing.
const TCGCSV_BASE = 'https://tcgcsv.com/tcgplayer/3';

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

function normalizeNumber(value) {
  const raw = String(value || '').trim().toLowerCase().split('/')[0].trim();
  return /^\d+$/.test(raw) ? String(Number(raw)) : raw;
}

function normalizeVariant(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
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

function productNumber(product) {
  const direct = product?.number || product?.cardNumber;
  if (direct) return normalizeNumber(direct);
  for (const row of product?.extendedData || []) {
    const key = normalizeText(row?.name || row?.displayName || '');
    if (key === 'number' || key === 'card number') return normalizeNumber(row?.value || '');
  }
  return '';
}

function productRarity(product) {
  for (const row of product?.extendedData || []) {
    if (normalizeText(row?.name || row?.displayName || '') === 'rarity') return String(row?.value || '');
  }
  return '';
}

function productBaseName(product) {
  return normalizeText(String(product?.cleanName || product?.name || '')
    .replace(/\s*-\s*#?\d+[a-z]?\s*\/\s*\d+\s*$/i, '')
    .replace(/\s*-\s*#?\d+[a-z]?\s*$/i, ''));
}

function resolveProduct(item, products) {
  const wantedName = normalizeText(item.name);
  const wantedNumber = normalizeNumber(item.number);
  const wantedRarity = normalizeText(item.rarity);
  if (!wantedName || !wantedNumber) return null;
  let best = null;
  let bestScore = -1;
  for (const product of products || []) {
    const number = productNumber(product);
    if (number !== wantedNumber) continue;
    const fullName = normalizeText(product.name || product.cleanName || '');
    const cleanName = normalizeText(product.cleanName || '');
    const baseName = productBaseName(product);
    let score = 0;
    if (cleanName === wantedName || fullName === wantedName || baseName === wantedName) score = 500;
    else if (cleanName.startsWith(wantedName) || fullName.startsWith(wantedName) || baseName.startsWith(wantedName)) score = 320;
    else if (fullName.includes(wantedName) || wantedName.includes(baseName)) score = 220;
    else continue;
    const rarity = normalizeText(productRarity(product));
    if (wantedRarity && rarity === wantedRarity) score += 30;
    if (score > bestScore) { bestScore = score; best = product; }
  }
  return bestScore >= 320 ? best : null;
}

function resolveGroup(setName, groups) {
  const wanted = normalizeText(setName);
  if (!wanted) return null;
  let best = null;
  let bestScore = -1;
  for (const group of groups || []) {
    const name = normalizeText(group.name);
    let score = -1;
    if (name === wanted) score = 130;
    else if (name.endsWith(wanted)) score = 120;
    else if (name.includes(wanted)) score = 100;
    if (score > bestScore) { bestScore = score; best = group; }
  }
  return bestScore >= 100 ? best : null;
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
  if ((r === 'common' || r === 'uncommon' || r === 'rare') && normal) return { status: 'inferred', variant: normal.subTypeName, marketPrice: finiteMarket(normal) };
  if ((r.includes('holo') || /\b(ex|gx|v|vmax|vstar)\b/.test(n)) && holo) return { status: 'inferred', variant: holo.subTypeName, marketPrice: finiteMarket(holo) };
  const ordinary = valid.filter(row => !/(reverse|1st|first|unlimited|shadowless)/i.test(String(row.subTypeName || '')));
  if (ordinary.length === 1) return { status: 'inferred', variant: ordinary[0].subTypeName, marketPrice: finiteMarket(ordinary[0]) };
  return { status: 'ambiguous', variant: null, marketPrice: null };
}

async function fetchJson(url, timeout = 7000) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'CardCrateClub/1.0 pricing-resolver' },
    signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

let groupsPromise = null;
async function getGroups() {
  if (!groupsPromise) groupsPromise = fetchJson(`${TCGCSV_BASE}/groups`).then(x => x.results || []).catch(err => { groupsPromise = null; throw err; });
  return groupsPromise;
}

async function resolveTcgcsvCards(cards, requestedVariant = '') {
  const result = new Map();
  if (!cards?.length) return result;
  const groups = await getGroups();
  const byGroup = new Map();
  for (const card of cards) {
    const group = resolveGroup(card.setName || card.set, groups);
    if (!group) continue;
    if (!byGroup.has(group.groupId)) byGroup.set(group.groupId, { group, cards: [] });
    byGroup.get(group.groupId).cards.push(card);
  }
  for (const { group, cards: groupCards } of byGroup.values()) {
    const [productsPayload, pricesPayload] = await Promise.all([
      fetchJson(`${TCGCSV_BASE}/${group.groupId}/products`),
      fetchJson(`${TCGCSV_BASE}/${group.groupId}/prices`)
    ]);
    const products = productsPayload.results || [];
    const rowsByProduct = new Map();
    for (const row of pricesPayload.results || []) {
      const id = Number(row.productId);
      if (!rowsByProduct.has(id)) rowsByProduct.set(id, []);
      rowsByProduct.get(id).push(row);
    }
    for (const card of groupCards) {
      const product = resolveProduct(card, products);
      if (!product) continue;
      const picked = choosePrice(rowsByProduct.get(Number(product.productId)) || [], requestedVariant || card.priceVariant || card.variance || '', card.rarity || '', card.name || '');
      result.set(String(card.id), {
        marketPrice: picked.marketPrice,
        pricingStatus: picked.status,
        priceVariant: picked.variant,
        tcgplayerProductId: Number(product.productId),
        tcgplayerUrl: product.url || `https://www.tcgplayer.com/product/${Number(product.productId)}`,
        productName: product.name || product.cleanName || card.name,
        groupId: group.groupId,
        groupName: group.name
      });
    }
  }
  return result;
}

module.exports = { normalizeText, normalizeNumber, normalizeVariant, productNumber, resolveProduct, resolveGroup, choosePrice, resolveTcgcsvCards };
