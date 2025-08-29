// Netlify Function: /api/track -> /.netlify/functions/track
// Forwards events to Google Analytics 4 Measurement Protocol.
// Env vars required (set in Netlify dashboard):
// - GA4_MEASUREMENT_ID (e.g., G-XXXXXXXXXX)
// - GA4_API_SECRET (MP API secret)
// - ALLOWED_ORIGINS (CSV of allowed origins)

const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

function buildHeaders(requestOrigin) {
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const origin = allowed.length === 0
    ? '*'
    : (allowed.includes(requestOrigin) ? requestOrigin : '');
  return {
    'Access-Control-Allow-Origin': origin || allowed[0] || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

exports.handler = async (event) => {
  const headersIn = event.headers || {};
  const reqOrigin = headersIn.origin || headersIn.Origin || '';
  const commonHeaders = buildHeaders(reqOrigin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: commonHeaders, body: '' };
  }

  // Enforce allowed origins when configured
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.length > 0 && reqOrigin && !allowed.includes(reqOrigin)) {
    return { statusCode: 403, headers: commonHeaders, body: 'Origin not allowed' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: commonHeaders, body: 'Method Not Allowed' };
  }

  const measurementId = process.env.GA4_MEASUREMENT_ID;
  const apiSecret = process.env.GA4_API_SECRET;
  if (!measurementId || !apiSecret) {
    return { statusCode: 500, headers: commonHeaders, body: 'GA4 env not configured' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers: commonHeaders, body: 'Invalid JSON' };
  }

  const headers = event.headers || {};
  const ua = headers['user-agent'] || headers['User-Agent'] || '';
  const ref = headers.referer || headers.referrer || headers['Referer'] || '';
  const ip = headers['x-nf-client-connection-ip'] || headers['x-forwarded-for'] || headers['client-ip'] || '';

  // Basic fields from client (with fallbacks)
  const now = Date.now();
  const {
    event_name = 'page_view',
    page = ref || payload.page || '',
    title = payload.title || '',
    page_referrer = payload.referrer || ref || '',
    lang = payload.lang || '',
    tz = payload.tz || '',
    screen = payload.screen || '',
    uid = payload.uid || undefined,
    cid: cidInput,
    params: extraParams = {},
  } = payload;

  // Persisted client id from localStorage, or create a short-lived one
  const cid = typeof cidInput === 'string' && cidInput.trim().length > 0
    ? cidInput
    : `cid.${Math.random().toString(36).slice(2)}.${Math.floor(now / 1000)}`;

  // Build GA4 MP request
  const body = {
    client_id: cid,
    ...(uid ? { user_id: uid } : {}),
    user_properties: {
      ...(lang ? { lang: { value: lang } } : {}),
      ...(tz ? { tz: { value: tz } } : {}),
      ...(screen ? { screen: { value: String(screen) } } : {}),
    },
    events: [
      {
        name: event_name,
        params: {
          page_location: page || undefined,
          page_title: title || undefined,
          page_referrer: page_referrer || undefined,
          engagement_time_msec: 1,
          ...extraParams,
        },
      },
    ],
    // These top-level hints help GA attribute geo/device more accurately for server-side hits
    user_ip_address: ip || undefined,
    user_agent: ua || undefined,
  };

  const url = `${GA4_ENDPOINT}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        statusCode: 502,
        headers: commonHeaders,
        body: `GA4 error: ${res.status} ${text}`,
      };
    }
  } catch (err) {
    return { statusCode: 500, headers: commonHeaders, body: `Upstream error: ${String(err)}` };
  }

  return {
    statusCode: 204,
    headers: commonHeaders,
    body: '',
  };
};
