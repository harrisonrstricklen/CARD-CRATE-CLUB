const { getFirebaseAdmin, json } = require('./_shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const firstName = String(body.firstName || body.name || '').trim().slice(0, 80);
    const email = String(body.email || '').trim().toLowerCase();
    const tier = String(body.tier || body.interestedTier || '').trim().slice(0, 80);
    const discord = Boolean(body.discord || body.joinDiscord);

    if (!firstName || !email) {
      return json(400, { error: 'First name and email are required.' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(400, { error: 'Please enter a valid email address.' });
    }

    const admin = getFirebaseAdmin();
    const db = admin.firestore();
    const id = Buffer.from(email).toString('base64url');
    const ref = db.collection('waitlist').doc(id);
    const existing = await ref.get();

    if (existing.exists) {
      return json(200, { ok: true, alreadyJoined: true });
    }

    await ref.set({
      firstName,
      email,
      tier,
      discord,
      source: 'website',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return json(200, { ok: true, alreadyJoined: false });
  } catch (error) {
    console.error('Waitlist signup failed:', error);
    return json(500, { error: 'Unable to join the waitlist right now.' });
  }
};
