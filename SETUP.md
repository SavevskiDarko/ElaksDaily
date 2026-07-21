# Elaks Ops — Setup (once, ~30 minutes)

The package contains:

```
index.html                      the whole app
sw.js                           service worker (offline + push)
manifest.json                   PWA install config
icon-192.png / icon-512.png     app icons
Ponuda_TEMPLATE.docx            your tagged offer template  ← put it here
schema.sql                      database
supabase/functions/push/index.ts   push notification sender
```

## 1. Supabase project (free tier is enough)

1. Go to https://supabase.com → New project. Pick a region close to Macedonia (eu-central).
2. **SQL Editor** → paste the whole `schema.sql` → Run.
3. **Authentication → Users → Add user** → your email + a strong password. This is your login.
4. **Project Settings → API** → copy the **Project URL** and the **anon public key**.

## 2. Configure the app

Open `index.html`, find the `CONFIG` block near the top of the script, and paste:

```js
SUPABASE_URL: "https://xxxx.supabase.co",
SUPABASE_ANON_KEY: "eyJ...",
VAPID_PUBLIC_KEY: "",        // filled in step 3
```

## 3. Push notification keys (VAPID)

On any machine with Node:

```bash
npx web-push generate-vapid-keys
```

- Put the **public key** into `CONFIG.VAPID_PUBLIC_KEY` in index.html.
- Keep the private key for the next step.

## 4. Deploy the push function

Install the Supabase CLI (https://supabase.com/docs/guides/cli), then from the project folder:

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase secrets set VAPID_PUBLIC_KEY="<public key>" VAPID_PRIVATE_KEY="<private key>" VAPID_SUBJECT="mailto:you@example.com"
supabase functions deploy push --no-verify-jwt
```

Then schedule it: Dashboard → **Edge Functions → push → Schedules** (or Database → Cron) → new schedule, expression `*/5 * * * *` (every 5 minutes). That one schedule powers task reminders, low-stock alerts, and the morning digest.

## 5. Host the app

Any static hosting works — the same server as the Elaks website, Netlify, Cloudflare Pages, GitHub Pages. Upload the whole folder **including Ponuda_TEMPLATE.docx**. HTTPS is required (push and PWA install don't work over http). 

## 6. Install on your phone

1. Open the URL in Chrome (Android) or Safari (iPhone).
2. Log in with the user from step 1.3.
3. **Add to Home Screen** (on iPhone this step is required before notifications can work).
4. Open the installed app → Опции → **Вклучи** push notifications.
5. Repeat on your laptop browser — every device gets its own subscription.

## Daily use in one paragraph

Morning: the digest push tells you how many tasks per context. **Денес** shows overdue + today; tap the square to complete; ↻ marks recurring tasks (standup, invoicing). **Лагер**: tap an article → + Прием / − Издавање; amber LED = below minimum (you'll also get a push), red = out of stock. **Понуди**: + creates an offer — search articles to add them (specs come along automatically), per-meter items show "???" and are excluded from the total with the footnote written for you, "Рачна ставка" is for montage/labor. "Зачувај + Генерирај .docx" downloads the finished Word offer. When a client accepts, set status to Прифатена and tap "Одземи од лагер" — the pieces leave inventory with the offer number as reference.

## If something doesn't work

- **Login fails** → check CONFIG values and that the user exists in Authentication.
- **No push on iPhone** → the app must be installed to the home screen first, iOS 16.4+.
- **Offer generation error** → Ponuda_TEMPLATE.docx must sit next to index.html on the server.
- **No digest** → check the Edge Function schedule is active and secrets are set (`supabase secrets list`).
