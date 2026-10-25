# Adltrack

Bring them home. Keep them on track. Scan the discharge papers or the bottles, and Adltrack turns them into a daily checklist with reminders and refills, shared with the family and paid caregivers.

Adltrack is becoming a post-discharge medication app built on this same design: scan the discharge papers, confirm each medication with a photo, and get reminders for doses and refills. The plan is in [docs/adltrack-plan.md](docs/adltrack-plan.md). Step 1 renamed the app and its menu. Step 2 made the scan read discharge papers: `server/discharge.js` sends the pages to Claude and `POST /api/discharge/read` returns one card per medication, with its instructions word for word, the doctor who prescribed it, the pharmacy, follow-up appointments and warning signs. Medications the papers say to stop are left out and named. Nothing the papers don't say is added. The cards after Scan still look like Returnly's until the next steps.

**Care teams (next):** an admin adds family and paid caregivers, the people given My Tasks do the care and everyone else follows along. The 11 steps are in [docs/care-team-plan.md](docs/care-team-plan.md). Run one step per session by saying: *Read `docs/care-team-plan.md`. Do step N only. Follow "Rules for every step". Stop when its "Done when" list is true, run `npm test`, and show me screenshots on desktop and phone.*

## Run locally

Requires Node.js 22 or newer.

```sh
npm install
npm start
```

Open http://127.0.0.1:4174/. Without `DATABASE_URL`, accounts are saved to `data/dev-store.json` and photos to `data/files/` (both git-ignored) so sign up and sign in work locally. Set `PORT` to use another port.

```sh
npm test
```

To run the data tests against Postgres as well, point `TEST_DATABASE_URL` at a throwaway database (its tables are dropped): `TEST_DATABASE_URL=postgres://localhost/returnly_test npm test`.

## Accounts

