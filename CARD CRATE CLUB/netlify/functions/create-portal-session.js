const { getFirebaseAdmin, getStripe, json, requireUser, getSiteUrl } = require('./_shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const user = await requireUser(event);
    const admin = getFirebaseAdmin();
    const snap = await admin.firestore().doc(`users/${user.uid}`).get();
    const customerId = snap.exists ? snap.data()?.subscription?.stripeCustomerId : null;

    if (!customerId) return json(400, { error: 'No billing account found for this member.' });

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${getSiteUrl(event)}/dashboard.html`
    });

    return json(200, { url: session.url });
  } catch (err) {
    console.error('create-portal-session error:', err);
    return json(err.statusCode || 500, { error: err.statusCode ? err.message : 'Unable to open billing portal.' });
  }
};
