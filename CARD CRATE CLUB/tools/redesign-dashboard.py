from pathlib import Path

path = Path(__file__).resolve().parent.parent / 'dashboard.html'
html = path.read_text(encoding='utf-8')

# Brand/logo replacement: replace the old CCC text mark with an inline gold emblem + full name.
html = html.replace(
    '<a href="dashboard.html" class="nav-logo">CCC<span>.</span></a>',
    '''<a href="dashboard.html" class="nav-logo brand-lockup" aria-label="Card Crate Club home">
      <span class="brand-emblem" aria-hidden="true">
        <svg viewBox="0 0 48 48" role="img" aria-hidden="true">
          <path d="M24 3 42 13v22L24 45 6 35V13L24 3Z" fill="none" stroke="currentColor" stroke-width="3"/>
          <path d="M14 18 24 12l10 6-10 6-10-6Zm0 0v12l10 6V24m10-6v12l-10 6" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
        </svg>
      </span>
      <span class="brand-name">Card Crate Club</span>
    </a>'''
)

# If the exact old anchor varied, catch the simple CCC version too.
html = html.replace(
    '<div class="nav-logo">CCC<span>.</span></div>',
    '''<a href="dashboard.html" class="nav-logo brand-lockup" aria-label="Card Crate Club home">
      <span class="brand-emblem" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M24 3 42 13v22L24 45 6 35V13L24 3Z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M14 18 24 12l10 6-10 6-10-6Zm0 0v12l10 6V24m10-6v12l-10 6" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg></span>
      <span class="brand-name">Card Crate Club</span>
    </a>'''
)

# Insert the collection preview immediately before Quick Actions if not already present.
marker = '      <!-- Quick Actions -->'
if 'id="collection-preview"' not in html and marker in html:
    preview = '''      <!-- Collection Preview -->
      <section class="collection-preview-section" id="collection-preview-section">
        <div class="collection-preview-head">
          <div>
            <div class="collection-kicker">YOUR COLLECTION</div>
            <h2>Top cards in your collection</h2>
          </div>
          <a href="collection.html" class="collection-link">View Full Collection →</a>
        </div>
        <div class="collection-preview-card">
          <div class="collection-preview-grid" id="collection-preview">
            <div class="collection-preview-empty">Add cards to your collection and your top three will appear here.</div>
          </div>
        </div>
      </section>

'''
    html = html.replace(marker, preview + marker, 1)

# Add CSS overrides right before </style>.
css = r'''

    /* ========== GENERATED-IMAGE DASHBOARD REDESIGN ========== */
    header { height:72px; padding:0 28px; background:rgba(8,8,13,.94); }
    main { max-width:1180px; padding:34px 24px 72px; }

    .brand-lockup { display:flex; align-items:center; gap:12px; color:var(--text); min-width:210px; }
    .brand-emblem { width:38px; height:38px; display:grid; place-items:center; color:var(--gold); filter:drop-shadow(0 6px 16px rgba(245,200,66,.16)); }
    .brand-emblem svg { width:100%; height:100%; }
    .brand-name { font-size:1.08rem; font-weight:800; letter-spacing:.01em; white-space:nowrap; color:var(--text); }

    .welcome-banner { padding:30px 30px 26px; border-radius:18px; background:linear-gradient(135deg,#171722 0%,#211c30 100%); }
    .welcome-heading { font-size:2rem; letter-spacing:-.035em; }
    .stats-row { grid-template-columns:repeat(6,1fr); gap:10px; }
    .stat-card { min-height:112px; display:flex; flex-direction:column; justify-content:center; }
    .stat-value { font-size:1.35rem; }

    .founding-banner { padding:16px 20px; border-radius:15px; }
    .subscription-section { margin-bottom:18px; }
    .subscription-section .section-title { display:none; }
    .sub-card { padding:18px 20px; border-radius:15px; background:linear-gradient(135deg,#15151e,#1b1b27); }
    .sub-info { display:grid; grid-template-columns:auto 1fr; column-gap:14px; align-items:center; }
    .sub-badge { grid-column:1; grid-row:1 / span 2; width:44px; height:44px; margin:0; border-radius:12px; justify-content:center; overflow:hidden; font-size:0; }
    .sub-badge::after { content:'★'; font-size:1.05rem; }
    .sub-name { grid-column:2; margin:0 0 3px; font-size:.95rem; }
    .sub-desc { grid-column:2; }
    .sub-actions { flex-direction:row; align-items:center; }
    .sub-actions .btn { min-width:132px; }

    .membership-manage-row { display:none !important; }

    .collection-preview-section { margin:18px 0 26px; }
    .collection-preview-head { display:flex; justify-content:space-between; align-items:end; gap:16px; margin-bottom:12px; }
    .collection-kicker { color:var(--gold); font-size:.66rem; font-weight:900; letter-spacing:.12em; margin-bottom:5px; }
    .collection-preview-head h2 { font-size:1.05rem; margin:0; }
    .collection-link { color:var(--gold); font-size:.78rem; font-weight:800; white-space:nowrap; }
    .collection-preview-card { border:1px solid var(--border); background:linear-gradient(135deg,#12131b,#181925); border-radius:16px; overflow:hidden; }
    .collection-preview-grid { display:grid; grid-template-columns:repeat(3,1fr); }
    .collection-item { min-height:190px; padding:16px; display:grid; grid-template-columns:88px 1fr; gap:14px; align-items:center; border-right:1px solid var(--border); }
    .collection-item:last-child { border-right:0; }
    .collection-item img { width:88px; height:124px; object-fit:contain; border-radius:7px; background:rgba(255,255,255,.025); filter:drop-shadow(0 9px 16px rgba(0,0,0,.38)); }
    .collection-item-copy { min-width:0; }
    .collection-item-rank { color:var(--gold); font-size:.67rem; font-weight:900; letter-spacing:.08em; margin-bottom:5px; }
    .collection-item-name { font-size:.95rem; font-weight:800; margin-bottom:5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .collection-item-meta { color:var(--muted); font-size:.74rem; line-height:1.45; }
    .collection-preview-empty { grid-column:1/-1; padding:34px 20px; text-align:center; color:var(--muted); font-size:.84rem; }

    .timeline-section, .crates-section, .activity-section, .sets-section, .actions-section { margin-bottom:28px; }
    .timeline-card, .card-block, .activity-list, .crate-history-card { border-radius:15px; }
    .section-title { font-size:.95rem; }

    .actions-grid { grid-template-columns:repeat(4,1fr); }
    .action-card { min-height:92px; padding:15px; }
    .action-card[href="collection.html"] { display:none; }

    @media (max-width:980px) {
      .stats-row { grid-template-columns:repeat(3,1fr); }
      .actions-grid { grid-template-columns:repeat(2,1fr); }
      .collection-item { grid-template-columns:72px 1fr; padding:13px; }
      .collection-item img { width:72px; height:102px; }
      .brand-name { display:none; }
      .brand-lockup { min-width:auto; }
    }
    @media (max-width:640px) {
      header { height:62px; padding:0 14px; }
      main { padding:20px 12px 94px; }
      .brand-emblem { width:34px; height:34px; }
      .welcome-banner { padding:22px 18px; }
      .welcome-heading { font-size:1.45rem; }
      .stats-row { grid-template-columns:repeat(3,1fr); }
      .stat-card { min-height:96px; }
      .collection-preview-head { align-items:center; }
      .collection-preview-grid { grid-template-columns:1fr; }
      .collection-item { grid-template-columns:82px 1fr; min-height:135px; border-right:0; border-bottom:1px solid var(--border); }
      .collection-item:last-child { border-bottom:0; }
      .collection-item img { width:82px; height:116px; }
      .sub-info { width:100%; }
      .sub-actions { width:100%; }
      .sub-actions .btn { width:100%; }
    }
'''
if 'GENERATED-IMAGE DASHBOARD REDESIGN' not in html:
    html = html.replace('</style>', css + '\n  </style>', 1)

