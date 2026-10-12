# Returnly

Track purchases, return deadlines and refunds. Scan a receipt, tap what you're returning, and Returnly reminds you until the money is back.

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

- `server.js` serves the app and a JSON API under `/api`: `signup`, `login`, `logout`, `me`, `items` (GET, POST; PUT and DELETE `/api/items/:id`), `settings` (PUT: settings and profile), `purchases` (GET; PUT `/api/purchases/:id/receipt`), `receipts/read` (POST: read a scanned receipt), `files/:id` (GET), `items/:id/label` (PUT, DELETE: the QR code or return label), `places/nearest` (POST: nearest drop-offs), `push/key` (GET), `push/subscribe`, `push/unsubscribe` and `push/test` (POST: this device's Web Push subscription), `reminders/claim` (POST: the open app's daily notification), `data` (GET/PUT, the whole account in one document, kept for older versions of the app) and `account` (DELETE, needs the password).
- Passwords are hashed with scrypt. Sessions are random tokens in an HttpOnly, SameSite=Lax cookie (Secure in production); only a SHA-256 of each token is stored. Sessions last 30 days.
- The app keeps a full copy in the browser and uploads changes in the background, one item at a time (create, update, delete), plus settings and profile; the last write wins. Signing in on another device downloads the account's copy.
- Sign-in is rate limited per IP, and an email is locked for 15 minutes after 10 wrong passwords. Writes must be same-origin JSON.
- Pages are served with a strict Content Security Policy: scripts, styles, fonts, the service worker (`worker-src 'self'`) and the web app manifest (`manifest-src 'self'`) only from this site, no inline scripts, no framing. The service worker (`sw.js`) is a top-level file, so its scope is the whole site; it caches only the public app files and never `/api/` responses, so account data and private photos are never stored in its cache, and signing out clears the account from the browser as before.
- Not built yet: password reset by email (needs an email service) and sign-in with Google or Apple.

## Data

