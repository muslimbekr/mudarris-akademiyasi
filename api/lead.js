import crypto from 'node:crypto';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const RANGE = process.env.GOOGLE_SHEET_RANGE || 'Leads!A:L';

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* Service-account JWT -> OAuth access token. Avoids pulling in googleapis. */
async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  }));
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(`${header}.${claim}`)
    .sign(PRIVATE_KEY, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${signature}`
    })
  });
  if (!res.ok) throw new Error(`Google token ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

const CONTROL_CHARS = /[\p{Cc}]/gu;
const clean = (v, max = 200) => String(v ?? '').replace(CONTROL_CHARS, '').trim().slice(0, max);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return res.status(400).json({ error: 'invalid_json' });
  }

  /* Honeypot + submit-speed check. Meta traffic attracts bots; both are answered with a
     success so the bot does not retry, but nothing is written to the sheet. */
  if (clean(body.website) !== '' || Number(body.elapsed) < 1500) {
    return res.status(200).json({ ok: true });
  }

  const name = clean(body.name, 80);
  const phone = clean(body.phone, 30);
  const digits = phone.replace(/\D/g, '');
  if (name.length < 2) return res.status(400).json({ error: 'invalid_name' });
  if (digits.length !== 12 || !digits.startsWith('998')) return res.status(400).json({ error: 'invalid_phone' });

  if (!SHEET_ID || !CLIENT_EMAIL || !PRIVATE_KEY) {
    console.error('Google Sheets env vars missing');
    return res.status(500).json({ error: 'not_configured' });
  }

  const row = [
    new Date().toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' }),
    name,
    "'+" + digits,                 // leading apostrophe keeps Sheets from mangling the number
    clean(body.course, 60),
    clean(body.branch, 60),
    clean(body.utm_source, 60),
    clean(body.utm_medium, 60),
    clean(body.utm_campaign, 120),
    clean(body.utm_content, 120),
    clean(body.fbclid, 255),
    clean(body.referrer, 255),
    clean(req.headers['user-agent'], 255)
  ];

  try {
    const token = await getAccessToken();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(RANGE)}:append`
      + '?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS';
    const append = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [row] })
    });
    if (!append.ok) throw new Error(`Sheets ${append.status}: ${await append.text()}`);
    return res.status(200).json({ ok: true });
  } catch (err) {
    /* The lead still lands in the function logs even if Sheets is down, so nothing is lost. */
    console.error('LEAD_WRITE_FAILED', JSON.stringify(row), err.message);
    return res.status(502).json({ error: 'write_failed' });
  }
}
