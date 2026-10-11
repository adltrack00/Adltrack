/* HTTP handler: account API under /api, owner-only files under /api/files, and the static app files. */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { itemFields, summary } = require('./policies');

const ROOT = path.resolve(__dirname, '..');
const COOKIE = 'rl_session';
const SESSION_DAYS = 30;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
// Only top-level app files and assets/ are public; server/, tests/, scripts/, data/ and package files never are.
const STATIC_DIRS = new Set(['', 'assets']);
const SERVER_ONLY = new Set(['server.js']);
const FILE_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox";
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

/* Passwords: scrypt with a per-user salt. */
const SCRYPT = { N: 16384, r: 8, p: 1 };
function scrypt(password, salt) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, { ...SCRYPT, maxmem: 64 * 1024 * 1024 }, (err, key) => err ? reject(err) : resolve(key)));
}
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function verifyPassword(password, stored) {
  const [scheme, , , , salt, key] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
// Compared against when an email isn't registered, so response time doesn't reveal which emails exist.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const normEmail = e => String(e || '').trim().toLowerCase();
const validEmail = e => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const validName = n => typeof n === 'string' && n.trim().length >= 1 && n.trim().length <= 40;
const validPassword = p => typeof p === 'string' && p.length >= 8 && p.length <= 200;

/* Simple in-memory limiter: N attempts per key per window. */
function limiter(limit, windowMs) {
  const hits = new Map();
  return key => {
    const now = Date.now(), entry = hits.get(key);
    if (!entry || entry.reset < now) { hits.set(key, { count: 1, reset: now + windowMs }); return true; }
    entry.count++;
    if (hits.size > 10000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    return entry.count <= limit;
  };
}

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > maxBytes) { reject(new HttpError(413, 'That’s too much data to save at once. Try removing a few large photos.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Invalid request.')); }
    });
    req.on('error', reject);
  });
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createApp({ store, data, production = false, policies = null }) {
  const authLimit = limiter(20, 15 * 60 * 1000);
  // Locks an email for 15 minutes after 10 wrong passwords, checked before the password is tried.
  const loginFailures = (() => {
    const fails = new Map(), WINDOW = 15 * 60 * 1000, MAX = 10;
    const get = e => { const f = fails.get(e); if (f && f.reset < Date.now()) { fails.delete(e); return null; } return f; };
    return {
      locked: e => (get(e)?.count || 0) >= MAX,
      fail: e => { const f = get(e); if (f) f.count++; else fails.set(e, { count: 1, reset: Date.now() + WINDOW }); },
      clear: e => fails.delete(e)
    };
  })();

  const isSecure = req => production || req.headers['x-forwarded-proto'] === 'https';
  const cookie = (req, value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isSecure(req) ? '; Secure' : ''}`;
  // Behind Render's proxy the real visitor IP is the last X-Forwarded-For entry; earlier entries can be forged.
  const clientIp = req => production && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',').pop().trim() : String(req.socket.remoteAddress || '');

  function send(res, status, body, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  }

  async function currentUser(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const tokenHash = sha256(token);
    const session = await store.findSession(tokenHash);
    if (!session) return null;
    if (new Date(session.expiresAt) < new Date()) { await store.deleteSession(tokenHash); return null; }
    return store.findUserById(session.userId);
  }

  async function startSession(req, res, user, status, extra = {}) {
    const token = crypto.randomBytes(32).toString('base64url');
    await store.createSession(user.id, sha256(token), new Date(Date.now() + SESSION_DAYS * 864e5));
    send(res, status, { user: { email: user.email, name: user.name }, ...extra }, { 'Set-Cookie': cookie(req, token, SESSION_DAYS * 86400) });
  }

  function checkWrite(req) {
    // Blocks cross-site form posts: state changes must be JSON from this site.
    const origin = req.headers.origin;
    if (origin) {
      let host; try { host = new URL(origin).host; } catch { throw new HttpError(403, 'Forbidden.'); }
      if (host !== (req.headers['x-forwarded-host'] || req.headers.host)) throw new HttpError(403, 'Forbidden.');
    }
    if (!/^application\/json\b/.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Send JSON.');
  }

  function cleanPayload(body) {
    const { purchases, settings, profile } = body || {};
    if (!Array.isArray(purchases) || purchases.length > 5000) throw new HttpError(400, 'Invalid purchases.');
    if (settings !== undefined && (typeof settings !== 'object' || settings === null || Array.isArray(settings))) throw new HttpError(400, 'Invalid settings.');
    if (profile !== undefined && (typeof profile !== 'object' || profile === null || Array.isArray(profile))) throw new HttpError(400, 'Invalid profile.');
    return { purchases, settings: settings || {}, profile: profile || {} };
  }

  async function api(req, res, route) {
    const method = req.method;
    if (route === '/api/health' && method === 'GET') return send(res, 200, { ok: true });

    // Retailer return policies are public facts, so no sign-in is needed to read them.
    if (route === '/api/retailers' && method === 'GET') {
      if (!policies) throw new HttpError(503, 'Retailer policies aren’t loaded.');
      const q = new URL(req.url, 'http://localhost').searchParams;
      if (q.has('match')) {
        const name = q.get('match').slice(0, 200), hit = policies.match(name);
        return send(res, 200, { match: hit && { ...hit, ...summary(policies.get(hit.id)) } });
      }
      return send(res, 200, { retailers: policies.list().map(summary) });
    }
    const retailer = /^\/api\/retailers\/([a-z0-9-]+)$/.exec(route);
    if (route.startsWith('/api/retailers/') && method === 'GET') {
      const policy = retailer && policies && policies.get(retailer[1]);
      if (!policy) throw new HttpError(404, 'We don’t have that store’s policy yet.');
      return send(res, 200, { retailer: policy, item: itemFields(policy), versions: await store.policyVersions(policy.id) });
    }

    if (route === '/api/signup' && method === 'POST') {
      checkWrite(req);
      if (!authLimit('ip:' + clientIp(req))) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
      const body = await readBody(req, 10_000);
      const email = normEmail(body.email), name = String(body.name || '').trim();
      if (!validName(name)) throw new HttpError(400, 'Enter your first name.');
      if (!validEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
      if (!validPassword(body.password)) throw new HttpError(400, 'Use a password with at least 8 characters.');
      let user;
      try { user = await store.createUser({ email, name, passwordHash: await hashPassword(body.password) }); }
      catch (err) { if (err.code === 'EXISTS') throw new HttpError(409, 'An account with this email already exists. Sign in instead.'); throw err; }
      return startSession(req, res, user, 201, { data: null });
    }

    if (route === '/api/login' && method === 'POST') {
      checkWrite(req);
      if (!authLimit('ip:' + clientIp(req))) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
      const body = await readBody(req, 10_000);
      const email = normEmail(body.email);
      if (loginFailures.locked(email)) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
      const user = validEmail(email) ? await store.findUserByEmail(email) : null;
      const ok = await verifyPassword(String(body.password || ''), user ? user.passwordHash : await DUMMY_HASH);
      if (!user || !ok) { loginFailures.fail(email); throw new HttpError(401, 'Email or password is incorrect.'); }
      loginFailures.clear(email);
      return startSession(req, res, user, 200, { data: await data.getData(user.id) });
    }

    if (route === '/api/logout' && method === 'POST') {
      checkWrite(req);
      const token = parseCookies(req.headers.cookie)[COOKIE];
      if (token) await store.deleteSession(sha256(token));
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, '', 0) });
    }

    const user = await currentUser(req);
    if (!user) throw new HttpError(401, 'Please sign in.');

    if (route === '/api/me' && method === 'GET') return send(res, 200, { user: { email: user.email, name: user.name } });
    if (route === '/api/data' && method === 'GET') return send(res, 200, { data: await data.getData(user.id) });
    // The whole account in one document, kept for older versions of the app.
    if (route === '/api/data' && method === 'PUT') {
      checkWrite(req);
      const payload = cleanPayload(await readBody(req, 12 * 1024 * 1024));
      return send(res, 200, { updatedAt: await data.putData(user.id, payload) });
    }

    // Owner-only file, such as an item photo. Anyone else gets the same 404 as a file that doesn't exist.
    const fileMatch = /^\/api\/files\/([0-9a-f-]{36})$/i.exec(route);
    if (fileMatch && method === 'GET') {
      const file = await data.readFile(user.id, fileMatch[1].toLowerCase());
      if (!file) throw new HttpError(404, 'Not found.');
      res.writeHead(200, { 'Content-Type': file.contentType, 'Content-Length': file.body.length, 'Cache-Control': 'private, max-age=31536000, immutable', 'Content-Disposition': 'inline', 'Content-Security-Policy': FILE_CSP });
      return res.end(file.body);
    }

    // Per-item sync: the app creates, updates and deletes one item at a time.
    await data.migrate(user.id);
    if (route === '/api/items' && method === 'GET') {
      const raw = await data.getData(user.id);
      return send(res, 200, { items: raw ? raw.purchases : [], updatedAt: raw ? raw.updatedAt : null });
    }
    if (route === '/api/items' && method === 'POST') {
      checkWrite(req);
      return send(res, 201, await data.saveItem(user.id, await readBody(req, 12 * 1024 * 1024), { mustBeNew: true }));
    }
    const itemMatch = /^\/api\/items\/([^/]+)$/.exec(route);
    if (itemMatch && (method === 'PUT' || method === 'DELETE')) {
      checkWrite(req);
      let id; try { id = decodeURIComponent(itemMatch[1]); } catch { throw new HttpError(400, 'Invalid item.'); }
      if (method === 'DELETE') {
        const r = await data.deleteItem(user.id, id);
        if (!r.deleted) throw new HttpError(404, 'Not found.');
        return send(res, 200, { ok: true, updatedAt: r.updatedAt });
      }
      const body = await readBody(req, 12 * 1024 * 1024);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Invalid item.');
      return send(res, 200, await data.saveItem(user.id, { ...body, id }));
    }
    if (route === '/api/settings' && method === 'PUT') {
      checkWrite(req);
      const { settings, profile } = cleanPayload({ purchases: [], ...(await readBody(req, 12 * 1024 * 1024)) });
      return send(res, 200, await data.putSettings(user.id, { settings, profile }));
    }
    if (route === '/api/purchases' && method === 'GET') return send(res, 200, { purchases: await data.listPurchases(user.id) });
    const receiptMatch = /^\/api\/purchases\/([^/]+)\/receipt$/.exec(route);
    if (receiptMatch && method === 'PUT') {
      checkWrite(req);
      let id; try { id = decodeURIComponent(receiptMatch[1]); } catch { throw new HttpError(400, 'Invalid request.'); }
      const body = await readBody(req, 14 * 1024 * 1024);
      return send(res, 200, await data.attachReceipt(user.id, id, body && body.data));
    }
    if (route === '/api/account' && method === 'DELETE') {
      checkWrite(req);
      const body = await readBody(req, 10_000);
      const full = await store.findUserByEmail(user.email);
      if (!full || !(await verifyPassword(String(body.password || ''), full.passwordHash))) throw new HttpError(401, 'That password isn’t right.');
      await data.deleteAccount(user.id);
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, '', 0) });
    }
    throw new HttpError(404, 'Not found.');
  }

  async function serveStatic(req, res, pathname) {
    let name = decodeURIComponent(pathname);
    if (name === '/') name = '/index.html';
    const rel = name.replace(/^\/+/, '');
    const dir = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
    const file = path.resolve(ROOT, rel);
    if (!STATIC_DIRS.has(dir) || SERVER_ONLY.has(rel) || rel.split('/').some(s => s.startsWith('.')) || !TYPES[path.extname(file)] || !file.startsWith(ROOT + path.sep)) throw new HttpError(404, 'Not found');
    const data = await fs.readFile(file).catch(() => { throw new HttpError(404, 'Not found'); });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)], 'Cache-Control': 'no-cache', 'Content-Security-Policy': CSP });
    res.end(data);
  }

  return async function handler(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url.pathname);
      if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'Method not allowed');
      return await serveStatic(req, res, url.pathname);
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      if (res.headersSent) return res.end();
      if (url.pathname.startsWith('/api/')) return send(res, status, { error: status === 500 ? 'Something went wrong. Please try again.' : err.message });
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(status === 404 ? 'Not found' : 'Error');
    }
  };
}

module.exports = { createApp, hashPassword, verifyPassword };
