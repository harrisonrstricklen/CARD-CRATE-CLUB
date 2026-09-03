from pathlib import Path

search = Path('CARD CRATE CLUB/netlify/functions/search-cards.js')
s = search.read_text()

old_require = "const { getFirebaseAdmin } = require('./_shared');"
new_require = "const { getFirebaseAdmin } = require('./_shared');\nconst { resolveTcgcsvCards } = require('./_tcgcsv');"
if "require('./_tcgcsv')" not in s:
    if old_require not in s: raise SystemExit('search require marker missing')
    s = s.replace(old_require, new_require, 1)

start = s.find("    if (isRoutineExactLookup) {")
end_marker = "\n    const liveDetails = await fetchLiveDetails(selected, variantRaw);"
end = s.find(end_marker, start)
if start < 0 or end < 0: raise SystemExit('search exact branch boundaries missing')
new_branch = '''    if (isRoutineExactLookup) {
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
        const fallbackMarket = Number(resolved.marketPrice);
        const masterMarket = Number(master?.marketPrice);
        const market = Number.isFinite(masterMarket) && masterMarket > 0 ? masterMarket : (Number.isFinite(fallbackMarket) && fallbackMarket > 0 ? fallbackMarket : null);
        const variant = master?.priceVariant || resolved.priceVariant || null;
        return {
          ...base,
          tcgplayer: {
            ...(base.tcgplayer || {}),
            url: base.tcgplayer?.url || resolved.tcgplayerUrl || '',
            prices: market && variant ? { [variant]: { market } } : (base.tcgplayer?.prices || {})
          },
          pricing: {
            source: Number.isFinite(masterMarket) && masterMarket > 0 ? 'master-cache' : 'tcgcsv-tcgplayer-fallback',
            status: master?.pricingStatus || resolved.pricingStatus || (market ? 'exact' : 'unavailable'),
            variant,
            requestedVariant: variantRaw || null,
            market
          }
        };
      });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' },
        body: JSON.stringify({ data, count: data.length, totalCount: matches.length, source: 'local-search-master-with-tcgcsv-fallback', version: 'pricing-relay-v5' })
      };
    }
'''
s = s[:start] + new_branch + s[end:]
search.write_text(s)

refresh = Path('CARD CRATE CLUB/netlify/functions/refresh-card-prices.js')
r = refresh.read_text()
old_resolver = '''  const wantedName = normalizeText(item.name);
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
new_resolver = '''  const wantedName = normalizeText(item.name);
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
if old_resolver in r: r = r.replace(old_resolver, new_resolver, 1)
r = r.replace("tcgplayerUrl: entry.item.tcgplayerUrl || product.url || '',", "tcgplayerUrl: entry.item.tcgplayerUrl || product.url || `https://www.tcgplayer.com/product/${Number(product.productId)}`,", 1)
r = r.replace("tcgplayerUrl: entry.item.tcgplayerUrl || product.url || ''\n", "tcgplayerUrl: entry.item.tcgplayerUrl || product.url || `https://www.tcgplayer.com/product/${Number(product.productId)}`\n", 1)
auto_marker = "          priceWrites.push({ ref: db.collection('cardPrices').doc(key), data: master });\n\n          if (picked.marketPrice != null) {"
if auto_marker in r:
    r = r.replace(auto_marker, "          priceWrites.push({ ref: db.collection('cardPrices').doc(key), data: master });\n          const requestedVariant = normalizeVariant(entry.item.priceVariant || entry.item.variance || '');\n          if (picked.marketPrice != null && !requestedVariant) {\n            const autoKey = priceKey(entry.item, 'auto');\n            priceWrites.push({ ref: db.collection('cardPrices').doc(autoKey), data: { ...master, key: autoKey, pricingStatus: 'master-default' } });\n          }\n\n          if (picked.marketPrice != null) {", 1)
refresh.write_text(r)
