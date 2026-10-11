# Returnly build plan: 12 sessions

Run these one at a time, in order. To start a session, paste this into a new session, changing the number and name:

> Read docs/build-plan.md and build Session 1 (Data foundation) exactly as written there. Follow the rules at the top: do not move, remove, restyle or redesign anything already in the app; only add what's needed to make it work. When done, open a pull request.

**Before starting the next session, merge the previous session's pull request into `main`.** New sessions start from `main`, so they only see work that has been merged.

Some sessions need accounts or keys only you can create (an AI API key, an email service, Google sign-in). Each session names what it needs. Add them as environment secrets in your session settings and in Render.

## Rules for every session

1. **Everything already in the app stays exactly where and how it is.** Don't move, remove, rename, resize or restyle any existing screen, card, button, tab, menu item, image, heading or section. Don't change the layout, typography, colours or order of anything.
2. **Add only what's needed to make it work**, and only in these places:
   - inside an existing card, below its current lines and above its main button;
   - as a new row in an existing list (Settings, Support);
   - as a new section below the existing sections of a page;
   - as a new sub-page reached from one of those new rows, built from existing components (the "My profile" sub-page is the pattern).
   New elements reuse existing classes and components. Never invent a new visual style.
3. **Words change only when they've become untrue** because of your work (for example "background push isn't connected" once it is). Keep the same place and about the same length.
4. **Don't rebuild what exists.** Read "Already in the app" below and open those screens before writing code. Reuse the existing item fields and functions.
5. **Never invent policy facts.** Every fact has a source and a last-checked date. When unsure, use the earlier deadline and say so.
6. Match the existing code style. Add tests, run `npm test`, update the README, and open a pull request with **before and after** phone and desktop screenshots of every screen you touched, showing that existing elements haven't moved.

## Already in the app (checked October 11, 2026)

Stack: vanilla JS front end (`app.html` plus layered scripts `app.js` → `features.js` → `klarna.js` → `precision.js` → `guided.js` → `menu.js`; later files override earlier render functions), Node 22 server (`server.js`, `server/app.js`, `server/store.js`), Postgres on Render (`render.yaml`), tests in `tests/` (`npm test`).

**Landing page** (`index.html`; `landing.html` is a copy): hero "Keep the love. Return the rest.", a three-step section (Capture, Check, Move), a "Your returns. In motion." preview, the toolkit list ("Purchase tracking and CSV import", "Daily calendar reminder exports", "Return progress and packing checklists", "Separate refund and store credit totals"), "Girl math. With a paper trail.", Good to know FAQs, and a closing call to action.

**Sign up / sign in**: sign-up has two steps (name, email and password, then daily reminder time with the note "SMS and background push aren't connected"). Sign-in uses email and password. Server: scrypt passwords, HttpOnly session cookies, rate limiting. API: `/api/signup`, `/api/login`, `/api/logout`, `/api/me`, `/api/data` (GET/PUT), `/api/account` (DELETE), `/api/health`. Not built: password reset, Google/Apple sign-in.

**Data**: purchases, reminder settings and profile live in the browser and are uploaded as one JSON document per account (`user_data`, last write wins). Photos are stored inside that JSON.

**Menu drawer (☰)**: "Welcome, {name}!", email, totals **Returned / Refunds / Store credit** (from `resultValues` in klarna.js), links to Your purchases, Your returns, Your results, Reminders, History, Settings, Support, and the version number.

**Your purchases (home)**: avatar, "{Name}'s purchases", tabs **All purchases / In progress / Returned**, a masonry photo grid (photo, name, store · price, days left, "Return item ↗" / "Return instead" / "Open ↗"), example purchases with "Start with my purchases ↗", and the dark footer.

**Your returns** (`calendar` view): month calendar with ← Today →, deadlines in cells (dashed when unconfirmed), tap a day to filter, and the "This month's deadlines" list.

**Your results** (`wallet` view): **Refunds received**, **Store credit received**, **Awaiting an outcome** tiles; the "Awaiting your comeback" list (items with status `shipped`), the "Actually back" list, and "Export your records ↓" (CSV). Totals come from `totalFor` in features.js.

**Reminders**: reminder time, "Daily check-in while this app is open" toggle, permission state, "Enable browser notifications" / "Send a test notification", a preview of the daily nudge, a start/ship/arrive explainer, and the "Calendar-ready purchases" list with "Export reminders ↗" (.ics, daily alert until the deadline; confirmed items only). While the app is open it sends one notification a day (most urgent item plus "Plus N other return windows", respecting `snoozeUntil`). "Start return" turns daily reminders on and asks for permission; its message is "We'll remind you daily until it's complete."

