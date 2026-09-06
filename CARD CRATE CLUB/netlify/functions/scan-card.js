const { getFirebaseAdmin, json, requireUser } = require('./_shared');

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MONTHLY_SCAN_LIMIT = 500;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const scanSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    card_name: { type: 'string' },
    set_name: { type: 'string' },
    card_number: { type: 'string' },
    variant: { type: 'string' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    readable: { type: 'boolean' }
  },
  required: ['card_name', 'set_name', 'card_number', 'variant', 'confidence', 'readable']
};

function monthKey() { return new Date().toISOString().slice(0, 7); }

function validateImage(dataUrl) {
  if (typeof dataUrl !== 'string') throw Object.assign(new Error('A card photo is required.'), { statusCode: 400 });
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match || !ALLOWED_IMAGE_TYPES.has(match[1])) throw Object.assign(new Error('Use a JPG, PNG, or WebP image.'), { statusCode: 400 });
  if (Math.floor(match[2].length * 3 / 4) > MAX_IMAGE_BYTES) throw Object.assign(new Error('The card photo is too large.'), { statusCode: 413 });
  return dataUrl;
}

async function getQuota(uid) {
  const admin = getFirebaseAdmin();
  const month = monthKey();
  const snap = await admin.firestore().doc(`users/${uid}/scannerUsage/${month}`).get();
  const used = Math.max(0, Number(snap.data()?.used) || 0);
  return { month, used, limit: MONTHLY_SCAN_LIMIT, remaining: Math.max(0, MONTHLY_SCAN_LIMIT - used) };
}

async function reserveScan(uid) {
  const admin = getFirebaseAdmin();
  const month = monthKey();
  const ref = admin.firestore().doc(`users/${uid}/scannerUsage/${month}`);
  return admin.firestore().runTransaction(async transaction => {
    const snap = await transaction.get(ref);
    const used = Math.max(0, Number(snap.data()?.used) || 0);
    if (used >= MONTHLY_SCAN_LIMIT) {
      const error = new Error('You have used all 500 card scans for this month. Your allowance resets next month.');
      error.statusCode = 429;
      error.quota = { month, used, limit: MONTHLY_SCAN_LIMIT, remaining: 0 };
      throw error;
    }
    const nextUsed = used + 1;
    transaction.set(ref, { used: nextUsed, limit: MONTHLY_SCAN_LIMIT, month, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return { ref, quota: { month, used: nextUsed, limit: MONTHLY_SCAN_LIMIT, remaining: MONTHLY_SCAN_LIMIT - nextUsed } };
  });
}

async function releaseScan(ref) {
  if (!ref) return;
  const admin = getFirebaseAdmin();
  await admin.firestore().runTransaction(async transaction => {
    const snap = await transaction.get(ref);
    const used = Math.max(0, Number(snap.data()?.used) || 0);
    transaction.set(ref, { used: Math.max(0, used - 1), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  });
}

exports.handler = async function(event) {
  if (!['GET', 'POST'].includes(event.httpMethod)) return json(405, { error: 'GET or POST required' });
  let reservationRef = null;
  try {
    const user = await requireUser(event);
    if (event.httpMethod === 'GET') return json(200, { quota: await getQuota(user.uid) });
    if (!process.env.OPENAI_API_KEY) return json(503, { error: 'Card Scanner is not configured yet.' });

    const image = validateImage(JSON.parse(event.body || '{}').image);
    const reservation = await reserveScan(user.uid);
    reservationRef = reservation.ref;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 40000);
    let response;
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.OPENAI_VISION_MODEL || 'gpt-5-mini',
          messages: [{ role: 'user', content: [
            { type: 'text', text: 'Identify this Pokémon trading card so it can be matched against a card database and confirmed by the user. First use the visible Pokémon name, artwork, card layout, set symbol, and color even when small printed text is not perfectly sharp. Return the most likely exact card name. Read the printed set or expansion and collector number (for example 054/191) only when recognizable; otherwise use an empty string for those fields. Note a visible variant such as full art, illustration rare, reverse holo, first edition, shadowless, promo, or standard. Use low confidence when relying mainly on artwork. Set readable=false only when neither the card name nor artwork can support a useful database search.' },
            { type: 'image_url', image_url: { url: image, detail: 'high' } }
          ] }],
          response_format: { type: 'json_schema', json_schema: { name: 'card_scan_identity', strict: true, schema: scanSchema } }
        }),
        signal: controller.signal
      });
    } finally { clearTimeout(timeout); }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('OpenAI card scan failed:', response.status, payload?.error?.message || payload);
      throw Object.assign(new Error(response.status === 429 ? 'The scanner is busy. Please try again shortly.' : 'The card could not be scanned right now.'), { statusCode: response.status === 429 ? 503 : 502 });
    }
    const message = payload?.choices?.[0]?.message;
    if (message?.refusal || !message?.content) throw Object.assign(new Error('The card could not be identified from this photo.'), { statusCode: 422 });
    const identification = JSON.parse(message.content);
    if (!identification.card_name.trim()) throw Object.assign(new Error('The card could not be identified. Move closer so the card fills most of the frame and try again.'), { statusCode: 422 });
    return json(200, { identification, quota: reservation.quota });
  } catch (error) {
    console.error('Card scan failed:', error);
    if (reservationRef) {
      try { await releaseScan(reservationRef); } catch (releaseError) { console.error('Could not release scanner quota:', releaseError); }
    }
    const status = error.name === 'AbortError' ? 504 : (error.statusCode || 500);
    return json(status, {
      error: error.name === 'AbortError' ? 'The scan timed out. Please try again.' : (status === 500 ? 'The card could not be scanned right now.' : error.message),
      ...(error.quota ? { quota: error.quota } : {})
    });
  }
};

exports.scanSchema = scanSchema;
exports.validateImage = validateImage;
exports.MONTHLY_SCAN_LIMIT = MONTHLY_SCAN_LIMIT;
