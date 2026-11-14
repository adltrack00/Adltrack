# Adltrack backend API

This is the reference for the Adltrack server's HTTP API, written for a developer building the iPhone and Android apps
against the same backend the web app uses. It describes the code on `main` as of 2026-11-14 (commit `9e5fd53`). The
machine-readable version is [`openapi.yaml`](openapi.yaml) (OpenAPI 3.1) in this folder.

Where the code lives: `server.js` starts everything, `server/app.js` holds every route, and the files it calls into are
named next to each group below (`server/team.js`, `server/billing.js` and so on).

---

## 1. The basics

| | |
|---|---|
| Base URL | The site's own origin, e.g. `https://<your-render-host>`. Every API path starts with `/api/`. |
| Format | JSON in, JSON out (`application/json; charset=utf-8`). Exceptions: file downloads, webhooks, the Apple sign-in callback, and redirect-based sign-in routes. |
| Server | Node 22, plain `node:http` (no Express). One process. |
| Database | Postgres when `DATABASE_URL` is set, otherwise a local JSON file (development only). |
| Files | An S3-compatible bucket (Cloudflare R2 in production) when `S3_*` is set, otherwise `data/files/`. |
| Caching | Every JSON answer has `Cache-Control: no-store`. |

### 1.1 Rules every write must follow

Every `POST`, `PUT` and `DELETE` that changes data (everything except the webhooks and the Outlook notification route)
goes through `checkWrite`:

1. **`Content-Type: application/json` is required**, even when there is no body. Otherwise the answer is `415 Send JSON.`
2. **If an `Origin` header is sent, its host must equal the request's `Host`** (or `X-Forwarded-Host`). Otherwise `403`.
   A native app usually sends no `Origin`, which passes this check.

Bodies have size limits on each route (listed below). Going over gives `413`. A body that isn't valid JSON gives `400 Invalid request.`

### 1.2 Errors

Every API error has the same shape:

```json
{ "error": "A sentence that can be shown to the person as it is." }
```

The doctor record adds `"needPin": true` when a PIN is needed or wrong. A `500` always says
`"Something went wrong. Please try again."` and the real error goes to the server log.

| Status | When |
|---|---|
| 400 | Something in the request is missing or not valid. The message says what. |
| 401 | Not signed in (`Please sign in.`), wrong password, or a webhook signature that doesn't check out. |
| 402 | The family's plan doesn't allow it (plan ended, or the team is full). |
| 403 | Signed in but not allowed (see the permissions in section 3), or a cross-site `Origin`. |
| 404 | Not found. Also the answer for files and admin routes the account may not see, so their existence isn't revealed. |
| 409 | Already exists (an email already signed up, an item id already used, someone already on the team). |
| 413 | Body too big, or a file over 10 MB. |
| 415 | `Content-Type` isn't JSON on a write. |
| 429 | Too many attempts (see rate limits in section 1.5). |
| 503 | A service the route needs isn't set up on this server (email, push, Stripe and so on). |

AI routes are different on purpose: when the AI isn't available they still answer `200`, with the result set to `null`
and a `reason` of `unavailable` (no API key), `limit` (rate limit reached) or `failed` (the model gave no usable answer).
The app then lets the person fill the form in by hand.

### 1.3 Signing in and the session

- Sessions are a cookie: **`rl_session`**, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production, valid **30 days**.
  The token is random; the server keeps only its SHA-256.
- `POST /api/signup`, `POST /api/login` and `POST /api/password/reset` set the cookie. `POST /api/logout` and
  `DELETE /api/account` clear it.
- Every route after the public ones (section 4.1) needs the cookie. Without it: `401 {"error":"Please sign in."}`.
- There is no bearer-token option today. A native app has to keep cookies (`URLSession` with `HTTPCookieStorage` on iOS,
  a persistent `CookieJar` on OkHttp for Android). See section 7 for what would help the native apps.

### 1.4 Which family's care plan: the `X-Patient` header

One account can be on several families' care teams (a paid caregiver who visits several homes). Each family is one patient's
care plan, identified by the **owner's user id** (a UUID).

- Send **`X-Patient: <owner id>`** on every request to say which family you mean. The ids come from
  `GET /api/me` → `team.patients[].id`.
- If the header is missing or names a family the person isn't on, the server uses their first family (or their own plan
  if they're on no team).
- The answer to several routes includes **`space`**, a short hash of the owner id. If it changes, the app is now looking at
  a different family and must drop its local copy and load again.

### 1.5 Rate limits

All limits are in memory, per server process, and reset when the server restarts.

