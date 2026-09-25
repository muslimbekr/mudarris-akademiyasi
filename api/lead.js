/*
 * Landing page lead -> amoCRM.
 *
 * Flow: look the contact up by phone, then either attach a new lead to the existing
 * contact or create contact + lead together. Looking up first keeps the CRM from
 * filling with duplicate contacts when the same person submits twice.
 */

const RAW_SUBDOMAIN = (process.env.AMOCRM_SUBDOMAIN || '').trim();
const TOKEN = (process.env.AMOCRM_ACCESS_TOKEN || '').trim();
const PIPELINE_ID = process.env.AMOCRM_PIPELINE_ID;
const STATUS_ID = process.env.AMOCRM_STATUS_ID;
const RESPONSIBLE_USER_ID = process.env.AMOCRM_RESPONSIBLE_USER_ID;

/* Optional lead custom fields. Run scripts/amocrm-inspect.mjs to find the ids.
   Anything left unset still reaches the CRM in the note. */
const CF = {
  course: process.env.AMOCRM_CF_COURSE,
  branch: process.env.AMOCRM_CF_BRANCH,
  utm_source: process.env.AMOCRM_CF_UTM_SOURCE,
  utm_campaign: process.env.AMOCRM_CF_UTM_CAMPAIGN,
  fbclid: process.env.AMOCRM_CF_FBCLID
};

/* Accept either "mudarris" or a full host like "mudarris.kommo.com". */
const HOST = RAW_SUBDOMAIN.includes('.') ? RAW_SUBDOMAIN : `${RAW_SUBDOMAIN}.amocrm.ru`;
const API = `https://${HOST}/api/v4`;

const CONTROL_CHARS = /[\p{Cc}]/gu;
const clean = (v, max = 200) => String(v ?? '').replace(CONTROL_CHARS, '').trim().slice(0, max);

async function amo(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  /* amoCRM answers 204 with an empty body when a search finds nothing. */
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`amoCRM ${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function findContactIdByPhone(digits) {
  const found = await amo(`/contacts?query=${encodeURIComponent(digits)}&limit=1`);
  return found?._embedded?.contacts?.[0]?.id ?? null;
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
  const utm = {
    source: clean(body.utm_source, 60),
    medium: clean(body.utm_medium, 60),
    campaign: clean(body.utm_campaign, 120),
    content: clean(body.utm_content, 120)
  };
  const fbclid = clean(body.fbclid, 255);
  const referrer = clean(body.referrer, 255);
  const e164 = `+${digits}`;

  if (!RAW_SUBDOMAIN || !TOKEN) {
    console.error('amoCRM env vars missing (AMOCRM_SUBDOMAIN / AMOCRM_ACCESS_TOKEN)');
    return res.status(500).json({ error: 'not_configured' });
  }

  /* Everything we know, in one readable block. Written as a note so no field is lost
     even when the optional custom fields are not configured. */
  const noteText = [
    'Saytdan yangi ariza',
    `Ism: ${name}`,
    `Telefon: ${e164}`,
    `Kurs: ${course || '—'}`,
    `Filial: ${branch || '—'}`,
    '',
    `utm_source: ${utm.source || '—'}`,
    `utm_medium: ${utm.medium || '—'}`,
    `utm_campaign: ${utm.campaign || '—'}`,
    `utm_content: ${utm.content || '—'}`,
    `fbclid: ${fbclid || '—'}`,
    `Referrer: ${referrer || '—'}`,
    `Vaqt: ${new Date().toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' })}`
  ].join('\n');

  const customFields = Object.entries({
    course,
    branch,
    utm_source: utm.source,
    utm_campaign: utm.campaign,
    fbclid
  })
    .filter(([key, value]) => CF[key] && value)
    .map(([key, value]) => ({ field_id: Number(CF[key]), values: [{ value }] }));

  const tags = [{ name: 'Sayt' }];
  if (utm.source) tags.push({ name: utm.source });
  if (course) tags.push({ name: course });
  if (branch) tags.push({ name: branch });

  const leadBase = {
    name: `Sayt: ${name}${course ? ` — ${course}` : ''}`,
    ...(PIPELINE_ID ? { pipeline_id: Number(PIPELINE_ID) } : {}),
    ...(STATUS_ID ? { status_id: Number(STATUS_ID) } : {}),
    ...(RESPONSIBLE_USER_ID ? { responsible_user_id: Number(RESPONSIBLE_USER_ID) } : {}),
    ...(customFields.length ? { custom_fields_values: customFields } : {})
  };

  try {
    let leadId;
    const existingContactId = await findContactIdByPhone(digits);

    if (existingContactId) {
      const created = await amo('/leads', {
        method: 'POST',
        body: [{ ...leadBase, _embedded: { contacts: [{ id: existingContactId }], tags } }]
      });
      leadId = created?._embedded?.leads?.[0]?.id;
    } else {
      const created = await amo('/leads/complex', {
        method: 'POST',
        body: [{
          ...leadBase,
          _embedded: {
            contacts: [{
              first_name: name,
              custom_fields_values: [
                { field_code: 'PHONE', values: [{ value: e164, enum_code: 'MOB' }] }
              ]
            }],
            tags
          }
        }]
      });
      leadId = Array.isArray(created) ? created[0]?.id : created?._embedded?.leads?.[0]?.id;
    }

    if (leadId) {
      /* A failed note must not fail the request — the lead itself is already safe in the CRM. */
      await amo(`/leads/${leadId}/notes`, {
        method: 'POST',
        body: [{ note_type: 'common', params: { text: noteText } }]
      }).catch((err) => console.error('NOTE_FAILED', leadId, err.message));
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    /* The lead still lands in the function logs if amoCRM is unreachable, so nothing is lost. */
    console.error('LEAD_WRITE_FAILED', JSON.stringify({ name, phone: e164, course, branch, ...utm, fbclid }), err.message);
    return res.status(502).json({ error: 'write_failed' });
  }
}
