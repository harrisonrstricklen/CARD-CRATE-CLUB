from pathlib import Path
import re

ROOT = Path('CARD CRATE CLUB')
COIN = 'images/crate%20coin%202.png'

# Shared styles for the new Crate Coin artwork.
theme = ROOT / 'theme.css'
text = theme.read_text(encoding='utf-8')
marker = '/* ===== CRATE COIN BRAND ASSET ===== */'
if marker not in text:
    text += f'''\n\n{marker}\n.crate-coin-nav-icon{{width:18px;height:18px;object-fit:contain;display:inline-block;vertical-align:-4px;filter:drop-shadow(0 2px 5px rgba(245,200,66,.22))}}\n.crate-coin-mobile-icon{{width:22px;height:22px;object-fit:contain;display:block;margin:0 auto 2px;filter:drop-shadow(0 2px 5px rgba(245,200,66,.22))}}\n.crate-coin-feature-icon{{width:48px;height:48px;object-fit:contain;display:block;filter:drop-shadow(0 6px 12px rgba(245,200,66,.22))}}\n.crate-coin-hero-img{{width:min(190px,48vw);height:auto;object-fit:contain;margin:0 auto 14px;display:block;filter:drop-shadow(0 16px 34px rgba(245,200,66,.2))}}\n.crate-coin-balance-img{{width:84px;height:84px;object-fit:contain;display:block;margin:0 auto 8px;filter:drop-shadow(0 8px 18px rgba(245,200,66,.24))}}\n.crate-coin-txn-icon{{width:24px;height:24px;object-fit:contain;flex:0 0 24px}}\n.crate-coin-action-img{{width:34px;height:34px;object-fit:contain;display:block}}\n'''
    theme.write_text(text, encoding='utf-8')
    print('theme.css: added Crate Coin asset styles')

# Replace Rewards emoji icons in shared desktop/mobile member navigation anywhere they occur.
for p in ROOT.glob('*.html'):
    t = p.read_text(encoding='utf-8')
    original = t
    t = t.replace('🪙 Rewards', f'<img class="crate-coin-nav-icon" src="{COIN}" alt=""> Rewards')
    t = t.replace('<span class="micon">🪙</span>Rewards', f'<span class="micon"><img class="crate-coin-mobile-icon" src="{COIN}" alt=""></span>Rewards')
    if t != original:
        p.write_text(t, encoding='utf-8')
        print(f'{p.name}: replaced Rewards coin emoji')

# Rewards page: make the new coin the visual centerpiece and default transaction emblem.
p = ROOT / 'rewards.html'
t = p.read_text(encoding='utf-8')
if '<div class="coin-hero">' in t and 'crate-coin-hero-img' not in t:
    t = t.replace('<div class="coin-hero">', f'<div class="coin-hero">\n      <img class="crate-coin-hero-img" src="{COIN}" alt="Card Crate Club Crate Coin">', 1)
t = t.replace('<div class="coin-balance-icon">🪙</div>', f'<img class="crate-coin-balance-img" src="{COIN}" alt="Crate Coin">')
t = t.replace("<span class=\"txn-icon\">${t.icon || '🪙'}</span>", f"<span class=\"txn-icon\">${{t.icon || '<img class=\\\"crate-coin-txn-icon\\\" src=\\\"{COIN}\\\" alt=\\\"Crate Coin\\\">'}}</span>")
p.write_text(t, encoding='utf-8')
print('rewards.html: added branded coin to hero, balance and transactions')

# Homepage feature: when JS relabels Rewards Program -> Crate Coins, use the actual coin artwork.
p = ROOT / 'main.js'
t = p.read_text(encoding='utf-8')
needle = "if (p) p.textContent = update[1];"
insert = "if (p) p.textContent = update[1];\n            if (update[0] === 'Crate Coins') { const icon = h3.parentElement.querySelector('.feature-icon'); if (icon) icon.innerHTML = '<img class=\"crate-coin-feature-icon\" src=\"images/crate%20coin%202.png\" alt=\"Crate Coin\">'; }"
if needle in t and 'crate-coin-feature-icon' not in t:
    t = t.replace(needle, insert, 1)
p.write_text(t, encoding='utf-8')
print('main.js: branded homepage Crate Coins feature')

# Dashboard: if there is a Rewards quick action, swap its generic icon for the coin artwork.
p = ROOT / 'dashboard.html'
t = p.read_text(encoding='utf-8')
# Handle common action-card markup without disturbing the main nav.
t = re.sub(r'(<a[^>]+href="rewards\.html"[^>]*class="action-card"[^>]*>\s*<div class="action-icon">)(.*?)(</div>)', rf'\1<img class="crate-coin-action-img" src="{COIN}" alt="Crate Coin">\3', t, flags=re.S)
p.write_text(t, encoding='utf-8')
print('dashboard.html: branded Rewards quick action when present')
