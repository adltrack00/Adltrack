/* Account storage. Postgres when DATABASE_URL is set (production on Render); a JSON file for local development. */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

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
);`;

const versionChanged = (id, version) => Object.assign(new Error(`policies/${id}.json changed but is still version ${version}. Move the old file to policies/history/${id}.v${version}.json and raise the version.`), { code: 'POLICY_VERSION' });

function pgStore(connectionString) {
  const { Pool } = require('pg');
  // Render's internal connection string needs no TLS; its external one (*.render.com) does.
  const ssl = /\.render\.com/.test(connectionString) ? { rejectUnauthorized: false } : false;
  const pool = new Pool({ connectionString, ssl, max: 5 });
  const one = async (sql, params) => (await pool.query(sql, params)).rows[0] || null;
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
    async getData(userId) {
      const row = await one('select payload, updated_at as "updatedAt" from user_data where user_id=$1', [userId]);
      return row ? { ...row.payload, updatedAt: new Date(row.updatedAt).toISOString() } : null;
    },
    async putData(userId, payload) {
      const row = await one(`insert into user_data (user_id, payload, updated_at) values ($1,$2,now())
        on conflict (user_id) do update set payload=excluded.payload, updated_at=now() returning updated_at as "updatedAt"`, [userId, payload]);
      return new Date(row.updatedAt).toISOString();
    },
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
    async close() { await pool.end(); }
  };
}

function fileStore(file) {
  let db = null, queue = Promise.resolve();
  const load = async () => {
    if (db) return db;
    try { db = JSON.parse(await fs.readFile(file, 'utf8')); } catch { db = { users: {}, sessions: {}, data: {} }; }
    db.policies = db.policies || {};
    return db;
  };
  // Serialise writes so concurrent requests can't interleave partial files.
  const persist = () => (queue = queue.then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file + '.tmp', JSON.stringify(db));
    await fs.rename(file + '.tmp', file);
  }));
  const publicUser = u => u && { id: u.id, email: u.email, name: u.name };
  return {
    async init() { await load(); },
    async createUser({ email, name, passwordHash }) {
      await load();
      if (Object.values(db.users).some(u => u.email === email)) throw Object.assign(new Error('exists'), { code: 'EXISTS' });
      const user = { id: crypto.randomUUID(), email, name, passwordHash, createdAt: new Date().toISOString() };
      db.users[user.id] = user; await persist();
      return publicUser(user);
    },
    async findUserByEmail(email) { await load(); return Object.values(db.users).find(u => u.email === email) || null; },
    async findUserById(id) { await load(); return publicUser(db.users[id]) || null; },
    async createSession(userId, tokenHash, expiresAt) { await load(); db.sessions[tokenHash] = { userId, expiresAt: expiresAt.toISOString() }; await persist(); },
    async findSession(tokenHash) { await load(); const s = db.sessions[tokenHash]; return s ? { userId: s.userId, expiresAt: new Date(s.expiresAt) } : null; },
    async deleteSession(tokenHash) { await load(); delete db.sessions[tokenHash]; await persist(); },
    async getData(userId) { await load(); return db.data[userId] ? { ...db.data[userId] } : null; },
    async putData(userId, payload) { await load(); const updatedAt = new Date().toISOString(); db.data[userId] = { ...payload, updatedAt }; await persist(); return updatedAt; },
    async deleteUser(userId) {
      await load();
      delete db.users[userId]; delete db.data[userId];
      for (const [k, s] of Object.entries(db.sessions)) if (s.userId === userId) delete db.sessions[k];
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
    async close() { await queue; }
  };
}

function createStore({ databaseUrl, file }) {
  return databaseUrl ? pgStore(databaseUrl) : fileStore(file);
}

module.exports = { createStore };
