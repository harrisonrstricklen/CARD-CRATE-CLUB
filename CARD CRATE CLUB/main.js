// ========================================
// CARDCRATE CLUB — MAIN.JS
// ========================================

document.addEventListener('DOMContentLoaded', function() {

    // ---- NAVBAR SCROLL EFFECT ----
    const navbar = document.getElementById('navbar');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.style.background = 'rgba(13,15,20,0.98)';
            navbar.style.boxShadow = '0 4px 24px rgba(0,0,0,0.5)';
        } else {
            navbar.style.background = 'rgba(13,15,20,0.95)';
            navbar.style.boxShadow = 'none';
        }
    });

    // ---- HAMBURGER MENU ----
    const hamburger = document.getElementById('hamburger');
    const mobileMenu = document.getElementById('mobileMenu');

    hamburger.addEventListener('click', () => {
        hamburger.classList.toggle('active');
        mobileMenu.classList.toggle('active');
    });

    // ---- CLOSE MOBILE MENU ----
    window.closeMobileMenu = function() {
        hamburger.classList.remove('active');
        mobileMenu.classList.remove('active');
    };

    // ---- FAQ ACCORDION ----
    window.toggleFaq = function(button) {
        const answer = button.nextElementSibling;
        const isActive = button.classList.contains('active');

        // Close all
        document.querySelectorAll('.faq-question').forEach(q => {
            q.classList.remove('active');
            q.nextElementSibling.classList.remove('active');
        });

        // Open clicked if it was closed
        if (!isActive) {
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
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Joining...';
            submitBtn.disabled = true;

            try {
                const formData = new FormData(waitlistForm);
                const response = await fetch('/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams(formData).toString()
                });

                if (response.ok) {
                    waitlistForm.style.display = 'none';
                    formSuccess.style.display = 'block';
                    updateCounter();
                } else {
                    throw new Error('Form submission failed');
                }
            } catch (error) {
                submitBtn.innerHTML = '<i class="fas fa-crown"></i> Claim My Founding Spot';
                submitBtn.disabled = false;
                alert('Something went wrong. Please try again or email hello@cardcrateclub.com');
            }
        });
    }

    // ---- COUNTER ANIMATION ----
    function updateCounter() {
        const counterFill = document.getElementById('counterFill');
        const spotsLeft = document.getElementById('spotsLeft');
        
        if (counterFill && spotsLeft) {
            const current = parseInt(spotsLeft.textContent);
            const newCount = Math.max(current - 1, 0);
            const percentage = ((100 - newCount) / 100) * 100;
            
            spotsLeft.textContent = newCount;
            counterFill.style.width = percentage + '%';
        }
    }

    // ---- SCROLL ANIMATIONS ----
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    // Animate elements on scroll
    const animateElements = document.querySelectorAll(
        '.feature-card, .step, .tier-card, .benefit, .faq-item, .social-card'
    );

    animateElements.forEach((el, index) => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = `opacity 0.5s ease ${index * 0.05}s, transform 0.5s ease ${index * 0.05}s`;
        observer.observe(el);
    });

    // ---- SMOOTH SCROLL FOR ANCHOR LINKS ----
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                const navHeight = navbar.offsetHeight;
                const targetPosition = target.offsetTop - navHeight - 20;
                window.scrollTo({ top: targetPosition, behavior: 'smooth' });
            }
        });
    });

    // ---- FOUNDING COUNTER ANIMATION ON SCROLL ----
    const counterSection = document.querySelector('.founding-counter');
    if (counterSection) {
        const counterObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const fill = document.getElementById('counterFill');
                    if (fill) {
                        fill.style.width = '23%';
                    }
                }
            });
        }, { threshold: 0.5 });
        counterObserver.observe(counterSection);
    }

    console.log('🃏 CardCrate Club loaded successfully!');
});