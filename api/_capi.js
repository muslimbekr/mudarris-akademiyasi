/*
 * Meta Conversions API sender.
 *
 * Why this exists alongside the browser Pixel: iOS tracking prompts, ad blockers and
 * dropped beacons lose a meaningful share of browser events. A server-side copy carrying
 * the same event_id is deduplicated by Meta, so what survives is the union of the two
 * rather than only what the browser managed to send.
 */

import crypto from 'node:crypto';

const PIXEL_ID = (process.env.META_PIXEL_ID || '1038630499223454').trim();
const TOKEN = (process.env.META_CAPI_TOKEN || '').trim();
const TEST_CODE = (process.env.META_CAPI_TEST_CODE || '').trim();
const API_VERSION = 'v21.0';

export const capiConfigured = () => Boolean(TOKEN && PIXEL_ID);

/* Meta expects SHA-256 of the normalised value: trimmed, lowercased, no punctuation. */
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

const hashPhone = (raw) => {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits ? sha(digits) : null;          // country code included, no plus
};

const hashName = (raw) => {
  const v = String(raw || '').trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return v ? sha(v) : null;
};

/* A click id only counts as fbc in Meta's own format: fb.1.<created ms>.<fbclid> */
export const buildFbc = (fbc, fbclid, createdMs = Date.now()) => {
  if (fbc) return fbc;
  if (!fbclid) return null;
  return `fb.1.${createdMs}.${fbclid}`;
};

/**
 * Send one event. Never throws: a tracking failure must not fail the lead that carries it.
 * Returns { ok, status, body } so the caller can log without branching.
 */
export async function sendCapiEvent({
  eventName,
  eventId,
  eventTime = Math.floor(Date.now() / 1000),
  actionSource = 'website',
  eventSourceUrl,
  phone,
  firstName,
  city,
  country = 'uz',
  fbc,
  fbp,
  clientIp,
  clientUserAgent,
  customData = {}
}) {
  if (!capiConfigured()) return { ok: false, skipped: 'not_configured' };

  const user_data = {};
  const ph = hashPhone(phone);        if (ph) user_data.ph = [ph];
  const fn = hashName(firstName);     if (fn) user_data.fn = [fn];
  const ct = hashName(city);          if (ct) user_data.ct = [ct];
  if (country) user_data.country = [sha(String(country).trim().toLowerCase())];
  if (fbc) user_data.fbc = fbc;
  if (fbp) user_data.fbp = fbp;
  if (clientIp) user_data.client_ip_address = clientIp;
  if (clientUserAgent) user_data.client_user_agent = clientUserAgent;

  const event = {
    event_name: eventName,
    event_time: eventTime,
    action_source: actionSource,
    user_data,
    custom_data: customData
  };
  if (eventId) event.event_id = eventId;                 // dedupes against the browser Pixel
  if (eventSourceUrl) event.event_source_url = eventSourceUrl;

  const payload = { data: [event] };
  if (TEST_CODE) payload.test_event_code = TEST_CODE;

  try {
    const res = await fetch(
      `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(TOKEN)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) {
      console.error('CAPI_FAILED', eventName, eventId, res.status, JSON.stringify(body.error || body).slice(0, 400));
      return { ok: false, status: res.status, body };
    }
    return { ok: true, status: res.status, body };
  } catch (err) {
    console.error('CAPI_FAILED', eventName, eventId, err.message);
    return { ok: false, error: err.message };
  }
}

/* The caller's real IP, as Vercel forwards it. Meta uses it for match quality. */
export const clientIpOf = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || null;
