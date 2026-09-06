const { getFirebaseAdmin, json, requireUser } = require('./_shared');

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MONTHLY_EVALUATION_LIMIT = 25;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

async function getQuota(uid) {
  const admin = getFirebaseAdmin();
  const month = currentMonthKey();
  const ref = admin.firestore().doc(`users/${uid}/evaluatorUsage/${month}`);
  const snap = await ref.get();
  const used = Math.max(0, Number(snap.data()?.used) || 0);
  return { month, used, limit: MONTHLY_EVALUATION_LIMIT, remaining: Math.max(0, MONTHLY_EVALUATION_LIMIT - used) };
}

async function reserveEvaluation(uid) {
  const admin = getFirebaseAdmin();
  const month = currentMonthKey();
  const ref = admin.firestore().doc(`users/${uid}/evaluatorUsage/${month}`);
  return admin.firestore().runTransaction(async transaction => {
    const snap = await transaction.get(ref);
    const used = Math.max(0, Number(snap.data()?.used) || 0);
    if (used >= MONTHLY_EVALUATION_LIMIT) {
      const error = new Error('You have used all 25 card evaluations for this month. Your allowance resets next month.');
      error.statusCode = 429;
      error.quota = { month, used, limit: MONTHLY_EVALUATION_LIMIT, remaining: 0 };
      throw error;
    }
    const nextUsed = used + 1;
    transaction.set(ref, {
      used: nextUsed,
      limit: MONTHLY_EVALUATION_LIMIT,
      month,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return { ref, quota: { month, used: nextUsed, limit: MONTHLY_EVALUATION_LIMIT, remaining: MONTHLY_EVALUATION_LIMIT - nextUsed } };
  });
}

async function releaseEvaluation(ref) {
  if (!ref) return;
  const admin = getFirebaseAdmin();
  await admin.firestore().runTransaction(async transaction => {
    const snap = await transaction.get(ref);
    const used = Math.max(0, Number(snap.data()?.used) || 0);
    transaction.set(ref, {
      used: Math.max(0, used - 1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
}

function validateImage(dataUrl, label) {
  if (typeof dataUrl !== 'string') throw Object.assign(new Error(`${label} photo is required.`), { statusCode: 400 });
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match || !ALLOWED_IMAGE_TYPES.has(match[1])) {
    throw Object.assign(new Error(`${label} photo must be a JPG, PNG, or WebP image.`), { statusCode: 400 });
  }
  const bytes = Math.floor(match[2].length * 3 / 4);
  if (bytes > MAX_IMAGE_BYTES) throw Object.assign(new Error(`${label} photo is too large.`), { statusCode: 413 });
  return dataUrl;
}

const evaluationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    card_name: { type: 'string' },
    set_name: { type: 'string' },
    card_number: { type: 'string' },
    identity_confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    photo_quality: { type: 'string', enum: ['insufficient', 'fair', 'good', 'excellent'] },
    gradeable: { type: 'boolean' },
    estimated_psa_score: { type: 'integer', minimum: 0, maximum: 10 },
    estimated_psa_min: { type: 'integer', minimum: 0, maximum: 10 },
    estimated_psa_max: { type: 'integer', minimum: 0, maximum: 10 },
    grade_confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    centering_front: { type: 'string' },
    centering_back: { type: 'string' },
    corners: { type: 'string' },
    edges: { type: 'string' },
    surface: { type: 'string' },
    visible_defects: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    limitations: { type: 'array', items: { type: 'string' } }
  },
  required: [
    'card_name', 'set_name', 'card_number', 'identity_confidence', 'photo_quality',
    'gradeable', 'estimated_psa_score', 'estimated_psa_min', 'estimated_psa_max',
    'grade_confidence', 'centering_front', 'centering_back', 'corners', 'edges',
    'surface', 'visible_defects', 'summary', 'limitations'
  ]
};

function normalizeEvaluation(value) {
  const result = { ...value };
  for (const key of ['estimated_psa_score', 'estimated_psa_min', 'estimated_psa_max']) {
    result[key] = Math.max(0, Math.min(10, Math.round(Number(result[key]) || 0)));
  }
  if (!result.gradeable) {
    result.estimated_psa_score = 0;
    result.estimated_psa_min = 0;
    result.estimated_psa_max = 0;
  } else {
    result.estimated_psa_min = Math.min(result.estimated_psa_min, result.estimated_psa_score);
    result.estimated_psa_max = Math.max(result.estimated_psa_max, result.estimated_psa_score);
  }
  return result;
}

exports.handler = async function(event) {
  if (!['GET', 'POST'].includes(event.httpMethod)) return json(405, { error: 'GET or POST required' });

  let reservationRef = null;

  try {
    const user = await requireUser(event);
    if (event.httpMethod === 'GET') return json(200, { quota: await getQuota(user.uid) });
    if (!process.env.OPENAI_API_KEY) {
      return json(503, { error: 'Card Evaluator is not configured yet.', setupRequired: 'OPENAI_API_KEY' });
    }

    const body = JSON.parse(event.body || '{}');
    const frontImage = validateImage(body.frontImage, 'Front');
    const backImage = validateImage(body.backImage, 'Back');
    const cardHint = String(body.cardHint || '').trim().slice(0, 160);
    const reservation = await reserveEvaluation(user.uid);
    reservationRef = reservation.ref;

    const prompt = `Act as a cautious trading-card condition evaluator. Review the FRONT and BACK photos of one Pokémon card and estimate the PSA numeric grade visible from these photos only.

Identify the card when readable. Inspect front/back centering, all visible corners, edges, surface wear, scratches, whitening, dents, creases, stains, print lines, and other visible defects. Do not claim the card is authentic. Do not invent defects you cannot see. Glare, sleeves, focus, lighting, and image angle reduce confidence.

If the images do not show the complete front and back clearly enough, set gradeable=false and all three score fields to 0. Otherwise return a conservative most-likely whole-number PSA score plus a narrow plausible minimum and maximum. This is only a photo-based estimate, never an official grade.${cardHint ? `\nUser-provided identity hint: ${cardHint}` : ''}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 50000);
    let response;
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: process.env.OPENAI_VISION_MODEL || 'gpt-5-mini',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'text', text: 'FRONT PHOTO:' },
              { type: 'image_url', image_url: { url: frontImage, detail: 'high' } },
              { type: 'text', text: 'BACK PHOTO:' },
              { type: 'image_url', image_url: { url: backImage, detail: 'high' } }
            ]
          }],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'card_condition_evaluation', strict: true, schema: evaluationSchema }
          }
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('OpenAI evaluator request failed:', response.status, payload?.error?.message || payload);
      throw Object.assign(new Error(response.status === 429 ? 'The evaluator is busy. Please try again shortly.' : 'The card could not be evaluated right now.'), { statusCode: response.status === 429 ? 503 : 502 });
    }

    const message = payload?.choices?.[0]?.message;
    if (message?.refusal) return json(422, { error: 'These photos could not be evaluated.' });
    if (!message?.content) return json(502, { error: 'The evaluator returned an empty result.' });

    return json(200, { evaluation: normalizeEvaluation(JSON.parse(message.content)), quota: reservation.quota });
  } catch (error) {
    console.error('Card evaluation failed:', error);
    if (reservationRef) {
      try { await releaseEvaluation(reservationRef); } catch (releaseError) { console.error('Could not release evaluator quota:', releaseError); }
    }
    const status = error.name === 'AbortError' ? 504 : (error.statusCode || 500);
    return json(status, {
      error: error.name === 'AbortError' ? 'The evaluation timed out. Please try again.' : (status === 500 ? 'The card could not be evaluated right now.' : error.message),
      ...(error.quota ? { quota: error.quota } : {})
    });
  }
};

exports.evaluationSchema = evaluationSchema;
exports.validateImage = validateImage;
exports.normalizeEvaluation = normalizeEvaluation;
exports.MONTHLY_EVALUATION_LIMIT = MONTHLY_EVALUATION_LIMIT;
