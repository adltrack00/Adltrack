/* Account storage. Postgres when DATABASE_URL is set (production on Render); a JSON file for local development.
   Both keep the same shape: users and sessions; purchases (one per receipt or order) and their items; file records (the bytes
   live in file storage, see storage.js); settings and profile in user_data; and the background job queue. */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { columnsSql, encode, decode, JSON_COLUMNS, FIELDS } = require('./items');

const SCHEMA = `
create table if not exists users (
  id uuid primary key,
  email text not null unique,
  name text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);
create table if not exists sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null
);
create index if not exists sessions_user_idx on sessions(user_id);
create table if not exists user_data (
  user_id uuid primary key references users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists files (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('item', 'receipt', 'profile', 'label')),
  storage_key text not null unique,
  content_type text not null,
  size integer not null,
  sha256 text not null,
  created_at timestamptz not null default now()
);
create index if not exists files_user_idx on files(user_id);
create table if not exists purchases (
  user_id uuid not null references users(id) on delete cascade,
  id text not null,
  store text,
  channel text,
  order_number text,
  purchased date,
  delivered date,
  source text not null default 'manual' check (source in ('receipt', 'email', 'manual')),
  retailer_id text,
  receipt_file_id uuid references files(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
-- Further pages of a long receipt (file ids); the first page is receipt_file_id.
alter table purchases add column if not exists receipt_pages jsonb not null default '[]';
create table if not exists items (
  user_id uuid not null references users(id) on delete cascade,
  id text not null,
  purchase_id text not null,
  position integer not null default 0,
  photo_file_id uuid references files(id) on delete set null,
  ${columnsSql()},
  extra jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, purchase_id) references purchases(user_id, id)
);
create index if not exists items_purchase_idx on items(user_id, purchase_id);
create table if not exists jobs (
  id bigserial primary key,
  name text not null,
  payload jsonb not null default '{}',
  unique_key text,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  run_at timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  last_error text,
  locked_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists jobs_due_idx on jobs(run_at) where status in ('queued', 'running');
create unique index if not exists jobs_unique_active_idx on jobs(unique_key) where status in ('queued', 'running');
create table if not exists retailers (
  id text primary key,
  name text not null,
  status text not null,
  current_version integer not null,
  checked date not null,
  aliases jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists retailer_policies (
  retailer_id text not null references retailers(id) on delete cascade,
  version integer not null,
  checked date not null,
  policy jsonb not null,
  loaded_at timestamptz not null default now(),
  primary key (retailer_id, version)
);
-- Nearby drop-offs for one store or partner around one area (about 1 km): place ids and coordinates only, which the places
-- provider allows keeping for up to 30 days. Never linked to a user.
create table if not exists place_cache (
  key text primary key,
  places jsonb not null,
  fetched_at timestamptz not null default now()
);
-- Web Push: one row per browser or installed app that allowed notifications, with the device's time zone.
create table if not exists push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  time_zone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on push_subscriptions(user_id);
-- The last local date each user's daily reminder was claimed (by push or by the open app), so it's sent once a day.
create table if not exists reminder_days (
  user_id uuid primary key references users(id) on delete cascade,
  last_date date not null,
  sent_by text not null,
  updated_at timestamptz not null default now()
);
-- The day a reminder was opened (tapped, or an email link used), so an unopened one can be followed by email.
alter table reminder_days add column if not exists opened_date date;
-- Reminder email types an account unsubscribed from ('daily': when push isn't set up; 'unopened': 3 days before a deadline).
create table if not exists email_optouts (
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('daily', 'unopened')),
  created_at timestamptz not null default now(),
  primary key (user_id, kind)
);
-- Password reset links: only a SHA-256 of each token is stored; each works once, for one hour.
create table if not exists password_resets (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null
);
create index if not exists password_resets_user_idx on password_resets(user_id);
-- Stores we don't have a checked policy for, looked up on the web (status found / not_found / failed / approved). The policy
-- is "unverified" until an admin approves it. One row per normalized store name, shared by every user who buys there.
create table if not exists store_lookups (
  key text primary key,
  name text not null,
  status text not null check (status in ('pending', 'found', 'not_found', 'failed', 'approved')),
  policy jsonb,
  retailer_id text,
  looked_up_at timestamptz not null default now()
);
-- Which accounts hit each looked-up store, so the admin page can rank them by usage.
create table if not exists store_lookup_users (
  key text not null references store_lookups(key) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  first_seen timestamptz not null default now(),
  primary key (key, user_id)
);
-- "Is this wrong?" reports from the Return card, kept for review.
create table if not exists policy_reports (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  retailer_id text,
  store text not null,
  item_name text,
  policy_version integer,
  policy_line text,
  note text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now()
);
-- Policy versions an admin approved at runtime (an unverified store, or a change the freshness job flagged). They sit on top of
-- policies/*.json until a file with the same or a higher version is committed.
create table if not exists approved_policies (
  retailer_id text not null,
  version integer not null,
  policy jsonb not null,
  approved_by text not null,
  reason text not null,
  approved_at timestamptz not null default now(),
  primary key (retailer_id, version)
);
-- The weekly freshness job's last copy of each official source page: a hash and the policy phrases found in it.
create table if not exists source_snapshots (
  url text primary key,
  hash text not null,
  phrases jsonb not null,
  fetched_at timestamptz not null default now()
);
-- Meaningful changes the freshness job found, waiting for review. Nothing changes automatically.
create table if not exists policy_flags (
  id uuid primary key,
  retailer_id text not null,
  url text not null,
  hash text not null,
  added jsonb not null,
  removed jsonb not null,
  holiday boolean not null default false,
  proposed jsonb,
  status text not null default 'open' check (status in ('open', 'approved', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (retailer_id, url, hash)
);
-- Messages for one account (for example "Target changed its return policy"), shown the next time the app opens.
create table if not exists notices (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  text text not null,
  item_id text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notices_user_idx on notices(user_id) where read_at is null;
-- Purchases from email. Each account's private forwarding address (u-<token>@ the inbound domain), and the extra senders
-- it accepts: Gmail addresses whose forwarding request reached this address.
create table if not exists inbox_addresses (
  user_id uuid primary key references users(id) on delete cascade,
  token text not null unique,
  senders jsonb not null default '[]',
  request jsonb,
  created_at timestamptz not null default now()
);
-- A connected Gmail or Outlook inbox. tokens is encrypted (INBOX_TOKEN_KEY); only a hash of the Graph clientState is kept.
create table if not exists inbox_connections (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  provider text not null check (provider in ('gmail', 'outlook')),
  email text not null,
  tokens text not null,
  status text not null default 'active' check (status in ('active', 'expired')),
  synced_at timestamptz,
  subscription_id text,
  subscription_secret text,
  subscription_expires timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, provider)
);
-- What was read from each email: the message id and the extracted fields. Email bodies are never stored.
create table if not exists inbox_messages (
  user_id uuid not null references users(id) on delete cascade,
  key text not null,
  connection_id uuid references inbox_connections(id) on delete cascade,
  kind text not null,
  order_key text,
  fields jsonb not null default '{}',
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);
-- Orders found in email, waiting on Your purchases until the user opens them. id is the purchase id their items join.
create table if not exists email_orders (
  user_id uuid not null references users(id) on delete cascade,
  id text not null,
  connection_id uuid references inbox_connections(id) on delete set null,
  order_key text not null,
  retailer_id text,
  store text,
  order_number text,
  purchased date,
  delivered date,
  products jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, order_key)
);
-- OAuth requests in flight (sign-in and inbox connect), by a hash of their state value. Kept for 10 minutes.
create table if not exists oauth_states (
  state_hash text primary key,
  purpose text not null,
  user_id uuid references users(id) on delete cascade,
  data jsonb not null default '{}',
  expires_at timestamptz not null
);
-- "Continue with Google / Apple": the provider's account id for each Adltrack account.
create table if not exists oauth_identities (
  provider text not null,
  subject text not null,
  user_id uuid not null references users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now(),
  primary key (provider, subject)
);`;

