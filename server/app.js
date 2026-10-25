/* HTTP handler: account API under /api, owner-only files under /api/files, and the static app files. */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { itemFields, summary } = require('./policies');
const { evaluate } = require('./engine');
const { MAX_PAGES } = require('./receipts');
const { buildGuide, placeQueries } = require('./guide');
const { cleanSubscription, validTimeZone, quiet, notification } = require('./reminders');
const { mergeMarks, mergeVitals } = require('./items');
const { ACTIONS, KINDS } = require('./email');
const { createTeam } = require('./team');
const { createPermissions } = require('./permissions');
const { createBilling } = require('./billing');
const { printedWindow } = require('./receipts');
const { dischargeDraft, MAX_PAGES: MAX_DISCHARGE_PAGES } = require('./discharge');
const { compare: compareLabel, MAX_PHOTOS: MAX_LABEL_PHOTOS } = require('./label');
const { InboxError } = require('./inbox');

const ROOT = path.resolve(__dirname, '..');
const COOKIE = 'rl_session';
const SESSION_DAYS = 30;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
// Only top-level app files, assets/ and the landing page's landing/ are public; server/, tests/, scripts/, data/ and package files never are.
const STATIC_DIRS = new Set(['', 'assets', 'landing']);
const SERVER_ONLY = new Set(['server.js']);
const FILE_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox";
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://images.unsplash.com; media-src 'self' blob:; connect-src 'self'; font-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

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

