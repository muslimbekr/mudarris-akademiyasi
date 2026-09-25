/*
 * Prints the Bitrix24 ids needed to configure api/lead.js, and confirms the webhook works.
 *
 *   BITRIX_WEBHOOK_URL=https://company.bitrix24.ru/rest/1/xxxx/ node scripts/bitrix-inspect.mjs
 *
 * Run it locally. The webhook never has to leave your machine — copy the ids it prints
 * into the Vercel environment variables.
 */

const WEBHOOK = (process.env.BITRIX_WEBHOOK_URL || '').trim().replace(/\/+$/, '');

if (!WEBHOOK) {
  console.error('Set BITRIX_WEBHOOK_URL first.\n');
  console.error('  BITRIX_WEBHOOK_URL=https://company.bitrix24.ru/rest/1/xxxx/ node scripts/bitrix-inspect.mjs');
  process.exit(1);
}

async function bx(method, payload = {}) {
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
    console.error(`\n✗ ${method} -> ${res.status}`);
    console.error(text.slice(0, 300));
    process.exit(1);
  }
  if (data.error) {
    console.error(`\n✗ ${method} -> ${data.error}: ${data.error_description || ''}`);
    if (data.error === 'INVALID_CREDENTIALS' || data.error === 'NO_AUTH_FOUND') {
      console.error('\nThe webhook URL is wrong, revoked, or from a different portal.');
    }
    if (data.error === 'ACCESS_DENIED') {
      console.error('\nThe webhook lacks the CRM scope. Edit it in Bitrix and tick CRM.');
    }
    process.exit(1);
  }
  return data.result;
}

/* Portal host, so you can be sure which Bitrix account this webhook belongs to. */
const host = new URL(WEBHOOK).host;
console.log(`\nPortal: ${host}\n${'='.repeat(64)}`);

const me = await bx('profile');
console.log(`Webhook runs as: ${me.NAME || ''} ${me.LAST_NAME || ''} (id ${me.ID})\n`);

/* Does this portal use Leads, or is CRM in simple mode (deals only)? */
let leadsEnabled = true;
try {
  await bx('crm.lead.fields');
} catch {
  leadsEnabled = false;
}
console.log(leadsEnabled
  ? 'Leads are enabled -> keep the default BITRIX_ENTITY=lead'
  : '⚠️  Leads look disabled (CRM simple mode) -> set BITRIX_ENTITY=deal');

console.log(`\n\nCUSTOM FIELDS on ${leadsEnabled ? 'lead' : 'deal'} (optional)`);
console.log('-'.repeat(64));
const fields = await bx(`crm.${leadsEnabled ? 'lead' : 'deal'}.fields`);
const ufs = Object.entries(fields).filter(([code]) => code.startsWith('UF_CRM_'));
if (!ufs.length) {
  console.log('  none — course and branch will appear in the comment block');
} else {
  for (const [code, f] of ufs) {
    console.log(`  ${code.padEnd(28)} ${f.formLabel || f.title || ''}  (${f.type})`);
  }
  console.log('\n  e.g. BITRIX_UF_COURSE=UF_CRM_1700000000000');
}

console.log('\n\nSOURCES (BITRIX_SOURCE_ID)');
console.log('-'.repeat(64));
const sources = await bx('crm.status.list', { filter: { ENTITY_ID: 'SOURCE' } });
for (const s of sources ?? []) console.log(`  ${String(s.STATUS_ID).padEnd(20)} ${s.NAME}`);

console.log('\n\nUSERS (BITRIX_ASSIGNED_BY_ID)');
console.log('-'.repeat(64));
const users = await bx('user.get', { FILTER: { ACTIVE: true } });
for (const u of users ?? []) {
  console.log(`  ${String(u.ID).padEnd(6)} ${u.NAME || ''} ${u.LAST_NAME || ''}  <${u.EMAIL || ''}>`);
}

if (!leadsEnabled) {
  console.log('\n\nDEAL PIPELINES (BITRIX_CATEGORY_ID)');
  console.log('-'.repeat(64));
  const cats = await bx('crm.category.list', { entityTypeId: 2 });
  for (const c of cats?.categories ?? []) console.log(`  ${String(c.id).padEnd(6)} ${c.name}`);
}

console.log('\n✓ Webhook works and has CRM access.\n');
