// ========================================
// CARD CRATE CLUB — MAIN.JS
// ========================================

document.addEventListener('DOMContentLoaded', function() {

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

    if (!document.querySelector('link[rel="icon"]')) {
        const icon = document.createElement('link');
        icon.rel = 'icon';
        icon.type = 'image/svg+xml';
        icon.href = 'favicon.svg';
        document.head.appendChild(icon);
    }

    document.querySelectorAll('a[target="_blank"]').forEach(link => {
        link.rel = 'noopener noreferrer';
    });

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
            heroSubtitle.textContent = 'Monthly Pokémon TCG subscriptions built to make collecting easier. Choose your tier, set your preferences, and let Card Crate Club handle the monthly hunt.';
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

        // Clearly-labelled subscription crate concepts until real product photography is available.
        if (!document.querySelector('.crate-concept-section')) {
            const concept = document.createElement('section');
            concept.className = 'crate-concept-section';
            concept.setAttribute('aria-label', 'Card Crate Club subscription crate concepts');
            concept.innerHTML = `
                <div class="crate-concept-card">
                    <div class="crate-concept-copy">
                        <span class="crate-concept-kicker">Packaging Preview</span>
                        <h2>Choose Your <span>Card Crate</span></h2>
                        <p>A look at how the core subscription sizes can scale with you. The 4, 8, and 12-pack concepts use the same black-and-gold Card Crate Club packaging, sized around the amount of sealed product inside.</p>
                        <div class="crate-concept-points">
                            <span>4 Pack Crate</span><span>8 Pack Crate</span><span>12 Pack Crate</span><span>Compact packaging</span>
                        </div>
                    </div>
                    <div class="crate-concept-art">
                        <img src="images/card-crate-club-4-8-12-pack-crates.png" alt="Concept renderings of Card Crate Club 4 pack, 8 pack, and 12 pack subscription boxes" loading="lazy">
                        <div class="crate-concept-caption">Concept rendering — final box dimensions, pack selection, and packaging may vary.</div>
                    </div>
                </div>`;
            const announcement = document.querySelector('.announcement-bar');
            const why = document.querySelector('#why');
            if (announcement) announcement.insertAdjacentElement('afterend', concept);
            else if (why) why.insertAdjacentElement('beforebegin', concept);
        }
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
            answer.classList.add('active');
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

    // Keep visual counter animation only; connect this to live availability before paid launch.
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