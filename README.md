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

- `server.js` serves the app and a JSON API under `/api`: `signup`, `login`, `logout`, `me`, `items` (GET, POST; PUT and DELETE `/api/items/:id`), `settings` (PUT: settings and profile), `purchases` (GET; PUT `/api/purchases/:id/receipt`), `files/:id` (GET), `data` (GET/PUT, the whole account in one document, kept for older versions of the app) and `account` (DELETE, needs the password).
- Passwords are hashed with scrypt. Sessions are random tokens in an HttpOnly, SameSite=Lax cookie (Secure in production); only a SHA-256 of each token is stored. Sessions last 30 days.
- The app keeps a full copy in the browser and uploads changes in the background, one item at a time (create, update, delete), plus settings and profile; the last write wins. Signing in on another device downloads the account's copy.
- Sign-in is rate limited per IP, and an email is locked for 15 minutes after 10 wrong passwords. Writes must be same-origin JSON.
- Not built yet: password reset by email (needs an email service) and sign-in with Google or Apple.

## Data

- Postgres tables (`server/store.js`): `purchases` (one row per receipt or order: store, channel, order number, purchase and delivery dates, source `receipt`/`email`/`manual`, retailer id, receipt file) and `items` (one row per item). Item columns keep the app's field names and values one-to-one (`server/items.js` lists them; `window` is stored as `window_days`). A value that doesn't fit its column's type, such as an empty date, and any field the server doesn't know yet, is kept as-is in the item's `extra` column, so nothing is lost. Columns for later sessions are already there: retailer id, policy checked date, condition answers, return method, drop-off location, QR or label file, refund expected-by date.
- Settings and profile stay in `user_data`. Accounts saved in the old single-document format move into the tables when the server starts (and again on their next request, in case an older server wrote one meanwhile), without changing their last-updated time.
- Items the app adds from one scan share a purchase; other items get a purchase of their own.
- Photos (items, receipts, profile) are files, not part of the JSON (`server/storage.js`): an S3-compatible bucket such as Cloudflare R2 in production, `data/files/` in development. The app gets a private `/api/files/<id>` URL that is served only to the signed-in owner (anyone else gets 404). Files are checked to be JPEG, PNG, WebP or PDF and up to 10 MB.
- Background jobs (`server/jobs.js`) are queued in Postgres and run inside the Node server. Jobs are retried with backoff, each job is claimed by one server at a time, and one left running by a crashed server is picked up again. `maintenance.cleanup` (the example) runs every 6 hours and clears expired sessions; `files.delete` retries deleting stored files that couldn't be removed straight away.
- "Delete my account" deletes the account's rows in every table and its stored files.

## Retailer return policies

`policies/` holds the checked US return policies for Amazon, Walmart, Target, Costco, Best Buy, The Home Depot, Apple, Nike, Zara, SHEIN and Fashion Nova, one file per store (for example `policies/amazon.json`).

- `item` fills the existing item fields (`window`, `basis`, `outcome`, `requirement`, `url`, `conditions`, `processing`; `policySource` is built from the name and checked date). Next to it: category exceptions, membership programs, holiday extensions, receipt rules, refund timing and fees, return methods with their steps and what each needs (label, box, QR code, printer), and marketplace-seller caveats.
- Every fact has the official source URL and the date it was checked. Anything the official page doesn't confirm, or where the retailer's own pages disagree, is `"unknown"` and listed under `unknowns`. Where pages disagree on a window, the shorter one is kept.
- `policies/schema.json` is the JSON schema. The server checks every file at startup and won't start if one is invalid or a fact has no source.
- Versions: to change a policy, move the current file to `policies/history/<id>.v<N>.json`, then edit `<id>.json` and raise its `version`. On startup every version is loaded into Postgres (`retailers`, `retailer_policies`); past versions are kept, and a changed file that keeps its old version number is refused.
- API (no sign-in needed): `GET /api/retailers` lists stores; `GET /api/retailers/:id` returns the full policy, the item fields it fills and its versions; `GET /api/retailers?match=WAL-MART%20%231234` matches a receipt or card-statement name (store numbers, `*` reference codes and `.com` are ignored).
- Nothing in the app reads these yet; the policy engine comes next.

## Deploy on Render

`render.yaml` is a Blueprint for a Node web service plus a Postgres database. In Render choose **New → Blueprint**, pick this repository and apply. `DATABASE_URL` is wired from the database automatically and the server refuses to start in production without it.

Photos need a bucket. With Cloudflare R2: create a bucket (keep it private), create an R2 API token with Object Read & Write on that bucket, and set `S3_ENDPOINT` (`https://<account id>.r2.cloudflarestorage.com`), `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` on the Render service. Any S3-compatible service works; set `S3_REGION` if it isn't `auto`. The server refuses to start in production without them; Render then keeps the previous version running. Render's free Postgres expires after 30 days; move it to a paid plan before real users rely on it.

## Project layout

- `index.html`, `landing.css`: home page with Sign in / Sign up.
- `signin.html`, `signup.html`, `auth.js`: account pages.
- `account.js`: sign-in gate for the app and background sync.
- `app.html` and its scripts: `app.js`, `features.js`, `klarna.js`, `precision.js`, `guided.js` (four-step return journey), `menu.js` (side menu, History, Settings, Support).
- `core.js`: date, eligibility and calendar logic.
- `server.js`, `server/`: account API (`app.js`), database access (`store.js`, `items.js`), account data and photos (`data.js`), file storage (`storage.js`), background jobs (`jobs.js`) and static file server; retailer policies are loaded and matched in `policies.js`. Only top-level app files and `assets/` are publicly served.
- `policies/`: retailer return policies and their JSON schema.
- `tests/`: automated tests (`npm test`).
- `docs/`: product and design notes.

## Current limits

Receipt reading (OCR), automatic return-policy research, SMS and background push are not connected. Deadlines are estimates until the user confirms the retailer's policy. The Terms of service page is a draft and needs review before launch.
