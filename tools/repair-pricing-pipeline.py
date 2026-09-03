from pathlib import Path

search = Path('CARD CRATE CLUB/netlify/functions/search-cards.js')
s = search.read_text()

old = "const { getFirebaseAdmin } = require('./_shared');"
new = "const { getFirebaseAdmin } = require('./_shared');\nconst { resolveTcgcsvCards } = require('./_tcgcsv');"
if "resolveTcgcsvCards" not in s:
    if old not in s: raise SystemExit('search require marker missing')
    s = s.replace(old, new, 1)

old = '''    if (isRoutineExactLookup) {
      const masters = await fetchMasterPrices(selected, variantRaw);
      const data = selected.map(card => masterCardShape(card, sets.get(String(card.setId)) || {}, masters.get(String(card.id)), variantRaw));
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120' },
        body: JSON.stringify({ data, count: data.length, totalCount: matches.length, source: 'local-search-master-price-cache' })
      };
    }
'''
new = '''    if (isRoutineExactLookup) {
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
        const market = Number(resolved.marketPrice);
        const validMarket = Number.isFinite(market) && market > 0 ? market : null;
        const variant = resolved.priceVariant || master?.priceVariant || null;
        return {
          ...base,
          tcgplayer: {
            ...(base.tcgplayer || {}),
            url: resolved.tcgplayerUrl || base.tcgplayer?.url || '',
            prices: validMarket && variant ? { [variant]: { market: validMarket } } : (base.tcgplayer?.prices || {})
          },
          pricing: {
            source: validMarket ? 'tcgcsv-tcgplayer-fallback' : (base.pricing?.source || 'master-cache'),
            status: validMarket ? resolved.pricingStatus : (base.pricing?.status || resolved.pricingStatus || 'unavailable'),
            variant,
            requestedVariant: variantRaw || null,
            market: validMarket ?? base.pricing?.market ?? null
          }
        };
      });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' },
        body: JSON.stringify({ data, count: data.length, totalCount: matches.length, source: 'local-search-master-with-tcgcsv-fallback' })
      };
    }
'''
if old in s:
    s = s.replace(old, new, 1)
elif "local-search-master-with-tcgcsv-fallback" not in s:
    raise SystemExit('search exact branch marker missing')
search.write_text(s)

refresh = Path('CARD CRATE CLUB/netlify/functions/refresh-card-prices.js')
s = refresh.read_text()
old = '''  const wantedName = normalizeText(item.name);
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
'''
new = '''  const wantedName = normalizeText(item.name);
  const wantedNumber = normalizeNumber(item.number);
  let best = null;
  let bestScore = -1;

  for (const product of products || []) {
    const number = productNumber(product);
    if (wantedNumber && number !== wantedNumber) continue;
    const fullName = normalizeText(product.name || product.cleanName || '');
    const cleanName = normalizeText(product.cleanName || '');
    let score = 0;
    if (wantedName && (fullName === wantedName || cleanName === wantedName)) score = 500;
    else if (wantedName && (fullName.startsWith(wantedName) || cleanName.startsWith(wantedName))) score = 320;
    else if (wantedName && fullName.includes(wantedName)) score = 220;
    else continue;
    if (score > bestScore) { bestScore = score; best = product; }
  }

  return bestScore >= 320 ? best : null;
'''
if old in s:
    s = s.replace(old, new, 1)

s = s.replace("tcgplayerUrl: entry.item.tcgplayerUrl || product.url || '',", "tcgplayerUrl: entry.item.tcgplayerUrl || product.url || `https://www.tcgplayer.com/product/${Number(product.productId)}`,", 1)
s = s.replace("tcgplayerUrl: entry.item.tcgplayerUrl || product.url || ''\n", "tcgplayerUrl: entry.item.tcgplayerUrl || product.url || `https://www.tcgplayer.com/product/${Number(product.productId)}`\n", 1)

old = '''          priceWrites.push({ ref: db.collection('cardPrices').doc(key), data: master });

          if (picked.marketPrice != null) {
'''
new = '''          priceWrites.push({ ref: db.collection('cardPrices').doc(key), data: master });
          const requestedVariant = normalizeVariant(entry.item.priceVariant || entry.item.variance || '');
          if (picked.marketPrice != null && !requestedVariant) {
            const autoKey = priceKey(entry.item, 'auto');
            priceWrites.push({ ref: db.collection('cardPrices').doc(autoKey), data: { ...master, key: autoKey, pricingStatus: 'master-default' } });
          }

          if (picked.marketPrice != null) {
'''
if old in s:
    s = s.replace(old, new, 1)
refresh.write_text(s)
