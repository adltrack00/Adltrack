# Returnly build plan: 12 sessions

Run these one at a time, in order. To start a session, paste this line into a new session, changing the number and name:

> Read docs/build-plan.md and build Session 1 (Data foundation) exactly as written there. Do not redesign the app; keep the current look and layout and only make things work. When done, open a pull request.

**Before starting the next session, merge the previous session's pull request into `main`.** New sessions start from `main`, so they only see work that has been merged.

Some sessions need accounts or keys that only you can create (an AI API key, an email service, Google sign-in). Each session names what it needs. Add these as environment secrets in your session settings and in Render. If a session can't reach an outside service, it will tell you which network setting to change.

## Rules for every session

1. **Do not redesign the app.** Keep the current look, layout, typography, colours and screen arrangement exactly as they are. This work makes the existing screens work. Add new UI only where a feature has no screen yet, and build it from the existing styles and components.
2. **Don't rebuild what exists.** Read "Already in the app" below and open the screens it names before writing code. Extend those screens and data fields; never add a second version of them.
3. **Policy facts are never invented.** Every fact shows its source and last-checked date. When unsure, use the earlier deadline and say so.
4. Keep the four-step journey: Scan → Item → Return → Get paid.
5. Match the existing code style. Add tests, run `npm test`, update the README, and open a pull request with phone and desktop screenshots.

## Already in the app (checked October 11, 2026)

Stack: vanilla JS front end (`app.html` plus layered scripts: `app.js` → `features.js` → `klarna.js` → `precision.js` → `guided.js` → `menu.js`; each later file overrides earlier render functions), Node 22 server (`server.js`, `server/app.js`, `server/store.js`), Postgres on Render (`render.yaml`), tests in `tests/` (`npm test`).

**Accounts and sync**
- Sign up (two steps: name, email, password, then daily reminder time), sign in, sign out, delete account (Settings → Security and privacy). Passwords are hashed with scrypt; sessions use HttpOnly cookies; sign-in is rate limited.
- API: `/api/signup`, `/api/login`, `/api/logout`, `/api/me`, `/api/data` (GET/PUT), `/api/account` (DELETE), `/api/health`.
- Purchases, reminder settings and profile are kept in the browser and uploaded as one JSON document per account (`user_data`, last write wins). Photos are stored inside that JSON.
- Not built: password reset, Google/Apple sign-in, photo storage outside the database.

**Menu drawer (☰ at top left)**
- "Welcome, {name}!", email, and totals: **Returned** (count), **Refunds** ($), **Store credit** ($).
- Links: Your purchases, Your returns, Your results, Reminders, History, Settings, Support. Version number at the bottom.

**Your purchases (home)**
- Avatar, "{Name}'s purchases", filter tabs **All purchases / In progress / Returned**, a masonry photo grid of cards (photo, name, store · price, days left, "Return item ↗" / "Return instead" / "Open ↗").
- Example purchases with "Start with my purchases ↗" to clear them. Dark footer with links.

**Your returns** (`calendar` view): month calendar with ← Today →, deadlines in the cells (dashed when unconfirmed), tap a day to filter, and a "This month's deadlines" list.

**Your results** (`wallet` view): **Refunds received**, **Store credit received**, **Awaiting an outcome** (count), an "Awaiting your comeback" list of sent-back items, an "Actually back" list, and "Export your records ↓" (CSV).

**Reminders**
- Daily reminder time, a "daily check-in" toggle, browser notification permission state, "Enable browser notifications" / "Send a test notification", a preview of the daily nudge, an explainer of start/ship/arrive deadlines, and "Export reminders ↗" (.ics calendar file with a daily alert until the deadline) for each confirmed item.
- While the app is open it sends one browser notification a day at the chosen time (the most urgent item plus "Plus N other return windows"). Items can carry `snoozeUntil`.
- Tapping "Start return" turns daily reminders on and asks for notification permission. The promise shown to users is "We'll remind you daily until it's complete."
- Not built: notifications while the app is closed, email or SMS.

