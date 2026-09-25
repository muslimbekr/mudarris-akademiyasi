# Mudarris Akademiyasi — landing page

Lead-generation landing page for **Mudarris Arab tili Akademiyasi** (Tashkent), built as the
destination for Meta (Facebook/Instagram) ad traffic. The academy teaches Arabic **offline**, in
person, across 8 branches in Tashkent — the page is written around that.

Form submissions go straight into **Bitrix24 CRM**.

Content and branding sourced from the academy's public
[Telegram channel](https://t.me/s/mudarris_akademiyasi) and
[Instagram profile](https://www.instagram.com/mudarris_akademiyasi/).

## Structure

- `public/index.html` — the page (Uzbek, Latin script)
- `public/styles.css` — styles; brand blue `#2A5298` taken from the academy logo
- `public/script.js` — form handling, Meta Pixel, validation, phone mask, UTM capture
- `api/lead.js` — serverless function; creates the CRM lead in Bitrix24
- `scripts/bitrix-inspect.mjs` — checks the webhook and prints the ids you need
- `public/assets/logo.jpg` — academy logo

No build step and no dependencies. Static files plus one serverless function on Vercel.

---

## ⚠️ Setup required before running ads

### 1. Bitrix24

**a. Create an inbound webhook.** In Bitrix24: **Developer resources → Other → Inbound webhook**.
Tick the **CRM** scope. Copy the URL — it looks like
`https://company.bitrix24.ru/rest/1/xxxxxxxxxxxx/`.

That URL *is* the credential. Treat it like a password: it goes in Vercel's environment
variables, never in the repo.

**b. Check it and find your ids.** Run this locally — the webhook stays on your machine:

```bash
BITRIX_WEBHOOK_URL=https://company.bitrix24.ru/rest/1/xxxx/ node scripts/bitrix-inspect.mjs
```

It confirms the webhook has CRM access, prints which portal it belongs to, says whether your
account uses Leads or runs CRM in simple mode, and lists custom fields, sources and users.

**c. Set the environment variables** in Vercel → the project → **Settings → Environment Variables**:

| Name | Required | Value |
|---|---|---|
| `BITRIX_WEBHOOK_URL` | yes | the inbound webhook URL |
| `BITRIX_ENTITY` | no | `lead` (default), or `deal` if CRM runs in simple mode |
| `BITRIX_ASSIGNED_BY_ID` | no | user id the lead is assigned to |
| `BITRIX_CATEGORY_ID` | no | deal pipeline id (only with `BITRIX_ENTITY=deal`) |
| `BITRIX_SOURCE_ID` | no | CRM source, default `WEB` |
| `BITRIX_UF_COURSE` / `BITRIX_UF_BRANCH` | no | custom field codes, e.g. `UF_CRM_1700000000000` |

Redeploy after adding them.

### What a lead looks like in Bitrix24

- **Title:** `Sayt: Nodira — Grammatika`
- **Phone:** stored as `+998…`, type MOBILE
- **UTM:** written to Bitrix's native `UTM_SOURCE`, `UTM_MEDIUM`, `UTM_CAMPAIGN` and
  `UTM_CONTENT` fields, so you can filter and build reports on campaigns without any setup
- **Comments:** course, branch, `fbclid`, referrer and the submission time in Tashkent time
- **Repeat enquiries** are flagged in the comments with the ids of the existing records, so
  whoever picks the card up knows before they call

Course and branch also go to `BITRIX_UF_COURSE` / `BITRIX_UF_BRANCH` when those are mapped.
They are optional on purpose — everything is in the comments regardless, so the integration
works the moment the webhook is set.

### 2. Meta Pixel — already configured

Pixel `1038630499223454` is live. The loader lives in `public/script.js`; the id is set in
`public/index.html`, alongside a `<noscript>` beacon for visitors with JavaScript disabled.

| Event | Fires when |
|---|---|
| `PageView` | page loads |
| `Lead` | form submits successfully — includes course + branch |
| `Contact` | a phone number is clicked |

Optimize the campaign for **Lead**. Note that `Lead` only fires on a successful write to the
CRM, so it stays silent until `BITRIX_WEBHOOK_URL` is set.

---

## Reliability

- If Bitrix is unreachable, the lead is written to the Vercel function logs
  (`LEAD_WRITE_FAILED`) and the visitor is asked to call instead — a failure is never silent.
- Bitrix answers `HTTP 200` with an `{error}` body when a call fails, so the response body is
  checked rather than the status code — a rejected lead can never look like a success.
- If the duplicate lookup fails, the lead is still created; only the repeat-enquiry note is lost.
- Until the env vars are set, `/api/lead` returns `500 not_configured`.

## Spam handling

Ad traffic attracts bots. Two filters run before anything reaches the CRM:

- a hidden honeypot field (`website`) that only a bot fills in
- a minimum time-on-page of 1.5s before submit

Both return `200 OK` so the bot believes it succeeded and does not retry — but no lead is created.

## Local preview

```bash
npx serve public
```

That serves the static page only; `/api/lead` will 404. To exercise the function locally, use
`npx vercel dev` with a `.env.local` based on `.env.example`.
