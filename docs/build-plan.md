# Returnly build plan: 12 sessions

Run these one at a time, in order. Each prompt stands on its own: paste it into a new session.

**Before starting the next session, merge the previous session's pull request into `main`.** New sessions start from `main`, so they only see work that has been merged.

Some sessions need accounts or keys that only you can create (an AI API key, an email service, Google sign-in). Each prompt names what it needs. Add these as environment secrets in your session settings and in Render. If a session can't reach an outside service, it will tell you which network setting to change.

| # | Session | What it gives users |
|---|---|---|
| 1 | Data foundation | Items stored properly on the server, so reminders can run while the app is closed |
| 2 | Retailer policy database | Checked return policies for the 10 launch stores |
| 3 | Policy engine | "Returnable? By when? Cash or credit?" answered for each item |
| 4 | Receipt reading | Photo of a receipt → store, items, prices, dates, printed policy |
| 5 | How-to-return guides and drop-off finder | Step-by-step instructions and the nearest drop-off location |
| 6 | Unknown stores and keeping policies current | Any store works; policies stay accurate over time |
| 7 | Installable app and push notifications | Real phone notifications, even when the app is closed |
| 8 | Reminders that get it done | Escalating reminders you can act on, plus email backup |
| 9 | Email order capture: forwarding address | Forward an order email and the item appears |
| 10 | Email order capture: connect your inbox | Gmail/Outlook connect; orders, deliveries and refunds captured automatically |
| 11 | Money dashboard and refund tracking | Recovered vs. lost, refunds chased until they arrive |
| 12 | iPhone and Android apps | App Store and Play Store apps with native push, camera and share sheet |

---

## 1. Data foundation

```
Returnly helps US shoppers return purchases before the return window closes. It makes two promises: teach people exactly how to return each item, and remind them until the return is done and the money is back. The stack is a vanilla JS front end (app.html plus its scripts; no framework or bundler), a Node 22 server (server.js, server/app.js, server/store.js), and Postgres on Render (render.yaml). Tests run with `npm test`. Read README.md and docs/product-notes.md first and match the existing code style. Keep the four-step journey (Scan → Return → Return it → Get paid).

This session lays the foundation that later sessions build on. Today each account's purchases are a single JSON document in `user_data`, and photos are stored inside it. Later work needs the server to read items on its own: reminders sent while the app is closed, email order capture, receipt reading and policy matching.

Do this:
1. Design Postgres tables for purchases (one row per receipt or order: store, channel online/in-store, order number, purchase date, delivery date, source receipt/email/manual) and items (name, price, category, quantity, photo, decision return/keep, status from active through return started, sent back, refund pending and refunded to expired, deadline, deadline basis, policy reference, refund type, amount received, received date). Leave room for fields later sessions add: retailer id, policy source and checked date, condition answers, return method, drop-off location, QR or label attachment.
2. Migrate existing `user_data` payloads into the new tables without losing anything, and keep the app working throughout. The browser keeps its offline copy; sync moves to the new API with per-item updates instead of whole-document last-write-wins.
3. Move photos out of the database into object storage behind a small storage interface: S3-compatible such as Cloudflare R2 in production, a local folder in development. Serve them only to their owner.
4. Add a background job runner inside the Node server (a simple Postgres-backed queue is fine) that later sessions will use for reminders and email processing. Include one example job and a test.
5. Update render.yaml, the README and tests. Keep the existing security rules: same-origin JSON writes, the strict CSP, and HttpOnly session cookies.

Needs from me: R2/S3 bucket credentials for production; development works without them.
When done, run `npm test`, check the app in a browser at phone and desktop widths, and open a pull request explaining the migration and how to roll back.
```

## 2. Retailer policy database

