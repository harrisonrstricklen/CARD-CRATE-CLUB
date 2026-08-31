const { getFirebaseAdmin, getStripe, json, PLANS } = require('./_shared');

function planSnapshot(planId) {
  const plan = PLANS[planId];
  return plan ? {
    planId,
    plan: plan.name,
    description: `${plan.name} monthly subscription`,
    price: plan.price
  } : { planId: planId || null, plan: 'CardCrate Club' };
}

async function assignFoundingMember(admin, uid) {
  const db = admin.firestore();
  const counterRef = db.doc('meta/founding100');
  const userRef = db.doc(`users/${uid}`);

  await db.runTransaction(async (tx) => {
    const [counterSnap, userSnap] = await Promise.all([tx.get(counterRef), tx.get(userRef)]);
    const userData = userSnap.exists ? userSnap.data() : {};

    if (userData.foundingMember === true && userData.memberNumber) return;

    const count = counterSnap.exists ? Number(counterSnap.data().count || 0) : 0;
    if (count >= 100) {
      tx.set(userRef, { foundingMember: false }, { merge: true });
      return;
    }

    const memberNumber = count + 1;
    tx.set(counterRef, {
      count: memberNumber,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    tx.set(userRef, {
      foundingMember: true,
      memberNumber,
      foundingMemberAssignedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
}

async function writeSubscription(admin, uid, sub, planId, extra = {}) {
  const snapshot = planSnapshot(planId);
  const currentPeriodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;

  await admin.firestore().doc(`users/${uid}`).set({
    subscription: {
      ...snapshot,
      status: sub.status,
      stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id || null,
      stripeSubscriptionId: sub.id,
      nextBillingDate: currentPeriodEnd,
      updatedAt: new Date().toISOString(),
      ...extra
    },
    onboarding: {
      status: sub.status === 'active' || sub.status === 'trialing' ? 'complete' : 'billing_pending'
    }
  }, { merge: true });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    if (!process.env.STRIPE_WEBHOOK_SECRET) throw new Error('Missing STRIPE_WEBHOOK_SECRET');

    const stripe = getStripe();
    const admin = getFirebaseAdmin();
    const signature = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '', 'utf8');

    const stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);

    switch (stripeEvent.type) {
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;
        const uid = session.metadata?.firebaseUid || session.client_reference_id;
        const planId = session.metadata?.planId;
        if (uid && session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          await writeSubscription(admin, uid, sub, planId, {
            stripeCheckoutSessionId: session.id,
            paymentStatus: session.payment_status
          });
          if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
            await assignFoundingMember(admin, uid);
          }
        }
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = stripeEvent.data.object;
        const uid = sub.metadata?.firebaseUid;
        const planId = sub.metadata?.planId;
        if (uid) await writeSubscription(admin, uid, sub, planId);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = stripeEvent.data.object;
        if (invoice.subscription) {
          const sub = await stripe.subscriptions.retrieve(invoice.subscription);
          const uid = sub.metadata?.firebaseUid;
          if (uid) await writeSubscription(admin, uid, sub, sub.metadata?.planId, { paymentStatus: 'past_due' });
        }
        break;
      }

      default:
        break;
    }

    return json(200, { received: true });
  } catch (err) {
    console.error('stripe-webhook error:', err);
    return json(400, { error: 'Webhook processing failed.' });
  }
};
