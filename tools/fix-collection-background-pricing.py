from pathlib import Path

p = Path('CARD CRATE CLUB/collection.html')
text = p.read_text(encoding='utf-8')

old = "const RECHECK_AFTER_MS=86400000,FAILED_RECHECK_AFTER_MS=300000,RECHECK_BATCH_SIZE=12,RECHECK_INTERVAL_MS=60000,LOOKUP_TIMEOUT_MS=9000;"
new = "const RECHECK_AFTER_MS=86400000,FAILED_RECHECK_AFTER_MS=300000,RECHECK_BATCH_SIZE=24,RECHECK_INTERVAL_MS=15000,LOOKUP_TIMEOUT_MS=9000;"
if old not in text:
    raise SystemExit('Could not find collection recheck constants')
text = text.replace(old, new, 1)

old_flow = "recheckTimer=setTimeout(async()=>{await requestMasterRefresh();await loadMasterPrices();await enrichMissingLinks()},1200)},()=>{overlay.classList.add('hide');setTimeout(()=>overlay.style.display='none',400)});setInterval(()=>{if(!document.hidden){loadMasterPrices();enrichMissingLinks()}},60000)"
new_flow = "recheckTimer=setTimeout(async()=>{await requestMasterRefresh();await loadMasterPrices();await recheckSavedCards(false)},1200)},()=>{overlay.classList.add('hide');setTimeout(()=>overlay.style.display='none',400)});setInterval(()=>{if(!document.hidden){loadMasterPrices();recheckSavedCards(false)}},RECHECK_INTERVAL_MS)"
if old_flow not in text:
    raise SystemExit('Could not find collection startup/interval pricing flow')
text = text.replace(old_flow, new_flow, 1)

old_hint = "Tap any card to enlarge it and immediately look up its exact TCGplayer profile. Saved cards are also periodically re-checked so card details, market prices, and links can correct themselves."
new_hint = "Prices and TCGplayer links update automatically in the background. Tapping a card still runs an immediate exact lookup, but you should not need to open cards one-by-one."
if old_hint not in text:
    raise SystemExit('Could not find collection helper text')
text = text.replace(old_hint, new_hint, 1)

p.write_text(text, encoding='utf-8')
print('collection.html: enabled continuous background exact-card pricing/link hydration')