const PURCHASE_COLUMNS = 'id, store, channel, order_number as "orderNumber", purchased, delivered, source, retailer_id as "retailerId", receipt_file_id as "receiptFileId", receipt_pages as "receiptPages"';
const JOB_COLUMNS = 'id, name, payload, unique_key as "uniqueKey", status, run_at as "runAt", attempts, max_attempts as "maxAttempts", last_error as "lastError"';
const FILE_COLUMNS = 'id, user_id as "userId", kind, storage_key as "storageKey", content_type as "contentType", size, sha256';
const CONNECTION_COLUMNS = 'id, user_id as "userId", provider, email, tokens, status, synced_at as "syncedAt", subscription_id as "subscriptionId", subscription_secret as "subscriptionSecret", subscription_expires as "subscriptionExpires", created_at as "createdAt"';
const ORDER_COLUMNS = 'id, connection_id as "connectionId", order_key as "orderKey", retailer_id as "retailerId", store, order_number as "orderNumber", purchased, delivered, products, created_at as "createdAt", updated_at as "updatedAt"';
const iso = d => new Date(d).toISOString();
const dateOrNull = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
const cleanPurchase = p => ({ id: p.id, store: p.store ?? null, channel: p.channel ?? null, orderNumber: p.orderNumber ?? null, purchased: dateOrNull(p.purchased), delivered: dateOrNull(p.delivered), source: p.source || 'manual', retailerId: p.retailerId ?? null, receiptFileId: p.receiptFileId ?? null, receiptPages: Array.isArray(p.receiptPages) ? p.receiptPages : [] });

const versionChanged = (id, version) => Object.assign(new Error(`policies/${id}.json changed but is still version ${version}. Move the old file to policies/history/${id}.v${version}.json and raise the version.`), { code: 'POLICY_VERSION' });

