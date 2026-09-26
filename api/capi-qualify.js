/*
 * Reports downstream outcomes from Bitrix back to Meta.
 *
 * The Pixel tells Meta a form was filled in. It cannot tell Meta whether that person was
 * worth reaching — and 71.5% of Facebook leads here end up unqualified. Optimising for
 * "Lead" therefore buys more of what the sales team throws away. This sends a Schedule
 * event only once a lead actually books a demo, so the campaign learns from real outcomes.
 *
 * Runs on a Vercel Cron (see vercel.json). Idempotent: every lead it reports is stamped in
 * BITRIX_UF_CAPI_QUAL so it is never counted twice.
 */

import { sendCapiEvent, buildFbc, capiConfigured } from './_capi.js';

const WEBHOOK = (process.env.BITRIX_WEBHOOK_URL || '').trim().replace(/\/+$/, '');
const CRON_SECRET = (process.env.CRON_SECRET || '').trim();

/* Our own stamp. Deliberately NOT the portal's existing UF_CRM_CAPI_SENT, which another
   integration already owns — writing to it would corrupt that system's bookkeeping. */
const UF_STAMP = (process.env.BITRIX_UF_CAPI_QUAL || '').trim();

/* Stages that count as a real outcome, and the Meta event each maps to. */
const QUALIFYING = {
  CONVERTED: 'Schedule',    // Demoga yozilgan — booked a demo
  UC_JSC9YW: 'Schedule'     // Online Demoga yozilganlar
};

/* Only leads this landing page created. The portal's other CAPI integration covers
   Meta lead-form leads already, so reporting those again would double-count. */
const OWN_SOURCES = (process.env.BITRIX_SOURCE_ID || 'WEB').split(',').map((s) => s.trim());

const LOOKBACK_DAYS = Number(process.env.CAPI_LOOKBACK_DAYS || 14);

async function bx(method, payload) {
  const res = await fetch(`${WEBHOOK}/${method}.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Bitrix ${method}: ${text.slice(0, 200)}`); }
  if (data.error) throw new Error(`Bitrix ${method}: ${data.error} ${data.error_description || ''}`);
  return data.result;
}

/* api/lead.js writes these into COMMENTS, so attribution survives without extra fields. */
const fromComments = (comments, key) => {
  const m = String(comments || '').match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  const v = m ? m[1].trim() : '';
  return !v || v === '—' ? '' : v;
};

export default async function handler(req, res) {
  /* Vercel Cron sends this header; a manual call needs the shared secret. */
  const authorized =
    req.headers['x-vercel-cron'] ||
    (CRON_SECRET && req.headers.authorization === `Bearer ${CRON_SECRET}`);
  if (!authorized) return res.status(401).json({ error: 'unauthorized' });

  if (!WEBHOOK) return res.status(500).json({ error: 'bitrix_not_configured' });
  if (!capiConfigured()) return res.status(500).json({ error: 'capi_not_configured' });

  const since = new Date(Date.now() - LOOKBACK_DAYS * 864e5).toISOString().slice(0, 19);
  const dryRun = !UF_STAMP;

  const filter = {
    '>=DATE_MODIFY': since,
    STATUS_ID: Object.keys(QUALIFYING),
    SOURCE_ID: OWN_SOURCES
  };
  if (UF_STAMP) filter[UF_STAMP] = '';           // not yet reported

  try {
    const leads = await bx('crm.lead.list', {
      select: ['ID', 'DATE_CREATE', 'DATE_MODIFY', 'STATUS_ID', 'NAME', 'PHONE', 'COMMENTS',
               'UTM_CAMPAIGN', ...(UF_STAMP ? [UF_STAMP] : [])],
      filter,
      order: { ID: 'ASC' },
      start: -1
    }) || [];

    const report = { scanned: leads.length, sent: 0, skipped: 0, failed: 0, dryRun, ids: [] };

    for (const lead of leads) {
      if (UF_STAMP && lead[UF_STAMP]) { report.skipped++; continue; }

      const phone = lead.PHONE?.[0]?.VALUE || '';
      const fbclid = fromComments(lead.COMMENTS, 'fbclid');
      const fbc = buildFbc(fromComments(lead.COMMENTS, 'fbc'), fbclid, Date.parse(lead.DATE_CREATE) || Date.now());
      const fbp = fromComments(lead.COMMENTS, 'fbp');

      /* Without a phone or any click id Meta has nothing to match on — sending would
         only depress the event match quality score, so skip rather than send noise. */
      if (!phone && !fbc && !fbp) { report.skipped++; continue; }

      if (dryRun) { report.sent++; report.ids.push(lead.ID); continue; }

      const result = await sendCapiEvent({
        eventName: QUALIFYING[lead.STATUS_ID],
        eventId: `qual-${lead.ID}`,               // stable, so a retry cannot double-count
        eventTime: Math.floor((Date.parse(lead.DATE_MODIFY) || Date.now()) / 1000),
        actionSource: 'phone_call',               // the demo is booked over the phone
        phone,
        firstName: lead.NAME,
        fbc,
        fbp,
        customData: { lead_id: String(lead.ID), campaign: lead.UTM_CAMPAIGN || '' }
      });

      if (!result.ok) { report.failed++; continue; }

      await bx('crm.lead.update', {
        id: lead.ID,
        fields: { [UF_STAMP]: new Date().toISOString() },
        params: { REGISTER_SONET_EVENT: 'N' }
      }).catch((err) => console.error('STAMP_FAILED', lead.ID, err.message));

      report.sent++;
      report.ids.push(lead.ID);
    }

    console.log('CAPI_QUALIFY', JSON.stringify(report));
    return res.status(200).json(report);
  } catch (err) {
    console.error('CAPI_QUALIFY_FAILED', err.message);
    return res.status(502).json({ error: 'sync_failed', detail: err.message });
  }
}
