/*
 * Landing page lead -> Bitrix24.
 *
 * Talks to an inbound webhook, so the whole credential is one URL and there is no
 * OAuth refresh to keep alive. Creates a CRM Lead by default; accounts running CRM in
 * simple mode (no Leads section) can set BITRIX_ENTITY=deal instead.
 */

const WEBHOOK = (process.env.BITRIX_WEBHOOK_URL || '').trim().replace(/\/+$/, '');
const ENTITY = (process.env.BITRIX_ENTITY || 'lead').trim().toLowerCase() === 'deal' ? 'deal' : 'lead';
const ASSIGNED_BY_ID = process.env.BITRIX_ASSIGNED_BY_ID;
const CATEGORY_ID = process.env.BITRIX_CATEGORY_ID;   // deal pipeline
const SOURCE_ID = (process.env.BITRIX_SOURCE_ID || 'WEB').trim();

/* Optional custom fields, e.g. UF_CRM_1700000000000.
   Run scripts/bitrix-inspect.mjs to list them. Anything unset still reaches
   the CRM in the comment block, so this is a refinement, not a requirement. */
const UF = {
  course: (process.env.BITRIX_UF_COURSE || '').trim(),
  branch: (process.env.BITRIX_UF_BRANCH || '').trim()
};

const CONTROL_CHARS = /[\p{Cc}]/gu;
const clean = (v, max = 200) => String(v ?? '').replace(CONTROL_CHARS, '').trim().slice(0, max);

/* Bitrix answers 200 with an {error} body on failure, so the status code alone is not enough. */
async function bx(method, payload) {
  const res = await fetch(`${WEBHOOK}/${method}.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Bitrix ${method} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  if (data.error) throw new Error(`Bitrix ${method} -> ${data.error}: ${data.error_description || ''}`);
  if (!res.ok) throw new Error(`Bitrix ${method} -> ${res.status}: ${text.slice(0, 300)}`);
  return data.result;
}

/* Bitrix has its own duplicate control in the UI; this only annotates the card so
   whoever picks it up knows they are looking at a repeat enquiry. */
async function findDuplicate(e164) {
  const found = await bx('crm.duplicate.findbycomm', {
    type: 'PHONE',
    values: [e164],
    entity_type: ENTITY === 'deal' ? 'CONTACT' : 'LEAD'
  });
  const ids = found?.LEAD || found?.CONTACT || [];
  return Array.isArray(ids) && ids.length ? ids : null;
}

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
     success so the bot does not retry, but nothing reaches the CRM. */
  if (clean(body.website) !== '' || Number(body.elapsed) < 1500) {
    return res.status(200).json({ ok: true });
  }

  const name = clean(body.name, 80);
  const phone = clean(body.phone, 30);
  const digits = phone.replace(/\D/g, '');
  if (name.length < 2) return res.status(400).json({ error: 'invalid_name' });
  if (digits.length !== 12 || !digits.startsWith('998')) return res.status(400).json({ error: 'invalid_phone' });

  const course = clean(body.course, 60);
  const branch = clean(body.branch, 60);
  const utmSource = clean(body.utm_source, 60);
  const utmMedium = clean(body.utm_medium, 60);
  const utmCampaign = clean(body.utm_campaign, 120);
  const utmContent = clean(body.utm_content, 120);
  const fbclid = clean(body.fbclid, 255);
  const referrer = clean(body.referrer, 255);
  const e164 = `+${digits}`;

  if (!WEBHOOK) {
    console.error('BITRIX_WEBHOOK_URL is not set');
    return res.status(500).json({ error: 'not_configured' });
  }

  try {
    let duplicateOf = null;
    /* Never let the duplicate lookup block the lead itself. */
    try {
      duplicateOf = await findDuplicate(e164);
    } catch (err) {
      console.warn('DUPLICATE_CHECK_SKIPPED', err.message);
    }

    const comments = [
      'Saytdan yangi ariza',
      `Kurs: ${course || '—'}`,
      `Filial: ${branch || '—'}`,
      `fbclid: ${fbclid || '—'}`,
      `Referrer: ${referrer || '—'}`,
      `Vaqt: ${new Date().toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' })}`,
      duplicateOf ? `\n⚠️ Bu raqam bazada bor: ${duplicateOf.join(', ')}` : ''
    ].filter(Boolean).join('\n');

    const fields = {
      TITLE: `Sayt: ${name}${course ? ` — ${course}` : ''}`,
      NAME: name,
      PHONE: [{ VALUE: e164, VALUE_TYPE: 'MOBILE' }],
      SOURCE_ID,
      SOURCE_DESCRIPTION: [utmSource, utmCampaign].filter(Boolean).join(' / ') || 'Landing',
      COMMENTS: comments,
      OPENED: 'Y',
      /* Bitrix stores UTM natively, so these are real filterable fields, not free text. */
      UTM_SOURCE: utmSource,
      UTM_MEDIUM: utmMedium,
      UTM_CAMPAIGN: utmCampaign,
      UTM_CONTENT: utmContent,
      ...(ASSIGNED_BY_ID ? { ASSIGNED_BY_ID: Number(ASSIGNED_BY_ID) } : {}),
      ...(ENTITY === 'deal' && CATEGORY_ID ? { CATEGORY_ID: Number(CATEGORY_ID) } : {}),
      ...(UF.course && course ? { [UF.course]: course } : {}),
      ...(UF.branch && branch ? { [UF.branch]: branch } : {})
    };

    /* REGISTER_SONET_EVENT posts it to the activity stream so the team is notified. */
    const id = await bx(`crm.${ENTITY}.add`, { fields, params: { REGISTER_SONET_EVENT: 'Y' } });

    return res.status(200).json({ ok: true, id });
  } catch (err) {
    /* The lead still lands in the function logs if Bitrix is unreachable, so nothing is lost. */
    console.error('LEAD_WRITE_FAILED', JSON.stringify({
      name, phone: e164, course, branch, utmSource, utmMedium, utmCampaign, utmContent, fbclid
    }), err.message);
    return res.status(502).json({ error: 'write_failed' });
  }
}