**History**: returned, sent-back and kept items with "$X back".

**Settings**: My profile (first name, profile photo), Security and privacy (explainer plus delete account), Terms of service (draft), Sign out.

**Support**: "How Returnly works" guide, four FAQs, and "Email support isn't set up yet."

**The return journey** (tab bar Scan · Item · Return · Get paid, "← Back", avatar shortcut)
- **Scan**: live camera with a frame, shutter, Upload (JPG/PNG/WebP/PDF up to 10 MB), Retry camera, "Try an example instead". The receipt file is accepted but **not read**.
- **Item**: card grid with photo (tap to add), name, price, and "Return item" / "✓ Returning" toggles (or "Continue" for one item). Untapped items are saved as kept. Store defaults to "Store not added", the date to today, and the window to 30 days from purchase.
- **Return**: item card with an editable store line, an editable "Return by" date with days left, "Open retailer's return portal ↗" (only when a URL is saved), and Continue.
- **Get paid**: store, "Expected back", then "Start return" → "Amount received $" → "Return complete".

**Item data fields that already exist** (reuse them; don't add duplicates): `name, retailer, price, category, channel (online/store), purchased, delivered, window, basis (purchase/delivery), outcome (refund/credit/exchange/final/unknown), requirement (start/ship/arrive/store/unknown), url, conditions, processing, confirmed, policySource, next, status (deciding/started/shipped/received/kept), intent, received, returnedOn, packing {receipt, condition, packed, label, proof}, taskDone, snoozeUntil, dateSet, photo, demo`.

**In the code but not reachable from today's screens** (reuse rather than rewrite): the old "Add a purchase" form with policy fields, the Fashion Nova policy reference (30 days from delivery, store credit, checked Oct 8, 2026), the policy editor (URL, basis, processing time, conditions), the packing checklist (receipt, condition, packed, label, proof), CSV import with template, and JSON backup. Logic for deadlines, eligibility and calendar files is in `core.js`.

## The 12 sessions

| # | Session | What it adds (that doesn't exist yet) |
|---|---|---|
| 1 | Data foundation | Items stored per row on the server so reminders can run while the app is closed; photos out of the database; background jobs |
| 2 | Retailer policy database | Checked policies for the 10 launch stores plus Fashion Nova |
| 3 | Policy engine | Automatic "returnable? by when? cash or credit?" filling the existing item fields |
| 4 | Receipt reading | The Scan step actually reads the receipt and fills the Item step |
| 5 | How-to guides and drop-off finder | Step-by-step instructions, saved QR codes and the nearest drop-off, inside the Return step |
| 6 | Unknown stores and keeping policies current | Any store looked up; policies re-checked; "this is wrong" reports |
| 7 | Installable app and background push | The existing daily reminder reaches the phone when the app is closed |
| 8 | Reminders that get it done | Smarter content and actions for the existing reminders, plus email backup and password reset |
| 9 | Email order capture: forwarding address | Forward an order email and the items appear |
| 10 | Email order capture: connect your inbox | Gmail/Outlook connect, plus Google and Apple sign-in |
| 11 | Refund follow-up and missed money | Overdue refunds chased, store-credit expiry, money lost to missed windows, all added to the existing Your results page and menu totals |
| 12 | iPhone and Android apps | App Store and Play Store apps with native push, camera and share sheet |

---

## 1. Data foundation

```
Read the "Rules for every session" and "Already in the app" sections of docs/build-plan.md first and follow them. Do not redesign the app; there are no visible changes in this session.

Returnly helps US shoppers return purchases before the return window closes. Today each account's purchases, settings and profile are one JSON document in `user_data` (last write wins), with photos inside it. Later sessions need the server to read items by itself: reminders while the app is closed, email capture, receipt reading and policy matching.

Do this:
1. Add Postgres tables for purchases (one row per receipt or order: store, channel, order number, purchase and delivery dates, source receipt/email/manual) and items. Item columns map one-to-one to the item fields listed in "Already in the app". Keep the same names and values so the front end barely changes. Leave room for later fields: retailer id, policy checked date, condition answers, return method, drop-off location, QR or label attachment, refund expected-by date.
2. Migrate every existing `user_data` payload into the new tables without losing anything, and keep the app working throughout. The browser keeps its offline copy. Sync moves from the whole-document PUT to per-item create, update and delete calls, while `/api/data` keeps working for older clients until they update.
3. Move photos (item photos, receipt files and the profile photo) into object storage behind a small storage interface: S3-compatible such as Cloudflare R2 in production, a local folder in development. Serve them only to their owner. Update the CSP only as far as needed.
4. Add a Postgres-backed background job runner inside the Node server for later sessions (reminders, email processing). Include one example job and a test.
5. Make "Delete my account" also delete the new rows and stored files.
6. Update render.yaml, the README and tests. Keep the existing security rules: same-origin JSON writes, the strict CSP, and HttpOnly cookies.

Needs from me: R2/S3 bucket credentials for production; development works without them.
When done, run `npm test`, check that every screen still looks identical at phone and desktop widths, and open a pull request explaining the migration and how to roll back.
```

## 2. Retailer policy database

```
Read the "Rules for every session" and "Already in the app" sections of docs/build-plan.md first and follow them. Do not redesign the app.

Build the checked US return-policy database for the launch retailers: Amazon, Walmart, Target, Costco, Best Buy, Home Depot, Apple, Nike, Zara and Shein. Also move the existing Fashion Nova reference (now in app.html and app.js) into it, as the 11th store. The app reads facts from this data and never makes them up.

1. Design the policy schema so it fills the item fields that already exist (`window`, `basis`, `outcome`, `requirement`, `url`, `conditions`, `processing`, `policySource`). Add only what those fields can't hold:
   - Category exceptions (electronics, opened items, final sale, non-returnable categories).
   - Membership variations.
   - Holiday extended-return rules.
   - Receipt requirements.
   - Refund timing and fees.
   - Return methods, each with its steps: mail, drop-off partners, in store; whether a label, box, QR code or printer is needed.
   - Marketplace or third-party seller caveats.
   - Source URL and last-checked date for every fact.
   Store it in versioned files in the repository (for example `policies/amazon.json`), validated by a JSON schema and loaded into Postgres. Keep past versions.
2. Research each retailer's current official US policy pages on the web. Record only what the official source says, with the URL and today's date. Mark anything you couldn't confirm as unknown; never guess.
3. Add a read API (`/api/retailers`, `/api/retailers/:id`) and store-name matching that handles aliases such as "AMZN Mktp", "Amazon.com", "WAL-MART #1234" and "Target T-1234".
4. Tests: every file passes the schema, every fact has a source, and alias matching works.

No screen changes in this session, apart from replacing the hard-coded Fashion Nova text with data from the new file.
When done, open a pull request with a table of the 11 retailers, their key windows and the sources, so I can spot-check them.
```

## 3. Policy engine: "Is this returnable, by when, and what do I get back?"

```
Read the "Rules for every session" and "Already in the app" sections of docs/build-plan.md first and follow them. Do not redesign the app.

Build the engine that applies a retailer's policy (from the policies/ database) to a specific item, and wire it into the existing journey.

1. Input: the item, its retailer's policy, and the user's answers to a few condition questions (opened? tags on? original packaging? member of the store's program?). Output, written into the existing item fields (`window`, `basis`, `outcome`, `requirement`, `url`, `conditions`, `processing`, `policySource`, `confirmed`) plus:
   - Returnable: yes, no, or "not sure" with the reason.
   - Whether a holiday extension applies.
   - The facts used, each with its source and checked date.
2. Classify items into the policy's categories from the item name, using a small AI call through the server (load the claude-api skill to choose the model and set it up; key in ANTHROPIC_API_KEY). The existing `category` field stays; add a finer policy category beside it.
3. Safety: when anything is unknown, use the earlier possible deadline and say why. Never mark "yes" unless the fact behind it is checked. Show "not sure" plainly.
4. On the existing **Return** card, the "Return by" line and days left come from the engine. Show at most two or three condition questions as lines in the card's existing style, and only the ones that change the answer for this store and category. Add a single line for what you get back (for example "Store credit · about 7–10 days"). Keep the existing editable store line and date override; a manual date sets `dateSet` as it does now.
5. The existing calendar, Your results totals, reminder preview and menu totals already read these fields, so they should start showing real data with no changes. Verify that they do.
6. Thorough tests: delivery vs. purchase start, category exceptions, membership, holiday extensions, final sale, unknown inputs and date edge cases (follow the style of tests/core.test.cjs).

When done, open a pull request with phone screenshots of the Return card for three different retailers.
```

## 4. Receipt reading

```
Read the "Rules for every session" and "Already in the app" sections of docs/build-plan.md first and follow them. Do not redesign the app.

The Scan step already has the camera, shutter, Upload button and example; the file is accepted but not read. Make it read the receipt and fill the existing Item step.

1. Send the photo, screenshot or PDF to the server. The browser CSP only allows same-origin requests, so all AI calls happen on the server. Use a vision-capable Claude model with structured output (load the claude-api skill; key in ANTHROPIC_API_KEY).
2. Extract: store name and location, purchase date and time, order or transaction number, each line item (name, quantity, price, item code if printed), totals, payment method type (never the card number), and any return-policy text printed on the receipt, word for word.
3. Fill the existing draft (`draft.retailer`, `draft.purchased`, `draft.channel`, `draft.products`) so the Item step opens already showing each item's name and price. Today the store defaults to "Store not added" and the date to today; use the real values instead. Show a short reading state on the Scan screen in its current style while waiting.
4. Match the store to the retailer database and run the policy engine. Printed policy text becomes a source ("printed on your receipt"), especially for stores we don't have.
5. Fields the model wasn't sure about are highlighted in the existing card for the user to fix, never silently filled. Handle long receipts across several photos, blurry or cropped images (ask for a retake with a reason), and receipts with no store name.
6. Privacy: no card numbers. The receipt image is stored privately with the purchase (storage from session 1), and the user can delete it.
7. Tests with realistic fixture receipts and a mocked AI response; note the cost per scan in the PR.

Needs from me: ANTHROPIC_API_KEY as a secret.
When done, open a pull request with phone screenshots of Scan → Item filled in from a real-looking receipt.
```

## 5. How-to-return guides and drop-off finder

```
Read the "Rules for every session" and "Already in the app" sections of docs/build-plan.md first and follow them. Do not redesign the app.

Users don't know how to return things, and that effort is why they give up. The Return step already has the item card, store, "Return by" and an "Open retailer's return portal ↗" link (shown only when a URL exists). Turn it into a clear guide for this item at this store, inside that same card and screen.

1. Under the existing lines, add a short numbered guide built from the retailer's return-method data, for example "Open Amazon → Your Orders → Return items → choose a drop-off → show the QR code; no box or label needed". When several methods exist, show the easiest first and say what each needs (box, label, printer, receipt, ID).
2. Fill `url` from the policy data so the existing portal link always appears, with an order-specific link when the order number is known.
3. Reuse the existing packing checklist (`packing`: receipt, condition, packed, label, proof) instead of building a new one. Show it in the Return card, adjusted per method (for example, "label" doesn't apply to a QR-code drop-off).
4. Let users attach the QR code or label the retailer gives them (photo, screenshot or PDF) to the item, and show it full-screen at the counter.
5. Drop-off finder: using the device's location (asked only when needed), show the nearest accepted locations for this retailer and method with distance, hours and a directions link. Use a places provider through the server (pick one and explain why; key as a secret). Cache results.
6. Education: add a "Returns 101" entry to the existing **Support** page, in the same style as its "How Returnly works" row and FAQ list (receipts, store credit vs. refund, drop-off vs. mail, final sale, keeping proof). Update the FAQ answers that are now out of date.
7. Tests for guide generation for every launch retailer.

Needs from me: a places API key (the session will tell me which).
When done, open a pull request with phone screenshots of the Return step for Amazon, Target and Zara.
```

## 6. Unknown stores and keeping policies current

```
Read the "Rules for every session" and "Already in the app" sections of docs/build-plan.md first and follow them. Do not redesign the app.

Make Returnly work for any US store, and keep the checked policies accurate over time.

1. Live lookup: when a receipt or email names a store we don't have and there's no printed policy, use Claude with web search on the server (load the claude-api skill) to find the official return-policy page and fill the same schema with source URLs. Save it as "unverified". Show it on the Return card with a clear "please confirm" note, using the same unconfirmed treatment the app already uses (for example the "Date unconfirmed" label and dashed calendar entries). Unverified data never produces "yes, returnable" by itself and always uses the safer, earlier deadline.
2. Cache lookups so the next user who buys from that store gets an instant answer. Track how many users hit each store.
3. Add a small "Is this wrong?" link next to policy facts on the Return card, with an optional note, saved for review.
4. A small admin page, for admin accounts only, built from the existing Settings page components. It shows unverified stores ranked by usage, user reports, and a side-by-side view to approve a policy into the checked database.
5. Freshness job (job runner from session 1): weekly, re-fetch each checked retailer's source pages, detect meaningful changes, and flag them for review instead of changing anything automatically. Flag holiday-season changes in October to December.
6. When an approved change moves a deadline earlier, recompute affected active items and tell those users.
7. Tests with mocked web results.

When done, open a pull request explaining the review workflow and how I get notified about flagged changes.
```

## 7. Installable app and background push

```
Read the "Rules for every session" and "Already in the app" sections of docs/build-plan.md first and follow them. Do not redesign the app.

The Reminders page, reminder time, daily toggle, permission request (on "Start return"), "Send a test notification" and the daily notification already exist, but they only work while the app is open. People who forget don't open the app. Make the same reminders arrive when the app is closed.

1. Make the web app installable: web app manifest, icons from the existing favicon style, and a service worker that caches the app shell. Add a short "Add Returnly to your Home Screen" tip in the existing Reminders page, in its current card style. On iPhone, web push only works after adding to the Home Screen, so say that.
2. Web Push with VAPID keys. Reuse the existing permission moments (the Reminders page button and "Start return"). Store subscriptions per device, remove expired ones, and send from the server with the job runner, at the user's existing `settings.time` in their time zone.
3. Move the daily-reminder choice of item (today in app.js: the most urgent item plus "Plus N other return windows", respecting `snoozeUntil`) to the server, so push and the in-app notification share one rule and the user never gets both.
4. Tapping a notification opens that item's Return step.
5. Update the existing honesty notes that say background push isn't connected (Reminders page, Support FAQ, How it works guide, sign-up step 2, README). Keep calendar export as an extra option.
6. Update the CSP and README security notes for the service worker. Tests for subscription storage and sending (mock the push service).

Needs from me: VAPID keys (the session will show me how to generate them) as secrets.
When done, open a pull request with steps to test on a real iPhone and Android phone.
```

## 8. Reminders that get it done

```
Read the "Rules for every session" and "Already in the app" sections of docs/build-plan.md first and follow them. Do not redesign the app.

The app promises "We'll remind you daily until it's complete", and push now works when the app is closed (session 7). Keep that promise and the existing Reminders page. Make each reminder make the return effortless right now, not just say "3 days left".

1. Keep one reminder a day per user at their chosen time, grouping items ("2 returns due this week: $84 total"). Make the wording escalate as the deadline nears (the existing preview already distinguishes "every day", "the day before" and "deadline day"; build on that). Add quiet hours and a "Gentle" option on the existing Reminders page (only when added, at the halfway point, 7, 3 and 1 days left, and on the day) next to the current daily toggle.
2. Content: item name and photo, money at stake, days left, the single next step from the how-to guide ("Tap for your QR code"), and the nearest drop-off with distance when known. Notification actions: "Show QR code", "Snooze until tomorrow" (the existing `snoozeUntil`), "I sent it back" (status `shipped`), "I'm keeping it" (status `kept`).
3. Reminders stop when an item is sent back, kept or received, as they do today. After "sent back", hand over to refund follow-up (session 11).
4. Email backup through a transactional email service (pick one and explain why): sent when push isn't set up, or when a reminder hasn't been opened by 3 days before the deadline. Use the same content and a one-click unsubscribe for each type. Add the channel choice to the existing Reminders page.
5. Password reset by email on the existing sign-in page (the README lists it as missing). Also replace "Email support isn't set up yet" on the Support page with a working contact address.
6. Last chance: on deadline day, if the store accepts in-store returns, say so ("Still possible today: Target closes at 10pm, 1.2 mi away").
7. Update the existing reminder preview card to show the new content. Tests for the scheduler: time zones, quiet hours, grouping, snooze, stopping and daylight saving changes.

Needs from me: an email service API key and a verified sending domain.
When done, open a pull request with screenshots of each reminder type (push and email).
```

## 9. Email order capture: forwarding address

```
Read the "Rules for every session" and "Already in the app" sections of docs/build-plan.md first and follow them. Do not redesign the app.

Most online purchases arrive with an order email. Let users add purchases without taking a photo.

1. Give each user a private forwarding address (for example `u-7f3k2@in.returnly.app`) using our email provider's inbound feature. Show it as a new row on the existing Settings page ("Add purchases by email"), opening a sub-page in the same style as "My profile". The sub-page has the address, a copy button and short instructions for Gmail, Outlook and Apple Mail.
2. Parse each forwarded email on the server (job runner plus Claude; load the claude-api skill and reuse the receipt-reading extraction from session 4). Recognise order confirmations, shipping and delivery notices, return confirmations and refund notices.
3. Match emails to existing purchases by store and order number:
   - A delivery email sets `delivered` and recomputes the deadline.
   - A return-started email sets status `started` or `shipped`.
   - A refund email sets `received`, the amount and the date, and closes the return, exactly as "Return complete" does today.
4. New orders open the existing **Item** step (the same card grid with "Return item" toggles), pre-filled from the email. Until the user looks, they wait as cards on Your purchases with a small "New from email" label in the existing card-label style. Nothing becomes a return without the user's tap.
5. Security: accept mail only for valid addresses, check that the forward came from the user's verified addresses, ignore non-shopping email, store only the extracted fields, and let users get a new address.
6. Tests with realistic fabricated emails from the launch retailers (no real personal data).

Needs from me: DNS records for the inbound email domain (the session will list them).
When done, open a pull request with screenshots of forwarding an order and seeing it appear.
```

## 10. Email order capture: connect your inbox

```
Read the "Rules for every session" and "Already in the app" sections of docs/build-plan.md first and follow them. Do not redesign the app.

Let users connect Gmail or Outlook once, so every order, delivery and refund is captured with no effort. Reuse the session 9 parser and the "Add purchases by email" settings sub-page; add "Connect Gmail" and "Connect Outlook" there.

1. Gmail: Google OAuth with read-only Gmail access. Search only shopping emails from known retailers and senders: the last 90 days when connecting, then continuously through Gmail push notifications or polling.
2. Outlook: the same through Microsoft sign-in and Microsoft Graph.
3. Add "Continue with Google" and "Continue with Apple" buttons to the existing sign-in and sign-up pages, in their current style, kept separate from inbox access.
4. Privacy is the product: request the narrowest access available, never store full email bodies (only extracted purchase fields and the message ID), encrypt tokens at rest, offer a clear "Disconnect and delete", and show a plain-English explanation before connecting. Add a paragraph to the existing Security and privacy page. Make "Delete my account" revoke the tokens.
5. Write docs/google-verification.md covering what Google requires before public launch: Gmail read access is a restricted scope that needs app verification and a yearly third-party security assessment. List the steps, costs and timing. Until then the app runs in testing mode (up to 100 test users), and the forwarding address stays the default for everyone else.
6. Tests with mocked Gmail and Graph responses.

Needs from me: a Google Cloud project with OAuth credentials, a Microsoft app registration and Apple sign-in keys (the session will list exact steps).
When done, open a pull request with screenshots of the connect flow and the verification checklist.
```

## 11. Refund follow-up and missed money

```
Read the "Rules for every session" and "Already in the app" sections of docs/build-plan.md first and follow them. Do not redesign the app.

The money screens already exist; do not build a new dashboard. The menu drawer shows Returned / Refunds / Store credit. **Your results** shows Refunds received, Store credit received, Awaiting an outcome, the "Awaiting your comeback" and "Actually back" lists, and CSV export. History lists completed items. Add only what's missing, inside those screens and in their existing styles.

1. Refund follow-up: when an item is sent back, set an expected-by date from the policy's refund timing (`processing`). If no refund email or "Return complete" arrives by then, mark it "Overdue" in the existing "Awaiting your comeback" list (same card-label style as "3 days left"). Send a reminder through the existing reminder system with the retailer's refund-status link or contact.
2. Money still in reach: add one stat in the same row style on Your results for the value of active returns not yet sent back, counted only from confirmed policies (the old `totalFor` logic in features.js already computes "potential refunds/credit"; reuse it).
3. Missed money: when a window passes on an item marked for return, record it. Add one stat in the same style ("Missed windows · $X") and list those items under it. Where the policy allows, suggest options (manufacturer warranty, contacting the store) without promising anything; the Support FAQ already has "I missed the return window" copy to reuse.
4. Store-credit balances: on items refunded as store credit, let the user note a gift-card or credit expiry date, show it in the existing "Actually back" row, and send a reminder before it expires.
5. Compute every new number with the existing helpers (`resultValues` in klarna.js feeds the menu drawer; `totalFor` in features.js feeds Your results) so the drawer and Your results always agree. Add no separate money calculation.
6. Optional, only if it fits the existing History page style: a "This year" line ("You got $412 back in 2026").
7. Tests for every total, overdue logic and expiry reminders.

When done, open a pull request with before and after screenshots of Your results and the menu drawer, showing that nothing was redesigned.
```

## 12. iPhone and Android apps

```
Read the "Rules for every session" and "Already in the app" sections of docs/build-plan.md first and follow them. Do not redesign the app; the native apps must look exactly like the web app.

Ship Returnly to the App Store and Google Play while keeping one codebase with the web app.

1. Wrap the existing front end with Capacitor (explain if you'd choose differently) for iOS and Android. The web app keeps working exactly as before.
2. Native push through Apple Push Notification service and Firebase Cloud Messaging, plugged into the existing reminder system next to web push, with the same actions.
3. Use the native camera on the existing Scan screen (same layout), with document edge detection if available.
4. Share sheet: share an order email, screenshot or PDF receipt from any app into Returnly, and it goes through receipt reading into the Item step.
5. A home-screen widget showing "Next return due" if practical.
6. Sign in with Apple is required on iOS when other social sign-ins exist; confirm it's in place.
7. App store readiness: icons, splash screens, privacy labels and data-safety forms matching what we actually collect, review notes explaining email access, and docs/app-store-release.md with the steps I take to submit.
8. Build instructions for both platforms in the README.

Needs from me: an Apple Developer account, a Google Play developer account and a Firebase project (the session will list exact steps). iOS builds need a Mac; the session will explain options such as a cloud build service.
When done, open a pull request with simulator screenshots and the release checklist.
```
