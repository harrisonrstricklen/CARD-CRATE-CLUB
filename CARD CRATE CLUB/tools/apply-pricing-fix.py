from pathlib import Path

seed = Path('CARD CRATE CLUB/netlify/functions/seed-ascended-heroes-master.js')
s = seed.read_text()
s = s.replace("const BUILD_VERSION = 2;", "const BUILD_VERSION = 3;", 1)
old = '''function bestProduct(card, products) {
  const wantedName = norm(card.name);
  const wantedNumber = normNumber(card.number);
  let best = null;
  let bestScore = -Infinity;
  for (const product of products) {
    const name = norm(product.name || product.cleanName || '');
    const number = productNumber(product);
    let score = 0;
    if (name === wantedName) score += 140;
    else if (name.includes(wantedName) || wantedName.includes(name)) score += 55;
    else continue;
    if (wantedNumber && number === wantedNumber) score += 180;
    else if (wantedNumber && number) score -= 160;
    if (score > bestScore) {
      bestScore = score;
      best = product;
    }
  }
  return bestScore >= (wantedNumber ? 260 : 130) ? best : null;
}'''
new = '''function productBaseName(product) {
  const raw = String(product?.name || product?.cleanName || '').replace(/\\s*-\\s*\\d+\\s*\\/\\s*\\d+\\s*$/i, '');
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
}'''
if old not in s:
    raise SystemExit('seed matcher not found')
s = s.replace(old, new, 1)
seed.write_text(s)

search = Path('CARD CRATE CLUB/netlify/functions/search-cards.js')
s = search.read_text()
old = '''    if (isRoutineExactLookup) {
      const masters = await fetchMasterPrices(selected, variantRaw);
      const data = selected.map(card => masterCardShape(card, sets.get(String(card.setId)) || {}, masters.get(String(card.id)), variantRaw));
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120' },
        body: JSON.stringify({ data, count: data.length, totalCount: matches.length, source: 'local-search-master-price-cache' })
      };
    }'''
new = '''    if (isRoutineExactLookup) {
      const masters = await fetchMasterPrices(selected, variantRaw);
      const needsLive = selected.filter(card => {
        const master = masters.get(String(card.id));
        const market = Number(master?.marketPrice);
        return !(Number.isFinite(market) && market > 0) || !master?.tcgplayerUrl;
      });
      const liveDetails = needsLive.length ? await fetchLiveDetails(needsLive, variantRaw) : new Map();
      const data = selected.map(card => {
        const id = String(card.id);
        const set = sets.get(String(card.setId)) || {};
        const master = masters.get(id);
        const masterShape = masterCardShape(card, set, master, variantRaw);
        const masterMarket = Number(master?.marketPrice);
        const hasMasterPrice = Number.isFinite(masterMarket) && masterMarket > 0;
        const live = liveDetails.get(id);
        if (!live) return masterShape;
        if (!hasMasterPrice) return live;
        if (!masterShape.tcgplayer?.url && live.tcgplayer?.url) {
          masterShape.tcgplayer = { ...(masterShape.tcgplayer || {}), url: live.tcgplayer.url };
        }
        return masterShape;
      });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' },
        body: JSON.stringify({ data, count: data.length, totalCount: matches.length, source: 'local-master-with-live-fallback', version: 'pricing-relay-v4' })
      };
    }'''
if old not in s:
    raise SystemExit('search exact branch not found')
s = s.replace(old, new, 1)
search.write_text(s)

coll = Path('CARD CRATE CLUB/collection.html')
s = coll.read_text()
old = "async function enrichMissingLinks(){if(!currentUser||!allCards.length)return;const due=allCards.filter(c=>!c.tcgplayerUrl).slice(0,18);for(let i=0;i<due.length;i+=3){const group=due.slice(i,i+3);await Promise.allSettled(group.map(async saved=>{try{const exact=await lookupExactCard(saved);if(!exact)return;const url=exact.tcgplayer?.url||'';if(!url)return;saved.tcgplayerUrl=url;if(exact.id&&!saved.apiId)saved.apiId=exact.id;await updateDoc(doc(db,'users',currentUser.uid,'collection',saved.id),{tcgplayerUrl:url,apiId:exact.id||saved.apiId||null,matchStatus:'verified',matchCheckedAt:serverTimestamp()})}catch(e){console.warn('TCG link enrichment failed:',saved.name,e)}}));if(i+3<due.length)await sleep(300)}renderCards()}"
new = "async function enrichMissingLinks(){if(!currentUser||!allCards.length)return;const due=allCards.filter(c=>!c.tcgplayerUrl||trustedCardValue(c)==null).slice(0,24);for(let i=0;i<due.length;i+=3){const group=due.slice(i,i+3);await Promise.allSettled(group.map(async saved=>{try{const exact=await lookupExactCard(saved);if(!exact)return;const url=exact.tcgplayer?.url||saved.tcgplayerUrl||'',live=marketPrice(exact),existing=trustedCardValue(saved);const patch={apiId:exact.id||saved.apiId||null,matchStatus:'verified',matchCheckedAt:serverTimestamp()};if(url)patch.tcgplayerUrl=url;if(live!=null&&existing==null){patch.marketPrice=live;patch.value=live;patch.pricingStatus=exact.pricing?.status||'exact';patch.priceVariant=exact.pricing?.variant||null;patch.priceSource=exact.pricing?.source==='master-cache'?'master-cache':'live-tcgplayer';patch.marketPriceUpdatedAt=serverTimestamp()}if(exact.id&&!saved.apiId)saved.apiId=exact.id;if(url)saved.tcgplayerUrl=url;await updateDoc(doc(db,'users',currentUser.uid,'collection',saved.id),patch)}catch(e){console.warn('Card enrichment failed:',saved.name,e)}}));if(i+3<due.length)await sleep(300)}renderCards()}"
if old not in s:
    raise SystemExit('collection enrichment not found')
s = s.replace(old, new, 1)
s = s.replace("setInterval(()=>{if(!document.hidden){loadMasterPrices();enrichMissingLinks()}},300000)", "setInterval(()=>{if(!document.hidden){loadMasterPrices();enrichMissingLinks()}},60000)", 1)
coll.write_text(s)