- `server.js` serves the app and a JSON API under `/api`: `signup`, `login`, `logout`, `me`, `items` (GET, POST; PUT and DELETE `/api/items/:id`), `settings` (PUT: settings and profile), `purchases` (GET; PUT `/api/purchases/:id/receipt`), `receipts/read` (POST: read a scanned receipt), `files/:id` (GET), `items/:id/label` (PUT, DELETE: the QR code or return label), `places/nearest` (POST: nearest drop-offs), `push/key` (GET), `push/subscribe`, `push/unsubscribe` and `push/test` (POST: this device's Web Push subscription), `reminders/claim` (POST: the open app's daily notification), `reminders/action` and `reminders/opened` (POST: a notification's buttons, and a reminder being opened), `email/prefs` (GET, PUT: which reminder emails are on), `email/act` and `email/unsubscribe` (POST: links in reminder emails, no sign-in needed), `password/forgot` and `password/reset` (POST), `contact` (GET: the support address), `policy/report` (POST: "Is this wrong?"), `notices` (GET; POST `/api/notices/read`), `inbox` (GET; POST `/api/inbox/address`, `/api/inbox/senders` and `/api/inbox/:provider/disconnect`; GET `/api/inbox/:provider/start` and `/callback`: purchases from email), `auth/providers` (GET) and `auth/:provider/start` / `callback` (Continue with Google / Apple), `inbound/email` (POST: the email provider's inbound webhook), `inbox/outlook/notify` (POST: Graph notifications), `admin/*` (policy review, admin accounts only), `data` (GET/PUT, the whole account in one document, kept for older versions of the app) and `account` (DELETE, needs the password).
- Passwords are hashed with scrypt. Sessions are random tokens in an HttpOnly, SameSite=Lax cookie (Secure in production); only a SHA-256 of each token is stored. Sessions last 30 days.
- The app keeps a full copy in the browser and uploads changes in the background, one item at a time (create, update, delete), plus settings and profile; the last write wins. Signing in on another device downloads the account's copy.
- Sign-in is rate limited per IP, and an email is locked for 15 minutes after 10 wrong passwords. Writes must be same-origin JSON.
- Pages are served with a strict Content Security Policy: scripts, styles, fonts, the service worker (`worker-src 'self'`) and the web app manifest (`manifest-src 'self'`) only from this site, no inline scripts, no framing. The service worker (`sw.js`) is a top-level file, so its scope is the whole site; it caches only the public app files and never `/api/` responses, so account data and private photos are never stored in its cache, and signing out clears the account from the browser as before.
- Password reset: "Forgot password?" under the sign-in button (`forgot.html`) emails a link to `reset.html`. The link carries a random token in the URL fragment (so it isn't sent to the server in logs or referrers); only its SHA-256 is stored, it works once and for one hour, and asking again is limited to 3 emails per address per hour. The answer is the same whether or not the address has an account. Saving a new password signs out every other device and signs this one in.
- "Continue with Google" and "Continue with Apple" sit under the existing buttons on the sign-in and sign-up pages when they're set up (see Purchases from email). They ask only for name and email (never inbox access), sign in to the account with that verified email (linking it the first time) or create one. Such accounts have no password; they confirm "Delete my account" with their email.

## Data

- Postgres tables (`server/store.js`): `purchases` (one row per receipt or order: store, channel, order number, purchase and delivery dates, source `receipt`/`email`/`manual`, retailer id, receipt file, and `receipt_pages` for the further pages of a long receipt) and `items` (one row per item). Item columns keep the app's field names and values one-to-one (`server/items.js` lists them; `window` is stored as `window_days`). A value that doesn't fit its column's type, such as an empty date, and any field the server doesn't know yet, is kept as-is in the item's `extra` column, so nothing is lost. Columns for later sessions are already there: retailer id, policy checked date, condition answers, return method, drop-off location, QR or label file, refund expected-by date.
- Settings and profile stay in `user_data`. Accounts saved in the old single-document format move into the tables when the server starts (and again on their next request, in case an older server wrote one meanwhile), without changing their last-updated time.
- Items the app adds from one scan share a purchase; other items get a purchase of their own.
- Photos (items, receipts, profile) are files, not part of the JSON (`server/storage.js`): an S3-compatible bucket such as Cloudflare R2 in production, `data/files/` in development. The app gets a private `/api/files/<id>` URL that is served only to the signed-in owner (anyone else gets 404). Files are checked to be JPEG, PNG, WebP or PDF and up to 10 MB.
- Background jobs (`server/jobs.js`) are queued in Postgres and run inside the Node server. Jobs are retried with backoff, each job is claimed by one server at a time, and one left running by a crashed server is picked up again. `maintenance.cleanup` (the example) runs every 6 hours and clears expired sessions; `files.delete` retries deleting stored files that couldn't be removed straight away. `receipts.cleanup` (every 6 hours) deletes receipts that were scanned but never saved with an item, two days later. `reminders.dispatch` (every minute) and `reminders.send` deliver the daily reminder by Web Push or email, and `reminders.followup` emails a pushed reminder that wasn't opened 3 days before a deadline (see below).
- `push_subscriptions` (one row per browser or installed app that allowed notifications, with its time zone), `reminder_days` (the last local date each account's daily reminder went out, and whether it was opened), `email_optouts` (reminder email types an account unsubscribed from) and `password_resets`.
- "Delete my account" deletes the account's rows in every table and its stored files.

## Retailer return policies

`policies/` holds the checked US return policies for Amazon, Walmart, Target, Costco, Best Buy, The Home Depot, Apple, Nike, Zara, SHEIN and Fashion Nova, one file per store (for example `policies/amazon.json`).

- `item` fills the existing item fields (`window`, `basis`, `outcome`, `requirement`, `url`, `conditions`, `processing`; `policySource` is built from the name and checked date). Next to it: category exceptions, membership programs, holiday extensions, receipt rules, refund timing and fees, return methods with their steps and what each needs (label, box, QR code, printer), and marketplace-seller caveats.
- Every fact has the official source URL and the date it was checked. Anything the official page doesn't confirm, or where the retailer's own pages disagree, is `"unknown"` and listed under `unknowns`. Where pages disagree on a window, the shorter one is kept.
- `policies/schema.json` is the JSON schema. The server checks every file at startup and won't start if one is invalid or a fact has no source.
- Versions: to change a policy, move the current file to `policies/history/<id>.v<N>.json`, then edit `<id>.json` and raise its `version`. On startup every version is loaded into Postgres (`retailers`, `retailer_policies`); past versions are kept, and a changed file that keeps its old version number is refused.
- API (no sign-in needed): `GET /api/retailers` lists stores; `GET /api/retailers/:id` returns the full policy, the item fields it fills and its versions; `GET /api/retailers?match=WAL-MART%20%231234` matches a receipt or card-statement name (store numbers, `*` reference codes and `.com` are ignored).

## Policy engine

`server/engine.js` applies a store's policy to one item and fills the existing item fields (`window`, `basis`, `outcome`, `requirement`, `url`, `conditions`, `processing`, `policySource`, `confirmed`). It also says whether the item is returnable (yes / no / not sure, with the reason), whether a holiday extension applies, and lists the facts it used with their sources and checked dates.

- `POST /api/policy` (signed in) takes the item and the answers to the condition questions, matches the store name, and returns the result. The app saves it into the item and syncs it like any other change. It runs when a store is added or changed on the Return card, when an answer changes, and on start for items that haven't been checked against their current store.
- Categories: the item name is sorted into the store's policy categories (`electronics`, `non-returnable`, ...) with one small Claude call (`server/classify.js`, `claude-opus-5-5` at low effort, structured output, refusal fallback on). The answer is kept on the item as `policyCategory`, next to the existing `category`, so each item is sorted once; answers are also cached in memory and limited to 300 calls per account per hour. Set `ANTHROPIC_API_KEY` to turn it on (it also turns on receipt reading).
- Safety: when the category isn't known, the earliest deadline of every category that could apply is used and the answer is "not sure". An unknown start date counts from purchase (the earlier date); a delivery-based window counts from purchase until the delivery date is added; an unknown deadline meaning is read as "must be on its way by then". Holiday extensions only apply with a published return-by date and only move the date later. Membership uses the least generous program and skips categories a program excludes or where the policy says it's unconfirmed. "Yes" needs a checked policy and a checked window; unverified policies are never "yes".
- Questions (at most three, only ones that change the answer for that store and category): marked final sale, opened or used, membership, damaged or wrong, tags still on, original packaging, bought at a clearance store. A "no" to a condition the policy names makes the answer "not sure" rather than a guessed refusal.
- On the Return card, "Return by" and the days left come from the engine; the questions and one line for what you get back sit below the existing lines and above Continue. A manual date stays the user's. Stores without a policy keep the "Date unconfirmed" label and the dashed calendar entry. Items with no fixed window (Costco general merchandise) show "No fixed window".
- New item fields (stored with the item): `retailerId`, `policyChecked`, `policyVersion`, `policyCategory`, `conditionAnswers`, `returnable`, `returnableReason`, `holidayReturnBy`, `policyFacts`, `policyQuestions`, `policyLine`, `policyStore`.

## Receipt reading

The Scan step reads the receipt and fills the Item card (`server/receipts.js`, `POST /api/receipts/read`, signed in).

- The app sends the photo, screenshot or PDF to the server (photos as a JPEG copy of at most 2000 px; PDFs as they are). Up to 4 pages of one receipt: pick several files at once, or, when a receipt is cut off, go back and scan the rest; the next photo is read together with the earlier pages.
- The pages are saved first, privately, on the scan's own purchase (source `receipt`), so the receipt stays with the purchase its items join and is deleted with it. A receipt that's scanned but never saved is deleted after two days.
- One call to `claude-opus-5-5` (vision, structured output, medium effort, refusal fallback on) extracts: store name and location, purchase date and time, order or transaction number, line items (name, quantity, price, item code), totals, payment type (never the card number) and any printed return-policy text, word for word. Anything the model isn't sure about comes back empty. Dates after today, impossible values and unknown payment types are dropped, and anything that looks like a card number (13–19 digits passing the Luhn check, or a masked number such as `**** 1234`) is removed from every field.
- The Item card opens with each item's name and price (a line bought several times becomes one card per unit), and the store and date from the receipt. The store name is matched to the retailer database (`TARGET` → Target). While waiting, the Scan card shows "Reading your receipt…". What couldn't be read (store, date, some names or prices) stays empty with its usual placeholder and is named in the line under the card; a missing date still falls back to today, and the line says so.
- Blurry, dark or non-receipt photos stay on Scan with the reason under the card. Without `ANTHROPIC_API_KEY`, or when the call fails, the receipt is still saved and the Item card opens empty, saying the receipt couldn't be read. Reads are limited to 60 per account per hour.
- Saved items keep `code` (item code), `orderNumber`, `payment` and `receiptPolicy` (the printed policy text). The policy engine treats printed text as a source ("Printed on your receipt"): for a store without a checked policy, a window printed on the receipt (the shortest one it states, read from the text itself) sets the date, counted from purchase; for a store we have, a shorter printed window wins.
- Cost: about $0.02–$0.05 per one-page scan at `claude-opus-5-5` prices ($4 / $20 per million input / output tokens); each further page adds about $0.01–$0.02. The server logs the tokens each read used.

## How to return it

The Return card teaches how to return the item at its store, below its existing lines and above Continue (`server/guide.js`). Everything comes from the store's checked policy (`methods` in `policies/<id>.json`); nothing is made up.

- Steps: the easiest way first (the policy lists its ways easiest first), as a numbered list with its cost, what it needs (QR code, return label, box, printer, receipt, photo ID; "Not confirmed" when the policy doesn't say) and the order number when known. Other ways sit in a collapsed "Other ways to return", each with "Return this way instead" (saved as the item's `returnMethod`). Stores whose steps aren't in the checked policy (Best Buy today) say so and point to the return link.
- Return link: `/api/policy` fills `url` from the policy, so "Open retailer's return portal ↗" shows for every known store. When a policy documents an order-specific link (`item.orderUrl`, with `{order}` where the order number goes, plus its source) and the item has an order number, the link opens that order. No retailer's official pages document one yet, so none is filled in.
- Checklist: the existing packing checklist (`packing`: receipt, condition, packed, label, proof), collapsed, worded for the chosen way. A QR-code drop-off with no label has no label line; in-store returns check the store's location and hours instead.
- "Add your QR code or label": a photo, screenshot or PDF, saved privately on the item (`PUT /api/items/:id/label` with a data URL; `DELETE` removes it; stored as `labelFileId`, shown to the app as `label`). It changes only through that call, so a sync from an older copy never drops it, and it's deleted with the item and the account. "Show your QR code or label" opens it full-screen (a PDF opens in a new tab).
- "Nearest drop-off" (`POST /api/places/nearest`, signed in, 30 lookups per account per hour): asks for the device's location only when tapped, then shows the three closest places that accept this store's returns by the chosen way (the drop-off partners the policy names, or the store itself for in-store returns; mail has none) with distance, today's hours, open now and a directions link. The location is used for that request only and never saved.
- Places provider: Google Places API (New) (`server/places.js`, key in `GOOGLE_PLACES_API_KEY`). It has the most complete US store listings with opening hours, which a drop-off answer needs. Google's terms only allow keeping place ids and coordinates, for up to 30 days, so that's what's cached (`place_cache`, per store and ~1 km area, never linked to a user, cleared by `maintenance.cleanup`); the name, address and hours of the closest three are fetched fresh. Cost: a cache miss is one Text Search per store or partner (Amazon has five), and every lookup is up to three Place Details calls; see Google's pricing page for current rates and free monthly usage.
- Returns 101: a row under "How Adltrack works" on Support opens a page on receipts, store credit vs. refund, drop-off vs. mail, final sale and keeping proof.

## Any store, always current

- Live lookup (`server/lookup.js`): when a store isn't in `policies/` and its receipt prints no return window, `/api/policy` queues a `stores.lookup` job and answers straight away with the existing unconfirmed treatment ("Looking up …'s return policy…"); the app asks again a few times. The job asks Claude (`claude-opus-5-5`, medium effort, refusal fallback on) with web search and web fetch to find the store's official US policy page and record it through one strict tool call, in the same schema as `policies/*.json`. Every fact's source is that page; anything it doesn't say is `unknown`. A page the search didn't return, or one off the store's own domain, is never accepted.
- Unverified: looked-up policies have `status: "unverified"`. The engine never says "yes, returnable" from them, always counts from the purchase date (the earlier deadline), and leaves `confirmed` false, so the Return card shows "Date unconfirmed" and the calendar entry is dashed. The Return card adds one line saying the policy is unverified.
- Cache and usage (`store_lookups`, `store_lookup_users`): one lookup per store name for everyone, refreshed after 30 days (7 days when no official page was found, 1 day after a failed lookup). Each account that uses a store is counted once. New lookups are limited to 20 per account per hour; cached answers aren't.
- "Is this wrong?": a small link under the policy line on the Return card, with an optional note (`POST /api/policy/report`, saved in `policy_reports`).
- Policy review: accounts whose email is in `ADMIN_EMAILS` (comma-separated) get a "Policy review" row at the end of Settings. It lists unverified stores ranked by how many people use them (with "Approve into checked policies"), open reports ("Mark reviewed") and flagged changes ("Approve change" with the window confirmed on the page, or "No real change"). Everyone else gets a 404 from `/api/admin/*`.
- Approved policies are new versions stored in `approved_policies` and loaded on top of `policies/*.json` at start-up, until a committed file has the same or a higher version. To make one permanent, copy it into `policies/` (see `/api/retailers/:id`).
- Freshness (`policies.freshness`, weekly): re-fetches every checked retailer's source pages, keeps a hash and the policy phrases of each (`source_snapshots`: day windows, dates, dollar amounts, terms like "store credit" or "final sale"), and flags a page whose phrases changed (`policy_flags`). A reworded paragraph or a new banner isn't flagged. In October to December a change that mentions holiday returns is marked "Holiday season". With `ANTHROPIC_API_KEY` the changed page is also re-read to propose the new window. Nothing changes until an admin approves it; admins get a notice the next time they open the app.
- When an approved change moves a deadline earlier, active items of that store (deciding or started, without a date the user set) are recomputed and saved, and their owners get a notice (`notices`), shown once when the app opens (and as a browser notification when they're on). Notices aren’t sent by push.

## Reminders when the app is closed

- Installable: `manifest.webmanifest` (icons in `assets/`, drawn like the favicon) and a service worker, `sw.js`, which caches the app shell (network first, so a new version shows straight away; the cache is used when offline). On iPhone, web push only works once Adltrack is added to the Home Screen (Share → Add to Home Screen, iOS 16.4 or later); the Reminders page says so.
- Web Push with VAPID keys (`web-push` library). The device subscribes at the existing permission moments: "Enable browser notifications" / "Send a test notification" on Reminders, and "Start return". Each open of the app refreshes the subscription and the device's time zone. The server only sends to the browsers' push services (Google, Mozilla, Apple, Microsoft); subscriptions the push service reports as expired (404/410) are deleted. Signing out removes this device's subscription; deleting the account removes them all.
- One rule, one reminder a day: `server/reminders.js` picks the day's reminder (the most urgent item, "Plus N other return windows", skipping examples, items sent back, kept or received, and items snoozed with `snoozeUntil`). Every minute `reminders.dispatch` finds accounts whose `settings.time` has come in their time zone (with `settings.daily` on) and queues `reminders.send`. The open app asks `POST /api/reminders/claim` instead of choosing for itself, and does so only on devices without push. Both claim the user's local date in `reminder_days` first, so the user never gets the reminder twice. If no device could be reached, the day is released and the send is retried.
- Tapping a reminder opens that item's Return step (`app.html?remind=<item id>`, or the already open window).
- Without VAPID keys push stays off and the open app's daily notification works as before.

Generate the keys once (keep the private key secret):

```sh
npx web-push generate-vapid-keys
```

Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (a `mailto:` address push services can contact) on the Render service, and as environment secrets for development. Changing the keys later makes every device subscribe again the next time the app is opened.

## Reminders that get it done

Still one reminder a day per user at their chosen time, and still "We'll remind you daily until it's complete". Its words come from `nudge.js`, which the server (push and email) and the app (the Reminders preview) share, so they always match.

- Grouping: every return being reminded goes into one reminder, most urgent first. Two or more due within 7 days get the title "2 returns due this week: $84 total"; the rest are "Plus N other return windows".
- Urgency builds on the preview's rows: every day "12 days left", then "Only 3 days left", the day before "Deadline tomorrow", and deadline day "Deadline today" with "Check the exact cutoff time".
- Content: item name, the money at stake ("$49 back", "$35 in store credit"), days left, the single next step from the item's return guide (the first step of the chosen way, or "Tap for your QR code" once one is saved), and "Nearest drop-off: Target, 1.2 mi" once the user has looked one up on the Return card. Then the closest place's name, distance and opening hours are kept on the item (`dropoff`); the user's location still isn't saved.
- Deadline day: when the store takes returns in store, "Still possible today: Target closes at 10pm, 1.2 mi away" (today's closing time from the saved opening hours), or "Still possible today: Target takes returns in store" when no store has been looked up.
- Notification buttons: "Show QR code" (when one is saved; opens it full screen), "Snooze until tomorrow" (`snoozeUntil`), "I sent it back" (status `shipped`, `returnedOn` today) and "I'm keeping it" (status `kept`). The service worker saves them straight away through `POST /api/reminders/action` without opening the app, and tells an open app window. Browsers show as many buttons as they support (Chrome shows two; iPhone shows none and opens the item instead).
- Reminders stop when an item is sent back, kept or received, as before.
- Settings, as rows at the end of the Reminders settings card: "Also email me", quiet hours (no reminder between the two times; a reminder time inside them moves to their end) and "Gentle" (only at the halfway point of the window and 7, 3 and 1 days before). Quiet hours and Gentle are saved with the other reminder settings, and the device's time zone is saved with them too, so email reminders arrive at the chosen time where the user is.
- Email backup (`server/email.js`): sent at the reminder time when push isn't set up on any of the user's devices (or none could be reached), and four hours after a pushed reminder that hasn't been opened (tapped, a button used or an email link followed) on the day an item has 3 days left. It has the same words, the same actions as links (signed for that one account, item and action, valid 14 days, no sign-in needed) and one-click unsubscribe for each type (`daily` and `unopened`): a link in the email, and `List-Unsubscribe` / `List-Unsubscribe-Post` headers so mail apps can offer it too. "Also email me" turns both types on or off.
- Service: Resend. Sign-up needs no company email address and there's no manual account approval, so it's quick to set up; it sends through Amazon SES with DKIM and SPF on your own domain (on a `send.` subdomain, so it doesn't touch the domain's own mailbox records); its JSON API needs no extra library; and it passes our own unsubscribe headers through. Open and click tracking stay off. Replies go to `SUPPORT_EMAIL`. The free plan sends 3,000 emails a month, at most 100 a day.
- Support shows the address in `SUPPORT_EMAIL`.

Set up email: create a Resend account (resend.com), add your domain (Domains → Add Domain) and add the DNS records it shows (a DKIM TXT record on `resend._domainkey`, and an MX and an SPF TXT record on `send`), wait until it says Verified, then create an API key with "Sending access" for that domain (API Keys → Create API Key). Set `RESEND_API_KEY`, `EMAIL_FROM` (an address on that domain, for example `Adltrack <hello@yourdomain.com>`), `APP_URL` (for example `https://returnly.onrender.com`), `EMAIL_TOKEN_SECRET` (a long random string; Render generates one from the Blueprint) and `SUPPORT_EMAIL`. Without them nothing is emailed, the "Also email me" row says email isn't set up, and "Forgot password?" says reset isn't set up.

## Purchases from email

Settings → **Add purchases from email** (a row below My profile) opens a sub-page with three ways in. Orders found in email appear on Your purchases (All purchases) as cards labelled **From email**. Tapping one opens the Item card filled in with the items, store, order number and dates. Nothing becomes a return until the user taps.

- **Forwarding** (`server/inbox.js`): each account has a private address such as `u-7f3k2q9m@in.returnly.app` with a copy button and steps for Gmail, Outlook and Apple Mail. "Get a new address" replaces it straight away. Mail arrives through Resend's inbound email, the same provider as reminder emails. Its `email.received` webhook (`POST /api/inbound/email`, signature checked with `RESEND_WEBHOOK_SECRET`) carries only the message's metadata. Mail to an unknown address is dropped unread. For the rest, a job (`inbox.forwarded`, whose payload is only Resend's email id) fetches the message from Resend's API and reads it. It is accepted only when sent or forwarded by one of the user's verified addresses: the account email, a connected inbox, or a Gmail address that asked to auto-forward and that the user accepted on the sub-page, where Google's confirmation code is shown. Mail that fails SPF (unless DKIM passes) is dropped. Resend keeps its own copy of received mail under its retention settings.
- **Connect Gmail** (Google OAuth, `gmail.readonly`) and **Connect Outlook** (Microsoft Graph, `Mail.Read`): each shows a plain-English privacy explanation before connecting, and "Disconnect and delete" afterwards. The first import searches the last 90 days, only from the launch retailers' domains and shopping services (`server/mail.js`), and only emails whose subject is about an order, shipping, delivery, a return or a refund. After that, `inbox.poll` checks every 15 minutes for mail since the last check. Outlook also has a Graph subscription that says when mail arrives; it is checked by its clientState, of which only a hash is kept, and renewed when less than a day is left. Gmail stays in testing mode until Google verifies the app (see `docs/google-verification.md`): up to 100 test users, who reconnect every 7 days. Set `GMAIL_VERIFIED=true` once it's verified.
- **Import a spreadsheet** opens the existing CSV import dialog.
- **Reading** (`inbox.message`, one job per email): the same model and settings as receipt reading (`claude-opus-5-5`, structured output, low effort, refusal fallback on), with card numbers scrubbed first. It recognises order confirmations, shipping and delivery notices, return confirmations and refund notices, and returns the store, order number, dates, items and refund. At most 300 emails per account per day are read; one costs about $0.01 at `claude-opus-5-5` prices.
- **Matching** by store and order number:
  - A new order (or a shipping notice for one not seen yet) becomes a card. Its purchase row has source `email`, and the items the user saves from the card join it.
  - Delivery sets `delivered` on the order's items and recomputes the deadline from the checked policy (a date the user set stays). The email's date is used when the notice gives none.
  - A return started or shipped moves items the user is already returning to `started` or `shipped`. A kept item never becomes a return from an email.
  - A refund sets `received`, the amount and the date (`returnedOn`), like "Return complete". If it can't tell which item it was for, the user gets a notice instead.
  - Each change leaves a notice that is shown when the app opens.
- **Privacy**:
  - Email bodies are never stored, only the extracted fields and the message id (`inbox_messages`).
  - Inbox tokens are encrypted at rest with AES-256-GCM (`INBOX_TOKEN_KEY`).
  - "Disconnect and delete" revokes the Google grant (Microsoft has no app-side revoke, so its tokens are deleted and the Graph subscription removed), then deletes everything read from that inbox and its unopened orders. "Delete my account" revokes every grant first.
  - Security and privacy has a paragraph on this.
- Tables: `inbox_addresses`, `inbox_connections`, `inbox_messages`, `email_orders`, `oauth_states` (sign-in and connect requests in flight, 10 minutes, bound to the browser by a cookie) and `oauth_identities`.

### Setting it up

Each part stays off until its values are set. With any of them set, production also needs `INBOX_TOKEN_KEY` (`openssl rand -base64 32`), and `APP_URL` (from Reminders that get it done) is used for the OAuth redirect and Outlook notification addresses. Reading needs `ANTHROPIC_API_KEY`.

1. **Inbound email (forwarding)**, with Resend (set up for reminder emails already):
   - In Resend → Receiving, add the receiving domain `in.returnly.app` (or a subdomain of your own). Don't use your main domain if it already receives mail.
   - At your DNS host, add the **MX record** Resend shows for it, priority 10.
   - In Resend → Webhooks, add `<APP_URL>/api/inbound/email` for the `email.received` event and copy its signing secret.
   - Set `INBOUND_EMAIL_DOMAIN` and `RESEND_WEBHOOK_SECRET` on Render. `RESEND_API_KEY` is reused to fetch each message.
2. **Google OAuth client** (Continue with Google and Gmail connect): in Google Cloud Console, enable the **Gmail API**.
   - Under Google Auth Platform, set up the consent screen (External, Testing) and add scopes `openid`, `email`, `profile` and `.../auth/gmail.readonly`. Add test users.
   - Create an **OAuth client ID** (Web application) with authorised redirect URIs `<APP_URL>/api/auth/google/callback` and `<APP_URL>/api/inbox/gmail/callback`.
   - Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
3. **Microsoft app registration** (Outlook connect): in Microsoft Entra admin center → App registrations → New registration.
   - Supported account types: "Accounts in any organizational directory and personal Microsoft accounts".
   - Redirect URI: Web, `<APP_URL>/api/inbox/outlook/callback`.
   - Under API permissions, add Microsoft Graph delegated `Mail.Read`, `offline_access`, `openid` and `email`.
   - Under Certificates & secrets, create a client secret.
   - Set `MICROSOFT_CLIENT_ID` (the Application ID) and `MICROSOFT_CLIENT_SECRET` (the secret's value). Client secrets expire, so note the date.
4. **Sign in with Apple**: in Apple Developer → Certificates, Identifiers & Profiles:
   - Create an App ID with "Sign in with Apple".
   - Create a **Services ID** (this is `APPLE_CLIENT_ID`). Enable Sign in with Apple on it with the domain and the return URL `<APP_URL>/api/auth/apple/callback`.
   - Create a **Key** with Sign in with Apple and download the `.p8` (it can be downloaded only once).
   - Set `APPLE_TEAM_ID`, `APPLE_KEY_ID` and `APPLE_PRIVATE_KEY` (the `.p8` contents, newlines as `\n`).

## Deploy on Render

`render.yaml` is a Blueprint for a Node web service plus a Postgres database. In Render choose **New → Blueprint**, pick this repository and apply. `DATABASE_URL` is wired from the database automatically and the server refuses to start in production without it.

Photos need a bucket. With Cloudflare R2: create a bucket (keep it private), create an R2 API token with Object Read & Write on that bucket, and set `S3_ENDPOINT` (`https://<account id>.r2.cloudflarestorage.com`), `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` on the Render service. Any S3-compatible service works; set `S3_REGION` if it isn't `auto`. For "Nearest drop-off", create a Google Cloud project, enable **Places API (New)**, create an API key restricted to that API, and set `GOOGLE_PLACES_API_KEY`. For reminders when the app is closed, set the three `VAPID_*` values (see above); for email reminders, password reset and the support address, the email values (see "Reminders that get it done"). Set `ADMIN_EMAILS` to the email addresses that may review policies. The server refuses to start in production without them; Render then keeps the previous version running. Render's free Postgres expires after 30 days; move it to a paid plan before real users rely on it. For purchases from email and Google / Apple sign-in, see Purchases from email → Setting it up.

## Project layout

- `index.html` (`landing.html` is a copy), `daily-meds.html`, `appointments.html`, `check-ins.html`, `your-circle.html`, `next-chapter.html` and `landing/` (their styles, fonts and pictures): the public site, with Log in / Sign up in its header.
- `signin.html`, `signup.html`, `forgot.html`, `reset.html`, `email.html` (links from reminder emails), `auth.js`: account pages, with Continue with Google / Apple when set up.
- `account.js`: sign-in gate for the app and background sync.
- `push.js`, `sw.js`, `manifest.webmanifest`: installable app, Web Push subscription, notification taps and buttons.
- `nudge.js`: the daily reminder's words, shared by the server and the app; `remind.js`: the Reminders preview and settings rows, notification buttons in the open app.
- `app.html` and its scripts: `app.js`, `features.js`, `klarna.js`, `precision.js`, `guided.js` (four-step return journey), `menu.js` (side menu, History, Settings, Support).
- `core.js`: date, eligibility and calendar logic.
- `server.js`, `server/`: account API (`app.js`), database access (`store.js`, `items.js`), account data and photos (`data.js`), file storage (`storage.js`), background jobs (`jobs.js`) and static file server; retailer policies are loaded and matched in `policies.js`, applied to items in `engine.js` and item categories are sorted in `classify.js`, receipts are read in `receipts.js`, return guides are built in `guide.js`, nearby drop-offs found in `places.js`, unknown stores looked up in `lookup.js`, lookups, reports, approvals and the freshness check run in `review.js`, daily reminders are chosen and pushed in `reminders.js`, emails are sent in `email.js`, and purchases from email come in through `inbox.js` (forwarding, Gmail, Outlook, matching), `mail.js` (shopping senders and reading an email) and `oauth.js` (Google, Microsoft and Apple OAuth, token encryption). Only top-level app files and `assets/` are publicly served.
- `policies/`: retailer return policies and their JSON schema.
- `tests/`: automated tests (`npm test`).
- `docs/`: product and design notes.

## Current limits

SMS is not connected. Reminders when the app is closed need notification permission (and, on iPhone, Adltrack on the Home Screen), or email set up on the server. Deadlines for stores without a checked policy are estimates, and looked-up policies stay unverified until an admin approves them. Some retailers block automated page fetches, so the freshness check logs those pages as not fetched and can't flag them. The Terms of service page is a draft and needs review before launch.
