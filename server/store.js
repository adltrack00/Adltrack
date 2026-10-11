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
create unique index if not exists jobs_unique_active_idx on jobs(unique_key) where status in ('queued', 'running');`;

const PURCHASE_COLUMNS = 'id, store, channel, order_number as "orderNumber", purchased, delivered, source, retailer_id as "retailerId", receipt_file_id as "receiptFileId"';
const JOB_COLUMNS = 'id, name, payload, unique_key as "uniqueKey", status, run_at as "runAt", attempts, max_attempts as "maxAttempts", last_error as "lastError"';
const FILE_COLUMNS = 'id, user_id as "userId", kind, storage_key as "storageKey", content_type as "contentType", size, sha256';
const iso = d => new Date(d).toISOString();
const dateOrNull = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
const cleanPurchase = p => ({ id: p.id, store: p.store ?? null, channel: p.channel ?? null, orderNumber: p.orderNumber ?? null, purchased: dateOrNull(p.purchased), delivered: dateOrNull(p.delivered), source: p.source || 'manual', retailerId: p.retailerId ?? null, receiptFileId: p.receiptFileId ?? null });

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
    async deletePurchaseIfEmpty(userId, id) {
      const row = await one(`delete from purchases where user_id=$1 and id=$2 and not exists (select 1 from items where user_id=$1 and purchase_id=$2)
        returning receipt_file_id as "receiptFileId"`, [userId, id]);
      return row ? { deleted: true, receiptFileId: row.receiptFileId } : { deleted: false };
    },
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

    async close() { await pool.end(); }
  };
}

function fileStore(file) {
  let db = null, queue = Promise.resolve();
  const load = async () => {
    if (db) return db;
    try { db = JSON.parse(await fs.readFile(file, 'utf8')); } catch { db = {}; }
    // Files written before the data foundation only have users, sessions and data.
    db = { users: {}, sessions: {}, data: {}, purchases: {}, items: {}, files: {}, jobs: {}, jobSeq: 0, ...db };
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
      await persist();
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
    async deletePurchaseIfEmpty(userId, id) {
      await load(); const p = userPurchases(userId)[id];
      if (!p || Object.values(userItems(userId)).some(r => r.purchase_id === id)) return { deleted: false };
      delete userPurchases(userId)[id]; await persist();
      return { deleted: true, receiptFileId: p.receiptFileId || null };
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
      for (const r of Object.values(userItems(userId))) if (r.photo_file_id === id) r.photo_file_id = null;
      for (const p of Object.values(userPurchases(userId))) if (p.receiptFileId === id) p.receiptFileId = null;
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

    async close() { await queue; }
  };
}

function createStore({ databaseUrl, file }) {
  return databaseUrl ? pgStore(databaseUrl) : fileStore(file);
}

module.exports = { createStore };