```
Returnly helps US shoppers return purchases before the return window closes. It makes two promises: teach people exactly how to return each item, and remind them until the return is done and the money is back. The stack is a vanilla JS front end, a Node 22 server (server/), Postgres, and `npm test`. Read README.md and docs/ first and match the existing style.

Build the checked return-policy database for our 10 launch retailers: Amazon, Walmart, Target, Costco, Best Buy, Home Depot, Apple, Nike, Zara and Shein. Fashion Nova already has a researched reference in the app; fold it in as the 11th store. Policies are structured data that a person checked. The app reads facts from it and never makes them up.

1. Design the policy schema. For each retailer, include:
   - Default return window, and whether it starts at purchase or delivery.
   - Category exceptions such as electronics, opened items, final sale and non-returnable categories.
   - Membership variations (paid tiers and loyalty programs).
   - Holiday extended-return rules.
   - Receipt requirements.
   - Condition rules such as tags on, unopened and original packaging.
   - Refund type (original payment, store credit, exchange only) and how long refunds take.
   - Fees (restocking, return shipping).
   - Return methods, each with its own steps: mail, drop-off partners, in store, and whether a label, box, QR code or printer is needed.
   - Marketplace or third-party seller caveats.
   - Source URLs and a last-checked date for every fact.
   Store it in versioned files in the repository, for example `policies/amazon.json`, validated by a JSON schema and loaded into Postgres. Keep every past version.
2. Research each retailer's current official US policy pages on the web. Record only what the official source says, with the source URL and today's date. Mark anything you couldn't confirm as unknown; never guess.
3. Add a read API (`/api/retailers`, `/api/retailers/:id`) and store-name matching that handles aliases such as "AMZN Mktp", "Amazon.com", "WAL-MART #1234" and "Target T-1234".
4. Add tests that validate every policy file against the schema and check that every fact has a source.

When done, open a pull request with a table of the 11 retailers, their key windows and the sources, so I can spot-check them.
```

## 3. Policy engine: "Is this returnable, by when, and what do I get back?"

```
Returnly helps US shoppers return purchases before the return window closes. It makes two promises: teach people exactly how to return each item, and remind them until the return is done and the money is back. The stack is a vanilla JS front end, a Node 22 server, Postgres, and `npm test`. Read README.md, docs/, core.js and the policies/ folder first.

Build the engine that applies a retailer's policy to a specific item and gives a clear answer.

1. Input: the item (name, category, price, purchase and delivery dates, channel), the retailer's policy record, and the user's answers to a few condition questions (opened? tags on? original packaging? member of the store's program?). Output:
   - Returnable: yes, no, or "not sure" with the reason.
   - Exact deadline, the date it counts from, and whether a holiday extension applies.
   - What you get back: refund to card, store credit or exchange, plus expected timing and any fees.
   - Available return methods.
   - The policy facts used, each with its source and last-checked date.
2. Classify items into the policy's categories automatically from the item name, using a small AI call through the server (load the claude-api skill to choose the model and set it up; key in ANTHROPIC_API_KEY). Let the user correct the category with one tap.
3. Safety rules: when any input is unknown, use the earlier possible deadline and say why. Never mark an item "yes" unless the policy fact behind it is checked. Show "not sure" plainly rather than faking certainty.
4. Ask only the condition questions that change the answer for this retailer and category, at most two or three, inside the existing Return step.
5. Replace the current hand-entered policy fields in the journey with engine output, and keep a manual override.
6. Thorough tests: window starting at delivery vs. purchase, category exceptions, membership tiers, holiday extensions, final sale, unknown inputs, and date edge cases (the existing date tests in tests/core.test.cjs show the style).

When done, open a pull request with screenshots of the answer card for three different retailers.
```

## 4. Receipt reading

```
Returnly helps US shoppers return purchases before the return window closes. It makes two promises: teach people exactly how to return each item, and remind them until the return is done and the money is back. The stack is a vanilla JS front end, a Node 22 server, Postgres, and `npm test`. Read README.md, docs/camera-flow-notes.md, guided.js and the policy engine first.

Make the Scan step read receipts. The user photographs a paper receipt, or uploads a screenshot or PDF of a digital one, and Returnly fills in everything.

1. Send the image to the server. The browser CSP only allows same-origin requests, so all AI calls happen on the server. Use a vision-capable Claude model (load the claude-api skill to choose the model and to use structured output; key in ANTHROPIC_API_KEY).
2. Extract: store name and location, purchase date and time, order or transaction number, each line item (name, quantity, price, item code if printed), totals, payment method type (not the card number), and any return-policy text printed on the receipt, word for word.
3. Match the store to our retailer database. Feed printed policy text into the policy engine as a source ("printed on your receipt"), especially for stores we don't have.
4. Show what was read on the existing Return step's photo grid so the user can fix anything in one tap. Fields the model wasn't sure about are highlighted, never silently filled.
5. Handle long receipts across several photos, blurry or cropped images (ask for a retake with a reason), non-English text, and receipts with no store name.
6. Privacy: don't store card numbers, store the receipt image privately in the storage set up in session 1, and let the user delete it.
7. Tests with sample receipt images (create realistic fixtures) and a mocked AI response; cost per scan noted in the PR.

Needs from me: ANTHROPIC_API_KEY as a secret.
When done, open a pull request with before/after screenshots of the Scan → Return flow.
```

