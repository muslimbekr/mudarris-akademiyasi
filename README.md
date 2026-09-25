# Mudarris Akademiyasi — landing page

Lead-generation landing page for **Mudarris Arab tili Akademiyasi** (Tashkent), built as the
destination for Meta (Facebook/Instagram) ad traffic. The academy teaches Arabic **offline**, in
person, across 8 branches in Tashkent — the page is written around that.

Form submissions go straight into **amoCRM**.

Content and branding sourced from the academy's public
[Telegram channel](https://t.me/s/mudarris_akademiyasi) and
[Instagram profile](https://www.instagram.com/mudarris_akademiyasi/).

## Structure

- `public/index.html` — the page (Uzbek, Latin script)
- `public/styles.css` — styles; brand blue `#2A5298` taken from the academy logo
- `public/script.js` — form handling, Meta Pixel, validation, phone mask, UTM capture
- `api/lead.js` — serverless function; creates the contact + lead in amoCRM
- `scripts/amocrm-inspect.mjs` — prints the amoCRM ids you need for configuration
- `public/assets/logo.jpg` — academy logo

No build step and no dependencies. Static files plus one serverless function on Vercel.

---

## ⚠️ Setup required before running ads

### 1. amoCRM

**a. Create a private integration.** In amoCRM: **Settings → Integrations → Create integration →
Private**. Grant it access to leads and contacts. Open it and copy the **long-lived token**
(долгосрочный токен).

**b. Find your ids.** Run this locally — the token stays on your machine:

```bash
AMOCRM_SUBDOMAIN=yoursubdomain AMOCRM_ACCESS_TOKEN=yourtoken node scripts/amocrm-inspect.mjs
```

It prints your pipelines, stage ids, lead custom fields and users, each labelled with the env var
it belongs to.

**c. Set the environment variables** in Vercel → the project → **Settings → Environment Variables**:

| Name | Required | Value |
|---|---|---|
| `AMOCRM_SUBDOMAIN` | yes | `mudarris` for `mudarris.amocrm.ru`. Pass the full host (`mudarris.kommo.com`) if you are on Kommo. |
| `AMOCRM_ACCESS_TOKEN` | yes | the long-lived token |
| `AMOCRM_PIPELINE_ID` | no | which funnel. Defaults to the main one. |
| `AMOCRM_STATUS_ID` | no | which stage. Defaults to the first. |
| `AMOCRM_RESPONSIBLE_USER_ID` | no | who the lead is assigned to |
| `AMOCRM_CF_COURSE` etc. | no | lead custom field ids — see below |

Redeploy after adding them.

### What a lead looks like in amoCRM

- **Lead name:** `Sayt: Nodira — Grammatika`
- **Contact:** created with the phone in `+998…` form, or reused if that phone already exists —
  repeat submissions do not create duplicate contacts
- **Tags:** `Sayt`, the utm_source, the course, the branch
- **Note:** every field including all UTM params, `fbclid` and referrer

Custom fields are optional on purpose: everything is in the note regardless, so the integration
works the moment the token is set. Map `AMOCRM_CF_COURSE`, `AMOCRM_CF_BRANCH`,
`AMOCRM_CF_UTM_SOURCE`, `AMOCRM_CF_UTM_CAMPAIGN` and `AMOCRM_CF_FBCLID` later if you want to
filter and build reports on those values.

### 2. Meta Pixel ID

Open `public/index.html` and replace the placeholder near the top:

```html
<script>window.META_PIXEL_ID = 'PASTE_PIXEL_ID_HERE';</script>
```

Until a real 15–16 digit ID is in place, no tracking fires (the page still works, and a warning
is logged to the browser console).

| Event | Fires when |
|---|---|
| `PageView` | page loads |
| `Lead` | form submits successfully — includes course + branch |
| `Contact` | a phone number is clicked |

Optimize the campaign for **Lead**.

---

## Reliability

- If amoCRM is unreachable, the lead is written to the Vercel function logs
  (`LEAD_WRITE_FAILED`) and the visitor is asked to call instead — a failure is never silent.
- If the lead is created but the note fails, the request still succeeds; the lead is already safe
  in the CRM.
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