- Postgres tables (`server/store.js`): `purchases` (one row per receipt or order: store, channel, order number, purchase and delivery dates, source `receipt`/`email`/`manual`, retailer id, receipt file, and `receipt_pages` for the further pages of a long receipt) and `items` (one row per item). Item columns keep the app's field names and values one-to-one (`server/items.js` lists them; `window` is stored as `window_days`). A value that doesn't fit its column's type, such as an empty date, and any field the server doesn't know yet, is kept as-is in the item's `extra` column, so nothing is lost. Columns for later sessions are already there: retailer id, policy checked date, condition answers, return method, drop-off location, QR or label file, refund expected-by date.
- Settings and profile stay in `user_data`. Accounts saved in the old single-document format move into the tables when the server starts (and again on their next request, in case an older server wrote one meanwhile), without changing their last-updated time.
- Items the app adds from one scan share a purchase; other items get a purchase of their own.
- Photos (items, receipts, profile) are files, not part of the JSON (`server/storage.js`): an S3-compatible bucket such as Cloudflare R2 in production, `data/files/` in development. The app gets a private `/api/files/<id>` URL that is served only to the signed-in owner (anyone else gets 404). Files are checked to be JPEG, PNG, WebP or PDF and up to 10 MB.
- Background jobs (`server/jobs.js`) are queued in Postgres and run inside the Node server. Jobs are retried with backoff, each job is claimed by one server at a time, and one left running by a crashed server is picked up again. `maintenance.cleanup` (the example) runs every 6 hours and clears expired sessions; `files.delete` retries deleting stored files that couldn't be removed straight away. `receipts.cleanup` (every 6 hours) deletes receipts that were scanned but never saved with an item, two days later. `reminders.dispatch` (every minute) and `reminders.send` deliver the daily reminder by Web Push (see below).
- `push_subscriptions` (one row per browser or installed app that allowed notifications, with its time zone) and `reminder_days` (the last local date each account's daily reminder went out).
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
- Returns 101: a row under "How Returnly works" on Support opens a page on receipts, store credit vs. refund, drop-off vs. mail, final sale and keeping proof.

## Reminders when the app is closed

- Installable: `manifest.webmanifest` (icons in `assets/`, drawn like the favicon) and a service worker, `sw.js`, which caches the app shell (network first, so a new version shows straight away; the cache is used when offline). On iPhone, web push only works once Returnly is added to the Home Screen (Share → Add to Home Screen, iOS 16.4 or later); the Reminders page says so.
- Web Push with VAPID keys (`web-push` library). The device subscribes at the existing permission moments: "Enable browser notifications" / "Send a test notification" on Reminders, and "Start return". Each open of the app refreshes the subscription and the device's time zone. The server only sends to the browsers' push services (Google, Mozilla, Apple, Microsoft); subscriptions the push service reports as expired (404/410) are deleted. Signing out removes this device's subscription; deleting the account removes them all.
- One rule, one reminder a day: `server/reminders.js` picks the day's reminder (the most urgent item, "Plus N other return windows", skipping examples, items sent back, kept or received, and items snoozed with `snoozeUntil`). Every minute `reminders.dispatch` finds accounts whose `settings.time` has come in their time zone (with `settings.daily` on) and queues `reminders.send`. The open app asks `POST /api/reminders/claim` instead of choosing for itself, and does so only on devices without push. Both claim the user's local date in `reminder_days` first, so the user never gets the reminder twice. If no device could be reached, the day is released and the send is retried.
- Tapping a reminder opens that item's Return step (`app.html?remind=<item id>`, or the already open window).
- Without VAPID keys push stays off and the open app's daily notification works as before.

Generate the keys once (keep the private key secret):

```sh
npx web-push generate-vapid-keys
```

Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (a `mailto:` address push services can contact) on the Render service, and as environment secrets for development. Changing the keys later makes every device subscribe again the next time the app is opened.

## Deploy on Render

`render.yaml` is a Blueprint for a Node web service plus a Postgres database. In Render choose **New → Blueprint**, pick this repository and apply. `DATABASE_URL` is wired from the database automatically and the server refuses to start in production without it.

Photos need a bucket. With Cloudflare R2: create a bucket (keep it private), create an R2 API token with Object Read & Write on that bucket, and set `S3_ENDPOINT` (`https://<account id>.r2.cloudflarestorage.com`), `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` on the Render service. Any S3-compatible service works; set `S3_REGION` if it isn't `auto`. For "Nearest drop-off", create a Google Cloud project, enable **Places API (New)**, create an API key restricted to that API, and set `GOOGLE_PLACES_API_KEY`. For reminders when the app is closed, set the three `VAPID_*` values (see above). The server refuses to start in production without them; Render then keeps the previous version running. Render's free Postgres expires after 30 days; move it to a paid plan before real users rely on it.

## Project layout

- `index.html`, `landing.css`: home page with Sign in / Sign up.
- `signin.html`, `signup.html`, `auth.js`: account pages.
- `account.js`: sign-in gate for the app and background sync.
- `push.js`, `sw.js`, `manifest.webmanifest`: installable app, Web Push subscription and notification taps.
- `app.html` and its scripts: `app.js`, `features.js`, `klarna.js`, `precision.js`, `guided.js` (four-step return journey), `menu.js` (side menu, History, Settings, Support).
- `core.js`: date, eligibility and calendar logic.
- `server.js`, `server/`: account API (`app.js`), database access (`store.js`, `items.js`), account data and photos (`data.js`), file storage (`storage.js`), background jobs (`jobs.js`) and static file server; retailer policies are loaded and matched in `policies.js`, applied to items in `engine.js` and item categories are sorted in `classify.js`, receipts are read in `receipts.js`, return guides are built in `guide.js`, nearby drop-offs found in `places.js` and daily reminders chosen and pushed in `reminders.js`. Only top-level app files and `assets/` are publicly served.
- `policies/`: retailer return policies and their JSON schema.
- `tests/`: automated tests (`npm test`).
- `docs/`: product and design notes.

## Current limits

Automatic return-policy research for stores outside `policies/` and SMS are not connected. Reminders when the app is closed need notification permission (and, on iPhone, Returnly on the Home Screen). Deadlines for stores without a checked policy are estimates. The Terms of service page is a draft and needs review before launch.