## 5. How-to-return guides and drop-off finder

```
Returnly helps US shoppers return purchases before the return window closes. It makes two promises: teach people exactly how to return each item, and remind them until the return is done and the money is back. The stack is a vanilla JS front end, a Node 22 server, Postgres, and `npm test`. Read README.md, docs/, guided.js, the policies/ folder and the policy engine first.

Users don't know how to return things, and the effort of figuring it out is why they give up. Turn the "Return it" step into a clear guide for this exact item at this exact store.

1. Build a step-by-step guide from the retailer's return-method data, such as "Open Amazon → Your Orders → Return items → choose a drop-off → show the QR code; no box or label needed". If several methods exist, show the easiest first, and say what each needs (box, label, printer, receipt, ID) and what you get back.
2. Add a direct button to the retailer's return page for this order where possible (order-specific link when we have the order number, otherwise the returns page).
3. Let users save the QR code or label the retailer gives them (photo, screenshot or PDF) on the item, and show it full-screen at the counter.
4. Drop-off finder: using the device's location (asked only when needed), show the nearest accepted locations for this retailer and method with distance, hours and a directions link. Use a places provider through the server (pick one and explain why; key as a secret). Cache results.
5. "What happens next": after "I sent it back", explain when the refund usually arrives and how it comes back, using policy data.
6. A plain-language "Returns 101" help page: receipts, store credit vs. refund, drop-off vs. mail, what "final sale" means, and keeping proof of return.
7. Keep everything short, phone-first and matching the current design. Tests for guide generation for every launch retailer.

Needs from me: a places API key (the session will tell me which).
When done, open a pull request with phone screenshots of the guide for Amazon, Target and Zara.
```

## 6. Unknown stores and keeping policies current

```
Returnly helps US shoppers return purchases before the return window closes. It makes two promises: teach people exactly how to return each item, and remind them until the return is done and the money is back. The stack is a vanilla JS front end, a Node 22 server, Postgres, and `npm test`. Read README.md, the policies/ folder, the policy engine and the receipt reader first.

Make Returnly work for any US store, and keep the checked policies accurate over time.

1. Live lookup: when a receipt or email names a store we don't have and there's no printed policy, use Claude with web search on the server (load the claude-api skill) to find the store's official return-policy page. Fill the same policy schema, with source URLs. Save the result as "unverified" and show it to the user with a clear "please confirm" label. Unverified policies never produce a "yes, returnable" answer by themselves, and deadlines from them use the safer, earlier reading.
2. Cache lookups so the second user to buy from that store gets an instant answer. Track how many users hit each store.
3. "This is wrong" button on every policy fact, with an optional note, saved for review.
4. A small admin page, restricted to admin accounts, showing unverified stores ranked by usage, user reports, and a side-by-side view to approve a policy into the checked database.
5. Freshness job (using the job runner from session 1): weekly, re-fetch each checked retailer's source pages, detect meaningful changes, and flag them for review instead of changing anything automatically. Flag holiday-season changes in October to December.
6. When a checked policy changes, recompute deadlines for affected active items and tell those users if their deadline moved earlier.
7. Tests with mocked web results.

When done, open a pull request explaining the review workflow and how I get notified about flagged changes.
```

## 7. Installable app and push notifications

