const { getStripe, json, requireUser, PLANS, getSiteUrl } = require('./_shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const user = await requireUser(event);
    const { planId } = JSON.parse(event.body || '{}');
    const plan = PLANS[planId];
    if (!plan) return json(400, { error: 'Invalid plan' });

    const stripe = getStripe();
    const siteUrl = getSiteUrl(event);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(plan.price * 100),
          recurring: { interval: 'month' },
          product_data: {
            name: `Card Crate Club — ${plan.name}`,
            description: plan.sealed
              ? 'Monthly sealed-product subscription; inventory varies by release.'
              : `${plan.packs}-pack monthly Card Crate Club subscription.`
          }
        },
        quantity: 1
      }],
      customer_email: user.email || undefined,
      client_reference_id: user.uid,
      allow_promotion_codes: true,
      success_url: `${siteUrl}/onboarding.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/onboarding.html?plan=${encodeURIComponent(planId)}&checkout=cancelled`,
      metadata: {
        firebaseUid: user.uid,
        planId
      },
      subscription_data: {
        metadata: {
          firebaseUid: user.uid,
          planId
        }
      }
    });

    return json(200, { url: session.url });
  } catch (err) {
    console.error('create-checkout-session error:', err);
    return json(err.statusCode || 500, { error: err.statusCode ? err.message : 'Unable to start checkout.' });
  }
};