| Limit | Key | Routes |
|---|---|---|
| 20 per 15 min | IP | signup, login, password forgot and reset, Google/Apple start |
| 10 wrong passwords then 15 min lock | email | login |
| 3 per hour | email | password forgot (it still answers `200`, it just doesn't send) |
| 60 per 15 min | IP | email action and unsubscribe links, invite info, invite accept |
| 60 per 15 min | user | team invites (add, resend) |
| 120 per 15 min | IP | doctor record open and file |
| 10 per 15 min | record link | wrong PINs on the doctor record |
| 60 per hour | user | AI reading: discharge papers, labels, vitals photos, receipts |
| 120 per hour | user | the assistant (Ada) |
| 30 per hour | user | pharmacy and drop-off lookups |
| 10 per hour | user | test notifications |
| 300 per hour | user | AI category sorting (Returnly policy engine) |
| 20 per hour | user | new store look-ups (Returnly) |
| 30 per hour | user | policy reports (Returnly) |

### 1.6 Files and photos

Photos and PDFs are sent **inside JSON as data URLs**: `data:<type>;base64,<data>`.

- Allowed types: `image/jpeg`, `image/png`, `image/webp`, and `application/pdf` where a route says so.
- The first bytes are checked against the type, so a renamed file is refused.
- Each file can be up to **10 MB**.
- Once saved, a file is referred to by its private URL **`/api/files/<uuid>`**. That URL is what goes in an item's
  `photo`, a dose's `photos`, a document's `files[].url` and so on. Reading it needs the session cookie, and only people on
  that family's team can read it.
- When an item is saved with `photo` set to a data URL, the server stores the file and swaps in its `/api/files/` URL. Sending
  the same URL back keeps the photo. Leaving `photo` out removes it.

---

## 2. The data model

The server stores each family's care plan as three things:

```json
{
  "purchases": [ /* items: medications, appointments, tasks, documents, report entries */ ],
  "settings":  { /* the plan's settings, vital signs, check-ins */ },
  "profile":   { /* the patient's name, photo and information */ },
  "updatedAt": "2026-11-13T18:22:05.123Z"
}
```

The list is still called `purchases` because Adltrack grew out of the Returnly app. Items are **free-form JSON objects**:
the server keeps every field the app sends. Some fields have their own database column (`server/items.js`, `FIELDS`);
everything else goes into a JSON `extra` column. Nothing the app saves is lost.

### 2.1 Items

Every item has `id` (text, 1 to 100 characters, the app makes a UUID) and `purchaseId` (made by the server if left out).
**One flag says what kind of item it is:**

| Flag | Kind | Main fields the app uses |
|---|---|---|
| `med: true` | Medication | `name`, `dose`, `instructions`, `route`, `frequency`, `times` (`["08:00","20:00"]`), `asNeeded`, `offTasks` (not on My Tasks), `status` (`"kept"` = not confirmed yet, `"deciding"` = confirmed and being taken, `"received"` = finished), `pickup` (waiting at the pharmacy), `pharmacy {name,address,phone}`, `prescriber {name,phone}`, `warnings`, `refills`, `quantity`, `refill`, `refilledOn`, `discardAfter`, `photo`, `doses[]`, `addedBy`, `discharge` (what the papers said) |
| `appt: true` | Appointment | `with`, `place`, `date`, `time`, `phone`, `note`, `remind` (`["daily","week","two"]`), `steps`, `status` |
| `task: true` | Planned task | `name`, `note`, `date`, `time`, `repeat` (`once`, `daily`, `weekly`), `until`, `by`, `addedAt`, `marks[]`, `photos` |
| `incident: true` | Incident | `at`, `kind` (`fall`, `refused`, `injury`, `behaviour`, `other`), `name`, `note`, `told`, `witnesses` (comma separated), `photos`, `by` |
| `symptom: true` | Symptoms | `at`, `name: "Symptoms"`, `note` (the person's own words), `photos`, `by` |
| `activity: true` | Something done now | `at`, `name` (what was done), `photos`, `by` |
| `doc: true` | Document | `name`, `category` (`discharge`, `insurance`, `prescriptions`, `results`, `visits`, `legal`, `other`), `files [{url,type}]`, `date`, `note`, `addedAt`, `scanned` |

Items also carry older Returnly fields (`retailer`, `price`, `channel`, `window`, `basis`, `outcome`, `intent` and so on).
The web app still fills them with fixed values on new medications; a native app can copy them from an existing item.

**A dose** (in a medication's `doses`):
`{ "at": "<ISO time it was marked>", "day": "YYYY-MM-DD", "slot": "08:00", "kind": "taken" | "skipped", "by": "George", "note": "...", "photos": ["/api/files/…"] }`

**A task mark** (in a task's `marks`): `{ "at", "day", "key", "kind", "by", "photos" }`.

### 2.2 Two people marking at once (`_seen`)

The app sends a whole item on every change. If two people mark doses on the same medication a moment apart, the second
save would wipe out the first. To stop that, `PUT /api/items/{id}` takes an extra field **`_seen`**: the list of marks
(doses and task marks) this device had already seen, each as `"<at>|<day>|<slot or key>|<kind>"`. A saved mark that
isn't in the item and isn't in `_seen` was added by someone else, so the server keeps it (`server/items.js`, `mergeMarks`).
Vital signs work the same way with `seenVitals` (a list of `at` times) on `PUT /api/settings`.

### 2.3 Settings

The keys the server itself reads:

| Key | What it is |
|---|---|
| `vitals` | Latest reading of each vital: `{ bp: "120/80", heart: "72", temp: "98.6", pain: "3", at }` |
| `vitalsLog` | Every reading (up to 400): `{ at, bp?, heart?, temp?, pain?, photos?, by? }` |
| `checkins` | Ada's check-ins. **Only the server writes this**; whatever the app sends is ignored. |
| `recordDocs` | Ids of the documents marked "Visible to doctor". |
| `notifications` | Whether this device allowed notifications. Anyone, viewers too, may change it. |
| `daily`, `time`, `gentle`, `timeZone` | The daily reminder: on or off, its time, gentle wording, time zone. |

### 2.4 Profile

`{ "name": "Rose", "photo": "/api/files/…", "info": { /* patient information fields: dob, sex, language, code, directive, allergies, … */ } }`.
The patient information fields are listed in `info.js` (`INFO_CARDS`).

### 2.5 Keeping in sync

How the web app does it (`account.js`), which the native apps can copy:

1. On start: `GET /api/me`, then `GET /api/data`. Keep the `space` value.
2. Each change: `POST /api/items` for a new item, `PUT /api/items/{id}` (with `_seen`) for a change, `DELETE /api/items/{id}`
   for a removal, and `PUT /api/settings` for settings or profile. The answer carries the saved item and the new `updatedAt`.
3. While the app is open: `GET /api/changes` every 2.5 seconds. If `space` changed, reload everything. If `updatedAt`
   changed, `GET /api/data` again.

---

## 3. Roles and permissions

Each person on a family's team has a **role** and three **ticks** (`perms`). The server checks every write
(`server/permissions.js`); hiding a button in the app is never enough.

| Role | `tasks` (My Tasks: mark doses and tasks, log vitals) | `addTasks` (add tasks) | `meds` (scan papers, change medications, documents, settings) | Admin powers |
|---|---|---|---|---|
| `admin` | if ticked | always | always | add people, plan and billing, doctor record |
| `caregiver` | always | if ticked | if ticked | no |
| `viewer` | never | never | never | no; can read everything, change nothing |

Someone on no team works on their own plan as an admin with every tick.

The names used in the route lists below:

- **any**: anyone signed in, viewers too.
- **tasks**, **addTasks**, **meds**: that tick is needed. Viewers always get `403`.
- **care**: `tasks` or `meds`.
- **admin**: role must be `admin`.
- **item rules**: what's needed depends on what changed in the item (see below).

**Item rules** for `POST` and `PUT /api/items`:

- A new task needs `addTasks`. A new incident, symptoms or activity needs `care`. Any other new item needs `meds`.
- When an item changes, each changed field is checked: `doses` and `marks` need `tasks` (unless dose `times` were also
  changed by someone with `meds`); refill and pickup steps, finishing a medication and back (`status` between `deciding` and
  `received`) need `care`; a task's own details need `addTasks`; anything else, or changing what kind of item it is, needs `meds`.

**Settings rules** for `PUT /api/settings`: changing `vitals` or `vitalsLog` needs `tasks`; any other setting or the profile
needs `meds`; `notifications` alone needs nothing.

The `403` messages, which can be shown as they are:

| Missing | Message |
|---|---|
| viewer | You can’t change this. |
| tasks / care | Only people with My Tasks can mark doses and tasks. Ask an admin to add it. |
| meds | Ask an admin to let you scan papers and change medications. |
| addTasks | Ask an admin to let you add tasks. |
| admin | Only an admin can do this. |

---

## 4. Endpoints

Each route below lists: who may call it, the body, what comes back and the errors to expect beyond the general ones.
"Body max" is the largest body the route reads.

### 4.1 Public (no sign-in)

#### `GET /api/health`
Liveness check. → `200 {"ok": true}`

#### `GET /api/contact`
The support email shown on the Support page. → `{"email": "help@example.com" | null}`

#### `POST /api/signup`
Makes an account and signs in. Body max 10 KB.
```json
{ "name": "George", "email": "george@example.com", "password": "at least 8 characters" }
```
→ `201` with the session cookie set:
```json
{ "user": { "email": "george@example.com", "name": "George" }, "data": null, "space": "a1b2c3d4e5f60718" }
```
Errors: `400` (name 1 to 40 characters, valid email, password 8 to 200 characters), `409` email already has an account, `429`.

#### `POST /api/login`
Body max 10 KB. `{ "email", "password" }` → `200` with the session cookie set:
```json
{ "user": { "email", "name", "admin"?: true }, "data": { "purchases": [], "settings": {}, "profile": {}, "updatedAt": "…" } | null, "space": "…" }
```
Errors: `401 Email or password is incorrect.`, `429` (also after 10 wrong passwords for that email).

#### `POST /api/logout`
Ends this session and clears the cookie. → `{"ok": true}`

#### `POST /api/password/forgot`
Emails a reset link valid for one hour. Answers the same whether or not the email has an account. Body: `{ "email" }`.
→ `{"ok": true}`. Errors: `400`, `429`, `503` when email isn't set up.

#### `POST /api/password/reset`
Body: `{ "token": "<from the email link>", "password": "<new>" }`. Signs out every other device and signs this one in.
→ same shape as login. Errors: `400` (password too short, or the link expired or was used).

#### `GET /api/auth/providers`
Which social sign-ins are set up. → `{ "google": true, "apple": false }`

#### `GET /api/auth/google/start`, `GET /api/auth/apple/start`
Browser redirect (`302`) to Google or Apple. Sets a short-lived `rl_oauth` cookie that ties the callback to this browser.
If the provider isn't set up: redirect to `/signin.html?error=unavailable`.

#### `GET /api/auth/google/callback`, `POST /api/auth/apple/callback`
Where Google and Apple send the person back (Apple uses a form post). Signs in, or makes an account from the verified
email, then redirects to `/signin.html?signed-in=google|apple` with the session cookie set. On failure redirects to
`/signin.html?error=expired|cancelled|email|failed`.

#### `POST /api/invite/info`
What an invite link shows before signing in. Body: `{ "token": "<from join.html#t=…>" }`.
→ `{ "inviter": "Rose", "name": "Maria", "email": "maria@example.com", "role": "caregiver" }`.
Errors: `400` expired (invites last 14 days) or already used, `429`.

#### `POST /api/email/act`
The buttons in reminder emails, signed for one account, item and action. Body: `{ "token" }`.
→ `{ "ok": true, "action": "snooze" | "sent" | "keep", "name": "<item name>" }`. Errors: `400` expired link, `404`, `429`.
(Inherited from Returnly.)

#### `POST /api/email/unsubscribe`
Turns off one kind of reminder email. Either JSON `{ "token" }`, or the mail app's one-click form post with `?t=<token>`
in the URL. → `{ "ok": true, "kind": "daily" | "unopened" }`. Errors: `400`, `429`.

#### `POST /api/record/open`
The doctor record, opened by scanning the For EMS code (`/record.html#<token>`). No account needed. Body max 2 KB:
`{ "token": "<32 to 64 characters>", "pin"?: "1234" }`. Each opening is logged for the family.
→
```json
{ "record": {
    "name": "Rose Smith", "photo": true,
    "info": { /* patient information */ },
    "line": "Goes by Rosie · Born 1941-03-02 · 85 years old · Female · English",
    "code": "Full code", "papers": "…", "allergies": "…",
    "rows": [ { "label": "Primary doctor", "value": ["Dr. Lee"] } ],
    "meds": [ { "name", "how", "times": ["08:00"], "unconfirmed": false, "pharmacy", "prescriber", "warnings", "taken": 54, "skipped": 2 } ],
    "vitals": [ { "at", "bp"?, "heart"?, "temp"?, "pain"? } ],
    "symptoms": [ { "at", "name", "note" } ],
    "incidents": [ { "at", "name", "note" } ],
    "documents": [ { "id", "name", "category", "date", "pages": [ { "type": "image" | "application/pdf" } ] } ],
    "since": "2026-10-15", "at": "2026-11-14T01:00:00.000Z"
} }
```
Vitals, symptoms, incidents and dose counts cover the last 30 days. Errors: `404` no such code (or it was replaced),
`401` with `"needPin": true` when a PIN is needed or wrong, `429`.

#### `POST /api/record/file`
One page of a shared document, or the patient's photo, from the doctor record. Body:
`{ "token", "pin"?, "doc": "<document id>", "page": 0 }` or `{ "token", "pin"?, "photo": true }`.
→ the file itself (image or PDF), not JSON. Errors as for `/api/record/open`.

### 4.2 Account

All need the session cookie.

#### `GET /api/me` (any)
Who is signed in and which family's plan they're looking at.
```json
{
  "user": { "email": "george@example.com", "name": "George", "admin"?: true, "passwordless"?: true },
  "team": {
    "role": "admin" | "caregiver" | "viewer",
    "perms": { "tasks": true, "addTasks": true, "meds": true },
    "owner": true,
    "changedBy"?: "Rose",
    "patient": "<owner id of the family on screen>",
    "patients": [ { "id": "<owner id>", "name": "Rose", "photo": "/api/files/…" | "", "by": "<name of the family's owner>" } ]
  },
  "space": "a1b2c3d4e5f60718"
}
```
`passwordless` means the account was made with Google or Apple. `admin` here means a site admin (`ADMIN_EMAILS`), not a family admin.

#### `DELETE /api/account` (any)
Deletes the account, its own care plan and every file, and signs out. Body: `{ "password" }`; an account without a
password sends its email address as `password` instead. → `{"ok": true}`. Errors: `401` wrong password or email.

### 4.3 Care team (`server/team.js`)

#### `GET /api/team` (any)
```json
{
  "me": { "role": "admin", "perms": { … }, "owner": true },
  "members": [ { "id": "<uuid>", "name": "Maria", "role": "caregiver", "perms": { … }, "status": "invited" | "joined",
                 "owner": false, "you": false, "email"?: "…", "phone"?: "+15551234567", "invitedAt"?: "…" } ],
  "plan"?: { "status": "none" | "trial" | "paid" | "lapsed", "canAdd": true, "tier": "Family" | null }
}
```
`email`, `phone`, `invitedAt` and `plan` are only shown to admins. When nobody has been added yet, the owner appears with id `"owner"`.

#### `POST /api/team/members` (admin)
Adds someone and sends the invite by email and text (when set up). Body max 5 KB:
```json
{ "name": "Maria", "email": "maria@example.com", "phone"?: "(555) 123-4567", "role": "caregiver",
  "perms"?: { "tasks": true, "addTasks": false, "meds": false } }
```
→ `201 { "member": { … }, "invite": { "link": "https://…/join.html#t=…", "emailed": true, "texted": true } }`.
The link always comes back so the admin can share it another way. The first person added starts the family's free trial.
Errors: `400`, `402` plan ended or team full, `403` not an admin, `409` email already on the team, `429`.

#### `PUT /api/team/members/{id}` (admin)
Changes a person. Any of `name`, `phone`, `role`, `perms`. → `{ "member": { … } }`.
Errors: `400` (the owner must stay an admin), `403`, `404`.

#### `DELETE /api/team/members/{id}` (admin)
→ `{"ok": true}`. Errors: `400` (the owner can't be removed), `403`, `404`.

#### `POST /api/team/members/{id}/invite` (admin)
Sends the invite again with a new link. → `{ "invite": { "link", "emailed", "texted" } }`.
Errors: `402` plan ended, `404` already joined, `429`.

#### `POST /api/team/leave` (any)
Leaves the family named in `X-Patient`. → `{"ok": true}`. Errors: `400` (not on another team, or it's your own).

#### `POST /api/invite/accept` (any)
Joins the family from an invite link. Body: `{ "token" }`. → the same as `GET /api/team`, plus `"patient": "<owner id>"`.
Send that id as `X-Patient` from then on. Errors: `400` expired, or it's your own team, `429`.

### 4.4 Plan and billing (`server/billing.js`)

Admins only (`403 Only an admin can see and pay for this family’s plan.` otherwise). Plans: **Solo** $9 (1 person),
**Family** $19 (up to 5), **Care team** $29 (up to 10), monthly, in USD, with a 14-day free trial. Payment goes through
Stripe's own pages; no card number ever reaches Adltrack.

#### `GET /api/plan`
```json
{
  "tiers": [ { "id": "solo", "name": "Solo", "amount": 900, "people": 1 }, … ],
  "currency": "usd", "interval": "month", "trialDays": 14,
  "status": "none" | "trial" | "paid" | "lapsed", "tier": "family" | null, "people": 3,
  "trialEnds": "…" | null, "periodEnd": "…" | null, "cancelAtEnd": false,
  "card": true, "payments": true, "texts": 4,
  "receipts": [ { "id", "at", "amount": 1900, "currency": "usd", "url": "https://invoice.stripe.com/…" } ]
}
```

#### `POST /api/plan/trial`
Starts the free trial. → the plan as above. Errors: `400` already had one.

#### `POST /api/plan/checkout`
Body: `{ "tier": "solo" | "family" | "team" }`. → `{ "url": "https://checkout.stripe.com/…" }`. Open that page; Stripe sends the
person back to `/app.html?plan=paid&session=<id>` or `/app.html?plan=cancelled`.
Errors: `400` (no such plan, team bigger than the plan, already paid), `503` Stripe not set up.

#### `POST /api/plan/confirm`
Back from Stripe. Body: `{ "session": "cs_…" }`. → the plan. Errors: `400` not found or not finished.

#### `POST /api/plan/change`
Moves a paid family to another plan. Body: `{ "tier" }`. → the plan. Errors: `400`, `503`.

#### `POST /api/plan/portal`
Stripe's billing page (change card, invoices, cancel). → `{ "url" }`. Errors: `400` no card yet, `503`.

### 4.5 The care plan: data, items and settings (`server/data.js`)

#### `GET /api/data` (any)
The whole care plan. → `{ "data": { "purchases": [ … ], "settings": { … }, "profile": { … }, "updatedAt": "…" } | null, "space": "…" }`

#### `GET /api/changes` (any)
Cheap check of whether anything changed. → `{ "updatedAt": "…", "space": "…" }`

#### `PUT /api/data` (admin with tasks)
Replaces the whole plan at once. Kept for older versions of the web app; **new apps should use the per-item routes.**
Body max 12 MB: `{ "purchases": [ … up to 5000 ], "settings"?: { … }, "profile"?: { … } }`. → `{ "updatedAt" }`.

#### `GET /api/items` (any)
→ `{ "items": [ … ], "updatedAt": "…" | null }`

#### `POST /api/items` (item rules)
Adds one item (section 2.1). Body max 12 MB (photos inline as data URLs). → `201 { "item": { … }, "updatedAt": "…" }`.
A new item with `incident: true` alerts everyone on the care team straight away.
Errors: `400 Invalid item.`, `403`, `409 This item already exists.` (then `PUT` instead).

#### `PUT /api/items/{id}` (item rules)
Saves the whole item. Add `_seen` (section 2.2). → `{ "item": { … }, "updatedAt": "…" }`. Errors: `400`, `403`.

#### `DELETE /api/items/{id}` (meds)
Deletes the item and its photos. → `{ "ok": true, "updatedAt": "…" }`. Errors: `403`, `404`.

#### `PUT /api/items/{id}/label`, `DELETE /api/items/{id}/label` (meds)
A separate attached file for one item (from Returnly, where it was the return label). Body for PUT: `{ "data": "<data URL, image or PDF>" }`.
→ `{ "item", "updatedAt" }`. Errors: `400`, `404`.

#### `PUT /api/settings` (settings rules)
Saves the settings and the profile together. Body max 12 MB:
`{ "settings": { … }, "profile": { … }, "seenVitals"?: [ "<at>", … ] }`.
`profile.photo` may be a data URL (stored and swapped for its URL). `settings.checkins` is always kept as the server has it.
→ `{ "settings": { … }, "profile": { … }, "updatedAt": "…" }`.

### 4.6 Files

#### `POST /api/files/proof`
A photo for a dose, a task, vitals or a report entry. Body max 14 MB: `{ "data": "<image data URL>", "for"?: "task" | "incident" | "symptom" | "activity" }`.
Who may: `for: "task"` needs addTasks; `incident`, `symptom`, `activity` need care; nothing (a dose or vitals photo) needs tasks.
→ `201 { "url": "/api/files/<uuid>" }`. Put that URL in the item's `photos`. Errors: `400` not a JPG, PNG or WebP.

#### `POST /api/files/document` (meds)
A page of a document, photo or PDF. Body max 14 MB: `{ "data": "<data URL>" }`. → `201 { "url": "/api/files/<uuid>", "type": "image/jpeg" }`.

#### `GET /api/files/{id}` (any, on a family the person is on)
The file itself, with its own content type. Cached privately for a year (`immutable`), since a file never changes.
→ `404` for a file that doesn't exist or that this person may not see.

### 4.7 Scanning and AI reading

Photos go to Claude (Opus 5.5 for papers and labels; vitals and the assistant use smaller settings) and come back as a
draft the person checks before saving. Nothing is saved as a medication here. All are limited per user (section 1.5).

#### `POST /api/discharge/read` (meds)
Reads one set of hospital discharge papers. The pages are kept privately (later shown on the Documents page).
Body max 60 MB:
```json
{ "purchaseId": "<uuid the app makes for this scan>", "pages": [ "<data URL, image or PDF>", … up to 8 ] }
```
→
```json
{
  "purchaseId": "…", "files": [ "/api/files/…" ],
  "papers": { "problem", "hospital", "discharged", "medications": [ … ], "pharmacy", "appointments", "warningSigns", "contacts", "notes" },
  "draft": {
    "products": [ { "name": "Lisinopril 10 mg", "dose", "route", "frequency", "times": ["08:00"], "instructions", "duration",
                    "medStatus": "new" | "changed" | "continue" | "unknown", "prescriber": { "name", "phone" },
                    "pharmacy": { "name", "address", "phone" } | null, "page": 1, "price": "" } ],
    "discharge": { "hospital", "discharged", "appointments": [ { "with", "place", "date", "time", "phone", "note" } ],
                   "warningSigns": [ { "text", "heading", "urgent" } ], "contacts": [ { "name", "phone" } ] },
    "notes": [ "What couldn’t be read, to show under the Confirm card." ]
  }
}
```
When the AI isn't available: `{ "purchaseId", "files", "papers": null, "reason": "unavailable" | "limit" | "failed" }`.
Medications the papers say to stop are left out of `draft.products` and named in `notes`.

#### `POST /api/label/read` (meds)
Reads a pharmacy bottle label (or the pharmacy's printed sheet) and, if given, compares it with what the papers say.
Body max 30 MB:
```json
{ "photos": [ "<image data URL>", … up to 3 ], "source"?: "bottle" | "leaflet",
  "med"?: { "name", "instructions", "dose", "route", "frequency" } }
```
→
```json
{
  "label": { "problem": null | "blurry" | "dark" | "cropped" | "not_label", "name", "strength", "form", "directions", "pillLooks",
             "pharmacy": { "name", "address", "phone" }, "prescriber", "quantity", "refills", "refillBy", "filled",
             "discardAfter", "warnings": [ … ], "mainPhoto": 0, "note": "" },
  "check": [ { "field": "Medication" | "Strength" | "Directions", "papers", "bottle", "match": true | false | null } ]
}
```
`check` is empty when no `med` was sent. The photos aren't saved here; the app saves them with the medication.

#### `POST /api/vitals/read` (tasks)
Reads one photo of a blood pressure cuff or thermometer. Body max 15 MB: `{ "photo": "<image data URL>" }`.
→ `{ "reading": { "sys": "128", "dia": "82", "pulse": "71", "temp": "98.6", "problem": "" } }`. Empty strings for numbers it
couldn't read; temperature is always °F.

#### `POST /api/assistant` (any)
Ada, the in-app assistant (Claude Haiku 5.5). The app sends the conversation and a small list of the plan (names, dates and
ids, no photos). Ada never saves anything and never gives medical advice. Body max 200 KB:
```json
{
  "messages": [ { "role": "user" | "assistant", "text": "When is her next appointment?" } ],
  "plan": {
    "medications": [ { "id", "name", "how", "times", "slots", "status", "doctor", "pharmacy", "given" } ],
    "appointments": [ { "id", "name", "date", "time", "place", "status" } ],
    "tasks": [ { "id", "name", "when" } ],
    "documents": [ { "id", "name", "category", "date" } ],
    "contacts": [ { "id", "name", "kind", "phone" } ]
  },
  "today": "2026-11-14", "weekday": "Saturday", "name": "Ada", "patient": "Rose"
}
```
Only the last 8 messages are used, and the last must be from the user.
→
```json
{ "answer": {
    "kind": "find" | "open" | "task" | "appointment" | "medication" | "document" | "vitals" | "dose" | "activity" | "symptom" | "incident" | "answer" | "medical" | "other",
    "reply": "Her next appointment is Tuesday at 10:30 AM with Dr. Lee.",
    "ids": [ "<item ids to show>" ],
    "open": "<page name>" | "",
    "task": { "what", "note", "date", "time", "repeat" } | null,
    "appointment": { "with", "place", "date", "time", "note" } | null,
    "fields": { "name", "category", "sys", "dia", "pulse", "temp", "pain", "med_id", "slot", "mark", "note", "witnesses", "incident" } | null
} }
```
Or `{ "answer": null, "reason": "unavailable" | "limit" | "failed" }`.

#### `POST /api/places/pharmacies` (any)
The nearest branches of a pharmacy (or the three nearest pharmacies when no name is given), using Google Places.
The location is used for this request only. Body: `{ "name"?: "CVS", "lat": 40.7, "lng": -74.0 }`.
→ `{ "places": [ { "id", "name", "partner", "address", "miles": 0.8, "openNow": true, "hours": [ "Monday: 8 AM – 10 PM", … ], "directions": "https://…" } ] }`,
or `{ "places": [], "reason": "unavailable" | "limit" | "failed" }`. Errors: `400` bad location.

### 4.8 Ada's check-ins (`server/checkins.js`)

After symptoms or a high or low blood pressure reading, Ada checks in every 30 minutes until the person says they went to
the ER or didn't. "I can't get to the ER" alerts the whole team straight away, and again after 10 minutes if nobody is coming.

A check-in looks like this:
```json
{
  "id": "<uuid>", "kind": "symptom" | "bp", "about": "stomach pain", "bp": "", "symptomId": "<item id>" | null,
  "name": "George", "patient": "Rose", "self": false, "mine": true,
  "startedAt": "…", "next": "…" | null, "askedAt": "…" | null,
  "answers": [ { "at", "still": true, "score": 6 } ],
  "help": { "at", "score": 8, "again": "…" | null, "replies": [ { "name": "Maria", "coming": true, "at", "mine": false } ] } | null,
  "end": { "at", "er": "went" | "not" | "replaced" | "quiet" } | null
}
```

#### `GET /api/checkins` (any)
The family's check-ins (the last 40). → `{ "checkins": [ … ] }`

#### `POST /api/checkins` (care)
Starts one. Body max 4 KB: `{ "kind": "symptom", "about": "stomach pain", "symptomId"?: "<item id>" }` or
`{ "kind": "bp", "bp": "152/95" }`. → `201 { "checkin": { … } }`.
Errors: `400` (no symptoms given, or a blood pressure that isn't high or low: 140+/90+ or under 90/60).

#### `POST /api/checkins/{id}` (only the person it's for)
Answers it. Body is one of:
- `{ "still": true, "score": 1-10 }` or `{ "still": false }`
- `{ "help": true }`: "It's really bad, I can't get to the ER"
- `{ "end": "went" | "not" }`: went to the ER, or didn't

→ `{ "checkin": { … } }`. Errors: `400`, `403` someone else's, `404`.

#### `POST /api/checkins/{id}/reply` (any on the team, viewers too)
Answers a request for help. Body: `{ "coming": true | false }`. "Coming" tells the person who asked.
→ `{ "checkin": { … } }`. Errors: `400` (own request, or `coming` missing), `404`.

### 4.9 Notifications and reminders (`server/reminders.js`)

Today notifications are **Web Push** only (VAPID). The server accepts subscriptions only from browser push services
(`fcm.googleapis.com`, `android.googleapis.com`, `updates.push.services.mozilla.com`, `*.push.apple.com`, `notify.windows.com`).
Native APNs or FCM device tokens are not supported yet (section 7).

A push message carries:
```json
{ "title": "Rose · 8:00 AM: Lisinopril 10 mg, 1 tablet", "body": "Take 1 tablet by mouth once daily",
  "itemId": "<item id>", "url": "app.html?patient=…&remind=…",
  "actions": [ { "action": "taken", "title": "Taken" }, { "action": "snooze15", "title": "Snooze 15 minutes" }, { "action": "skipped", "title": "Skipped" } ],
  "dose"?: { "date": "2026-11-14", "time": "08:00", "ids": [ "<med ids>" ], "patient": "<owner id>" },
  "tag": "dose … 2026-11-14 08:00" }
```

#### `GET /api/push/key` (any)
→ `{ "key": "<VAPID public key>" | null }` (null when push isn't set up).

#### `POST /api/push/subscribe` (any)
Body: `{ "subscription": { "endpoint": "https://…", "keys": { "p256dh": "…", "auth": "…" } }, "timeZone": "America/New_York" }`.
→ `{"ok": true}`. Errors: `400` unsupported subscription, `503` push not set up.

#### `POST /api/push/unsubscribe` (any)
Body: `{ "endpoint" }`. → `{"ok": true}`

#### `POST /api/push/test` (any)
Sends a test to this device (a real next dose when there is one). Body: `{ "endpoint" }`. → `{ "sent": true | false }`. Errors: `429`.

#### `POST /api/reminders/claim` (any)
The open app's daily reminder, claimed once a day so push and the app never both show it.
Body: `{ "date": "YYYY-MM-DD" (the device's date, within a day of the server's), "time"?: "HH:MM" }`.
→ `{ "reminder": { … } | null, "reminders": [ … one per family ] }`, or `{ "reminder": null, "reminders": [], "quiet": true }`
inside quiet hours. Errors: `400 Invalid date.`

#### `POST /api/reminders/dose` (tasks)
The buttons on a dose notification. Body max 8 KB: `{ "action": "taken" | "skipped" | "snooze15", "date", "time": "08:00", "ids": [ "<med ids>", … up to 20 ] }`.
Taken and skipped mark each medication still unmarked, in the name of the person who tapped. Snooze sends the same
reminder again in 15 minutes. → `{ "items": [ <saved medications> ] }` (empty for snooze). Errors: `400 Invalid action.`

#### `POST /api/reminders/action` (care, on whichever family the item is on)
Older notification buttons from Returnly. Body: `{ "action": "snooze" | "sent" | "keep", "itemId", "today"? }`. → `{ "item" }`.

#### `POST /api/reminders/opened` (any)
The daily reminder was opened, so no follow-up email is sent. → `{"ok": true}`

#### `GET /api/alerts/prefs`, `PUT /api/alerts/prefs` (any)
This person's own alert choices, the same on every family they're on. Incidents always arrive.
```json
{ "prefs": { "doses": true, "missed": true, "endOfDay": true, "endOfDayTime": "20:00", "quietStart"?: "22:00", "quietEnd"?: "07:00" } }
```
`PUT` takes any of these fields (send `""` for quiet hours to clear them) and returns the full `prefs`. `503` when reminders aren't running.

#### `GET /api/email/prefs`, `PUT /api/email/prefs` (any)
Which reminder emails are on. → `{ "available": true, "daily": true, "unopened": true }`. `PUT` takes `{ "daily"?: bool, "unopened"?: bool }`.

### 4.10 Doctor record, family side (`server/record.js`)

#### `GET /api/record` (any)
→ `{ "on": false }` or `{ "on": true, "link": "https://…/record.html#<token>", "pin": true, "createdAt": "…", "views": [ "<ISO time>", … ] }`

#### `PUT /api/record` (admin)
Turns it on, or makes a new code (the old one stops working). Body: `{ "pin"?: "4 to 6 digits" | "" }`. → the status above.

#### `DELETE /api/record` (admin)
Turns it off. → `{ "on": false }`

### 4.11 Notices (any)

Messages shown once when the app opens (from Returnly: a store changed its policy).
- `GET /api/notices` → `{ "notices": [ … ] }`
- `POST /api/notices/read` with `{ "ids": [ "<uuid>", … up to 50 ] }` → `{"ok": true}`

---

## 5. Webhooks (called by other services, not by the app)

| Route | Caller | Check |
|---|---|---|
| `POST /api/stripe/webhook` | Stripe: checkout finished, subscription and invoice changes | `Stripe-Signature` with `STRIPE_WEBHOOK_SECRET`, at most 5 min old. → `{"received": true}` |
| `POST /api/inbound/email` | Resend `email.received` (Returnly's forwarded order emails) | Svix signature with `RESEND_WEBHOOK_SECRET`. → `{"accepted": bool, "reason"?}` |
| `POST /api/inbox/outlook/notify` | Microsoft Graph mail notifications (Returnly) | Echoes `validationToken` as plain text, otherwise `202` |

---

## 6. Routes inherited from Returnly

These still exist and work but belong to the old returns app. **The Adltrack mobile apps don't need them.** They're listed so
nothing is hidden. Most were documented in Returnly's own notes in `docs/`.

| Route | Who | What |
|---|---|---|
| `GET /api/retailers`, `GET /api/retailers?match=<name>`, `GET /api/retailers/{id}` | public | Store return policies |
| `POST /api/policy` | any | Applies a store's return policy to one item |
| `POST /api/policy/report` | any | "Is this wrong?" report on a policy |
| `POST /api/places/nearest` | any | Nearest drop-off for a store's returns |
| `POST /api/receipts/read` | meds | Reads a shopping receipt (up to 4 pages) |
| `GET /api/purchases`, `PUT /api/purchases/{id}/receipt` | any / meds | Purchases and their receipt files |
| `GET /api/inbox`, `POST /api/inbox/address`, `POST /api/inbox/senders` | any | Order emails: forwarding address and senders |
| `GET /api/inbox/{gmail\|outlook}/start`, `…/callback`, `POST …/disconnect` | any | Connecting Gmail or Outlook |
| `GET /api/admin/review`, `POST /api/admin/stores/approve`, `POST /api/admin/reports/{id}/resolve`, `POST /api/admin/flags/{id}` | site admins (`ADMIN_EMAILS`) | Reviewing looked-up store policies. Everyone else gets `404`. |

---

## 7. Notes for the native apps

None of these are changes made here; they're the gaps a developer will hit, so they can be planned.

1. **Cookies, not tokens.** Sign-in sets an `HttpOnly` cookie. Native HTTP clients can store it, but a bearer token
   (for example `Authorization: Bearer <token>` checked the same way as the cookie) would be simpler and safer on a phone.
2. **Push notifications.** Only browser Web Push is accepted. Native apps need APNs (iPhone) and FCM (Android) device tokens
   registered and sent from the server, alongside the current Web Push sending in `server/reminders.js`.
3. **Google and Apple sign-in** are browser redirect flows that end on `/signin.html`. Native apps usually use the platform's
   own sign-in and send the ID token to the server, which would need a new route that checks that token.
4. **Photos as data URLs inside JSON.** This works but is heavy on a phone (base64 adds about a third). Multipart uploads would
   be lighter, and the 10 MB per file limit stays.
5. **Live updates by polling** `/api/changes` every 2.5 seconds. Fine while the app is open; it should stop in the background.
6. **Item shapes are defined by the web app**, not checked by the server (section 2.1). The native apps must write items the
   same way the web app does, or the web app won't show them right. The web app code that builds each kind is the reference:
   `assistant.js` (`ADA_READY`) and `home.js` (`newAppt`).
7. **The `Origin` check** passes when no `Origin` header is sent. A web view inside a native app that sends a different origin
   would be refused.

---

## 8. Server setup this API depends on

| Setting | Needed for |
|---|---|
| `DATABASE_URL` | Postgres (required in production) |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | File storage on R2 (required in production) |
| `ANTHROPIC_API_KEY` | Reading papers, labels and vitals photos; Ada |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push notifications |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Text invites and urgent texts |
| `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`, `EMAIL_TOKEN_SECRET` | Emails: password reset, invites, reminders |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PLAN_TRIAL_DAYS` | Paying for plans |
| `GOOGLE_PLACES_API_KEY` | Pharmacy look-ups |
| Google / Apple / Microsoft OAuth settings (see `server/oauth.js`), `INBOX_TOKEN_KEY` | Social sign-in; Returnly inboxes |
| `SUPPORT_EMAIL`, `ADMIN_EMAILS` | Support address; site admins |
| `PORT` (default 4174), `HOST`, `NODE_ENV` | Running the server |
