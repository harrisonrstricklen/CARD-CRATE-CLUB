from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# --- set.html: local artwork only ---
set_path = ROOT / 'set.html'
s = set_path.read_text(encoding='utf-8')
start = s.index('  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));')
end = s.index('\n  function render() {', start)
replacement = '''  // Card data and artwork are served from Card Crate Club's own local files.
  async function loadLocalSet() {
    statusEl.textContent = 'Opening card list…';
    const res = await fetch(`card-data/${encodeURIComponent(setId)}.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Local card data HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !Array.isArray(data.cards) || !data.cards.length) throw new Error('Local card data is empty');
    return data;
  }

  function localImage(card) {
    if (card.localImage) return card.localImage;
    const id = String(card.localId ?? '').replace(/[^A-Za-z0-9._-]+/g, '-');
    return id ? `card-images/${setId}/${id}.webp` : '';
  }

  function applyFallback(img, card, quality = 'low', stateEl = null) {
    const src = localImage(card);
    if (!src) {
      img.removeAttribute('src');
      if (stateEl) stateEl.textContent = 'Artwork coming soon';
      return;
    }
    if (stateEl) stateEl.textContent = 'Loading local artwork…';
    img.onload = () => { if (stateEl) stateEl.remove(); };
    img.onerror = () => {
      img.removeAttribute('src');
      if (stateEl) stateEl.textContent = 'Artwork coming soon';
    };
    img.src = src;
  }
'''
s = s[:start] + replacement + s[end:]
# Modal used imageSources/loadCardImage in the old implementation; make it local too.
s = s.replace("const modalSources = imageSources(card, 'high');", "const modalSources = [localImage(card)].filter(Boolean);")
s = s.replace("loadCardImage(modalImg, card, 'high', null, 3).catch(() => {});", "applyFallback(modalImg, card, 'high', null);")
s = s.replace('Waiting for artwork…', 'Loading local artwork…')
set_path.write_text(s, encoding='utf-8')

# --- dashboard.html: compact professional membership controls ---
dash_path = ROOT / 'dashboard.html'
d = dash_path.read_text(encoding='utf-8')
old_controls = '''      <!-- Subscription Controls -->
      <div class="controls-section">
        <div class="section-title">🔧 Subscription Controls</div>
        <div class="controls-grid">
          <a href="subscriptions.html" class="control-btn"><span class="control-icon">⬆️</span>Upgrade</a>
          <a href="subscriptions.html" class="control-btn"><span class="control-icon">⬇️</span>Downgrade</a>
          <button type="button" class="control-btn" id="btn-pause"><span class="control-icon">⏸️</span>Pause</button>
          <button type="button" class="control-btn" id="btn-skip"><span class="control-icon">⏭️</span>Skip a Month</button>
          <button type="button" class="control-btn danger" id="btn-cancel"><span class="control-icon">❌</span>Cancel</button>
          <a href="account.html#preferences" class="control-btn"><span class="control-icon">🎯</span>Preferences</a>
        </div>
      </div>
'''
new_controls = '''      <!-- Membership Management -->
      <div class="controls-section">
        <div class="membership-manage-row">
          <div class="membership-manage-copy">
            <span class="membership-kicker">Membership</span>
            <strong>Manage your Card Crate Club plan</strong>
            <span>Billing, plan changes and preferences in one place.</span>
          </div>
          <a href="subscriptions.html" class="membership-manage-link">Manage plan <span>→</span></a>
        </div>
      </div>
'''
if old_controls not in d:
    raise SystemExit('Dashboard controls block not found')
d = d.replace(old_controls, new_controls)
css_anchor = '    /* ========== ACTIVITY LIST ========== */'
css = '''    .membership-manage-row {
      background: linear-gradient(135deg, rgba(22,22,31,.96), rgba(26,26,36,.96));
      border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 18px;
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
    }
    .membership-manage-copy { display:flex; flex-direction:column; gap:3px; min-width:0; }
    .membership-kicker { color:var(--gold); font-size:.66rem; font-weight:800; text-transform:uppercase; letter-spacing:.09em; }
    .membership-manage-copy strong { font-size:.9rem; font-weight:750; }
    .membership-manage-copy > span:last-child { color:var(--muted); font-size:.74rem; }
    .membership-manage-link { color:var(--gold); font-size:.78rem; font-weight:800; white-space:nowrap; padding:8px 10px; border-radius:9px; }
    .membership-manage-link:hover { background:rgba(245,200,66,.08); }
    @media (max-width:640px) {
      .membership-manage-row { padding:14px; align-items:flex-start; }
      .membership-manage-copy > span:last-child { display:none; }
      .membership-manage-link { padding:6px 2px; }
    }

'''
d = d.replace(css_anchor, css + css_anchor)
# Remove now-obsolete modal script so deleted buttons cannot cause JS errors.
modal_start = d.find('  <!-- ========== SUBSCRIPTION CONTROL MODALS ========== -->')
if modal_start != -1:
    body_end = d.rfind('</body>')
    d = d[:modal_start] + d[body_end:]
dash_path.write_text(d, encoding='utf-8')
print('Updated set.html and dashboard.html')
