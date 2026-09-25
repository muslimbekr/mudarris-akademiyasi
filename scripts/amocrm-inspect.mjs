/*
 * Prints the amoCRM ids needed to configure api/lead.js.
 *
 *   AMOCRM_SUBDOMAIN=mudarris AMOCRM_ACCESS_TOKEN=xxx node scripts/amocrm-inspect.mjs
 *
 * Run it locally. The token never has to leave your machine — copy the ids it prints
 * into the Vercel environment variables.
 */

const RAW = (process.env.AMOCRM_SUBDOMAIN || '').trim();
const TOKEN = (process.env.AMOCRM_ACCESS_TOKEN || '').trim();

if (!RAW || !TOKEN) {
  console.error('Set AMOCRM_SUBDOMAIN and AMOCRM_ACCESS_TOKEN first.\n');
  console.error('  AMOCRM_SUBDOMAIN=mudarris AMOCRM_ACCESS_TOKEN=xxx node scripts/amocrm-inspect.mjs');
  process.exit(1);
}

const HOST = RAW.includes('.') ? RAW : `${RAW}.amocrm.ru`;
const API = `https://${HOST}/api/v4`;

async function amo(path) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) {
    console.error(`\n✗ ${path} -> ${res.status}`);
    console.error(text.slice(0, 400));
    if (res.status === 401) console.error('\nThe token is wrong, expired, or belongs to another subdomain.');
    process.exit(1);
  }
  return JSON.parse(text);
}

console.log(`\nConnected to ${HOST}\n${'='.repeat(60)}`);

const me = await amo('/account');
console.log(`Account: ${me.name} (id ${me.id})\n`);

console.log('PIPELINES AND STAGES');
console.log('-'.repeat(60));
const pipelines = await amo('/leads/pipelines');
for (const p of pipelines?._embedded?.pipelines ?? []) {
  console.log(`\n  Pipeline "${p.name}"${p.is_main ? '  [main]' : ''}`);
  console.log(`    AMOCRM_PIPELINE_ID=${p.id}`);
  for (const s of p._embedded?.statuses ?? []) {
    console.log(`      stage "${s.name}" -> AMOCRM_STATUS_ID=${s.id}`);
  }
}

console.log(`\n\nLEAD CUSTOM FIELDS (optional)`);
console.log('-'.repeat(60));
const fields = await amo('/leads/custom_fields?limit=250');
const list = fields?._embedded?.custom_fields ?? [];
if (!list.length) {
  console.log('  none — leads will still carry everything in the note');
} else {
  for (const f of list) console.log(`  ${String(f.id).padEnd(10)} ${f.name}  (${f.type})`);
  console.log('\n  Map the ones you want, e.g. AMOCRM_CF_COURSE=<id>, AMOCRM_CF_BRANCH=<id>');
}

console.log(`\n\nUSERS (optional — who new leads are assigned to)`);
console.log('-'.repeat(60));
const users = await amo('/users?limit=250');
for (const u of users?._embedded?.users ?? []) {
  console.log(`  AMOCRM_RESPONSIBLE_USER_ID=${String(u.id).padEnd(10)} ${u.name}  <${u.email}>`);
}
console.log();