```
Returnly helps US shoppers return purchases before the return window closes. It makes two promises: teach people exactly how to return each item, and remind them until the return is done and the money is back. The stack is a vanilla JS front end, a Node 22 server, Postgres, and `npm test`. Read README.md, docs/ and the background job runner first.

People forget, and someone who forgets doesn't open the app. Reminders must reach the phone while the app is closed. Today notifications only work while the app is open.

1. Make the web app installable: web app manifest, icons, a service worker that caches the app shell for offline use, and an "Add to Home Screen" prompt. On iPhone, web push only works after adding to the Home Screen, so explain that clearly.
2. Web Push with VAPID keys: subscribe after a clear explanation (never on first load), store subscriptions per device, remove expired ones, and send from the server through the job runner.
3. Notification taps open the exact item's "Return it" screen.
4. Settings: turn push on or off per device, set quiet hours and a preferred reminder time, and send a test notification.
5. Keep the existing calendar reminders as an extra option.
6. Update the CSP and the security notes in the README for the service worker. Tests for subscription storage and sending (mock the push service).

Needs from me: VAPID keys (the session will show me how to generate them) as secrets.
When done, open a pull request with steps to test on a real iPhone and Android phone.
```

## 8. Reminders that get it done

```
Returnly helps US shoppers return purchases before the return window closes. It makes two promises: teach people exactly how to return each item, and remind them until the return is done and the money is back. The stack is a vanilla JS front end, a Node 22 server, Postgres, and `npm test`. Read README.md, docs/, the push notification setup, the policy engine and the how-to guides first.

Design and build the reminder system. A reminder's job is not to say "3 days left". It is to make the return effortless right now.

1. Cadence per item marked for return: one when it's added (confirming the deadline), then halfway through the window, 7 days left, 3 days, 1 day and the final day. Respect quiet hours and the preferred time. Never send more than one reminder a day per user; group several items into one ("2 returns due this week: $84 total").
2. Content you can act on: item name and photo, money at stake, days left, the single next step ("Tap for your QR code"), and the nearest drop-off with its distance when known. Actions on the notification: "Show QR code", "Snooze until tomorrow", "I sent it back", "I'm keeping it".
3. Stop the moment the item is sent back or kept. After "sent back", switch to refund follow-up (session 11 builds the tracking; leave a hook for it).
4. Email backup through a transactional email service (pick one and explain why), sent when push isn't set up or a reminder hasn't been opened by the 3-day mark. Simple branded email with the same action. Include one-click unsubscribe for each type of email.
5. Add password reset by email, since the email service now exists (the README lists it as missing).
6. Last-chance logic: if the deadline is today and the store has an in-store option, say so ("Still possible today: Target closes at 10pm, 1.2 mi away").
7. Settings to choose channels and intensity (gentle or persistent). Tests for the scheduler: time zones, quiet hours, grouping, stopping, and daylight saving changes.

Needs from me: an email service API key and a verified sending domain.
When done, open a pull request with mock-ups of each reminder type (push and email).
```

## 9. Email order capture: forwarding address

```
Returnly helps US shoppers return purchases before the return window closes. It makes two promises: teach people exactly how to return each item, and remind them until the return is done and the money is back. The stack is a vanilla JS front end, a Node 22 server, Postgres, and `npm test`. Read README.md, docs/, the receipt reader, the policy engine and the job runner first.

Most online purchases already arrive with an order email. Let users add purchases without taking a photo.

1. Give each user a private forwarding address (for example `u-7f3k2@in.returnly.app`) using the inbound-email feature of our email provider. Show it in the app with a copy button and simple instructions for forwarding from Gmail, Outlook and Apple Mail.
2. Parse each forwarded email on the server with the job runner and Claude (load the claude-api skill). Recognise order confirmations, shipping and delivery notices, return confirmations and refund notices. Extract the store, order number, items, prices, images and dates.
3. Match emails to existing purchases by store and order number. A delivery email sets the delivery date and recomputes the deadline, since many windows start at delivery. A return-started email moves the item to "sent back". A refund email records the amount and date and marks the item refunded.
4. New orders appear in an "Inbox" tray to review: "Keep" or "Might return". Nothing becomes a return without the user's tap.
5. Security: accept mail only for valid addresses, check that the user really sent it (SPF/DKIM on the forward or the user's verified addresses), ignore anything that isn't a shopping email, store only what's needed, and let users rotate their address.
6. Tests with realistic sample emails from the launch retailers (fabricate fixtures; no real personal data).

Needs from me: the inbound email domain DNS records (the session will list them).
When done, open a pull request with a short video or screenshots of forwarding an order and seeing it appear.
```

## 10. Email order capture: connect your inbox

