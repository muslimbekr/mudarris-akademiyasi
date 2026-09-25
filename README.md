# Mudarris Akademiyasi — landing page

Lead-generation landing page for **Mudarris Arab tili Akademiyasi** (Tashkent), built as the
destination for Meta (Facebook/Instagram) ad traffic. The academy teaches Arabic **offline**, in
person, across 8 branches in Tashkent — the page is written around that.

Content and branding sourced from the academy's public
[Telegram channel](https://t.me/s/mudarris_akademiyasi) and
[Instagram profile](https://www.instagram.com/mudarris_akademiyasi/).

## Structure

- `public/index.html` — the page (Uzbek, Latin script)
- `public/styles.css` — styles; brand blue `#2A5298` taken from the academy logo
- `public/script.js` — form handling, Meta Pixel, validation, phone mask, UTM capture
- `api/lead.js` — serverless function; appends each lead to Google Sheets
- `public/assets/logo.jpg` — academy logo

No build step. Static files plus one serverless function on Vercel.

---

## ⚠️ Two things must be set up before running ads

### 1. Meta Pixel ID

Open `public/index.html` and replace the placeholder near the top:

```html
<script>window.META_PIXEL_ID = 'PASTE_PIXEL_ID_HERE';</script>
```

Until a real 15–16 digit ID is in place, no tracking fires (the page still works, and a warning
is logged to the browser console).

Events sent:

| Event | Fires when |
|---|---|
| `PageView` | page loads |
| `Lead` | form submits successfully — includes course + branch |
| `Contact` | a phone number is clicked |

Optimize the campaign for **Lead**.

### 2. Google Sheets credentials

**a.** Create a spreadsheet. Name the first sheet **`Leads`** and put these headers in row 1:

```
Sana | Ism | Telefon | Kurs | Filial | utm_source | utm_medium | utm_campaign | utm_content | fbclid | Referrer | User-Agent
```

**b.** In [Google Cloud Console](https://console.cloud.google.com/): create a project → enable the
**Google Sheets API** → **IAM & Admin → Service Accounts** → create one → **Keys → Add key → JSON**.

**c.** Open the downloaded JSON, copy the `client_email` value, and **share the spreadsheet with
that email address as Editor**. This step is the one people forget — without it every write is
denied.

**d.** In Vercel → the project → **Settings → Environment Variables**, add:

| Name | Value |
|---|---|
| `GOOGLE_SHEET_ID` | the long id in the sheet URL, between `/d/` and `/edit` |
| `GOOGLE_CLIENT_EMAIL` | `client_email` from the JSON |
| `GOOGLE_PRIVATE_KEY` | `private_key` from the JSON, pasted whole, `-----BEGIN` through `-----END PRIVATE KEY-----\n` |
| `GOOGLE_SHEET_RANGE` | `Leads!A:L` (optional, this is the default) |

Redeploy after adding them.

Until these exist, `/api/lead` returns `500 not_configured` and the form shows its error message.
Leads are also written to the function logs on any Sheets failure, so a broken spreadsheet never
silently loses one.

---

## Spam handling

Ad traffic attracts bots. Two filters run before anything is written:

- a hidden honeypot field (`website`) that only a bot fills in
- a minimum time-on-page of 1.5s before submit

Both return `200 OK` so the bot believes it succeeded and does not retry — but no row is written.

## Local preview

```bash
npx serve public
```

That serves the static page only; `/api/lead` will 404. To exercise the function locally, use
`npx vercel dev` with a `.env.local` based on `.env.example`.