**History**: returned, sent-back and kept items with "$X back".

**Settings**: My profile (first name, photo), Security and privacy (explainer plus delete account), Terms of service (draft), Sign out.

**Support**: "How Returnly works" (opens the guide "A nudge, then a next step.", which notes that AI policy research, receipt reading and background push aren't connected), four FAQs, and "Email support isn't set up yet."

**Return journey** (tabs Scan · Item · Return · Get paid, "← Back", avatar):
- **Scan**: camera, shutter, Upload (image or PDF up to 10 MB), Retry camera, "Try an example instead". The file is accepted but **not read**.
- **Item**: card with photo ("+ Add photo"), item name, price, and Continue (or "Return item" toggles when there are several items). Untapped items are saved as kept. Store defaults to "Store not added", the date to today, and the window to **30 days from purchase, a guess shown as if it were a fact**.
- **Return**: card with photo, name, editable store line ("Add store name"), editable "Return by" date with days left, "Open retailer's return portal ↗" (only if a URL exists), and Continue. A kept item shows "You're keeping this · return window" with "Return this instead".
- **Get paid**: store, "Expected back", "Start return" → then "Amount received $" → "Return complete". **There is no "sent back" step**, so items go from `started` straight to `received` and never appear under "Awaiting your comeback".

**Item fields that already exist** (reuse; don't duplicate): `name, retailer, price, category, channel, purchased, delivered, window, basis, outcome, requirement, url, conditions, processing, confirmed, policySource, next, status (deciding/started/shipped/received/kept), intent, received, returnedOn, packing {receipt, condition, packed, label, proof}, taskDone, snoozeUntil, dateSet, photo, demo`.

**In the code but not reachable from any screen**: the old "Add a purchase" form, the Fashion Nova policy reference (30 days from delivery, store credit, checked Oct 8, 2026), the policy editor, the packing checklist, CSV import and template, and JSON backup. The landing page still advertises CSV import and packing checklists. Deadline, eligibility and calendar logic lives in `core.js`.

## The 12 sessions

| # | Session | What it adds |
|---|---|---|
| 1 | Data foundation | Server-side items and photo storage, background jobs (nothing visible) |
| 2 | Retailer policy database | Checked policies for 10 launch stores plus Fashion Nova (nothing visible) |
| 3 | Policy engine | Real deadlines and "what you get back" on the existing Return card |
| 4 | Receipt reading | The Scan step reads the receipt and fills the Item card |
| 5 | How to return it | Steps, checklist, QR code and nearest drop-off inside the Return card; Returns 101 in Support |
| 6 | Any store, always current | Unknown stores looked up; policies re-checked; "Is this wrong?" |
| 7 | Reminders when the app is closed | Installable app and push for the existing daily reminder |
| 8 | Reminders that get it done | Useful reminder content and actions, email backup, password reset |
| 9 | Purchases from email | Forwarding address plus Gmail/Outlook connect, in Settings |
| 10 | Money follow-through | "Sent back" tracking, overdue refunds, missed windows and credit expiry on Your results |
| 11 | Say what Returnly does | Words-only update to the landing page, guide, FAQs and notes |
| 12 | iPhone and Android apps | App Store and Play Store apps |

---

## 1. Data foundation

```
Follow "Rules for every session" and read "Already in the app" in docs/build-plan.md. Nothing visible changes in this session; every screen must look identical afterwards.

Today each account's purchases, settings and profile are one JSON document in `user_data` (last write wins), with photos inside it. Later sessions need the server to read items by itself (reminders while the app is closed, email capture, receipt reading, policy matching).

1. Add Postgres tables for purchases (one row per receipt or order: store, channel, order number, purchase and delivery dates, source receipt/email/manual) and items. Item columns use the existing item field names and values one-to-one, so the front end barely changes. Leave room for later fields: retailer id, policy checked date, condition answers, return method, drop-off location, QR or label attachment, refund expected-by date.
2. Migrate every existing payload into the new tables without losing anything, and keep the app working throughout. The browser keeps its offline copy; sync moves to per-item create, update and delete calls, and `/api/data` keeps working for older clients.
3. Move photos (items, receipts, profile) into object storage behind a small interface: S3-compatible such as Cloudflare R2 in production, a local folder in development. Serve them only to their owner.
4. Add a Postgres-backed background job runner inside the Node server, with one example job and a test.
5. "Delete my account" also deletes the new rows and files.
6. Keep the existing security rules (same-origin JSON writes, strict CSP, HttpOnly cookies). Update render.yaml, the README and tests.

Needs from me: R2/S3 bucket credentials for production; development works without them.
```

## 2. Retailer policy database

```
Follow "Rules for every session" and read "Already in the app" in docs/build-plan.md. Nothing visible changes in this session.

Build the checked US return-policy database for Amazon, Walmart, Target, Costco, Best Buy, Home Depot, Apple, Nike, Zara and Shein, and add the existing Fashion Nova reference as the 11th store. The app reads facts from this data and never makes them up.

1. Design the schema so it fills the existing item fields (`window`, `basis`, `outcome`, `requirement`, `url`, `conditions`, `processing`, `policySource`). Add only what those can't hold:
   - Category exceptions (electronics, opened items, final sale, non-returnable categories).
   - Membership variations.
   - Holiday extended-return rules.
   - Receipt requirements.
   - Refund timing and fees.
   - Return methods with their steps: mail, drop-off partners, in store; whether a label, box, QR code or printer is needed.
   - Marketplace or third-party seller caveats.
   - Source URL and last-checked date for every fact.
   Store versioned files (for example `policies/amazon.json`) validated by a JSON schema and loaded into Postgres. Keep past versions.
2. Research each retailer's current official US policy pages. Record only what the official source says, with the URL and today's date. Anything unconfirmed is marked unknown; never guess.
3. Add a read API (`/api/retailers`, `/api/retailers/:id`) and store-name matching for aliases such as "AMZN Mktp", "Amazon.com", "WAL-MART #1234" and "Target T-1234".
4. Tests: schema validity, a source on every fact, alias matching.

In the pull request, include a table of the 11 retailers with their key windows and sources so I can spot-check them.
```

## 3. Policy engine

```
Follow "Rules for every session" and read "Already in the app" in docs/build-plan.md.

The Return card currently shows a guessed 30-day deadline as if it were a fact. Build the engine that applies the retailer's policy (from policies/) to each item and fills the existing fields.

1. Input: the item, its retailer's policy, and the user's answers to condition questions (opened? tags on? original packaging? member of the store's program?). Output written into the existing fields (`window`, `basis`, `outcome`, `requirement`, `url`, `conditions`, `processing`, `policySource`, `confirmed`), plus: returnable yes / no / not sure with the reason, whether a holiday extension applies, and the facts used with their sources and dates.
2. Classify items into the policy's categories from the item name with a small AI call on the server (load the claude-api skill to choose the model; key in ANTHROPIC_API_KEY). Keep the existing `category` field; add a finer policy category beside it.
3. Safety: when anything is unknown, use the earlier possible deadline and say why. Never "yes" without a checked fact behind it. When no policy is known, the existing "Date unconfirmed" label and dashed calendar style must show, not a confident date.
4. On the existing **Return** card, the existing "Return by" line and days left now come from the engine. Below the existing lines and above Continue, add at most two or three condition questions (only ones that change the answer for this store and category) and one line for what you get back (for example "Store credit · about 7–10 days"). The existing store line and manual date override stay exactly as they are.
5. Your returns, Your results, the Reminders list and the menu totals already read these fields; confirm they now show real data with no changes to those screens.
6. Tests: delivery vs. purchase start, category exceptions, membership, holiday extensions, final sale, unknowns, date edge cases (follow tests/core.test.cjs).
```

## 4. Receipt reading

```
Follow "Rules for every session" and read "Already in the app" in docs/build-plan.md.

The Scan step's camera, shutter and Upload already work, but the receipt is never read. Make it read the receipt and fill the existing Item card. Don't change either screen's layout.

1. Send the photo, screenshot or PDF to the server (the CSP allows same-origin requests only, so all AI calls happen there). Use a vision-capable Claude model with structured output (load the claude-api skill; key in ANTHROPIC_API_KEY).
2. Extract: store name and location, purchase date and time, order or transaction number, line items (name, quantity, price, item code), totals, payment method type (never the card number), and any printed return-policy text, word for word.
3. Fill the existing draft (`draft.retailer`, `draft.purchased`, `draft.channel`, `draft.products`) so the Item card opens with each item's name and price filled in, and the real store and date instead of "Store not added" and today. While waiting, show a short "Reading your receipt…" line inside the existing Scan card, using its existing text style.
4. Match the store to the retailer database and run the policy engine. Printed policy text becomes a source ("printed on your receipt"), especially for stores we don't have.
5. Fields the model wasn't sure about stay empty, with their existing placeholder, for the user to fill; never guess silently. Handle long receipts across several photos, blurry or cropped images (show the reason in the existing error line under the card), and receipts with no store name.
6. Privacy: no card numbers; the receipt image is stored privately with the purchase and deleted with it.
7. Tests with realistic fixture receipts and a mocked AI response. Note the cost per scan in the pull request.

Needs from me: ANTHROPIC_API_KEY as a secret.
```

## 5. How to return it

```
Follow "Rules for every session" and read "Already in the app" in docs/build-plan.md.

Users don't know how to return things, and that's why they give up. Teach them inside the existing Return card, below its current lines and above Continue. Everything already on the card stays where it is.

1. A short numbered guide for this item at this store, built from the policy's return-method data, for example "Open Amazon → Your Orders → Return items → choose a drop-off → show the QR code; no box or label needed". When there are several methods, show the easiest first and what each needs (box, label, printer, receipt, ID). Use a collapsed "Other ways to return" for the rest.
2. Fill `url` from the policy data so the existing "Open retailer's return portal ↗" link appears for every known store, with an order-specific link when the order number is known.
3. Bring back the existing packing checklist (`packing`: receipt, condition, packed, label, proof) as a collapsed "Checklist" in the card, adjusted to the method (for example, no "label" line for a QR-code drop-off).
4. "Add your QR code or label": attach the photo, screenshot or PDF the retailer gives, and show it full-screen at the counter.
5. "Nearest drop-off": with the device's location (asked only at this moment), show the closest accepted locations for this retailer and method with distance, hours and a directions link. Use a places provider through the server (pick one and explain why; key as a secret) and cache results.
6. Education: add a "Returns 101" row to the existing Support list, under "How Returnly works" and in the same style, opening a sub-page (receipts, store credit vs. refund, drop-off vs. mail, final sale, keeping proof).
7. Tests for guide generation for every launch retailer.

Needs from me: a places API key (the session will tell me which).
```

## 6. Any store, always current

```
Follow "Rules for every session" and read "Already in the app" in docs/build-plan.md.

1. Live lookup: when a receipt or email names a store we don't have and there's no printed policy, use Claude with web search on the server (load the claude-api skill) to find the official policy page and fill the same schema with sources. Save it as "unverified" and show it with the app's existing unconfirmed treatment ("Date unconfirmed" label, dashed calendar entry), plus one line in the Return card saying it's unverified. Unverified data never gives "yes, returnable" and always uses the safer, earlier deadline.
2. Cache lookups so the next user who buys from that store gets an instant answer. Count how many users hit each store.
3. A small "Is this wrong?" text link at the end of the policy lines in the Return card, with an optional note, saved for review.
4. An admin sub-page for admin accounts only, reached from a new row at the end of the Settings list (visible only to admins) and built from existing components. It shows unverified stores ranked by usage, user reports, and lets me approve a policy into the checked database.
5. Weekly freshness job (job runner from session 1): re-fetch each checked retailer's source pages and flag meaningful changes for review instead of changing anything automatically. Flag holiday-season changes in October to December.
6. When an approved change moves a deadline earlier, recompute affected active items and notify those users.
7. Tests with mocked web results.

In the pull request, explain the review workflow and how I'm notified of flagged changes.
```

## 7. Reminders when the app is closed

```
Follow "Rules for every session" and read "Already in the app" in docs/build-plan.md.

The Reminders page, reminder time, daily toggle, permission request (on "Start return" and the Reminders button), test notification and daily notification already exist, but they only work while the app is open. Make the same reminders arrive when it's closed. Don't change the Reminders page layout.

1. Make the web app installable: web app manifest, icons in the existing favicon style, and a service worker that caches the app shell. Add one short line at the bottom of the existing Reminders settings card: "Add Returnly to your Home Screen to get reminders on iPhone" (iPhone web push only works after adding it to the Home Screen).
2. Web Push with VAPID keys, using the existing permission moments. Store subscriptions per device, remove expired ones, and send from the server through the job runner at the user's existing `settings.time` in their time zone.
3. Move the daily choice of item (now in app.js: most urgent item plus "Plus N other return windows", respecting `snoozeUntil`) to the server, so push and the in-app notification share one rule and the user never gets both.
4. Tapping a notification opens that item's Return step.
5. Words only: correct the notes that say background push isn't connected (Reminders page honesty note and toggle label, sign-up step 2 note, README).
6. Update the CSP and README security notes for the service worker. Tests for subscriptions and sending (mock the push service).

Needs from me: VAPID keys (the session will show me how to generate them) as secrets.
In the pull request, include steps to test on a real iPhone and Android phone.
```

## 8. Reminders that get it done

```
Follow "Rules for every session" and read "Already in the app" in docs/build-plan.md.

Keep the app's promise, "We'll remind you daily until it's complete", and the existing Reminders page. Make each reminder make the return effortless right now.

1. Still one reminder a day per user at their chosen time, grouping items ("2 returns due this week: $84 total"). The wording gets more urgent as the deadline nears, building on the existing preview rows "Every day / The day before / Deadline day".
2. Content: item name, money at stake, days left, the single next step from the session 5 guide ("Tap for your QR code"), and the nearest drop-off with distance when known. Notification actions: "Show QR code", "Snooze until tomorrow" (existing `snoozeUntil`), "I sent it back" (status `shipped`), "I'm keeping it" (status `kept`).
3. Reminders stop when an item is sent back, kept or received, as they do now.
4. Email backup through a transactional email service (pick one and explain why): sent when push isn't set up, or when a reminder hasn't been opened 3 days before the deadline. Same content, plus one-click unsubscribe for each type.
5. New settings go as new rows at the end of the existing Reminders settings card, in its existing style: "Also email me", quiet hours, and "Gentle" (only at the halfway point and 7, 3 and 1 days before). The existing time, toggle and buttons stay where they are.
6. Password reset by email: a "Forgot password?" link under the existing sign-in button, plus the reset pages built from the sign-in page components. Replace "Email support isn't set up yet" on Support with a working contact address.
7. Deadline day: if the store accepts in-store returns, the reminder says so ("Still possible today: Target closes at 10pm, 1.2 mi away").
8. The existing reminder preview card shows the new content in its current layout. Tests for the scheduler: time zones, quiet hours, grouping, snooze, stopping, daylight saving changes.

Needs from me: an email service API key and a verified sending domain.
```

## 9. Purchases from email

```
Follow "Rules for every session" and read "Already in the app" in docs/build-plan.md.

Most online purchases arrive with an order email. Let users add purchases with no photo: by forwarding, or by connecting their inbox once.

1. Add a row "Add purchases from email" to the existing Settings list, below "My profile" and in the same style. It opens a sub-page built like "My profile" with:
   - Their private forwarding address (for example `u-7f3k2@in.returnly.app`, using our email provider's inbound feature), a copy button and short steps for Gmail, Outlook and Apple Mail.
   - "Connect Gmail" (Google OAuth, read-only Gmail access) and "Connect Outlook" (Microsoft Graph), each showing a plain-English privacy explanation before connecting and a "Disconnect and delete" option afterwards.
   - "Import a spreadsheet": a link to the existing CSV import dialog (features.js), which makes the landing page's "CSV import" promise true.
2. On connect, search only shopping emails from known retailers and senders from the last 90 days, then keep watching (Gmail push notifications or polling; Graph subscriptions).
3. Parse emails on the server with the job runner and Claude (load the claude-api skill; reuse the session 4 extraction). Recognise order confirmations, shipping and delivery notices, return confirmations and refund notices. Match them to purchases by store and order number:
   - Delivery sets `delivered` and recomputes the deadline.
   - Return started or shipped sets status `started` or `shipped`.
   - Refund sets `received`, the amount and the date, exactly like "Return complete".
4. New orders appear as cards on Your purchases with a small "From email" card label in the existing label style. Tapping opens the existing Item card pre-filled. Nothing becomes a return without the user's tap.
5. Add "Continue with Google" and "Continue with Apple" under the existing buttons on the sign-in and sign-up pages, kept separate from inbox access.
6. Privacy and security: narrowest access, never store full email bodies (only extracted fields and the message ID), encrypt tokens at rest, accept forwarded mail only from the user's verified addresses, let users get a new forwarding address, and make "Delete my account" revoke tokens. Add one paragraph to the existing Security and privacy page.
7. Write docs/google-verification.md: Gmail read access is a restricted scope that needs Google app verification and a yearly third-party security assessment. List the steps, costs and timing. Until then Gmail connect runs in testing mode (up to 100 test users) and forwarding is the default.
8. Tests with fabricated sample emails from the launch retailers and mocked Gmail and Graph responses.

Needs from me: inbound email DNS records, a Google Cloud OAuth client, a Microsoft app registration and Apple sign-in keys (the session will list exact steps).
```

## 10. Money follow-through

```
Follow "Rules for every session" and read "Already in the app" in docs/build-plan.md.

The money screens already exist: the menu drawer totals and **Your results** (three tiles, the "Awaiting your comeback" and "Actually back" lists, export). Do not add a dashboard, and don't add or move tiles. Make the existing screens tell the full story.

1. Fix the gap in the journey: after "Start return", items go straight to "Amount received" and never count as sent back. On the existing Get paid card, between "Start return" and "Return complete", add the existing status `shipped` as one more button state, "I sent it back", in the same button spot. It sets `returnedOn`. Email capture (session 9) and the reminder action (session 8) can set it too. Items that are `started` or `shipped` appear in the existing "Awaiting your comeback" list, and "Awaiting an outcome" counts them.
2. Refund follow-up: when an item is sent back, set an expected-by date from the policy's refund timing (`processing`). If no refund arrives by then, show "Overdue" as the card label in the existing "Awaiting your comeback" row, and send a reminder through the existing system with the retailer's refund-status link or contact.
3. Missed windows: when the window passes on an item that was marked for return, record it. Add a "Missed windows" section **below** "Actually back", in the same row style, showing the total and the items. Where the policy allows, suggest options without promising anything (reuse the Support FAQ "I missed the return window" copy).
4. Store credit: for items refunded as store credit, let the user add an expiry date on the existing "Actually back" row's item, and send a reminder before it expires.
5. All numbers come from the existing helpers (`resultValues` for the drawer, `totalFor` for Your results) so the two always agree. Add no separate money math.
6. Tests for each total, the sent-back step, overdue logic, missed windows and expiry reminders.
```

## 11. Say what Returnly does

```
Follow "Rules for every session" and read "Already in the app" in docs/build-plan.md. This session changes **words only**: no layout, image, section, button position or style changes. Every heading, list and button stays in place, with text of about the same length.

Returnly's job, in the founder's words: people buy something, want to return it, don't know how, and forget until the window has passed. Returnly solves both: it **teaches exactly how to return each item at each store** (where to go, what to bring, whether it's returnable, cash or store credit), and it **reminds them until it's done and the money is back**, with a record of everything they've got back.

1. Go through every screen (landing page, sign-up and sign-in, the "How Returnly works" guide, Support FAQs, the Reminders and Your results notes, Security and privacy, empty states, toasts and the README) and list every sentence that is now untrue or undersells what the app does. Examples: "This first version includes a researched Fashion Nova reference", "Background push is not connected", "THE FIRST VERSION", "Returnly / Local first version", "Live AI is not connected".
2. Rewrite only those sentences so they describe what the app does today: scan a receipt or forward an email; know if it's returnable, by when, and whether you get cash or store credit; step-by-step instructions and the nearest drop-off; reminders on your phone until it's done; tracking every dollar back. Stay honest about limits that still apply (for example, deadlines from unverified policies are estimates).
3. Keep Returnly's voice ("Keep the love. Return the rest.", "Girl math. With a paper trail.") and leave headings and taglines that are still true untouched.
4. Make sure every feature the landing page lists can actually be reached in the app; if one can't, list it in the pull request rather than removing it.
5. In the pull request, include a table of each changed sentence (before → after) and before/after screenshots proving that nothing moved.
```

## 12. iPhone and Android apps

```
Follow "Rules for every session" and read "Already in the app" in docs/build-plan.md. The native apps must look exactly like the web app.

1. Wrap the existing front end with Capacitor (explain if you'd choose differently) for iOS and Android. The web app keeps working exactly as before.
2. Native push through Apple Push Notification service and Firebase Cloud Messaging, plugged into the existing reminder system next to web push, with the same actions.
3. Use the native camera inside the existing Scan screen (same layout), with document edge detection if available.
4. Share sheet: share an order email, screenshot or PDF receipt from any app into Returnly, and it goes through receipt reading to the existing Item card.
5. Confirm Sign in with Apple is in place (required on iOS when Google sign-in exists).
6. App store readiness: icons, splash screens, privacy labels and data-safety forms matching what we actually collect, review notes explaining email access, and docs/app-store-release.md with the steps I take to submit.
7. Build instructions for both platforms in the README.

Needs from me: an Apple Developer account, a Google Play developer account and a Firebase project (the session will list exact steps). iOS builds need a Mac; the session will explain options such as a cloud build service.
```
