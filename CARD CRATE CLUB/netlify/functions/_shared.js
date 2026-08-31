const admin = require('firebase-admin');
const Stripe = require('stripe');

function getFirebaseAdmin() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON');

    const serviceAccount = JSON.parse(raw);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }
  return admin;
}

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Missing STRIPE_SECRET_KEY');
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

async function requireUser(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    const err = new Error('Missing authorization token');
    err.statusCode = 401;
    throw err;
  }

  const adminSdk = getFirebaseAdmin();
  return adminSdk.auth().verifyIdToken(match[1]);
}

const PLANS = {
  'pack-club': {
    name: 'Pack Club',
    price: 24.99,
    priceEnv: 'STRIPE_PRICE_PACK_CLUB'
  },
  'trainer-club': {
    name: 'Trainer Club',
    price: 44.99,
    priceEnv: 'STRIPE_PRICE_TRAINER_CLUB'
  },
  'collector-club': {
    name: 'Collector Club',
    price: 64.99,
    priceEnv: 'STRIPE_PRICE_COLLECTOR_CLUB'
  },
  'box-club': {
    name: 'Box Club',
    price: 149.00,
    priceEnv: 'STRIPE_PRICE_BOX_CLUB'
  }
};

function getSiteUrl(event) {
  const configured = process.env.APP_URL || process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (configured) return configured.replace(/\/$/, '');

  const host = event.headers['x-forwarded-host'] || event.headers.host;
  const proto = event.headers['x-forwarded-proto'] || 'https';
  if (!host) throw new Error('Could not determine site URL. Set APP_URL in Netlify.');
  return `${proto}://${host}`;
}

module.exports = { getFirebaseAdmin, getStripe, json, requireUser, PLANS, getSiteUrl };
