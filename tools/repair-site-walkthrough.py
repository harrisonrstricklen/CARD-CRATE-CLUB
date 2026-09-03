from pathlib import Path
import re

ROOT = Path('CARD CRATE CLUB')

def replace(path, old, new, count=None):
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    n = text.count(old)
    if n == 0:
        raise SystemExit(f'Missing expected text in {path}: {old[:90]!r}')
    if count is not None and n != count:
        raise SystemExit(f'Expected {count} occurrences in {path}, found {n}: {old[:90]!r}')
    p.write_text(text.replace(old, new), encoding='utf-8')
    print(f'{path}: replaced {n} occurrence(s)')

# Homepage: make account creation obvious from the first screen.
replace('index.html', '<a href="#waitlist" class="btn btn-gold btn-lg">👑 Claim Your Founding Spot</a>', '<a href="signup.html?intent=founding" class="btn btn-gold btn-lg">👑 Create Profile & Join Founding 100</a>', 1)
replace('index.html', '<a href="#waitlist" class="btn btn-gold btn-lg">👑 Claim My Founding Spot</a>', '<a href="signup.html?intent=founding" class="btn btn-gold btn-lg">👑 Create Profile & Join Founding 100</a>', 1)
replace('index.html', 'navAuth.innerHTML = `<a href="login.html" style="padding:6px 12px;">Login</a><a href="#waitlist" class="nav-btn-primary" style="padding:8px 16px;border-radius:8px;">Join Waitlist</a>`;', 'navAuth.innerHTML = `<a href="login.html" style="padding:6px 12px;">Login</a><a href="signup.html?intent=waitlist" class="nav-btn-primary" style="padding:8px 16px;border-radius:8px;">Create Account</a>`;', 1)
replace('index.html', 'mobileAuth.innerHTML = `<a href="login.html">Login</a>`;', 'mobileAuth.innerHTML = `<a href="login.html">Login</a><a href="signup.html?intent=waitlist">Create Account</a>`;', 1)

# Homepage JS: the waitlist form now becomes step one of account creation instead of a disconnected lead form.
p = ROOT / 'main.js'
text = p.read_text(encoding='utf-8')
pattern = re.compile(r"    // ---- WAITLIST FORM ----\n    const waitlistForm = document\.getElementById\('waitlistForm'\);.*?\n    function updateCounter\(\) \{.*?\n    \}\n", re.S)
replacement = '''    // ---- WAITLIST / PROFILE CREATION ----\n    const waitlistForm = document.getElementById('waitlistForm');\n    if (waitlistForm) {\n        const submitBtn = waitlistForm.querySelector('.btn-submit');\n        if (submitBtn) submitBtn.textContent = 'Create Profile & Join Waitlist';\n        const explainer = waitlistForm.querySelector('.form-disclaimer');\n        if (explainer) explainer.textContent = 'Next, you’ll create your free Card Crate Club profile. No credit card is required.';\n        waitlistForm.addEventListener('submit', function(e) {\n            e.preventDefault();\n            const formData = new FormData(waitlistForm);\n            const firstName = String(formData.get('firstName') || '').trim();\n            const email = String(formData.get('email') || '').trim();\n            const tier = String(formData.get('tier') || '').trim();\n            const params = new URLSearchParams({ intent: 'waitlist' });\n            if (firstName) params.set('firstName', firstName);\n            if (email) params.set('email', email);\n            if (tier) params.set('plan', tier);\n            window.location.href = `signup.html?${params.toString()}`;\n        });\n    }\n'''
text2, n = pattern.subn(replacement, text, count=1)
if n != 1:
    raise SystemExit(f'Could not replace homepage waitlist handler; matches={n}')
text = text2

# Keep homepage plan pricing synchronized with the real subscriptions page and require a profile first.
price_pairs = [('$24.99', '$29.99'), ('$44.99', '$54.99'), ('$64.99', '$74.99'), ('$119.99', '$149')]
for old, new in price_pairs:
    if old not in text:
        raise SystemExit(f'Missing stale homepage price {old}')
    text = text.replace(old, new)
for plan in ('pack-club','trainer-club','collector-club','box-club'):
    text = text.replace(f'href="onboarding.html?plan={plan}"', f'href="signup.html?intent=subscribe&plan={plan}"')
# Founding CTA injected/polished by JS must also point into profile creation.
old = "if (foundingCta) foundingCta.textContent = '👑 Join the Founding 100 Waitlist';"
new = "if (foundingCta) { foundingCta.textContent = '👑 Create Profile & Join Founding 100'; foundingCta.href = 'signup.html?intent=founding'; }"
if old not in text:
    raise SystemExit('Missing founding CTA JS update')
text = text.replace(old, new)
p.write_text(text, encoding='utf-8')
print('main.js: repaired waitlist/profile flow and synchronized pricing')

# Subscription choices should create/reuse a profile before entering onboarding.
p = ROOT / 'subscriptions.html'
text = p.read_text(encoding='utf-8')
for plan in ('pack-club','trainer-club','collector-club','box-club'):
    old = f'href="onboarding.html?plan={plan}"'
    new = f'href="signup.html?intent=subscribe&plan={plan}"'
    if old not in text:
        raise SystemExit(f'Missing subscriptions CTA for {plan}')
    text = text.replace(old, new)
# Preview builder CTA also enters the account-aware route.
text = text.replace('href="onboarding.html?plan=trainer-club"', 'href="signup.html?intent=subscribe&plan=trainer-club"')
p.write_text(text, encoding='utf-8')
print('subscriptions.html: account-aware membership CTAs')

# Founding 100 page: make profile creation the primary next action.
p = ROOT / 'founding-members.html'
text = p.read_text(encoding='utf-8')
old = '<section class="fm-cta-wrap"><a href="subscriptions.html" class="btn btn-gold btn-lg">Build Your Crate →</a><p>'
new = '<section class="fm-cta-wrap"><a href="signup.html?intent=founding" class="btn btn-gold btn-lg">Create Profile & Join Founding 100 →</a><p>'
if old not in text:
    raise SystemExit('Missing Founding 100 CTA')
text = text.replace(old, new)
text = text.replace('<a href="signup.html" class="nav-btn-primary">Join the Club</a>', '<a href="signup.html?intent=founding" class="nav-btn-primary">Create Account</a>')
p.write_text(text, encoding='utf-8')
print('founding-members.html: primary CTA now creates profile')

# Across public pages, remove vague "Join the Club" labels where the action is actually account creation.
for p in ROOT.glob('*.html'):
    t = p.read_text(encoding='utf-8')
    updated = t.replace('>Join the Club</a>', '>Create Account</a>')
    if updated != t:
        p.write_text(updated, encoding='utf-8')
        print(f'{p.name}: clarified Create Account nav label')

# Signup page: prefill the first step when someone came from the homepage waitlist form.
p = ROOT / 'signup.html'
text = p.read_text(encoding='utf-8')
needle = "document.getElementById('intentKicker').textContent=copy.kicker;document.getElementById('intentTitle').textContent=copy.title;document.getElementById('intentCopy').textContent=copy.copy;document.getElementById('intentNote').textContent=copy.note;createBtn.textContent=copy.button;"
insert = needle + "\n  const preFirst=params.get('firstName')||'',preEmail=params.get('email')||'';if(preFirst)document.getElementById('firstName').value=preFirst;if(preEmail)document.getElementById('signupEmail').value=preEmail;"
if needle not in text:
    raise SystemExit('Missing signup copy initialization')
text = text.replace(needle, insert, 1)
p.write_text(text, encoding='utf-8')
print('signup.html: added homepage waitlist prefill')