# Add Firestore-driven top-three preview. We query recent cards, then sort client-side by any value field available.
needle = "      // ── Hide loading overlay ───────────────────────────────────────\n"
if 'renderCollectionPreview' not in html and needle in html:
    insertion = r'''      // ── Collection preview: top three cards ─────────────────────────
      try {
        await renderCollectionPreview(user.uid);
      } catch (err) {
        console.warn('Could not load collection preview:', err);
      }

'''
    html = html.replace(needle, insertion + needle, 1)

function_anchor = '    async function loadStashIntoFloatingBg(uid) {'
if 'async function renderCollectionPreview' not in html and function_anchor in html:
    func = r'''    async function renderCollectionPreview(uid) {
      const target = document.getElementById('collection-preview');
      if (!target) return;
      const collRef = collection(db, 'users', uid, 'collection');
      const q = query(collRef, orderBy('addedAt', 'desc'), limit(30));
      const snap = await getDocs(q);
      if (snap.empty) return;

      const cards = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const score = card => Number(card.marketPrice ?? card.price ?? card.value ?? card.tcgPrice ?? 0) || 0;
      cards.sort((a,b) => score(b) - score(a));
      const top = cards.slice(0,3);
      if (!top.length) return;

      target.innerHTML = top.map((card, index) => {
        const img = card.image || card.imageUrl || card.localImage || '';
        const name = card.name || card.cardName || 'Collected card';
        const setName = card.setName || card.set || 'Your collection';
        const number = card.number || card.localId || '';
        const price = score(card);
        const meta = price > 0 ? `$${price.toFixed(2)} estimated value` : `${setName}${number ? ' · #' + number : ''}`;
        return `
          <a class="collection-item" href="collection.html">
            ${img ? `<img src="${img}" alt="${name}" loading="lazy" onerror="this.style.opacity='.18'">` : '<div></div>'}
            <div class="collection-item-copy">
              <div class="collection-item-rank">#${index + 1} TOP CARD</div>
              <div class="collection-item-name">${name}</div>
              <div class="collection-item-meta">${meta}</div>
            </div>
          </a>`;
      }).join('');
    }

'''
    html = html.replace(function_anchor, func + function_anchor, 1)

# Make the loading emblem match the new branding too.
html = html.replace('<div class="loader-logo">CCC<span>.</span></div>', '<div class="loader-logo">Card Crate <span>Club</span></div>')

path.write_text(html, encoding='utf-8')
print('Dashboard redesign applied.')
