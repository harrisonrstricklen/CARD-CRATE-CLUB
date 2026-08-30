// Netlify serverless function: proxies card search to api.pokemontcg.io.
//
// Why this exists: calling api.pokemontcg.io directly from the browser is
// unreliable (public monitoring shows a ~59% error rate and inconsistent
// CORS support for unauthenticated cross-origin requests). Routing through
// this function means the request is server-to-server, which sidesteps
// CORS entirely, and lets us attach an API key without ever exposing it
// to visitors.
//
// Optional: set POKEMONTCG_API_KEY as a Netlify environment variable
// (Site configuration -> Environment variables) using a free key from
// https://dev.pokemontcg.io — this raises the rate limit from 1,000/day
// (30/min) to 20,000/day. The function works without a key, just at the
// lower public rate limit.

exports.handler = async function (event) {
  const query = (event.queryStringParameters && event.queryStringParameters.q || '').trim();

  if (!query) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing required query parameter "q".' })
    };
  }

  const apiUrl = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent('name:"' + query + '*"')}&pageSize=12&orderBy=-set.releaseDate`;

  try {
    const headers = {};
    if (process.env.POKEMONTCG_API_KEY) {
      headers['X-Api-Key'] = process.env.POKEMONTCG_API_KEY;
    }

    const upstream = await fetch(apiUrl, { headers });

    if (!upstream.ok) {
      return {
        statusCode: upstream.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Upstream API returned ${upstream.status}` })
      };
    }

    const data = await upstream.json();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        // Short cache: identical searches within 5 minutes skip the upstream call
        'Cache-Control': 'public, max-age=300'
      },
      body: JSON.stringify(data)
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Could not reach the card database. Please try again.' })
    };
  }
};
