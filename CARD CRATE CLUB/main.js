// ========================================
// CARD CRATE CLUB — MAIN.JS
// ========================================

document.addEventListener('DOMContentLoaded', function() {

    // ---- OFFICIAL BRAND MARK ----
    if (!document.querySelector('link[data-ccc-brand-logo]')) {
        const brandLogo = document.createElement('link');
        brandLogo.rel = 'stylesheet';
        brandLogo.href = 'brand-logo.css';
        brandLogo.dataset.cccBrandLogo = 'true';
        document.head.appendChild(brandLogo);
    }

    // ---- HOMEPAGE POLISH CSS ----
    if (document.querySelector('.home-section') && !document.querySelector('link[data-home-mobile-fix]')) {
        const mobileFix = document.createElement('link');
        mobileFix.rel = 'stylesheet';
        mobileFix.href = 'home-mobile-fix.css';
        mobileFix.dataset.homeMobileFix = 'true';
        document.head.appendChild(mobileFix);
    }

    // ---- SEO / BROWSER POLISH ----
    if (!document.querySelector('link[rel="canonical"]')) {
        const canonical = document.createElement('link');
        canonical.rel = 'canonical';
        canonical.href = 'https://cardcrateclub.com' + (window.location.pathname === '/' ? '/' : window.location.pathname);
        document.head.appendChild(canonical);
    }

    document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"]').forEach(icon => icon.remove());
    const icon = document.createElement('link');
    icon.rel = 'icon';
    icon.type = 'image/svg+xml';
    icon.href = 'favicon.svg?v=ccc-official-20260831';
    document.head.appendChild(icon);

    document.querySelectorAll('a[target="_blank"]').forEach(link => {
        link.rel = 'noopener noreferrer';
    });

    // ---- PERSONAL NAVIGATION ----
    // Keep Home visibly available and make the signed-in dashboard feel personal.
    const navLinks = document.getElementById('navLinks') || document.querySelector('.nav-links');
    if (navLinks && !navLinks.querySelector('a[data-home-nav]')) {
        const homeLink = document.createElement('a');
        homeLink.href = 'index.html';
        homeLink.textContent = 'Home';
        homeLink.dataset.homeNav = 'true';
        navLinks.insertBefore(homeLink, navLinks.firstChild);
    }

    const personalizeDashboardLinks = () => {
        document.querySelectorAll('a[href*="dashboard.html"]').forEach(link => {
            if (/^dashboard$/i.test(link.textContent.trim())) link.textContent = 'My Dashboard';
        });
    };
    personalizeDashboardLinks();
    const navAuth = document.getElementById('navAuth');
    if (navAuth && 'MutationObserver' in window) {
        new MutationObserver(personalizeDashboardLinks).observe(navAuth, { childList: true, subtree: true, characterData: true });
    }
    const mobileAuth = document.getElementById('mobileAuth');
    if (mobileAuth && 'MutationObserver' in window) {
        new MutationObserver(personalizeDashboardLinks).observe(mobileAuth, { childList: true, subtree: true, characterData: true });
    }

    // ---- HOMEPAGE BRAND / PRE-LAUNCH COPY ----
    const isHome = !!document.querySelector('.hero#home');
    if (isHome) {
        document.querySelectorAll('.nav-logo, .footer-brand-logo').forEach(el => {
            const spans = el.querySelectorAll('span');
            spans.forEach(span => {
                if (span.textContent.trim() === '.' || /CARDCRATE CLUB/i.test(span.textContent)) span.remove();
            });
        });

        const heroSubtitle = document.querySelector('.hero-subtitle');
        if (heroSubtitle) {
            heroSubtitle.textContent = 'Monthly Pokémon TCG subscriptions built to make collecting easier. Pick your monthly pack count, choose the sets you want, and let Card Crate Club handle the hunt.';
        }

        const disclaimer = document.querySelector('.hero-disclaimer');
        if (disclaimer) disclaimer.textContent = 'Free to join the waitlist. No credit card required.';

        const copyUpdates = {
            'No More Scalpers': ['Skip the Store Hunt', 'Spend less time chasing restocks. We plan each crate around authentic sealed products sourced through trusted suppliers and available distribution channels.'],
            'AI-Powered Tools': ['Collector Tools', 'Use collection tracking, card research, and Crate Advisor tools designed to help you organize your hobby and make informed collecting decisions.'],
            'Rewards Program': ['Crate Coins', 'Eligible subscriptions, referrals, and community activity can earn Crate Coins for future rewards and member perks as the program rolls out.'],
            'Fast & Safe Shipping': ['Protective Fulfillment', 'Paid crates are packed with protective materials and shipment tracking when available from the carrier.']
        };
        document.querySelectorAll('.feature-card h3').forEach(h3 => {
            const update = copyUpdates[h3.textContent.trim()];
            if (!update) return;
            h3.textContent = update[0];
            const p = h3.parentElement.querySelector('p');
            if (p) p.textContent = update[1];
        });

        // Prefer local decorative card art to avoid third-party image failures.
        const localCards = [
            'card-images/me05/116.webp','card-images/me04/116.webp','card-images/me03/120.webp',
            'card-images/me02.5/293.webp','card-images/me02/125.webp','card-images/me01/180.webp',
            'card-images/me05/120.webp','card-images/me04/122.webp','card-images/me03/121.webp',
            'card-images/me02.5/294.webp','card-images/me02/126.webp','card-images/me01/181.webp'
        ];
        document.querySelectorAll('.floating-bg .fc img').forEach((img, i) => {
            img.src = localCards[i % localCards.length];
            img.onerror = () => { if (img.parentElement) img.parentElement.style.display = 'none'; };
        });

        // Use the newest Card Crate Club concept art from the repo.
        if (!document.querySelector('.crate-concept-section')) {
            const concept = document.createElement('section');
            concept.className = 'crate-concept-section';
            concept.setAttribute('aria-label', 'Card Crate Club subscription crate concepts');
            concept.innerHTML = `
                <div class="crate-concept-card">
                    <div class="crate-concept-copy">
                        <span class="crate-concept-kicker">What We're Building</span>
                        <h2>Your Packs. Your Sets. <span>Your Crate.</span></h2>
                        <p>Pick a monthly pack count, split those packs across the eligible sets you actually want, and preview your crate before you subscribe.</p>
                        <div class="crate-concept-points">
                            <span>4 Pack Crate</span><span>8 Pack Crate</span><span>12 Pack Crate</span><span>Box Club</span>
                        </div>
                    </div>
                    <div class="crate-concept-art">
                        <img src="images/card-crate-club-crates-final.png?v=20260901-v2" alt="Card Crate Club subscription crate concept renderings" loading="eager">
                        <div class="crate-concept-caption">Concept rendering — final packaging and eligible pack selection may vary.</div>
                    </div>
                </div>`;
            const announcement = document.querySelector('.announcement-bar');
            const why = document.querySelector('#why');
            if (announcement) announcement.insertAdjacentElement('afterend', concept);
            else if (why) why.insertAdjacentElement('beforebegin', concept);
        }

        // Match the homepage choices to the full subscription lineup.
        const subscriptionsSection = document.getElementById('subscriptions');
        if (subscriptionsSection) {
            subscriptionsSection.innerHTML = `
                <div class="section-header">
                    <span class="section-tag">Build Your Crate</span>
                    <h2 class="section-title">Choose Your <span class="gold">Monthly Pack Count</span></h2>
                    <p class="section-subtitle">Start with the size that fits you, then choose how many packs you want from each eligible set before checkout.</p>
                </div>
                <div class="tiers-grid">
                    <div class="tier-card">
                        <div class="tier-icon">🎴</div>
                        <div class="tier-name">4-Pack Crate</div>
                        <div class="tier-amount">$24.99</div>
                        <div class="tier-period">/month — current price</div>
                        <ul class="tier-features">
                            <li>✓ 4 booster packs each month</li>
                            <li>✓ Mix available eligible sets</li>
                            <li>✓ Update next crate before cutoff</li>
                            <li>✓ Member store access</li>
                        </ul>
                        <a href="onboarding.html?plan=pack-club" class="btn btn-outline btn-block">Build 4-Pack Crate</a>
                    </div>
                    <div class="tier-card popular">
                        <div class="popular-badge">⭐ Most Popular</div>
                        <div class="tier-icon">⚡</div>
                        <div class="tier-name">8-Pack Crate</div>
                        <div class="tier-amount">$44.99</div>
                        <div class="tier-period">/month — current price</div>
                        <ul class="tier-features">
                            <li>✓ 8 booster packs each month</li>
                            <li>✓ Mix sets however you want</li>
                            <li>✓ Surprise Me option for open slots</li>
                            <li>✓ Early member access to select drops</li>
                        </ul>
                        <a href="onboarding.html?plan=trainer-club" class="btn btn-gold btn-block">Build 8-Pack Crate</a>
                    </div>
                    <div class="tier-card">
                        <div class="tier-icon">🏆</div>
                        <div class="tier-name">12-Pack Crate</div>
                        <div class="tier-amount">$64.99</div>
                        <div class="tier-period">/month — current price</div>
                        <ul class="tier-features">
                            <li>✓ 12 booster packs each month</li>
                            <li>✓ Mix all available eligible sets</li>
                            <li>✓ Priority access to limited inventory</li>
                            <li>✓ Maximum mixed-crate flexibility</li>
                        </ul>
                        <a href="onboarding.html?plan=collector-club" class="btn btn-outline btn-block">Build 12-Pack Crate</a>
                    </div>
                    <div class="tier-card">
                        <div class="tier-icon">📦</div>
                        <div class="tier-name">Box Club</div>
                        <div class="tier-amount">$119.99</div>
                        <div class="tier-period">/month — current price</div>
                        <ul class="tier-features">
                            <li>✓ Premium monthly sealed-product option</li>
                            <li>✓ Build from eligible Box Club selections</li>
                            <li>✓ Preview available options before checkout</li>
                            <li>✓ Member access to limited inventory</li>
                        </ul>
                        <a href="onboarding.html?plan=box-club" class="btn btn-outline btn-block">Build Box Club Crate</a>
                    </div>
                </div>
                <p class="tiers-note">ℹ️ Pricing and eligible sets can change with product acquisition, shipping, and inventory. You'll see your crate options before subscribing.</p>
                <div class="home-cta-row"><a href="subscriptions.html" class="btn btn-outline">See All Subscription Options →</a></div>`;
        }

        // Keep Founding 100 benefits valuable without promises that are difficult to sustain.
        const foundingSection = document.getElementById('founding-members');
        if (foundingSection) {
            const title = foundingSection.querySelector('.founding-title');
            if (title) title.innerHTML = 'Become One of the <span class="gold">Founding 100</span>';
            const subtitle = foundingSection.querySelector('.founding-subtitle');
            if (subtitle) subtitle.textContent = 'The first 100 activated founding memberships get permanent recognition plus launch-era perks built to stay useful as Card Crate Club grows.';

            const benefits = foundingSection.querySelector('.founding-benefits');
            if (benefits) benefits.innerHTML = `
                <div class="benefit"><div class="benefit-icon">🃏</div><div class="benefit-text"><strong>Exclusive Founding Card</strong><span>A physical Card Crate Club collectible made for the Founding 100.</span></div></div>
                <div class="benefit"><div class="benefit-icon">🏆</div><div class="benefit-text"><strong>Permanent Founder Number</strong><span>Your member number #001–#100 stays tied to your account.</span></div></div>
                <div class="benefit"><div class="benefit-icon">🎟️</div><div class="benefit-text"><strong>Giveaway Entry for Life</strong><span>One complimentary entry in eligible Card Crate Club giveaways for life.</span></div></div>
                <div class="benefit"><div class="benefit-icon">⚡</div><div class="benefit-text"><strong>First Look at New Drops</strong><span>Founders get the first opportunity at new store items and select releases.</span></div></div>
                <div class="benefit"><div class="benefit-icon">🪙</div><div class="benefit-text"><strong>Launch Crate Coins</strong><span>Special launch rewards as the Crate Coins program rolls out.</span></div></div>
                <div class="benefit"><div class="benefit-icon">👑</div><div class="benefit-text"><strong>Founding Member Status</strong><span>A permanent founder badge and recognition inside the club.</span></div></div>`;

            const counter = foundingSection.querySelector('.founding-counter');
            if (counter) {
                counter.innerHTML = '<p class="counter-text"><span class="counter-number">Founding 100</span> — limited to the first 100 activated founding memberships.</p>';
            }
            const foundingCta = foundingSection.querySelector('.btn.btn-gold');
            if (foundingCta) foundingCta.textContent = '👑 Join the Founding 100 Waitlist';
        }

        // Remove outdated lifetime-price-lock language anywhere else on the homepage.
        document.querySelectorAll('.tiers-note, .waitlist-perks .perk, .announcement-inner span').forEach(el => {
            if (/price lock|locked in|pricing forever|lifetime price/i.test(el.textContent)) {
                el.textContent = el.classList.contains('perk') ? '✅ Founder-only launch perks' : 'Founding 100 members receive exclusive launch perks';
            }
        });
    }

    // ---- NAVBAR SCROLL EFFECT ----
    const navbar = document.getElementById('navbar');
    if (navbar) {
        window.addEventListener('scroll', () => {
            if (window.scrollY > 50) {
                navbar.style.background = 'rgba(13,15,20,0.98)';
                navbar.style.boxShadow = '0 4px 24px rgba(0,0,0,0.5)';
            } else {
                navbar.style.background = 'rgba(13,15,20,0.95)';
                navbar.style.boxShadow = 'none';
            }
        });
    }

    // ---- HAMBURGER MENU ----
    const hamburger = document.getElementById('hamburger');
    const mobileMenu = document.getElementById('mobileMenu');
    if (hamburger && mobileMenu) {
        hamburger.addEventListener('click', () => {
            hamburger.classList.toggle('active');
            mobileMenu.classList.toggle('active');
        });
    }

    window.closeMobileMenu = function() {
        if (hamburger) hamburger.classList.remove('active');
        if (mobileMenu) mobileMenu.classList.remove('active');
    };

    // ---- FAQ ACCORDION ----
    window.toggleFaq = function(button) {
        const answer = button.nextElementSibling;
        const isActive = button.classList.contains('active');
        document.querySelectorAll('.faq-question').forEach(q => {
            q.classList.remove('active');
            if (q.nextElementSibling) q.nextElementSibling.classList.remove('active');
        });
        if (!isActive && answer) {
            button.classList.add('active');
            if (answer) answer.classList.add('active');
        }
    };

    // ---- WAITLIST FORM ----
    const waitlistForm = document.getElementById('waitlistForm');
    const formSuccess = document.getElementById('formSuccess');
    if (waitlistForm) {
        waitlistForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const submitBtn = waitlistForm.querySelector('.btn-submit');
            const originalText = submitBtn ? submitBtn.innerHTML : '';
            if (submitBtn) { submitBtn.innerHTML = 'Joining...'; submitBtn.disabled = true; }
            try {
                const formData = new FormData(waitlistForm);
                const payload = Object.fromEntries(formData.entries());
                const response = await fetch('/.netlify/functions/join-waitlist', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
                });
                let result = {};
                try { result = await response.json(); } catch (_) {}
                if (!response.ok) throw new Error(result.error || 'Form submission failed');
                waitlistForm.style.display = 'none';
                if (formSuccess) {
                    formSuccess.style.display = 'block';
                    if (result.alreadyJoined) {
                        const message = formSuccess.querySelector('p');
                        if (message) message.textContent = "You're already on the waitlist — we'll keep you posted!";
                    }
                }
                updateCounter();
            } catch (error) {
                console.error('Waitlist error:', error);
                if (submitBtn) { submitBtn.innerHTML = originalText; submitBtn.disabled = false; }
                alert(error.message || 'Something went wrong. Please try again.');
            }
        });
    }

    function updateCounter() {
        const counterFill = document.getElementById('counterFill');
        const spotsLeft = document.getElementById('spotsLeft');
        if (counterFill && spotsLeft) {
            const current = parseInt(spotsLeft.textContent, 10);
            if (Number.isNaN(current)) return;
            const newCount = Math.max(current - 1, 0);
            spotsLeft.textContent = newCount;
            counterFill.style.width = ((100 - newCount) / 100) * 100 + '%';
        }
    }

    // ---- SCROLL ANIMATIONS ----
    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                }
            });
        }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
        document.querySelectorAll('.feature-card, .step, .tier-card, .benefit, .faq-item, .social-card, .crate-concept-card').forEach((el, index) => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(30px)';
            el.style.transition = `opacity 0.5s ease ${index * 0.04}s, transform 0.5s ease ${index * 0.04}s`;
            observer.observe(el);
        });
    }

    // ---- SMOOTH SCROLL ----
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            const selector = this.getAttribute('href');
            if (!selector || selector === '#') return;
            const target = document.querySelector(selector);
            if (target) {
                e.preventDefault();
                const navHeight = navbar ? navbar.offsetHeight : 0;
                window.scrollTo({ top: target.offsetTop - navHeight - 20, behavior: 'smooth' });
            }
        });
    });

    const counterSection = document.querySelector('.founding-counter');
    if (counterSection && 'IntersectionObserver' in window) {
        const counterObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const fill = document.getElementById('counterFill');
                    if (fill) fill.style.width = '23%';
                }
            });
        }, { threshold: 0.5 });
        counterObserver.observe(counterSection);
    }
});