/* The raw request body, for checking a webhook's signature before parsing it. */
function readRaw(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > maxBytes) { reject(new HttpError(413, 'Too much data.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
/* Resend signs webhooks the Svix way: HMAC-SHA256 of "id.timestamp.body" with the base64 key after "whsec_", sent as
   "v1,<base64>" (several may be listed). Requests older or newer than five minutes are refused, so they can't be replayed. */
function verifyWebhook(secret, headers, raw, now = Date.now()) {
  const id = headers['svix-id'], ts = headers['svix-timestamp'], sigs = String(headers['svix-signature'] || '');
  if (!secret || !id || !/^\d+$/.test(String(ts || '')) || Math.abs(now / 1000 - Number(ts)) > 300) return false;
  const want = crypto.createHmac('sha256', Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64')).update(`${id}.${ts}.${raw.toString('utf8')}`).digest();
  return sigs.split(' ').some(s => { const [v, b64] = s.split(','); const got = Buffer.from(b64 || '', 'base64'); return v === 'v1' && got.length === want.length && crypto.timingSafeEqual(got, want); });
}

/* Form posts (Sign in with Apple answers with one). */
function readForm(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > maxBytes) { reject(new HttpError(413, 'Too much data.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')))));
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

/* A read receipt → the app's draft: store (the matched retailer's name when we know the store), date, channel and one
   product per item. A line bought several times becomes one product per unit, so each can be returned on its own. */
function receiptDraft(receipt, policy) {
  const products = [];
  for (const line of receipt.items) {
    const units = line.quantity > 1 && line.quantity <= 10 && line.price !== null ? line.quantity : 1;
    const price = line.price === null ? '' : units > 1 ? Math.round(line.price / units * 100) / 100 : line.price;
    for (let n = 0; n < units && products.length < 20; n++) products.push({ name: line.name || '', price, code: line.code || '' });
  }
  return {
    retailer: policy ? policy.name : receipt.store || '',
    purchased: receipt.purchased || '',
    channel: receipt.channel,
    products,
    orderNumber: receipt.orderNumber || '',
    payment: receipt.payment || '',
    receiptPolicy: receipt.policyText || '',
    notes: receipt.notes
  };
}

function createApp({ store, data, production = false, policies = null, classifier = null, receipts = null, discharge = null, labels = null, places = null, review = null, push = null, reminders = null, email = null, supportEmail = '', inbox = null, oauth = null, publicUrl = '', inboundSecret = '', sms = null, team = null, billing = null }) {
  billing = billing || createBilling({ store });
  team = team || createTeam({ store, email, sms, billing });
  const authLimit = limiter(20, 15 * 60 * 1000);
  // Each classification is an AI call, so it's limited per account.
  const classifyLimit = limiter(300, 60 * 60 * 1000);
  // Each receipt read is a larger AI call (images), so it has its own, lower limit.
  const receiptLimit = limiter(60, 60 * 60 * 1000);
  // Each drop-off lookup can be several paid places calls.
  const placesLimit = limiter(30, 60 * 60 * 1000);
  // Test notifications go through the push service.
  const pushTestLimit = limiter(10, 60 * 60 * 1000);
  // Each new store lookup is a web search plus an AI call; cached answers don't count.
  const lookupLimit = limiter(20, 60 * 60 * 1000);
  const reportLimit = limiter(30, 60 * 60 * 1000);
  // Password reset emails: a few per address per hour, so nobody can flood someone's inbox.
  const resetLimit = limiter(3, 60 * 60 * 1000);
  // Email links (actions and unsubscribes) work without signing in, so they're limited per IP.
  const linkLimit = limiter(60, 15 * 60 * 1000);
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
    send(res, status, { user: publicUser(user), ...extra }, { 'Set-Cookie': cookie(req, token, SESSION_DAYS * 86400) });
  }

  /* The care plan an account works on (its own, or the care team's it joined), with a short id of it so the app notices
     when that changes and swaps its copy. */
  const spaceOf = ownerId => sha256('space:' + ownerId).slice(0, 16);
  async function spaceData(user) { const { ownerId } = await team.access(user); return { data: await data.getData(ownerId), space: spaceOf(ownerId) }; }

  const publicUser = user => ({ email: user.email, name: user.name, ...(review && review.isAdmin(user) ? { admin: true } : {}) });
  // Accounts made with "Continue with Google / Apple" have no password.
  const NO_PASSWORD = 'none';

  /* OAuth: sign-in with Google or Apple, and connecting Gmail or Outlook. The state value is random, kept (hashed) for ten
     minutes and bound to this browser by a cookie, so a callback can't be replayed or started from another browser. */
  const OAUTH_COOKIE = 'rl_oauth';
  const baseUrl = req => publicUrl || `${isSecure(req) ? 'https' : 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`;
  const redirect = (res, location, cookies = []) => { res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...(cookies.length ? { 'Set-Cookie': cookies } : {}) }); res.end(); };
  const oauthCookie = (req, value, maxAge) => `${OAUTH_COOKIE}=${value}; Path=/api/; HttpOnly; SameSite=None; Secure; Max-Age=${maxAge}`;
  async function startOAuth(req, res, purpose, callbackPath, { userId = null, loginHint } = {}) {
    const state = crypto.randomBytes(24).toString('base64url'), nonce = crypto.randomBytes(16).toString('base64url'), browser = crypto.randomBytes(24).toString('base64url');
    await store.saveOAuthState(sha256(state), { purpose, userId, data: { nonce, browser: sha256(browser) }, expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
    redirect(res, oauth.authUrl(purpose, { state, nonce, redirectUri: baseUrl(req) + callbackPath, loginHint }), [oauthCookie(req, browser, 600)]);
  }
  async function finishOAuth(req, purpose, params, userId = null) {
    const saved = typeof params.state === 'string' && params.state ? await store.takeOAuthState(sha256(params.state)) : null;
    const browser = parseCookies(req.headers.cookie)[OAUTH_COOKIE];
    if (!saved || saved.purpose !== purpose || !browser || sha256(browser) !== saved.data.browser || (userId && saved.userId !== userId)) throw new HttpError(400, 'expired');
    if (params.error || typeof params.code !== 'string' || !params.code) throw new HttpError(400, 'cancelled');
    return { nonce: saved.data.nonce };
  }
  /* Signs in (or up) with the provider's verified email. An existing account with that email is linked, not duplicated. */
  async function socialSignIn(req, res, provider, claims, name) {
    const subject = String(claims.sub || ''), email = normEmail(claims.email), verified = claims.email_verified === true || claims.email_verified === 'true';
    let user = null;
    const identity = subject ? await store.findOAuthIdentity(provider, subject) : null;
    if (identity) user = await store.findUserById(identity.userId);
    if (!user) {
      if (!subject || !verified || !validEmail(email)) throw new HttpError(400, 'email');
      const existing = await store.findUserByEmail(email);
      if (existing) user = { id: existing.id, email: existing.email, name: existing.name };
      else {
        const first = String(name || '').trim().split(/\s+/)[0] || email.split('@')[0];
        try { user = await store.createUser({ email, name: first.slice(0, 40), passwordHash: NO_PASSWORD }); }
        catch (err) { if (err.code !== 'EXISTS') throw err; const again = await store.findUserByEmail(email); user = { id: again.id, email: again.email, name: again.name }; }
      }
      await store.saveOAuthIdentity({ provider, subject, userId: user.id, email });
    }
    const token = crypto.randomBytes(32).toString('base64url');
    await store.createSession(user.id, sha256(token), new Date(Date.now() + SESSION_DAYS * 864e5));
    redirect(res, '/signin.html?signed-in=' + provider, [cookie(req, token, SESSION_DAYS * 86400), oauthCookie(req, '', 0)]);
  }
  const authFailed = (res, err) => { if (!err.status || err.status >= 500) console.error('Sign-in failed:', err.message); redirect(res, '/signin.html?error=' + (['expired', 'cancelled', 'email'].includes(err.message) ? err.message : 'failed')); };

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
      return startSession(req, res, user, 201, { data: null, space: spaceOf(user.id) });
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
      return startSession(req, res, user, 200, await spaceData(user));
    }

    // The support address shown on Support (SUPPORT_EMAIL), or null when it isn't set.
    if (route === '/api/contact' && method === 'GET') return send(res, 200, { email: supportEmail || null });

    // Password reset by email. The answer is the same whether or not the address has an account.
    if (route === '/api/password/forgot' && method === 'POST') {
      checkWrite(req);
      if (!authLimit('ip:' + clientIp(req))) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
      const body = await readBody(req, 10_000);
      const address = normEmail(body.email);
      if (!validEmail(address)) throw new HttpError(400, 'Enter a valid email address.');
      if (!email || !email.available()) throw new HttpError(503, 'Password reset by email isn’t set up yet. Contact support to reset it.');
      if (!resetLimit('email:' + address)) return send(res, 200, { ok: true });
      const user = await store.findUserByEmail(address);
      if (user) {
        const token = crypto.randomBytes(32).toString('base64url');
        await store.createPasswordReset(user.id, sha256(token), new Date(Date.now() + 60 * 60 * 1000));
        // Not awaited, so the response time doesn't reveal which addresses have an account.
        email.sendReset(user.email, token).catch(err => console.error('Reset email failed:', err.message));
      }
      return send(res, 200, { ok: true });
    }
    if (route === '/api/password/reset' && method === 'POST') {
      checkWrite(req);
      if (!authLimit('ip:' + clientIp(req))) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
      const body = await readBody(req, 10_000);
      if (!validPassword(body.password)) throw new HttpError(400, 'Use a password with at least 8 characters.');
      const userId = typeof body.token === 'string' && body.token.length <= 100 ? await store.takePasswordReset(sha256(body.token)) : null;
      if (!userId) throw new HttpError(400, 'This link has expired or was already used. Ask for a new one.');
      await store.setPassword(userId, await hashPassword(body.password));
      // Every other device is signed out; this one is signed in with the new password.
      await store.deleteUserSessions(userId);
      const user = await store.findUserById(userId);
      loginFailures.clear(user.email);
      return startSession(req, res, user, 200, await spaceData(user));
    }

    // Links in reminder emails, which work without signing in: signed for one account, item and action.
    if (route === '/api/email/act' && method === 'POST') {
      checkWrite(req);
      if (!linkLimit('ip:' + clientIp(req))) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
      const body = await readBody(req, 2_000);
      const t = email && email.tokens.verify(body.token);
      if (!t || t.t !== 'act' || !ACTIONS.includes(t.a) || !reminders) throw new HttpError(400, 'This link has expired. Open Adltrack instead.');
      const item = await reminders.act(t.u, t.i, t.a, (await reminders.localNow(t.u)).date);
      if (!item) throw new HttpError(404, 'This purchase isn’t in your Adltrack anymore.');
      return send(res, 200, { ok: true, action: t.a, name: item.name || '' });
    }
    // Unsubscribe from one type of reminder email: from the email's link (JSON) or one-click from the mail app (RFC 8058,
    // a form post with the token in the URL, sent by the mail provider itself).
    if (route === '/api/email/unsubscribe' && method === 'POST') {
      if (!linkLimit('ip:' + clientIp(req))) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
      const query = new URL(req.url, 'http://localhost').searchParams.get('t');
      let token = query;
      if (query) req.resume(); else { checkWrite(req); token = (await readBody(req, 2_000)).token; }
      const t = email && email.tokens.verify(token);
      if (!t || t.t !== 'unsub' || !KINDS.includes(t.k)) throw new HttpError(400, 'This link isn’t valid. Turn emails off in Reminders instead.');
      if (await store.findUserById(t.u)) await store.setEmailOptout(t.u, t.k, true);
      return send(res, 200, { ok: true, kind: t.k });
    }

    // The invite link from a care team, before signing in: who added this person and as what.
    if (route === '/api/invite/info' && method === 'POST') {
      checkWrite(req);
      if (!linkLimit('ip:' + clientIp(req))) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
      return send(res, 200, await team.inviteInfo((await readBody(req, 2_000)).token));
    }

    if (route === '/api/logout' && method === 'POST') {
      checkWrite(req);
      const token = parseCookies(req.headers.cookie)[COOKIE];
      if (token) await store.deleteSession(sha256(token));
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, '', 0) });
    }

    // "Continue with Google / Apple" on the sign-in and sign-up pages. Separate from inbox access: only name and email.
    if (route === '/api/auth/providers' && method === 'GET') return send(res, 200, { google: !!(oauth && oauth.available.google), apple: !!(oauth && oauth.available.apple) });
    const signInStart = /^\/api\/auth\/(google|apple)\/start$/.exec(route);
    if (signInStart && method === 'GET') {
      const provider = signInStart[1];
      if (!oauth || !oauth.available[provider]) return redirect(res, '/signin.html?error=unavailable');
      if (!authLimit('ip:' + clientIp(req))) return redirect(res, '/signin.html?error=limit');
      return startOAuth(req, res, provider === 'google' ? 'signinGoogle' : 'signinApple', `/api/auth/${provider}/callback`);
    }
    if (route === '/api/auth/google/callback' && method === 'GET') {
      try {
        const q = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
        const { nonce } = await finishOAuth(req, 'signinGoogle', q);
        const t = await oauth.exchange('signinGoogle', { code: q.code, redirectUri: baseUrl(req) + '/api/auth/google/callback', nonce });
        return await socialSignIn(req, res, 'google', t.claims || {}, t.claims && (t.claims.given_name || t.claims.name));
      } catch (err) { return authFailed(res, err); }
    }
    // Apple answers with a cross-site form post, so the browser binding uses a SameSite=None cookie.
    if (route === '/api/auth/apple/callback' && method === 'POST') {
      try {
        const f = await readForm(req, 20_000);
        const { nonce } = await finishOAuth(req, 'signinApple', f);
        const t = await oauth.exchange('signinApple', { code: f.code, redirectUri: baseUrl(req) + '/api/auth/apple/callback', nonce });
        let name = ''; try { name = JSON.parse(f.user || '{}').name.firstName || ''; } catch {}
        return await socialSignIn(req, res, 'apple', t.claims, name);
      } catch (err) { return authFailed(res, err); }
    }
    // Forwarded mail: Resend's `email.received` webhook, signed with RESEND_WEBHOOK_SECRET (Svix format). Only the message's
    // metadata arrives here; mail to an unknown address is dropped, and the rest is fetched and read by a job.
    if (route === '/api/inbound/email' && method === 'POST') {
      const raw = await readRaw(req, 1024 * 1024);
      if (!inbox || !verifyWebhook(inboundSecret, req.headers, raw)) throw new HttpError(401, 'Unauthorized.');
      let event; try { event = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'Invalid request.'); }
      return send(res, 200, await inbox.inbound(event));
    }
    // Stripe: payments and subscription changes for a family's plan, signed with STRIPE_WEBHOOK_SECRET.
    if (route === '/api/stripe/webhook' && method === 'POST') {
      const raw = await readRaw(req, 1024 * 1024);
      if (!billing.stripe || !billing.stripe.verify(req.headers['stripe-signature'], raw)) throw new HttpError(401, 'Unauthorized.');
      let event; try { event = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'Invalid request.'); }
      return send(res, 200, await billing.webhook(event));
    }
    // Microsoft Graph: the subscription handshake echoes validationToken; notifications only say that mail arrived.
    if (route === '/api/inbox/outlook/notify' && method === 'POST') {
      const token = new URL(req.url, 'http://localhost').searchParams.get('validationToken');
      if (token !== null) { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(token.slice(0, 1000)); }
      if (inbox) await inbox.outlookNotify(await readBody(req, 1024 * 1024));
      return send(res, 202, { ok: true });
    }

    const user = await currentUser(req);
    if (!user) throw new HttpError(401, 'Please sign in.');

    // Whose care plan this account works on: its own, or one of the care teams it joined, the one the app asked for (X-Patient)
    // when this person is on it. Every care plan route below uses it.
    const wanted = typeof req.headers['x-patient'] === 'string' ? req.headers['x-patient'].toLowerCase() : null;
    const access = await team.access(user, wanted), owner = access.ownerId;
    // What this person may change on it (server/permissions.js). Viewers change nothing.
    const may = createPermissions(access);

    if (route === '/api/me' && method === 'GET') {
      const full = await store.findUserByEmail(user.email);
      return send(res, 200, { user: { ...publicUser(user), ...(full && full.passwordHash === NO_PASSWORD ? { passwordless: true } : {}) }, team: { role: access.role, perms: access.perms, owner: access.owner, ...(access.changedBy ? { changedBy: access.changedBy } : {}), patient: owner, patients: await team.patients(access) }, space: spaceOf(owner) });
    }

    // Settings → People: the care team, adding people by email and phone with what each may do, and joining from an invite.
    if (route === '/api/team' && method === 'GET') return send(res, 200, await team.view(user, wanted));
    if (route === '/api/team/members' && method === 'POST') {
      checkWrite(req);
      if (!linkLimit('invite:' + user.id)) throw new HttpError(429, 'You’ve sent a lot of invites. Try again in a few minutes.');
      return send(res, 201, await team.add(user, await readBody(req, 5_000), baseUrl(req), wanted));
    }
    const memberMatch = /^\/api\/team\/members\/([0-9a-f-]{36})(\/invite)?$/i.exec(route);
    if (memberMatch && !memberMatch[2] && method === 'PUT') { checkWrite(req); return send(res, 200, await team.update(user, memberMatch[1].toLowerCase(), await readBody(req, 5_000), wanted)); }
    if (memberMatch && !memberMatch[2] && method === 'DELETE') { checkWrite(req); return send(res, 200, await team.remove(user, memberMatch[1].toLowerCase(), wanted)); }
    if (memberMatch && memberMatch[2] && method === 'POST') {
      checkWrite(req);
      if (!linkLimit('invite:' + user.id)) throw new HttpError(429, 'You’ve sent a lot of invites. Try again in a few minutes.');
      return send(res, 200, await team.resend(user, memberMatch[1].toLowerCase(), baseUrl(req), wanted));
    }
    if (route === '/api/team/leave' && method === 'POST') { checkWrite(req); return send(res, 200, await team.leave(user, wanted)); }
    if (route === '/api/invite/accept' && method === 'POST') {
      checkWrite(req);
      if (!linkLimit('ip:' + clientIp(req))) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
      return send(res, 200, await team.accept(user, (await readBody(req, 2_000)).token));
    }

    // Settings → Plan: this family's plan, paid by its admins. Caregivers and viewers never pay.
    if (route === '/api/plan' && method === 'GET') return send(res, 200, await billing.view(access));
    if (route === '/api/plan/trial' && method === 'POST') { checkWrite(req); return send(res, 200, await billing.trial(access)); }
    if (route === '/api/plan/checkout' && method === 'POST') { checkWrite(req); return send(res, 200, await billing.checkout(access, user, baseUrl(req), (await readBody(req, 2_000)).tier)); }
    if (route === '/api/plan/change' && method === 'POST') { checkWrite(req); return send(res, 200, await billing.change(access, (await readBody(req, 2_000)).tier)); }
    if (route === '/api/plan/confirm' && method === 'POST') { checkWrite(req); return send(res, 200, await billing.confirm(access, (await readBody(req, 2_000)).session)); }
    if (route === '/api/plan/portal' && method === 'POST') { checkWrite(req); return send(res, 200, await billing.portal(access, baseUrl(req))); }

    // Purchases from email: the forwarding address, connected inboxes and the orders found that haven't been opened yet.
    if (route.startsWith('/api/inbox')) {
      if (!inbox) throw new HttpError(503, 'Email import isn’t available right now.');
      try {
        if (route === '/api/inbox' && method === 'GET') return send(res, 200, await inbox.status(user));
        if (route === '/api/inbox/address' && method === 'POST') { checkWrite(req); return send(res, 200, await inbox.newAddress(user.id)); }
        if (route === '/api/inbox/senders' && method === 'POST') { checkWrite(req); return send(res, 200, await inbox.acceptSender(user.id, (await readBody(req, 2_000)).email)); }
        const m = /^\/api\/inbox\/(gmail|outlook)\/(start|callback|disconnect)$/.exec(route);
        if (m && m[2] === 'disconnect' && method === 'POST') { checkWrite(req); return send(res, 200, await inbox.disconnect(user.id, m[1])); }
        if (m && m[2] === 'start' && method === 'GET') {
          if (!inbox.available()[m[1]]) return redirect(res, '/app.html?inbox_error=unavailable');
          return await startOAuth(req, res, m[1], `/api/inbox/${m[1]}/callback`, { userId: user.id, loginHint: user.email });
        }
        if (m && m[2] === 'callback' && method === 'GET') {
          try {
            const q = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
            const { nonce } = await finishOAuth(req, m[1], q, user.id);
            const t = await oauth.exchange(m[1], { code: q.code, redirectUri: baseUrl(req) + `/api/inbox/${m[1]}/callback`, nonce: m[1] === 'outlook' ? nonce : null });
            await inbox.connect(user.id, m[1], t);
            return redirect(res, '/app.html?inbox=' + m[1], [oauthCookie(req, '', 0)]);
          } catch (err) {
            if (!err.status || err.status >= 500) console.error('Inbox connect failed:', err.message);
            return redirect(res, '/app.html?inbox_error=' + (['expired', 'cancelled'].includes(err.message) ? err.message : err.code === 'scope' ? 'scope' : 'failed'));
          }
        }
      } catch (err) { if (err instanceof InboxError) throw new HttpError(err.status, err.message); throw err; }
      throw new HttpError(404, 'Not found.');
    }

    // Policy engine: the retailer's checked policy applied to one item and the user's answers. Nothing is saved here;
    // the app writes the result into the item's existing fields and syncs it like any other change.
    if (route === '/api/policy' && method === 'POST') {
      checkWrite(req);
      if (!policies) throw new HttpError(503, 'Retailer policies aren’t loaded.');
      const body = await readBody(req, 20_000);
      const raw = body && typeof body.item === 'object' && body.item ? body.item : {};
      const text = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
      const item = { name: text(raw.name, 200), retailer: text(raw.retailer, 200), purchased: text(raw.purchased, 10), delivered: text(raw.delivered, 10), channel: text(raw.channel, 20), dateSet: !!raw.dateSet, receiptPolicy: text(raw.receiptPolicy, 2000), orderNumber: text(raw.orderNumber, 40) };
      const answers = {};
      for (const k of ['final', 'opened', 'member', 'damaged', 'tags', 'packaging', 'clearance']) if (typeof body.answers?.[k] === 'boolean') answers[k] = body.answers[k];
      const match = item.retailer && item.retailer !== 'Store not added' ? policies.match(item.retailer) : null;
      let policy = match && policies.get(match.id), lookup = null;
      // A store we don't have, with no window printed on the receipt: the cached web lookup (unverified), or one queued for it.
      if (!policy && match === null && item.retailer && item.retailer !== 'Store not added' && review && !printedWindow(item.receiptPolicy)) {
        const r = await review.forStore(item.retailer, user.id, { canLookUp: lookupLimit('user:' + user.id) });
        policy = r.policy; lookup = r.state;
      }
      let category = null;
      if (policy && body.retailerId === policy.id && typeof body.category === 'string' && body.category) category = body.category.slice(0, 60);
      else if (policy && classifier && classifyLimit('user:' + user.id)) category = await classifier.classify(item.name, policy);
      const result = evaluate({ item, policy, answers, category });
      if (!policy && lookup === 'pending') result.line = `Not sure it's returnable · Looking up ${item.retailer}'s return policy…`;
      // How to return it: the steps for each way this store accepts returns, easiest first.
      const guide = buildGuide(policy, item);
      if (guide) result.fields.url = guide.url;
      return send(res, 200, { retailer: policy ? { id: policy.id, name: policy.name, version: policy.version, checked: policy.checked, ...(policy.status !== 'checked' ? { unverified: true } : {}) } : null, category, answers, result, guide, ...(lookup ? { lookup } : {}) });
    }
    // "Is this wrong?" on the Return card: the policy line the user saw and an optional note, saved for review.
    if (route === '/api/policy/report' && method === 'POST') {
      checkWrite(req);
      if (!review) throw new HttpError(503, 'Reports aren’t available right now.');
      if (!reportLimit('user:' + user.id)) throw new HttpError(429, 'You’ve sent a lot of reports this hour. Try again later.');
      return send(res, 201, await review.report(user.id, await readBody(req, 5_000)));
    }
    // Notices, such as a store changing its policy, shown once the next time the app opens.
    if (route === '/api/notices' && method === 'GET') return send(res, 200, { notices: await store.listNotices(user.id) });
    if (route === '/api/notices/read' && method === 'POST') {
      checkWrite(req);
      const body = await readBody(req, 5_000);
      const ids = (Array.isArray(body.ids) ? body.ids : []).filter(id => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)).slice(0, 50);
      if (ids.length) await store.markNoticesRead(user.id, ids);
      return send(res, 200, { ok: true });
    }
    // Policy review, for admin accounts only (ADMIN_EMAILS). Everyone else gets the same 404 as a route that doesn't exist.
    if (route.startsWith('/api/admin/')) {
      if (!review || !review.isAdmin(user)) throw new HttpError(404, 'Not found.');
      if (route === '/api/admin/review' && method === 'GET') return send(res, 200, await review.overview());
      if (method !== 'POST') throw new HttpError(404, 'Not found.');
      checkWrite(req);
      const body = await readBody(req, 5_000);
      if (route === '/api/admin/stores/approve') return send(res, 200, await review.approveStore(String(body.key || ''), user));
      const reportMatch = /^\/api\/admin\/reports\/([0-9a-f-]{36})\/resolve$/i.exec(route);
      if (reportMatch) { if (!(await store.resolvePolicyReport(reportMatch[1]))) throw new HttpError(404, 'This report was already reviewed.'); return send(res, 200, { ok: true }); }
      const flagMatch = /^\/api\/admin\/flags\/([0-9a-f-]{36})$/i.exec(route);
      if (flagMatch && ['approve', 'dismiss'].includes(body.action)) return send(res, 200, await review.decideFlag(flagMatch[1], { action: body.action, window: body.window, basis: body.basis, outcome: body.outcome }, user));
      throw new HttpError(404, 'Not found.');
    }
    // Nearest drop-off: the closest places that accept this store's returns by the chosen way. The location is used for this
    // request only and never saved.
    if (route === '/api/places/nearest' && method === 'POST') {
      checkWrite(req);
      const body = await readBody(req, 2_000);
      const policy = typeof body.retailerId === 'string' ? (policies && policies.get(body.retailerId)) || (review && await review.policyById(body.retailerId)) : null;
      const way = policy && Number.isInteger(body.method) ? policy.methods[body.method] : null;
      const queries = way ? placeQueries(policy, way) : [];
      if (!queries.length) throw new HttpError(400, 'There’s no drop-off to look up for this way of returning.');
      if (!places || !places.available()) return send(res, 200, { places: [], reason: 'unavailable' });
      if (!placesLimit('user:' + user.id)) return send(res, 200, { places: [], reason: 'limit' });
      try { return send(res, 200, { places: await places.nearest(queries, Number(body.lat), Number(body.lng)) }); }
      catch (err) { if (err.status) throw new HttpError(err.status, err.message); console.error('Places lookup failed:', err.message); return send(res, 200, { places: [], reason: 'failed' }); }
    }
    // A medication's pharmacy: the nearest branches of the pharmacy on its label or papers, or the three nearest pharmacies
    // when none is named, with today's hours and directions. The location is used for this request only.
    if (route === '/api/places/pharmacies' && method === 'POST') {
      checkWrite(req);
      const body = await readBody(req, 2_000);
      const name = typeof body.name === 'string' ? body.name.replace(/\s+/g, ' ').trim().slice(0, 100) : '';
      if (!places || !places.available()) return send(res, 200, { places: [], reason: 'unavailable' });
      if (!placesLimit('user:' + user.id)) return send(res, 200, { places: [], reason: 'limit' });
      try { return send(res, 200, { places: await places.nearest([name || 'pharmacy'], Number(body.lat), Number(body.lng), { anyName: !name }) }); }
      catch (err) { if (err.status) throw new HttpError(err.status, err.message); console.error('Places lookup failed:', err.message); return send(res, 200, { places: [], reason: 'failed' }); }
    }
    // Receipt reading: the pages of one receipt are saved privately on the scan's purchase, read by the AI model, and
    // returned as the draft the Item card opens with. Fields the model wasn't sure about come back empty.
    if (route === '/api/receipts/read' && method === 'POST') {
      checkWrite(req);
      may.need('meds');
      const body = await readBody(req, 30 * 1024 * 1024);
      const purchaseId = typeof body.purchaseId === 'string' ? body.purchaseId : '';
      const pages = data.receiptPages(body.pages, MAX_PAGES);
      const files = await data.saveReceipt(owner, purchaseId, pages);
      if (!receipts || !receipts.available()) return send(res, 200, { purchaseId, files, receipt: null, reason: 'unavailable' });
      if (!receiptLimit('user:' + user.id)) return send(res, 200, { purchaseId, files, receipt: null, reason: 'limit' });
      const receipt = await receipts.read(pages, { today: typeof body.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : undefined });
      if (!receipt) return send(res, 200, { purchaseId, files, receipt: null, reason: 'failed' });
      const match = receipt.store && policies ? policies.match(receipt.store) : null;
      const policy = match && policies.get(match.id);
      await data.describeReceiptPurchase(owner, purchaseId, { store: policy ? policy.name : receipt.store, channel: receipt.channel, orderNumber: receipt.orderNumber, purchased: receipt.purchased, retailerId: policy ? policy.id : null });
      return send(res, 200, { purchaseId, files, receipt, retailer: policy ? { id: policy.id, name: policy.name } : null, draft: receiptDraft(receipt, policy) });
    }
    // Discharge papers: saved privately like a receipt's pages, read by the AI model, and returned as the draft the Confirm
    // card opens with, one card per medication. Nothing the papers don't say is added.
    if (route === '/api/discharge/read' && method === 'POST') {
      checkWrite(req);
      may.need('meds');
      const body = await readBody(req, 60 * 1024 * 1024);
      const purchaseId = typeof body.purchaseId === 'string' ? body.purchaseId : '';
      const pages = data.receiptPages(body.pages, MAX_DISCHARGE_PAGES, 'discharge');
      const files = await data.saveReceipt(owner, purchaseId, pages);
      if (!discharge || !discharge.available()) return send(res, 200, { purchaseId, files, papers: null, reason: 'unavailable' });
      if (!receiptLimit('user:' + user.id)) return send(res, 200, { purchaseId, files, papers: null, reason: 'limit' });
      const papers = await discharge.read(pages);
      if (!papers) return send(res, 200, { purchaseId, files, papers: null, reason: 'failed' });
      return send(res, 200, { purchaseId, files, papers, draft: dischargeDraft(papers) });
    }
    // Bottle labels: up to 3 photos of one bottle are read as one label and checked against what the discharge papers say
    // for that medication. The photos themselves are saved with the medication by the app, not here.
    if (route === '/api/label/read' && method === 'POST') {
      checkWrite(req);
      may.need('meds');
      const body = await readBody(req, 30 * 1024 * 1024);
      const photos = data.receiptPages(body.photos, MAX_LABEL_PHOTOS, 'label').filter(p => p.contentType !== 'application/pdf');
      if (!photos.length) throw new HttpError(400, 'Use a photo of the bottle.');
      if (!labels || !labels.available()) return send(res, 200, { label: null, reason: 'unavailable' });
      if (!receiptLimit('user:' + user.id)) return send(res, 200, { label: null, reason: 'limit' });
      const label = await labels.read(photos);
      if (!label) return send(res, 200, { label: null, reason: 'failed' });
      // Bottles only (no discharge papers): nothing to compare against, so no check rows.
      const m = body.med && typeof body.med === 'object' ? body.med : null;
      if (!m) return send(res, 200, { label, check: [] });
      const med = Object.fromEntries(['name', 'instructions', 'dose', 'route', 'frequency'].map(k => [k, typeof m[k] === 'string' ? m[k].slice(0, 600) : '']));
      return send(res, 200, { label, check: compareLabel(med, label) });
    }
    // Web Push: the public key the browser subscribes with (null when push isn't set up), and this device's subscription.
    if (route === '/api/push/key' && method === 'GET') return send(res, 200, { key: push && push.available() ? push.publicKey() : null });
    if (route === '/api/push/subscribe' && method === 'POST') {
      checkWrite(req);
      if (!push || !push.available()) throw new HttpError(503, 'Background reminders aren’t set up on this server.');
      const body = await readBody(req, 5_000);
      const sub = cleanSubscription(body.subscription);
      if (!sub) throw new HttpError(400, 'This browser’s notification subscription isn’t supported.');
      await store.savePushSubscription(user.id, { ...sub, timeZone: validTimeZone(body.timeZone) ? body.timeZone : 'UTC' });
      return send(res, 200, { ok: true });
    }
    if (route === '/api/push/unsubscribe' && method === 'POST') {
      checkWrite(req);
      const body = await readBody(req, 5_000);
      if (typeof body.endpoint === 'string') await store.deletePushSubscription(body.endpoint, user.id);
      return send(res, 200, { ok: true });
    }
    // "Send a test notification": pushed to this device, so it shows the same way the daily reminder will.
    if (route === '/api/push/test' && method === 'POST') {
      checkWrite(req);
      const body = await readBody(req, 5_000);
      const sub = push && push.available() && typeof body.endpoint === 'string' ? (await store.listPushSubscriptions(user.id)).find(s => s.endpoint === body.endpoint) : null;
      if (!sub) return send(res, 200, { sent: false });
      if (!pushTestLimit('user:' + user.id)) throw new HttpError(429, 'Too many test notifications. Try again later.');
      // A real dose with its Taken, Snooze and Skipped buttons when there's a medication to show.
      const dose = await reminders.testDose(owner, user.id);
      const r = await reminders.sendTo(user.id, [sub], dose || { title: 'Adltrack · Reminders are on', body: 'Reminders arrive at each dose time, even when Adltrack is closed.', url: 'app.html' });
      return send(res, 200, { sent: r.sent > 0 });
    }
    // The open app's daily notification: the same rule and the same once-a-day claim as push, so only one of them is sent.
    if (route === '/api/reminders/claim' && method === 'POST') {
      checkWrite(req);
      const body = await readBody(req, 2_000);
      // The device's local date, which is never more than a day from the server's UTC date.
      const offset = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? (Date.parse(body.date) - Date.parse(new Date().toISOString().slice(0, 10))) / 864e5 : NaN;
      if (!(Math.abs(offset) <= 1)) throw new HttpError(400, 'Invalid date.');
      if (!reminders) return send(res, 200, { reminder: null });
      // Inside this person's quiet hours nothing is claimed; the app asks again once they end.
      if (typeof body.time === 'string' && quiet(await reminders.prefsOf(user.id), body.time)) return send(res, 200, { reminder: null, reminders: [], quiet: true });
      // One reminder per family this person does the tasks for, each naming its patient.
      const list = (await reminders.claim(user.id, body.date, 'app')).reminders.map(notification);
      return send(res, 200, { reminder: list[0] || null, reminders: list });
    }
    // A notification's action buttons ("Snooze until tomorrow", "I sent it back", "I'm keeping it"), sent by the service worker.
    // The item may be on any family this person is on; they must do the care on that one (checked in reminders.act).
    if (route === '/api/reminders/action' && method === 'POST') {
      checkWrite(req);
      const body = await readBody(req, 2_000);
      if (!reminders || !ACTIONS.includes(body.action)) throw new HttpError(400, 'Invalid action.');
      const offset = typeof body.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? (Date.parse(body.today) - Date.parse(new Date().toISOString().slice(0, 10))) / 864e5 : NaN;
      const today = Math.abs(offset) <= 1 ? body.today : (await reminders.localNow(user.id)).date;
      const item = await reminders.act(user.id, body.itemId, body.action, today);
      if (!item) throw new HttpError(404, 'Not found.');
      return send(res, 200, { item });
    }
    // A dose reminder's buttons ("Taken", "Snooze 15 minutes", "Skipped"), sent by the service worker for the family the
    // reminder came from (X-Patient), and marked with the name of the person who tapped it.
    if (route === '/api/reminders/dose' && method === 'POST') {
      checkWrite(req);
      may.need('tasks');
      const body = await readBody(req, 8_000);
      const saved = reminders ? await reminders.actDose(owner, body, { by: user.name, userId: user.id }) : null;
      if (!saved) throw new HttpError(400, 'Invalid action.');
      return send(res, 200, { items: saved });
    }
    // The daily reminder was opened (tapped), so no "unopened" email follows it.
    if (route === '/api/reminders/opened' && method === 'POST') {
      checkWrite(req);
      if (reminders) await reminders.opened(user.id);
      return send(res, 200, { ok: true });
    }
    // Reminders and alerts this person gets, wherever they're on a care team: dose and task reminders, missed doses, the
    // end-of-day report and its time, and quiet hours. Incidents always arrive. Everyone picks their own, viewers too.
    if (route === '/api/alerts/prefs' && method === 'GET') return send(res, 200, { prefs: reminders ? await reminders.prefsOf(user.id) : {} });
    if (route === '/api/alerts/prefs' && method === 'PUT') {
      checkWrite(req);
      if (!reminders) throw new HttpError(503, 'Reminders aren’t available right now.');
      return send(res, 200, { prefs: await reminders.savePrefs(user.id, await readBody(req, 2_000)) });
    }
    // When the care plan on screen last changed: open apps ask every few seconds, and load what someone else saved.
    if (route === '/api/changes' && method === 'GET') return send(res, 200, { updatedAt: await store.dataVersion(owner), space: spaceOf(owner) });
    // Reminder emails: which types are on ("Also email me" on Reminders, and the unsubscribe links in each email).
    if (route === '/api/email/prefs' && method === 'GET') {
      const off = await store.emailOptouts(user.id);
      return send(res, 200, { available: !!(email && email.available()), ...Object.fromEntries(KINDS.map(k => [k, !off.includes(k)])) });
    }
    if (route === '/api/email/prefs' && method === 'PUT') {
      checkWrite(req);
      const body = await readBody(req, 2_000);
      for (const k of KINDS) if (typeof body[k] === 'boolean') await store.setEmailOptout(user.id, k, !body[k]);
      const off = await store.emailOptouts(user.id);
      return send(res, 200, { available: !!(email && email.available()), ...Object.fromEntries(KINDS.map(k => [k, !off.includes(k)])) });
    }
    if (route === '/api/data' && method === 'GET') return send(res, 200, { data: await data.getData(owner), space: spaceOf(owner) });
    // The whole account in one document, kept for older versions of the app.
    if (route === '/api/data' && method === 'PUT') {
      checkWrite(req);
      // Replaces the whole plan at once, so only an admin who also does the tasks may.
      may.need('admin'); may.need('tasks');
      const payload = cleanPayload(await readBody(req, 12 * 1024 * 1024));
      return send(res, 200, { updatedAt: await data.putData(owner, payload) });
    }

    // A photo of a dose being taken: POST it as a data URL, kept with the dose by its file URL. A photo for a new task or an
    // incident (from the + on My Tasks) says so in `for`, and needs what adding one needs.
    if (route === '/api/files/proof' && method === 'POST') {
      checkWrite(req);
      const body = await readBody(req, 14 * 1024 * 1024);
      may.need(body && body.for === 'task' ? 'addTasks' : body && body.for === 'incident' ? 'care' : 'tasks');
      return send(res, 201, await data.saveProof(owner, body && body.data));
    }

    // A file of a care plan this person is on, such as an item photo (or another family's patient photo, for the picker).
    // Anyone else gets the same 404 as a file that doesn't exist.
    const fileMatch = /^\/api\/files\/([0-9a-f-]{36})$/i.exec(route);
    if (fileMatch && method === 'GET') {
      let file = null;
      for (const id of [owner, ...access.patients.filter(p => p !== owner)]) if ((file = await data.readFile(id, fileMatch[1].toLowerCase()))) break;
      if (!file) throw new HttpError(404, 'Not found.');
      res.writeHead(200, { 'Content-Type': file.contentType, 'Content-Length': file.body.length, 'Cache-Control': 'private, max-age=31536000, immutable', 'Content-Disposition': 'inline', 'Content-Security-Policy': FILE_CSP });
      return res.end(file.body);
    }

    // Per-item sync: the app creates, updates and deletes one item at a time.
    await data.migrate(owner);
    if (route === '/api/items' && method === 'GET') {
      const raw = await data.getData(owner);
      return send(res, 200, { items: raw ? raw.purchases : [], updatedAt: raw ? raw.updatedAt : null });
    }
    if (route === '/api/items' && method === 'POST') {
      checkWrite(req);
      // A new medication or visit needs the medications tick; a task or an incident from the + needs what adding one needs.
      const body = await readBody(req, 12 * 1024 * 1024);
      if (body && typeof body === 'object') delete body._seen;
      may.item(null, body && typeof body === 'object' && !Array.isArray(body) ? body : {});
      const saved = await data.saveItem(owner, body, { mustBeNew: true });
      // An incident from the + reaches everyone on the care team straight away.
      if (reminders && saved.item.incident) await reminders.incidentReported(owner, saved.item, user.id);
      return send(res, 201, saved);
    }
    // The QR code or return label for one item: PUT a photo, screenshot or PDF as a data URL; DELETE removes it.
    const labelMatch = /^\/api\/items\/([^/]+)\/label$/.exec(route);
    if (labelMatch && (method === 'PUT' || method === 'DELETE')) {
      checkWrite(req);
      may.need('meds');
      let id; try { id = decodeURIComponent(labelMatch[1]); } catch { throw new HttpError(400, 'Invalid item.'); }
      const body = method === 'PUT' ? await readBody(req, 14 * 1024 * 1024) : null;
      return send(res, 200, await data.setLabel(owner, id, method === 'PUT' ? body && body.data : null));
    }
    const itemMatch = /^\/api\/items\/([^/]+)$/.exec(route);
    if (itemMatch && (method === 'PUT' || method === 'DELETE')) {
      checkWrite(req);
      let id; try { id = decodeURIComponent(itemMatch[1]); } catch { throw new HttpError(400, 'Invalid item.'); }
      if (method === 'DELETE') {
        may.need('meds');
        const r = await data.deleteItem(owner, id);
        if (!r.deleted) throw new HttpError(404, 'Not found.');
        return send(res, 200, { ok: true, updatedAt: r.updatedAt });
      }
      const body = await readBody(req, 12 * 1024 * 1024);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Invalid item.');
      // Marks someone else saved since this app last loaded are kept (see mergeMarks).
      const { _seen: seen, ...sent } = body, before = (await store.getItem(owner, id))?.item;
      const item = mergeMarks(before, { ...sent, id }, seen);
      may.item(before, item);
      return send(res, 200, await data.saveItem(owner, item));
    }
    if (route === '/api/settings' && method === 'PUT') {
      checkWrite(req);
      const body = await readBody(req, 12 * 1024 * 1024), saved = (await store.getRawData(owner))?.payload || {};
      const { settings: sent, profile } = cleanPayload({ purchases: [], ...body, seenVitals: undefined });
      // Vital signs someone else saved since this app last loaded are kept, like marks.
      const settings = mergeVitals(saved.settings, sent, body.seenVitals);
      may.settings({ settings: saved.settings, profile: saved.profile }, { settings, profile });
      return send(res, 200, await data.putSettings(owner, { settings, profile }));
    }
    if (route === '/api/purchases' && method === 'GET') return send(res, 200, { purchases: await data.listPurchases(owner) });
    const receiptMatch = /^\/api\/purchases\/([^/]+)\/receipt$/.exec(route);
    if (receiptMatch && method === 'PUT') {
      checkWrite(req);
      may.need('meds');
      let id; try { id = decodeURIComponent(receiptMatch[1]); } catch { throw new HttpError(400, 'Invalid request.'); }
      const body = await readBody(req, 14 * 1024 * 1024);
      return send(res, 200, await data.attachReceipt(owner, id, body && body.data));
    }
    if (route === '/api/account' && method === 'DELETE') {
      checkWrite(req);
      const body = await readBody(req, 10_000);
      const full = await store.findUserByEmail(user.email);
      // An account without a password (Google or Apple sign-in) confirms with its email address instead.
      if (full && full.passwordHash === NO_PASSWORD) { if (normEmail(body.password) !== full.email) throw new HttpError(401, 'That email isn’t right.'); }
      else if (!full || !(await verifyPassword(String(body.password || ''), full.passwordHash))) throw new HttpError(401, 'That password isn’t right.');
      // Connected inboxes are revoked with the provider before anything is deleted.
      if (inbox) await inbox.forget(user.id);
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

module.exports = { createApp, hashPassword, verifyPassword, receiptDraft, verifyWebhook };