function pgStore(connectionString) {
  const { Pool, types } = require('pg');
  // Render's internal connection string needs no TLS; its external one (*.render.com) does.
  const ssl = /\.render\.com/.test(connectionString) ? { rejectUnauthorized: false } : false;
  // Dates stay 'YYYY-MM-DD' strings, exactly as the app writes them.
  const parsers = { getTypeParser: (oid, format) => oid === types.builtins.DATE ? v => v : types.getTypeParser(oid, format) };
  const pool = new Pool({ connectionString, ssl, max: 5, types: parsers });
  const one = async (sql, params) => (await pool.query(sql, params)).rows[0] || null;
  const all = async (sql, params) => (await pool.query(sql, params)).rows;
  const columns = FIELDS.map(f => f[1]);
  return {
    async init() { await pool.query(SCHEMA); },
    async createUser({ email, name, passwordHash }) {
      const id = crypto.randomUUID();
      try {
        return await one('insert into users (id, email, name, password_hash) values ($1,$2,$3,$4) returning id, email, name', [id, email, name, passwordHash]);
      } catch (err) {
        if (err.code === '23505') throw Object.assign(new Error('exists'), { code: 'EXISTS' });
        throw err;
      }
    },
    findUserByEmail: email => one('select id, email, name, password_hash as "passwordHash" from users where email=$1', [email]),
    findUserById: id => one('select id, email, name from users where id=$1', [id]),
    async createSession(userId, tokenHash, expiresAt) { await pool.query('insert into sessions (token_hash, user_id, expires_at) values ($1,$2,$3)', [tokenHash, userId, expiresAt]); },
    findSession: tokenHash => one('select user_id as "userId", expires_at as "expiresAt" from sessions where token_hash=$1', [tokenHash]),
    async deleteSession(tokenHash) { await pool.query('delete from sessions where token_hash=$1', [tokenHash]); },
    async deleteExpiredSessions() { return (await pool.query('delete from sessions where expires_at < now()')).rowCount; },
    async deleteUser(userId) { await pool.query('delete from users where id=$1', [userId]); },
    // Loads every policy version from policies/ into Postgres. Past versions are kept; a changed file must get a new version.
    async syncPolicies(versions) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const latest = new Map();
        for (const p of versions) if (!latest.has(p.id) || latest.get(p.id).version < p.version) latest.set(p.id, p);
        for (const p of latest.values()) await client.query(`insert into retailers (id, name, status, current_version, checked, aliases, updated_at) values ($1,$2,$3,$4,$5,$6,now())
          on conflict (id) do update set name=excluded.name, status=excluded.status, current_version=excluded.current_version, checked=excluded.checked, aliases=excluded.aliases, updated_at=now()`,
          [p.id, p.name, p.status, p.version, p.checked, JSON.stringify(p.aliases)]);
        for (const p of versions) {
          const row = (await client.query('select policy = $3::jsonb as same from retailer_policies where retailer_id=$1 and version=$2', [p.id, p.version, JSON.stringify(p)])).rows[0];
          if (row && !row.same) throw versionChanged(p.id, p.version);
          if (!row) await client.query('insert into retailer_policies (retailer_id, version, checked, policy) values ($1,$2,$3,$4)', [p.id, p.version, p.checked, JSON.stringify(p)]);
        }
        await client.query('commit');
      } catch (err) { await client.query('rollback'); throw err; } finally { client.release(); }
    },
    async policyVersions(retailerId) {
      return (await pool.query('select version, checked::text as checked from retailer_policies where retailer_id=$1 order by version desc', [retailerId])).rows;
    },

    /* Settings and profile (and, before migration, the whole old payload). */
    async getRawData(userId) {
      const row = await one('select payload, updated_at as "updatedAt" from user_data where user_id=$1', [userId]);
      return row && { payload: row.payload, updatedAt: iso(row.updatedAt) };
    },
    async putSettings(userId, payload) {
      const row = await one(`insert into user_data (user_id, payload, updated_at) values ($1,$2,now())
        on conflict (user_id) do update set payload=excluded.payload, updated_at=now() returning updated_at as "updatedAt"`, [userId, JSON.stringify(payload)]);
      return iso(row.updatedAt);
    },
    async touch(userId, at = null) {
      const row = await one(`insert into user_data (user_id, payload, updated_at) values ($1,'{}',coalesce($2::timestamptz, now()))
        on conflict (user_id) do update set updated_at=coalesce($2::timestamptz, now()) returning updated_at as "updatedAt"`, [userId, at]);
      return iso(row.updatedAt);
    },
    async usersWithLegacyData() { return (await all(`select user_id as "userId" from user_data where payload ? 'purchases'`)).map(r => r.userId); },

    /* Purchases and items. */
    async savePurchase(userId, purchase) {
      const p = cleanPurchase(purchase);
      await pool.query(`insert into purchases (user_id, id, store, channel, order_number, purchased, delivered, source, retailer_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        on conflict (user_id, id) do update set store=excluded.store, channel=excluded.channel, purchased=excluded.purchased, delivered=excluded.delivered,
        order_number=coalesce(excluded.order_number, purchases.order_number), retailer_id=coalesce(excluded.retailer_id, purchases.retailer_id), updated_at=now()`,
      [userId, p.id, p.store, p.channel, p.orderNumber, p.purchased, p.delivered, p.source, p.retailerId]);
    },
    listPurchases: userId => all(`select ${PURCHASE_COLUMNS} from purchases where user_id=$1 order by created_at, id`, [userId]),
    getPurchase: (userId, id) => one(`select ${PURCHASE_COLUMNS} from purchases where user_id=$1 and id=$2`, [userId, id]),
    async setPurchaseReceipt(userId, id, fileId) {
      const row = await one(`update purchases p set receipt_file_id=$3, updated_at=now() from (select receipt_file_id as old from purchases where user_id=$1 and id=$2) prev
        where p.user_id=$1 and p.id=$2 returning prev.old as "previous"`, [userId, id, fileId]);
      return row ? row.previous : undefined;
    },
    // All pages of a receipt at once: the first in receipt_file_id, the rest in receipt_pages. Returns the file ids it replaced.
    async setPurchaseReceiptPages(userId, id, fileIds) {
      const row = await one(`update purchases p set receipt_file_id=$3, receipt_pages=$4, updated_at=now() from (select receipt_file_id as old, receipt_pages as old_pages from purchases where user_id=$1 and id=$2) prev
        where p.user_id=$1 and p.id=$2 returning prev.old as "previous", prev.old_pages as "previousPages"`, [userId, id, fileIds[0] || null, JSON.stringify(fileIds.slice(1))]);
      return row ? [row.previous, ...(row.previousPages || [])].filter(Boolean) : undefined;
    },
    async deletePurchaseIfEmpty(userId, id) {
      const row = await one(`delete from purchases where user_id=$1 and id=$2 and not exists (select 1 from items where user_id=$1 and purchase_id=$2)
        returning receipt_file_id as "receiptFileId", receipt_pages as "receiptPages"`, [userId, id]);
      return row ? { deleted: true, receiptFileId: row.receiptFileId, receiptPages: row.receiptPages || [] } : { deleted: false };
    },
    // Receipts that were read but never saved with any item.
    emptyReceiptPurchases: before => all(`select user_id as "userId", id from purchases p where source='receipt' and created_at < $1
      and not exists (select 1 from items i where i.user_id=p.user_id and i.purchase_id=p.id) limit 500`, [before]),
    async listItems(userId) { return (await all('select * from items where user_id=$1 order by position, created_at, id', [userId])).map(decode); },
    async getItem(userId, id) { const row = await one('select * from items where user_id=$1 and id=$2', [userId, id]); return row && { item: decode(row), photoFileId: row.photo_file_id }; },
    async saveItem(userId, item, { photoFileId = null, position = null } = {}) {
      const { columns: values, extra } = encode(item);
      const params = [userId, item.id, item.purchaseId, photoFileId, JSON.stringify(extra), position, ...columns.map(c => JSON_COLUMNS.has(c) && values[c] !== null ? JSON.stringify(values[c]) : values[c])];
      const list = columns.map((c, i) => [c, `$${i + 7}`]);
      const row = await one(`insert into items (user_id, id, purchase_id, photo_file_id, extra, position, ${list.map(l => l[0]).join(', ')})
        values ($1, $2, $3, $4, $5, coalesce($6::integer, (select coalesce(max(position), -1) + 1 from items where user_id=$1)), ${list.map(l => l[1]).join(', ')})
        on conflict (user_id, id) do update set purchase_id=excluded.purchase_id, photo_file_id=excluded.photo_file_id, extra=excluded.extra,
        position=coalesce($6::integer, items.position), updated_at=now(), ${columns.map(c => `${c}=excluded.${c}`).join(', ')}
        returning *`, params);
      return decode(row);
    },
    async deleteItem(userId, id) {
      const row = await one('delete from items where user_id=$1 and id=$2 returning *', [userId, id]);
      return row && { item: decode(row), photoFileId: row.photo_file_id };
    },

    /* File records. */
    async createFile(f) {
      await pool.query('insert into files (id, user_id, kind, storage_key, content_type, size, sha256) values ($1,$2,$3,$4,$5,$6,$7)', [f.id, f.userId, f.kind, f.storageKey, f.contentType, f.size, f.sha256]);
      return f;
    },
    getFile: (userId, id) => one(`select ${FILE_COLUMNS} from files where user_id=$1 and id=$2`, [userId, id]),
    deleteFile: (userId, id) => one(`delete from files where user_id=$1 and id=$2 returning ${FILE_COLUMNS}`, [userId, id]),
    listFiles: userId => all(`select ${FILE_COLUMNS} from files where user_id=$1`, [userId]),

    /* Background jobs. */
    async enqueueJob({ name, payload = {}, runAt = new Date(), uniqueKey = null, maxAttempts = 5 }) {
      const row = await one(`insert into jobs (name, payload, run_at, unique_key, max_attempts) values ($1,$2,$3,$4,$5)
        on conflict (unique_key) where status in ('queued', 'running') do nothing returning id`, [name, JSON.stringify(payload), runAt, uniqueKey, maxAttempts]);
      return row ? String(row.id) : null;
    },
    async claimJob(staleMs) {
      const row = await one(`update jobs set status='running', locked_at=now(), attempts=attempts+1 where id = (
          select id from jobs where (status='queued' and run_at <= now()) or (status='running' and locked_at < now() - make_interval(secs => $1::double precision / 1000))
          order by run_at, id limit 1 for update skip locked)
        returning ${JOB_COLUMNS}`, [staleMs]);
      return row && { ...row, id: String(row.id) };
    },
    async completeJob(id) { await pool.query(`update jobs set status='done', finished_at=now(), locked_at=null where id=$1`, [id]); },
    async retryJob(id, error, runAt) { await pool.query(`update jobs set status='queued', last_error=$2, run_at=$3, locked_at=null where id=$1`, [id, error, runAt]); },
    async failJob(id, error) { await pool.query(`update jobs set status='failed', last_error=$2, finished_at=now(), locked_at=null where id=$1`, [id, error]); },
    async getJob(id) { const row = await one(`select ${JOB_COLUMNS} from jobs where id=$1`, [id]); return row && { ...row, id: String(row.id) }; },
    async deleteFinishedJobs(before) { return (await pool.query(`delete from jobs where status in ('done', 'failed') and finished_at < $1`, [before])).rowCount; },

    /* Nearby drop-offs cache. */
    async getPlaceCache(key, after) { const row = await one('select places from place_cache where key=$1 and fetched_at > $2', [key, after]); return row ? row.places : null; },
    async putPlaceCache(key, places) { await pool.query('insert into place_cache (key, places) values ($1,$2) on conflict (key) do update set places=excluded.places, fetched_at=now()', [key, JSON.stringify(places)]); },
    async deleteOldPlaceCache(before) { return (await pool.query('delete from place_cache where fetched_at < $1', [before])).rowCount; },

    /* Push subscriptions and daily reminders. A device that signs in to another account moves to that account. */
    async savePushSubscription(userId, { endpoint, p256dh, auth, timeZone }) {
      await pool.query(`insert into push_subscriptions (endpoint, user_id, p256dh, auth, time_zone) values ($1,$2,$3,$4,$5)
        on conflict (endpoint) do update set user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth, time_zone=excluded.time_zone, updated_at=now()`, [endpoint, userId, p256dh, auth, timeZone]);
    },
    async deletePushSubscription(endpoint, userId) { return (await pool.query('delete from push_subscriptions where endpoint=$1 and user_id=$2', [endpoint, userId])).rowCount > 0; },
    async listPushSubscriptions(userId) { return all('select endpoint, p256dh, auth, time_zone as "timeZone" from push_subscriptions where user_id=$1 order by updated_at desc', [userId]); },
    // Every account with settings or a push subscription: its settings, the time zone of its most recently seen device (or
    // null), whether it has a device for push, and its last reminder day.
    async reminderCandidates() {
      return all(`select u.id as "userId", p.time_zone as "timeZone", p.time_zone is not null as "hasPush", d.payload->'settings' as settings, r.last_date as "lastDate"
        from users u left join user_data d on d.user_id=u.id left join reminder_days r on r.user_id=u.id
        left join lateral (select time_zone from push_subscriptions s where s.user_id=u.id order by s.updated_at desc limit 1) p on true
        where d.user_id is not null or p.time_zone is not null`);
    },
    reminderDay: userId => one('select last_date as "lastDate", opened_date as "openedDate" from reminder_days where user_id=$1', [userId]),
    async markReminderOpened(userId) { await pool.query('update reminder_days set opened_date=last_date where user_id=$1', [userId]); },
    async emailOptouts(userId) { return (await all('select kind from email_optouts where user_id=$1 order by kind', [userId])).map(r => r.kind); },
    async setEmailOptout(userId, kind, off) {
      if (off) await pool.query('insert into email_optouts (user_id, kind) values ($1,$2) on conflict do nothing', [userId, kind]);
      else await pool.query('delete from email_optouts where user_id=$1 and kind=$2', [userId, kind]);
    },
    /* Password reset. */
    async setPassword(userId, passwordHash) { await pool.query('update users set password_hash=$2 where id=$1', [userId, passwordHash]); },
    async deleteUserSessions(userId) { await pool.query('delete from sessions where user_id=$1', [userId]); },
    async createPasswordReset(userId, tokenHash, expiresAt) { await pool.query('insert into password_resets (token_hash, user_id, expires_at) values ($1,$2,$3)', [tokenHash, userId, expiresAt]); },
    // Uses the link up: returns its account when it hasn't expired, and removes every reset link of that account.
    async takePasswordReset(tokenHash) {
      const row = await one('delete from password_resets where token_hash=$1 returning user_id as "userId", expires_at as "expiresAt"', [tokenHash]);
      if (!row) return null;
      await pool.query('delete from password_resets where user_id=$1', [row.userId]);
      return new Date(row.expiresAt) > new Date() ? row.userId : null;
    },
    async deleteExpiredPasswordResets() { return (await pool.query('delete from password_resets where expires_at < now()')).rowCount; },
    async claimReminderDay(userId, date, by) {
      const row = await one(`with prev as (select last_date from reminder_days where user_id=$1)
        insert into reminder_days (user_id, last_date, sent_by) values ($1,$2,$3)
        on conflict (user_id) do update set last_date=excluded.last_date, sent_by=excluded.sent_by, opened_date=null, updated_at=now() where reminder_days.last_date <> excluded.last_date
        returning (select last_date from prev) as previous`, [userId, date, by]);
      return row ? { claimed: true, previous: row.previous || null } : { claimed: false, previous: null };
    },
    async releaseReminderDay(userId, date, previous) {
      if (previous) await pool.query('update reminder_days set last_date=$3 where user_id=$1 and last_date=$2', [userId, date, previous]);
      else await pool.query('delete from reminder_days where user_id=$1 and last_date=$2', [userId, date]);
    },
    /* Store lookups (unverified policies) and how many accounts use each store. */
    getStoreLookup: key => one(`select key, name, status, policy, retailer_id as "retailerId", looked_up_at as "lookedUpAt" from store_lookups where key=$1`, [key]),
    async saveStoreLookup({ key, name, status, policy = null, retailerId = null }) {
      await pool.query(`insert into store_lookups (key, name, status, policy, retailer_id, looked_up_at) values ($1,$2,$3,$4,$5,now())
        on conflict (key) do update set name=excluded.name, status=excluded.status, policy=excluded.policy, retailer_id=excluded.retailer_id, looked_up_at=now()`,
      [key, name, status, policy && JSON.stringify(policy), retailerId]);
    },
    async countStoreUser(key, userId) { await pool.query('insert into store_lookup_users (key, user_id) values ($1,$2) on conflict do nothing', [key, userId]); },
    listStoreLookups: () => all(`select l.key, l.name, l.status, l.policy, l.retailer_id as "retailerId", l.looked_up_at as "lookedUpAt", count(u.user_id)::integer as users
      from store_lookups l left join store_lookup_users u on u.key=l.key group by l.key order by users desc, l.looked_up_at desc limit 200`),

    /* "Is this wrong?" reports. */
    async createPolicyReport(r) {
      await pool.query(`insert into policy_reports (id, user_id, retailer_id, store, item_name, policy_version, policy_line, note) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [r.id, r.userId, r.retailerId, r.store, r.itemName, r.policyVersion, r.policyLine, r.note]);
      return r;
    },
    listPolicyReports: () => all(`select id, retailer_id as "retailerId", store, item_name as "itemName", policy_version as "policyVersion", policy_line as "policyLine", note, status, created_at as "createdAt"
      from policy_reports where status='open' order by created_at desc limit 200`),
    async resolvePolicyReport(id) { return (await pool.query(`update policy_reports set status='resolved' where id=$1 and status='open'`, [id])).rowCount > 0; },

    /* Policies approved at runtime. */
    async saveApprovedPolicy({ policy, by, reason }) {
      await pool.query('insert into approved_policies (retailer_id, version, policy, approved_by, reason) values ($1,$2,$3,$4,$5)', [policy.id, policy.version, JSON.stringify(policy), by, reason]);
    },
    listApprovedPolicies: async () => (await all(`select distinct on (retailer_id) policy from approved_policies order by retailer_id, version desc`)).map(r => r.policy),

    /* Freshness: source page snapshots and flagged changes. */
    getSourceSnapshot: url => one('select url, hash, phrases from source_snapshots where url=$1', [url]),
    async putSourceSnapshot(url, { hash, phrases }) {
      await pool.query('insert into source_snapshots (url, hash, phrases) values ($1,$2,$3) on conflict (url) do update set hash=excluded.hash, phrases=excluded.phrases, fetched_at=now()', [url, hash, JSON.stringify(phrases)]);
    },
    async createPolicyFlag(f) {
      const row = await one(`insert into policy_flags (id, retailer_id, url, hash, added, removed, holiday, proposed) values ($1,$2,$3,$4,$5,$6,$7,$8)
        on conflict (retailer_id, url, hash) do nothing returning id`, [f.id, f.retailerId, f.url, f.hash, JSON.stringify(f.added), JSON.stringify(f.removed), f.holiday, f.proposed && JSON.stringify(f.proposed)]);
      return !!row;
    },
    getPolicyFlag: id => one(`select id, retailer_id as "retailerId", url, added, removed, holiday, proposed, status, created_at as "createdAt" from policy_flags where id=$1`, [id]),
    listPolicyFlags: () => all(`select id, retailer_id as "retailerId", url, added, removed, holiday, proposed, status, created_at as "createdAt" from policy_flags where status='open' order by created_at desc limit 200`),
    async setPolicyFlagStatus(id, status) { return (await pool.query(`update policy_flags set status=$2 where id=$1 and status='open'`, [id, status])).rowCount > 0; },

    /* Items of every account that use one of these retailers, for recomputing after an approved change. */
    async itemsByRetailer(ids) { return (await all('select * from items where retailer_id = any($1)', [ids])).map(row => ({ userId: row.user_id, item: decode(row) })); },

    /* Notices. */
    async addNotice(userId, { text, itemId = null }) { await pool.query('insert into notices (id, user_id, text, item_id) values ($1,$2,$3,$4)', [crypto.randomUUID(), userId, text, itemId]); },
    listNotices: userId => all('select id, text, item_id as "itemId", created_at as "createdAt" from notices where user_id=$1 and read_at is null order by created_at limit 20', [userId]),
    async markNoticesRead(userId, ids) { await pool.query('update notices set read_at=now() where user_id=$1 and id = any($2::uuid[])', [userId, ids]); },


    /* Purchases from email. */
    getInboxAddress: userId => one('select token, senders, request, created_at as "createdAt" from inbox_addresses where user_id=$1', [userId]),
    findInboxAddress: token => one('select user_id as "userId", token, senders from inbox_addresses where token=$1', [token]),
    async setInboxAddress(userId, token) { await pool.query('insert into inbox_addresses (user_id, token) values ($1,$2) on conflict (user_id) do update set token=excluded.token, request=null, created_at=now()', [userId, token]); },
    async setForwardRequest(userId, request) { await pool.query('update inbox_addresses set request=$2 where user_id=$1', [userId, request && JSON.stringify(request)]); },
    async addInboxSender(userId, email) {
      await pool.query(`update inbox_addresses set request=null, senders=(select coalesce(jsonb_agg(distinct v), '[]') from jsonb_array_elements(senders || jsonb_build_array($2::text)) v) where user_id=$1`, [userId, email]);
    },
    async saveInboxConnection(c) {
      return one(`insert into inbox_connections (id, user_id, provider, email, tokens, status) values ($1,$2,$3,$4,$5,'active')
        on conflict (user_id, provider) do update set email=excluded.email, tokens=excluded.tokens, status='active' returning ${CONNECTION_COLUMNS}`, [c.id, c.userId, c.provider, c.email, c.tokens]);
    },
    async updateInboxConnection(id, patch) {
      const cols = { tokens: 'tokens', status: 'status', syncedAt: 'synced_at', subscriptionId: 'subscription_id', subscriptionSecret: 'subscription_secret', subscriptionExpires: 'subscription_expires' };
      const keys = Object.keys(patch).filter(k => cols[k]);
      if (!keys.length) return;
      await pool.query(`update inbox_connections set ${keys.map((k, n) => `${cols[k]}=$${n + 2}`).join(', ')} where id=$1`, [id, ...keys.map(k => patch[k])]);
    },
    getInboxConnection: id => one(`select ${CONNECTION_COLUMNS} from inbox_connections where id=$1`, [id]),
    listInboxConnections: userId => all(`select ${CONNECTION_COLUMNS} from inbox_connections where user_id=$1 order by provider`, [userId]),
    activeInboxConnections: () => all(`select ${CONNECTION_COLUMNS} from inbox_connections where status='active'`),
    findInboxSubscription: id => one(`select ${CONNECTION_COLUMNS} from inbox_connections where subscription_id=$1`, [id]),
    deleteInboxConnection: (userId, provider) => one(`delete from inbox_connections where user_id=$1 and provider=$2 returning ${CONNECTION_COLUMNS}`, [userId, provider]),
    async hasInboxMessage(userId, key) { return !!(await one('select 1 from inbox_messages where user_id=$1 and key=$2', [userId, key])); },
    async saveInboxMessage(userId, m) {
      await pool.query('insert into inbox_messages (user_id, key, connection_id, kind, order_key, fields) values ($1,$2,$3,$4,$5,$6) on conflict (user_id, key) do nothing', [userId, m.key, m.connectionId || null, m.kind, m.orderKey || null, JSON.stringify(m.fields || {})]);
    },
    findEmailOrder: (userId, orderKey) => one(`select ${ORDER_COLUMNS} from email_orders where user_id=$1 and order_key=$2`, [userId, orderKey]),
    listEmailOrders: userId => all(`select ${ORDER_COLUMNS} from email_orders where user_id=$1 order by coalesce(purchased, created_at::date) desc, created_at desc`, [userId]),
    async saveEmailOrder(userId, o) {
      await pool.query(`insert into email_orders (user_id, id, connection_id, order_key, retailer_id, store, order_number, purchased, delivered, products) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        on conflict (user_id, id) do update set retailer_id=excluded.retailer_id, store=excluded.store, order_number=excluded.order_number, purchased=excluded.purchased, delivered=excluded.delivered, products=excluded.products, updated_at=now()`,
      [userId, o.id, o.connectionId || null, o.orderKey, o.retailerId || null, o.store || null, o.orderNumber || null, dateOrNull(o.purchased), dateOrNull(o.delivered), JSON.stringify(o.products || [])]);
    },
    /* Disconnect and delete: what was read from one inbox, and its orders nobody has opened yet. Returns those orders' ids. */
    async deleteInboxData(userId, connectionId) {
      await pool.query('delete from inbox_messages where user_id=$1 and connection_id=$2', [userId, connectionId]);
      return (await all(`delete from email_orders o where o.user_id=$1 and o.connection_id=$2 and not exists (select 1 from items i where i.user_id=o.user_id and i.purchase_id=o.id) returning id`, [userId, connectionId])).map(r => r.id);
    },
    async saveOAuthState(stateHash, { purpose, userId = null, data = {}, expiresAt }) { await pool.query('insert into oauth_states (state_hash, purpose, user_id, data, expires_at) values ($1,$2,$3,$4,$5)', [stateHash, purpose, userId, JSON.stringify(data), expiresAt]); },
    takeOAuthState: stateHash => one('delete from oauth_states where state_hash=$1 and expires_at > now() returning purpose, user_id as "userId", data', [stateHash]),
    async deleteExpiredOAuthStates() { return (await pool.query('delete from oauth_states where expires_at < now()')).rowCount; },
    findOAuthIdentity: (provider, subject) => one('select user_id as "userId", email from oauth_identities where provider=$1 and subject=$2', [provider, subject]),
    async saveOAuthIdentity({ provider, subject, userId, email = null }) { await pool.query('insert into oauth_identities (provider, subject, user_id, email) values ($1,$2,$3,$4) on conflict (provider, subject) do nothing', [provider, subject, userId, email]); },

    async close() { await pool.end(); }
  };
}

function fileStore(file) {
  let db = null, queue = Promise.resolve();
  const load = async () => {
    if (db) return db;
    try { db = JSON.parse(await fs.readFile(file, 'utf8')); } catch { db = {}; }
    // Files written before the data foundation only have users, sessions and data.
    db = { users: {}, sessions: {}, data: {}, purchases: {}, items: {}, files: {}, jobs: {}, jobSeq: 0, policies: {}, places: {}, lookups: {}, reports: {}, approved: [], snapshots: {}, flags: {}, notices: {}, push: {}, reminderDays: {}, optouts: {}, resets: {}, inboxAddresses: {}, inboxConnections: {}, inboxMessages: {}, emailOrders: {}, oauthStates: {}, identities: {}, ...db };
    return db;
  };
  // Serialise writes so concurrent requests can't interleave partial files.
  const persist = () => (queue = queue.then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file + '.tmp', JSON.stringify(db));
    await fs.rename(file + '.tmp', file);
  }));
  const publicUser = u => u && { id: u.id, email: u.email, name: u.name };
  const userItems = id => (db.items[id] = db.items[id] || {});
  const userPurchases = id => (db.purchases[id] = db.purchases[id] || {});
  const now = () => new Date().toISOString();
  const jobOut = j => j && { id: j.id, name: j.name, payload: j.payload, uniqueKey: j.uniqueKey, status: j.status, runAt: new Date(j.runAt), attempts: j.attempts, maxAttempts: j.maxAttempts, lastError: j.lastError };
  const later = (a, b) => (a > b ? a : new Date(Date.parse(b) + 1).toISOString());
  const copy = v => v === null || v === undefined ? v : JSON.parse(JSON.stringify(v));
  const connOut = c => c ? copy(c) : null;
  return {
    async init() { await load(); },
    async createUser({ email, name, passwordHash }) {
      await load();
      if (Object.values(db.users).some(u => u.email === email)) throw Object.assign(new Error('exists'), { code: 'EXISTS' });
      const user = { id: crypto.randomUUID(), email, name, passwordHash, createdAt: now() };
      db.users[user.id] = user; await persist();
      return publicUser(user);
    },
    async findUserByEmail(email) { await load(); return Object.values(db.users).find(u => u.email === email) || null; },
    async findUserById(id) { await load(); return publicUser(db.users[id]) || null; },
    async createSession(userId, tokenHash, expiresAt) { await load(); db.sessions[tokenHash] = { userId, expiresAt: expiresAt.toISOString() }; await persist(); },
    async findSession(tokenHash) { await load(); const s = db.sessions[tokenHash]; return s ? { userId: s.userId, expiresAt: new Date(s.expiresAt) } : null; },
    async deleteSession(tokenHash) { await load(); delete db.sessions[tokenHash]; await persist(); },
    async deleteExpiredSessions() {
      await load(); let n = 0;
      for (const [k, s] of Object.entries(db.sessions)) if (new Date(s.expiresAt) < new Date()) { delete db.sessions[k]; n++; }
      if (n) await persist();
      return n;
    },
    async deleteUser(userId) {
      await load();
      delete db.users[userId]; delete db.data[userId]; delete db.items[userId]; delete db.purchases[userId];
      for (const [k, s] of Object.entries(db.sessions)) if (s.userId === userId) delete db.sessions[k];
      for (const [k, f] of Object.entries(db.files)) if (f.userId === userId) delete db.files[k];
      for (const [k, p] of Object.entries(db.push)) if (p.userId === userId) delete db.push[k];
      delete db.reminderDays[userId]; delete db.optouts[userId];
      for (const [k, r] of Object.entries(db.resets)) if (r.userId === userId) delete db.resets[k];
      for (const [k, r] of Object.entries(db.reports)) if (r.userId === userId) delete db.reports[k];
      for (const [k, n] of Object.entries(db.notices)) if (n.userId === userId) delete db.notices[k];
      for (const l of Object.values(db.lookups)) l.users = l.users.filter(u => u !== userId);
      delete db.inboxAddresses[userId]; delete db.inboxMessages[userId]; delete db.emailOrders[userId];
      for (const [k, c] of Object.entries(db.inboxConnections)) if (c.userId === userId) delete db.inboxConnections[k];
      for (const [k, st] of Object.entries(db.oauthStates)) if (st.userId === userId) delete db.oauthStates[k];
      for (const [k, i] of Object.entries(db.identities)) if (i.userId === userId) delete db.identities[k];
      await persist();
    },
    async syncPolicies(versions) {
      await load();
      for (const p of versions) {
        const saved = db.policies[`${p.id}@${p.version}`];
        if (saved && JSON.stringify(saved.policy) !== JSON.stringify(p)) throw versionChanged(p.id, p.version);
      }
      for (const p of versions) db.policies[`${p.id}@${p.version}`] ||= { policy: p, loadedAt: new Date().toISOString() };
      await persist();
    },
    async policyVersions(retailerId) {
      await load();
      return Object.values(db.policies).map(v => v.policy).filter(p => p.id === retailerId).sort((a, b) => b.version - a.version).map(p => ({ version: p.version, checked: p.checked }));
    },

    async getRawData(userId) {
      await load(); const d = db.data[userId];
      if (!d) return null;
      const { updatedAt, ...payload } = d;
      return { payload, updatedAt };
    },
    // updatedAt always moves forward, even within the same millisecond, so other devices notice every change.
    async putSettings(userId, payload) { await load(); const updatedAt = later(now(), db.data[userId]?.updatedAt || ''); db.data[userId] = { ...payload, updatedAt }; await persist(); return updatedAt; },
    async touch(userId, at = null) {
      await load();
      const updatedAt = at ? iso(at) : later(now(), db.data[userId]?.updatedAt || '');
      db.data[userId] = { ...(db.data[userId] || {}), updatedAt }; await persist(); return updatedAt;
    },
    async usersWithLegacyData() { await load(); return Object.entries(db.data).filter(([, d]) => d && 'purchases' in d).map(([id]) => id); },

    async savePurchase(userId, purchase) {
      await load();
      const p = cleanPurchase(purchase), list = userPurchases(userId), old = list[p.id];
      list[p.id] = old ? { ...old, store: p.store, channel: p.channel, purchased: p.purchased, delivered: p.delivered, orderNumber: p.orderNumber ?? old.orderNumber, retailerId: p.retailerId ?? old.retailerId, updatedAt: now() } : { ...p, createdAt: now(), updatedAt: now() };
      await persist();
    },
    async listPurchases(userId) { await load(); return Object.values(userPurchases(userId)).map(cleanPurchase); },
    async getPurchase(userId, id) { await load(); const p = userPurchases(userId)[id]; return p ? cleanPurchase(p) : null; },
    async setPurchaseReceipt(userId, id, fileId) {
      await load(); const p = userPurchases(userId)[id];
      if (!p) return undefined;
      const previous = p.receiptFileId || null; p.receiptFileId = fileId; await persist();
      return previous;
    },
    async setPurchaseReceiptPages(userId, id, fileIds) {
      await load(); const p = userPurchases(userId)[id];
      if (!p) return undefined;
      const previous = [p.receiptFileId, ...(p.receiptPages || [])].filter(Boolean);
      p.receiptFileId = fileIds[0] || null; p.receiptPages = fileIds.slice(1); p.updatedAt = now(); await persist();
      return previous;
    },
    async deletePurchaseIfEmpty(userId, id) {
      await load(); const p = userPurchases(userId)[id];
      if (!p || Object.values(userItems(userId)).some(r => r.purchase_id === id)) return { deleted: false };
      delete userPurchases(userId)[id]; await persist();
      return { deleted: true, receiptFileId: p.receiptFileId || null, receiptPages: p.receiptPages || [] };
    },
    async emptyReceiptPurchases(before) {
      await load(); const out = [];
      for (const [userId, list] of Object.entries(db.purchases)) for (const p of Object.values(list)) {
        if (p.source === 'receipt' && p.createdAt < iso(before) && !Object.values(userItems(userId)).some(r => r.purchase_id === p.id)) out.push({ userId, id: p.id });
      }
      return out.slice(0, 500);
    },
    // Item rows are kept in the same shape as Postgres rows, so both stores encode and decode identically.
    async listItems(userId) { await load(); return Object.values(userItems(userId)).sort((a, b) => a.position - b.position || (a.created_at < b.created_at ? -1 : 1)).map(decode); },
    async getItem(userId, id) { await load(); const r = userItems(userId)[id]; return r ? { item: decode(r), photoFileId: r.photo_file_id } : null; },
    async saveItem(userId, item, { photoFileId = null, position = null } = {}) {
      await load();
      const { columns, extra } = encode(item), rows = userItems(userId), old = rows[item.id];
      const nextPos = Object.values(rows).reduce((m, r) => Math.max(m, r.position), -1) + 1;
      const row = { ...JSON.parse(JSON.stringify(columns)), id: item.id, purchase_id: item.purchaseId, photo_file_id: photoFileId, extra: JSON.parse(JSON.stringify(extra)), position: position ?? old?.position ?? nextPos, created_at: old?.created_at || now(), updated_at: now() };
      rows[item.id] = row; await persist();
      return decode(row);
    },
    async deleteItem(userId, id) {
      await load(); const r = userItems(userId)[id];
      if (!r) return null;
      delete userItems(userId)[id]; await persist();
      return { item: decode(r), photoFileId: r.photo_file_id };
    },

    async createFile(f) { await load(); db.files[f.id] = { ...f }; await persist(); return f; },
    async getFile(userId, id) { await load(); const f = db.files[id]; return f && f.userId === userId ? { ...f } : null; },
    async deleteFile(userId, id) {
      await load(); const f = db.files[id];
      if (!f || f.userId !== userId) return null;
      delete db.files[id];
      for (const r of Object.values(userItems(userId))) { if (r.photo_file_id === id) r.photo_file_id = null; if (r.label_file_id === id) r.label_file_id = null; }
      for (const p of Object.values(userPurchases(userId))) { if (p.receiptFileId === id) p.receiptFileId = null; if (p.receiptPages) p.receiptPages = p.receiptPages.filter(x => x !== id); }
      await persist();
      return f;
    },
    async listFiles(userId) { await load(); return Object.values(db.files).filter(f => f.userId === userId); },

    async enqueueJob({ name, payload = {}, runAt = new Date(), uniqueKey = null, maxAttempts = 5 }) {
      await load();
      if (uniqueKey && Object.values(db.jobs).some(j => j.uniqueKey === uniqueKey && ['queued', 'running'].includes(j.status))) return null;
      const id = String(++db.jobSeq);
      db.jobs[id] = { id, name, payload: JSON.parse(JSON.stringify(payload)), uniqueKey, status: 'queued', runAt: iso(runAt), attempts: 0, maxAttempts, lastError: null, lockedAt: null, finishedAt: null };
      await persist();
      return id;
    },
    async claimJob(staleMs) {
      await load();
      const t = Date.now();
      const due = Object.values(db.jobs).filter(j => (j.status === 'queued' && Date.parse(j.runAt) <= t) || (j.status === 'running' && Date.parse(j.lockedAt) < t - staleMs))
        .sort((a, b) => Date.parse(a.runAt) - Date.parse(b.runAt) || Number(a.id) - Number(b.id))[0];
      if (!due) return null;
      Object.assign(due, { status: 'running', lockedAt: now(), attempts: due.attempts + 1 });
      await persist();
      return jobOut(due);
    },
    async completeJob(id) { await load(); Object.assign(db.jobs[id], { status: 'done', finishedAt: now(), lockedAt: null }); await persist(); },
    async retryJob(id, error, runAt) { await load(); Object.assign(db.jobs[id], { status: 'queued', lastError: error, runAt: iso(runAt), lockedAt: null }); await persist(); },
    async failJob(id, error) { await load(); Object.assign(db.jobs[id], { status: 'failed', lastError: error, finishedAt: now(), lockedAt: null }); await persist(); },
    async getJob(id) { await load(); return jobOut(db.jobs[id]) || null; },
    async deleteFinishedJobs(before) {
      await load(); let n = 0;
      for (const [k, j] of Object.entries(db.jobs)) if (['done', 'failed'].includes(j.status) && new Date(j.finishedAt) < before) { delete db.jobs[k]; n++; }
      if (n) await persist();
      return n;
    },

    async getPlaceCache(key, after) { await load(); const c = db.places[key]; return c && new Date(c.fetchedAt) > after ? JSON.parse(JSON.stringify(c.places)) : null; },
    async putPlaceCache(key, places) { await load(); db.places[key] = { places: JSON.parse(JSON.stringify(places)), fetchedAt: now() }; await persist(); },
    async deleteOldPlaceCache(before) {
      await load(); let n = 0;
      for (const [k, c] of Object.entries(db.places)) if (new Date(c.fetchedAt) < before) { delete db.places[k]; n++; }
      if (n) await persist();
      return n;
    },

    async savePushSubscription(userId, { endpoint, p256dh, auth, timeZone }) {
      await load();
      db.push[endpoint] = { endpoint, userId, p256dh, auth, timeZone, createdAt: db.push[endpoint]?.createdAt || now(), updatedAt: later(now(), db.push[endpoint]?.updatedAt || '') };
      await persist();
    },
    async deletePushSubscription(endpoint, userId) { await load(); if (db.push[endpoint]?.userId !== userId) return false; delete db.push[endpoint]; await persist(); return true; },
    async listPushSubscriptions(userId) {
      await load();
      return Object.values(db.push).filter(p => p.userId === userId).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).map(({ endpoint, p256dh, auth, timeZone }) => ({ endpoint, p256dh, auth, timeZone }));
    },
    async reminderCandidates() {
      await load();
      const latest = {};
      for (const p of Object.values(db.push)) if (!latest[p.userId] || latest[p.userId].updatedAt < p.updatedAt) latest[p.userId] = p;
      return Object.keys(db.users).filter(id => db.data[id] || latest[id]).map(id => ({ userId: id, timeZone: latest[id]?.timeZone || null, hasPush: !!latest[id], settings: db.data[id]?.settings || null, lastDate: db.reminderDays[id]?.lastDate || null }));
    },
    async reminderDay(userId) { await load(); const r = db.reminderDays[userId]; return r ? { lastDate: r.lastDate, openedDate: r.openedDate || null } : null; },
    async markReminderOpened(userId) { await load(); const r = db.reminderDays[userId]; if (r) { r.openedDate = r.lastDate; await persist(); } },
    async emailOptouts(userId) { await load(); return [...(db.optouts[userId] || [])].sort(); },
    async setEmailOptout(userId, kind, off) {
      await load();
      const set = new Set(db.optouts[userId] || []);
      if (off) set.add(kind); else set.delete(kind);
      db.optouts[userId] = [...set]; await persist();
    },
    async setPassword(userId, passwordHash) { await load(); if (db.users[userId]) { db.users[userId].passwordHash = passwordHash; await persist(); } },
    async deleteUserSessions(userId) { await load(); for (const [k, s] of Object.entries(db.sessions)) if (s.userId === userId) delete db.sessions[k]; await persist(); },
    async createPasswordReset(userId, tokenHash, expiresAt) { await load(); db.resets[tokenHash] = { userId, expiresAt: iso(expiresAt) }; await persist(); },
    async takePasswordReset(tokenHash) {
      await load();
      const r = db.resets[tokenHash];
      if (!r) return null;
      for (const [k, x] of Object.entries(db.resets)) if (x.userId === r.userId) delete db.resets[k];
      await persist();
      return new Date(r.expiresAt) > new Date() ? r.userId : null;
    },
    async deleteExpiredPasswordResets() {
      await load(); let n = 0;
      for (const [k, r] of Object.entries(db.resets)) if (new Date(r.expiresAt) < new Date()) { delete db.resets[k]; n++; }
      if (n) await persist();
      return n;
    },
    async claimReminderDay(userId, date, by) {
      await load();
      const prev = db.reminderDays[userId];
      if (prev && prev.lastDate === date) return { claimed: false, previous: null };
      db.reminderDays[userId] = { lastDate: date, sentBy: by, openedDate: null, updatedAt: now() };
      await persist();
      return { claimed: true, previous: prev ? prev.lastDate : null };
    },
    async releaseReminderDay(userId, date, previous) {
      await load();
      if (db.reminderDays[userId]?.lastDate !== date) return;
      if (previous) db.reminderDays[userId].lastDate = previous; else delete db.reminderDays[userId];
      await persist();
    },

    async getStoreLookup(key) { await load(); const l = db.lookups[key]; return l ? JSON.parse(JSON.stringify({ key, ...l, users: undefined })) : null; },
    async saveStoreLookup({ key, name, status, policy = null, retailerId = null }) {
      await load(); db.lookups[key] = { name, status, policy: policy && JSON.parse(JSON.stringify(policy)), retailerId, lookedUpAt: now(), users: db.lookups[key]?.users || [] }; await persist();
    },
    async countStoreUser(key, userId) { await load(); const l = db.lookups[key]; if (l && !l.users.includes(userId)) { l.users.push(userId); await persist(); } },
    async listStoreLookups() {
      await load();
      return Object.entries(db.lookups).map(([key, l]) => ({ key, name: l.name, status: l.status, policy: l.policy, retailerId: l.retailerId, lookedUpAt: l.lookedUpAt, users: l.users.filter(u => db.users[u]).length }))
        .sort((a, b) => b.users - a.users || (a.lookedUpAt < b.lookedUpAt ? 1 : -1)).slice(0, 200);
    },

    async createPolicyReport(r) { await load(); db.reports[r.id] = { ...r, status: 'open', createdAt: now() }; await persist(); return r; },
    async listPolicyReports() {
      await load();
      return Object.values(db.reports).filter(r => r.status === 'open').sort((a, b) => a.createdAt < b.createdAt ? 1 : -1).map(({ userId, ...r }) => r);
    },
    async resolvePolicyReport(id) { await load(); const r = db.reports[id]; if (!r || r.status !== 'open') return false; r.status = 'resolved'; await persist(); return true; },

    async saveApprovedPolicy({ policy, by, reason }) {
      await load();
      if (db.approved.some(a => a.policy.id === policy.id && a.policy.version === policy.version)) throw new Error('This version was already approved.');
      db.approved.push({ policy: JSON.parse(JSON.stringify(policy)), by, reason, approvedAt: now() }); await persist();
    },
    async listApprovedPolicies() {
      await load(); const latest = new Map();
      for (const a of db.approved) if (!latest.has(a.policy.id) || latest.get(a.policy.id).version < a.policy.version) latest.set(a.policy.id, a.policy);
      return JSON.parse(JSON.stringify([...latest.values()]));
    },

    async getSourceSnapshot(url) { await load(); const s = db.snapshots[url]; return s ? { url, hash: s.hash, phrases: s.phrases } : null; },
    async putSourceSnapshot(url, { hash, phrases }) { await load(); db.snapshots[url] = { hash, phrases, fetchedAt: now() }; await persist(); },
    async createPolicyFlag(f) {
      await load();
      if (Object.values(db.flags).some(x => x.retailerId === f.retailerId && x.url === f.url && x.hash === f.hash)) return false;
      db.flags[f.id] = { ...JSON.parse(JSON.stringify(f)), status: 'open', createdAt: now() }; await persist();
      return true;
    },
    async getPolicyFlag(id) { await load(); const f = db.flags[id]; if (!f) return null; const { hash, ...rest } = f; return JSON.parse(JSON.stringify(rest)); },
    async listPolicyFlags() {
      await load();
      return Object.values(db.flags).filter(f => f.status === 'open').sort((a, b) => a.createdAt < b.createdAt ? 1 : -1).map(({ hash, ...f }) => JSON.parse(JSON.stringify(f)));
    },
    async setPolicyFlagStatus(id, status) { await load(); const f = db.flags[id]; if (!f || f.status !== 'open') return false; f.status = status; await persist(); return true; },

    async itemsByRetailer(ids) {
      await load(); const out = [];
      for (const [userId, rows] of Object.entries(db.items)) for (const r of Object.values(rows)) if (ids.includes(r.retailer_id)) out.push({ userId, item: decode(r) });
      return out;
    },

    async addNotice(userId, { text, itemId = null }) { await load(); const id = crypto.randomUUID(); db.notices[id] = { id, userId, text, itemId, readAt: null, createdAt: now() }; await persist(); },
    async listNotices(userId) {
      await load();
      return Object.values(db.notices).filter(n => n.userId === userId && !n.readAt).sort((a, b) => a.createdAt < b.createdAt ? -1 : 1).slice(0, 20).map(({ id, text, itemId, createdAt }) => ({ id, text, itemId, createdAt }));
    },
    async markNoticesRead(userId, ids) { await load(); for (const id of ids) { const n = db.notices[id]; if (n && n.userId === userId) n.readAt = now(); } await persist(); },


    /* Purchases from email. */
    async getInboxAddress(userId) { await load(); const a = db.inboxAddresses[userId]; return a ? copy({ token: a.token, senders: a.senders, request: a.request, createdAt: a.createdAt }) : null; },
    async findInboxAddress(token) { await load(); const e = Object.entries(db.inboxAddresses).find(([, a]) => a.token === token); return e ? copy({ userId: e[0], token, senders: e[1].senders }) : null; },
    async setInboxAddress(userId, token) { await load(); db.inboxAddresses[userId] = { token, senders: db.inboxAddresses[userId]?.senders || [], request: null, createdAt: now() }; await persist(); },
    async setForwardRequest(userId, request) { await load(); const a = db.inboxAddresses[userId]; if (!a) return; a.request = copy(request); await persist(); },
    async addInboxSender(userId, email) { await load(); const a = db.inboxAddresses[userId]; if (!a) return; a.request = null; if (!a.senders.includes(email)) a.senders.push(email); await persist(); },
    async saveInboxConnection(c) {
      await load();
      const old = Object.values(db.inboxConnections).find(x => x.userId === c.userId && x.provider === c.provider);
      const row = old ? Object.assign(old, { email: c.email, tokens: c.tokens, status: 'active' }) : (db.inboxConnections[c.id] = { id: c.id, userId: c.userId, provider: c.provider, email: c.email, tokens: c.tokens, status: 'active', syncedAt: null, subscriptionId: null, subscriptionSecret: null, subscriptionExpires: null, createdAt: now() });
      await persist(); return connOut(row);
    },
    async updateInboxConnection(id, patch) {
      await load(); const c = db.inboxConnections[id]; if (!c) return;
      for (const k of ['tokens', 'status', 'syncedAt', 'subscriptionId', 'subscriptionSecret', 'subscriptionExpires']) if (k in patch) c[k] = patch[k] instanceof Date ? iso(patch[k]) : patch[k];
      await persist();
    },
    async getInboxConnection(id) { await load(); return connOut(db.inboxConnections[id]); },
    async listInboxConnections(userId) { await load(); return Object.values(db.inboxConnections).filter(c => c.userId === userId).sort((a, b) => a.provider.localeCompare(b.provider)).map(connOut); },
    async activeInboxConnections() { await load(); return Object.values(db.inboxConnections).filter(c => c.status === 'active').map(connOut); },
    async findInboxSubscription(id) { await load(); return connOut(Object.values(db.inboxConnections).find(c => c.subscriptionId && c.subscriptionId === id)); },
    async deleteInboxConnection(userId, provider) {
      await load(); const c = Object.values(db.inboxConnections).find(x => x.userId === userId && x.provider === provider);
      if (!c) return null;
      delete db.inboxConnections[c.id];
      for (const o of Object.values(db.emailOrders[userId] || {})) if (o.connectionId === c.id) o.connectionId = null;
      for (const [k, m] of Object.entries(db.inboxMessages[userId] || {})) if (m.connectionId === c.id) delete db.inboxMessages[userId][k];
      await persist(); return connOut(c);
    },
    async hasInboxMessage(userId, key) { await load(); return !!(db.inboxMessages[userId] || {})[key]; },
    async saveInboxMessage(userId, m) {
      await load(); const list = (db.inboxMessages[userId] = db.inboxMessages[userId] || {});
      if (!list[m.key]) { list[m.key] = { key: m.key, connectionId: m.connectionId || null, kind: m.kind, orderKey: m.orderKey || null, fields: copy(m.fields || {}), createdAt: now() }; await persist(); }
    },
    async findEmailOrder(userId, orderKey) { await load(); return copy(Object.values(db.emailOrders[userId] || {}).find(o => o.orderKey === orderKey) || null); },
    async listEmailOrders(userId) { await load(); return copy(Object.values(db.emailOrders[userId] || {}).sort((a, b) => String(b.purchased || b.createdAt).localeCompare(String(a.purchased || a.createdAt)))); },
    async saveEmailOrder(userId, o) {
      await load(); const list = (db.emailOrders[userId] = db.emailOrders[userId] || {}), old = list[o.id];
      list[o.id] = { id: o.id, connectionId: old ? old.connectionId : o.connectionId || null, orderKey: o.orderKey, retailerId: o.retailerId || null, store: o.store || null, orderNumber: o.orderNumber || null, purchased: dateOrNull(o.purchased), delivered: dateOrNull(o.delivered), products: copy(o.products || []), createdAt: old ? old.createdAt : now(), updatedAt: now() };
      await persist();
    },
    async deleteInboxData(userId, connectionId) {
      await load(); const out = [];
      for (const [k, m] of Object.entries(db.inboxMessages[userId] || {})) if (m.connectionId === connectionId) delete db.inboxMessages[userId][k];
      for (const [id, o] of Object.entries(db.emailOrders[userId] || {})) if (o.connectionId === connectionId && !Object.values(userItems(userId)).some(r => r.purchase_id === id)) { delete db.emailOrders[userId][id]; out.push(id); }
      await persist(); return out;
    },
    async saveOAuthState(stateHash, { purpose, userId = null, data = {}, expiresAt }) { await load(); db.oauthStates[stateHash] = { purpose, userId, data: copy(data), expiresAt: iso(expiresAt) }; await persist(); },
    async takeOAuthState(stateHash) {
      await load(); const st = db.oauthStates[stateHash];
      if (!st) return null;
      delete db.oauthStates[stateHash]; await persist();
      return Date.parse(st.expiresAt) > Date.now() ? { purpose: st.purpose, userId: st.userId, data: st.data } : null;
    },
    async deleteExpiredOAuthStates() { await load(); let n = 0; for (const [k, st] of Object.entries(db.oauthStates)) if (Date.parse(st.expiresAt) < Date.now()) { delete db.oauthStates[k]; n++; } if (n) await persist(); return n; },
    async findOAuthIdentity(provider, subject) { await load(); const i = db.identities[`${provider}:${subject}`]; return i ? { userId: i.userId, email: i.email } : null; },
    async saveOAuthIdentity({ provider, subject, userId, email = null }) { await load(); db.identities[`${provider}:${subject}`] ||= { userId, email, createdAt: now() }; await persist(); },

    async close() { await queue; }
  };
}

function createStore({ databaseUrl, file }) {
  return databaseUrl ? pgStore(databaseUrl) : fileStore(file);
}

module.exports = { createStore };
