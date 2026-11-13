# Going live (step 9 of the care team plan)

What the code does is in place (`render.yaml`, `server/health.js`, `server/security.js`, `legal.js`). What's left is for George: paying for the plans, two settings, a monitor, and approving the privacy policy and terms.

## 1. Paid plans on Render

`render.yaml` now asks for the **Starter** web service (about $7 a month; it never sleeps, so reminders go out overnight) and a **paid Postgres** (`basic-256mb`, about $6 a month; it doesn't expire, and Render keeps backups of it). A Blueprint sync applies them. If the site was made by hand instead:

1. Render → the `returnly` service → **Settings** → **Instance Type** → **Starter**.
2. Render → `returnly-db` → **Settings** → change the plan to a paid one (Basic 256 MB is enough to start).
3. Render → `returnly-db` → **Recovery**: check that backups are listed. Paid databases have point-in-time recovery; download an export there whenever you want a copy of your own.

Photos stay in Cloudflare R2 (nothing to change).

## 2. Two settings (Render → `returnly` → Environment)

| Setting | What to put |
| --- | --- |
| `ALERT_EMAIL` | the email that hears when reminders stop sending (for example `adltrack00@gmail.com`) |
| `APP_URL`, `RESEND_API_KEY`, `EMAIL_FROM` | already listed in `render.yaml`; email has to be set up for the alert email to go out |

## 3. The health check

`/api/health` answers `{"ok":true,"reminders":"sending"}` while the every-minute reminder check runs. If it hasn't run for 5 minutes it answers **503** with `"reminders":"stopped"`:

- Render sees the failed health check, restarts the service and emails the account owner.
- `ALERT_EMAIL` gets "Adltrack reminders have stopped sending", and "sending again" once they're back.
- `"reminders":"off"` means push, email and texts aren't set up, so no reminders are sent at all.

For the case where the whole site is down (so it can't email anyone), add a free outside monitor: https://uptimerobot.com → **Add New Monitor** → HTTP(s) → `https://<your site>/api/health`, every 5 minutes, alert to your email. It alerts on the 503 too.

## 4. Security (built)

- Passwords: at least 10 characters, not one of the most used passwords, not the email or name. Older passwords still sign in.
- Shared phone: Settings → Security and privacy → "Sign me out on this phone after 15 minutes without use". The server signs the session out too, so a phone left closed is signed out when it's next opened.
- Sign-in history: the last 10 sign-ins and wrong passwords, with the kind of device, in Security and privacy. Kept 90 days.

## 5. Privacy policy and terms

Both are in `legal.js`, shown in Settings and, before signing in, on `legal.html` (`#privacy`, `#terms`). Each person ticks "I agree…" on the invite page before joining a care team; the server refuses to join without it and keeps the time (`team_members.consented_at`). Delete account removes the account's rows, the discharge papers and the photos.

**Before launch: George approves the wording, and a lawyer reviews it before selling to agencies.**

## 6. HIPAA readiness for agencies (step 11)

A family using Adltrack for their own relative doesn't need HIPAA. An agency or care home does: Adltrack becomes its business associate.

1. A **Business Associate Agreement (BAA)** between Adltrack and each agency, signed before it adds a patient. A lawyer drafts the template.
2. A BAA from every provider that touches health information. Check each one's current terms with them before signing up an agency:

| Provider | What it holds | BAA |
| --- | --- | --- |
| Render (website, database) | everything | Offered on its HIPAA-enabled workspaces, at an extra cost. The workspace has to be switched before agency data goes in. |
| Cloudflare R2 (photos, papers) | photos of papers and bottles | Offered to Enterprise customers. Ask Cloudflare; if R2 isn't covered on our plan, move photos to Amazon S3 under an AWS BAA. |
| Anthropic (reads papers and labels) | the paper and label photos | Offered for the API through Anthropic's sales team, usually with zero data retention. |
| Resend (email) | names, reminders, end-of-day reports | Ask Resend. If it won't sign one, send agency email through Amazon SES under an AWS BAA. |
| Twilio (texts) | invites, alerts | Offered for its HIPAA-eligible products on the Security or Enterprise edition. |
| Stripe (payments) | the admin's card, no health information | Not needed: payments are exempt, and no health information is sent to Stripe. |
| Apple and Google push | the words of each notification | No BAA is offered. For agencies, notifications should say only "Adltrack: a reminder is due" and show the details once the app is opened. To build with step 11. |

3. Have a lawyer review the BAA template, the privacy policy and the terms before selling to agencies.