```
Returnly helps US shoppers return purchases before the return window closes. It makes two promises: teach people exactly how to return each item, and remind them until the return is done and the money is back. The stack is a vanilla JS front end, a Node 22 server, Postgres, and `npm test`. Read README.md, docs/ and the email forwarding capture (its parser is reused here) first.

Let users connect Gmail or Outlook once, so every order, delivery and refund is captured with no effort.

1. Gmail: Google sign-in (OAuth) with read-only Gmail access. Search only for shopping emails (order, shipped, delivered, return, refund) from known retailers and senders, from the last 90 days on connect and then continuously through Gmail push notifications or polling. Reuse the session 9 parser.
2. Outlook: the same through Microsoft sign-in and Microsoft Graph.
3. Also add "Sign in with Google" and "Sign in with Apple" for accounts (the README lists them as missing), kept separate from inbox access.
4. Privacy is the product here: request the narrowest access available, never store full email bodies (only the extracted purchase fields and the message ID), encrypt tokens at rest, offer a clear "Disconnect and delete" button, and write a plain-English privacy explanation screen shown before connecting.
5. Write docs/google-verification.md describing what Google requires before public launch: read access to Gmail is a restricted scope that needs app verification and a yearly third-party security assessment. List the steps, costs and timing. Until that's done, the app runs in testing mode for up to 100 test users, and the forwarding address remains the default for everyone else.
6. Tests with mocked Gmail and Graph responses.

Needs from me: a Google Cloud project with OAuth credentials, a Microsoft app registration, and Apple sign-in keys (the session will list exact steps).
When done, open a pull request with the connect flow screenshots and the verification checklist.
```

## 11. Money dashboard and refund tracking

```
Returnly helps US shoppers return purchases before the return window closes. It makes two promises: teach people exactly how to return each item, and remind them until the return is done and the money is back. The stack is a vanilla JS front end, a Node 22 server, Postgres, and `npm test`. Read README.md, docs/, the current totals in the app, the reminder system and the email capture first.

Show users the money they've recovered and make sure every refund actually arrives.

1. Dashboard: money recovered (cash and store credit shown separately), money at stake right now with the next deadline, refunds on the way, and money lost to missed windows. Show this month, this year and all time, plus a simple chart of recovered money over time (load the dataviz skill first). Breakdown by store.
2. Refund tracking: after "I sent it back", expect a refund by the policy's typical timing. If no refund email or confirmation arrives by then, remind the user to check and give them the retailer's contact or refund-status link. Mark it overdue in the dashboard.
3. Store-credit wallet: track store credit and gift card balances from returns, with expiry dates if any, and remind users to use them before they expire.
4. "Missed it" honesty: when a window passes, record the loss, and where the policy allows, suggest options (manufacturer warranty, a price-adjustment policy, resale) without promising anything.
5. A shareable year-in-review card ("You got $412 back in 2026") with no personal details, as an image the user can save.
6. Accessible in light and dark mode at phone and desktop widths. Tests for every total.

When done, open a pull request with dashboard screenshots using realistic sample data.
```

## 12. iPhone and Android apps

```
Returnly helps US shoppers return purchases before the return window closes. It makes two promises: teach people exactly how to return each item, and remind them until the return is done and the money is back. The stack is a vanilla JS front end, a Node 22 server, Postgres, and `npm test`. Read README.md, docs/ and the installable-app and push work first.

Ship Returnly to the App Store and Google Play while keeping one codebase with the web app.

1. Wrap the existing front end with Capacitor (explain if you'd choose differently) for iOS and Android. Keep the web app working exactly as before.
2. Native push through Apple Push Notification service and Firebase Cloud Messaging, plugged into the existing reminder system next to web push, with the same notification actions.
3. Native camera for receipt scanning, with document edge detection if available.
4. Share sheet: share an order email, a screenshot or a PDF receipt from any app into Returnly, and it goes through receipt reading.
5. Widgets if practical: "Next return due" on the home screen.
6. Sign in with Apple is required on iOS when other social sign-ins exist; make sure it's in place.
7. App store readiness: icons, splash screens, privacy nutrition labels and data-safety forms matching what we actually collect, review notes explaining email access, and docs/app-store-release.md with the steps I take to submit.
8. Build instructions in the README for both platforms.

Needs from me: an Apple Developer account, a Google Play developer account and a Firebase project (the session will list exact steps). iOS builds need a Mac; the session will explain options such as a cloud build service.
When done, open a pull request with simulator screenshots and the release checklist.
```
