// Resolve Japanese card images without making the browser guess which source
// exists. Prefer the current Limitless Japanese scan and fall back to the
// TCGdex image stored in Card Crate Club's Japanese index.

function safeTcgdexFallback(raw) {
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:') return '';
    if (host === 'tcgdex.net' || host.endsWith('.tcgdex.net')) return url.toString();
  } catch (_) {}
  return '';
}

function limitlessUrl(setId, number) {
  const code = String(setId || '').trim().toUpperCase();
  const localNumber = String(number || '').trim().split('/')[0].replace(/^#/, '');
  if (!code || !localNumber) return '';
  return `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc/${encodeURIComponent(code)}/${encodeURIComponent(code)}_${encodeURIComponent(localNumber)}_R_JP.png`;
}

exports.handler = async function (event) {
  const params = event.queryStringParameters || {};
  const primary = limitlessUrl(params.set, params.number);
  const fallback = safeTcgdexFallback(params.fallback);

  if (!primary && fallback) {
    return { statusCode: 302, headers: { Location: fallback, 'Cache-Control': 'public, max-age=86400' }, body: '' };
  }
  if (!primary) {
    return { statusCode: 404, headers: { 'Cache-Control': 'public, max-age=300' }, body: 'Card image unavailable' };
  }

  try {
    let response = await fetch(primary, { method: 'HEAD', signal: AbortSignal.timeout(4500) });
    if (!response.ok && response.status === 405) {
      response = await fetch(primary, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(4500) });
    }
    if (response.ok || response.status === 206) {
      return { statusCode: 302, headers: { Location: primary, 'Cache-Control': 'public, max-age=86400' }, body: '' };
    }
  } catch (error) {
    console.warn('Limitless Japanese image check failed:', error.message || error);
  }

  if (fallback) {
    return { statusCode: 302, headers: { Location: fallback, 'Cache-Control': 'public, max-age=86400' }, body: '' };
  }

  return { statusCode: 404, headers: { 'Cache-Control': 'public, max-age=300' }, body: 'Card image unavailable' };
};
