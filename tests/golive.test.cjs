/* Step 9: going live. The health check, strong passwords, signing out a shared phone, the sign-in history, agreeing before
   joining a care team, and the privacy policy and terms written for health information. */
const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), os = require('node:os'), path = require('node:path'), fs = require('node:fs'), vm = require('node:vm');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { createStorage } = require('../server/storage');
const { createData } = require('../server/data');
const { createEmail } = require('../server/email');
const { createHealth, STALE_MS } = require('../server/health');
const { passwordProblem, deviceName, idleExpired } = require('../server/security');

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function boot({ health = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adltrack-golive-'));
  const store = createStore({ file: path.join(dir, 'store.json') });
  await store.init();
  const data = createData({ store, storage: createStorage({ dir: path.join(dir, 'files') }) });
  // Moves every session's "last used" time back, as if nobody had touched the phone for that many minutes.
  const clock = { idle: 0 };
  const timed = { ...store, findSession: async h => { const s = await store.findSession(h); return s && { ...s, lastSeen: new Date(new Date(s.lastSeen).getTime() - clock.idle * 60000) }; } };
  const mails = [];
  const email = createEmail({ send: async m => { mails.push(m); } });
  const server = http.createServer(createApp({ store: timed, data, email, health }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = (ua = IPHONE) => {
    let cookie = '';
    return async (method, url, body) => {
      const res = await fetch(base + url, { method, headers: { 'User-Agent': ua, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      return { status: res.status, body: await res.json().catch(() => null) };
    };
  };
  const signUp = async (name, address) => { const c = client(); assert.equal((await c('POST', '/api/signup', { name, email: address, password: 'Care-plan-2026' })).status, 201); return c; };
  return { client, signUp, store, clock, mails, close: () => new Promise(r => server.close(r)) };
}

test('passwords: at least 10 characters, not easy to guess, not the email or name', () => {
  assert.match(passwordProblem('short'), /at least 10/);
  assert.match(passwordProblem('password123'), /too easy/);
  assert.match(passwordProblem('Password2026!'), /too easy/);
  assert.match(passwordProblem('1234567890'), /too easy/);
  assert.match(passwordProblem('aaaaaaaaaaaa'), /too easy/);
  assert.match(passwordProblem('george2026!', { email: 'george@example.com', name: 'George' }), /email or name/);
  assert.equal(passwordProblem('rose walks at noon'), '');
  assert.equal(passwordProblem('Care-plan-2026'), '');
});

test('sign up and new passwords refuse weak passwords', async () => {
  const app = await boot();
  try {
    const c = app.client();
    for (const password of ['short', 'password123', 'qwerty12345', 'rose@example.com'])
      assert.equal((await c('POST', '/api/signup', { name: 'Rose', email: 'rose@example.com', password })).status, 400, password);
    assert.equal((await c('POST', '/api/signup', { name: 'Rose', email: 'rose@example.com', password: 'tulips by the door' })).status, 201);
  } finally { await app.close(); }
});

test('a shared phone signs out after 15 minutes without use; other phones stay signed in', async () => {
  const app = await boot();
  try {
    const phone = await app.signUp('George', 'george@example.com');
    assert.equal((await phone('GET', '/api/me')).body.shared, false);
    const r = await phone('PUT', '/api/session', { shared: true });
    assert.deepEqual(r.body, { shared: true, idleMinutes: 15 });
    assert.equal((await phone('GET', '/api/me')).body.shared, true);
    app.clock.idle = 14;
    assert.equal((await phone('GET', '/api/me')).status, 200, 'still signed in after 14 minutes');
    app.clock.idle = 16;
    assert.equal((await phone('GET', '/api/me')).status, 401, 'signed out after 16 minutes');
    app.clock.idle = 0;
    assert.equal((await phone('GET', '/api/me')).status, 401, 'the session is gone, not just hidden');

    const own = await app.signUp('Maria', 'maria@example.com');
    app.clock.idle = 24 * 60;
    assert.equal((await own('GET', '/api/me')).status, 200, 'a phone that isn’t shared stays signed in');
  } finally { await app.close(); }
});

test('the sign-in history lists sign-ins and wrong passwords with the kind of device', async () => {
  const app = await boot();
  try {
    const phone = await app.signUp('George', 'george@example.com');
    const laptop = app.client('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36');
    assert.equal((await laptop('POST', '/api/login', { email: 'george@example.com', password: 'wrong-pass' })).status, 401);
    assert.equal((await laptop('POST', '/api/login', { email: 'george@example.com', password: 'Care-plan-2026' })).status, 200);
    const r = await phone('GET', '/api/security');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.signIns.map(x => [x.method, x.ok, x.device]), [['password', true, 'Windows · Chrome'], ['password', false, 'Windows · Chrome'], ['signup', true, 'iPhone · Safari']]);
    // Another account's history isn't there.
    const maria = await app.signUp('Maria', 'maria@example.com');
    assert.deepEqual((await maria('GET', '/api/security')).body.signIns.map(x => x.method), ['signup']);
    assert.equal((await app.client()('GET', '/api/security')).status, 401);
    assert.equal(deviceName('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'), 'Android · Chrome');
    assert.equal(deviceName(''), 'Unknown device');
  } finally { await app.close(); }
});

test('joining a care team needs the person to agree first, and the time they agreed is kept', async () => {
  const app = await boot();
  try {
    const george = await app.signUp('George', 'george@example.com');
    const add = await george('POST', '/api/team/members', { name: 'Maria', email: 'maria@example.com', phone: '', role: 'caregiver', perms: { tasks: true } });
    assert.equal(add.status, 201);
    const token = add.body.invite.link.split('#t=')[1];
    const maria = await app.signUp('Maria', 'maria@example.com');
    const refused = await maria('POST', '/api/invite/accept', { token });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /agree/);
    assert.equal((await maria('POST', '/api/invite/accept', { token, consent: true })).status, 200);
    const owner = await app.store.findUserByEmail('george@example.com');
    const member = (await app.store.listMembers(owner.id)).find(m => m.email === 'maria@example.com');
    assert.ok(member.joinedAt);
  } finally { await app.close(); }
});

test('the health check answers 503 and emails ALERT_EMAIL when reminders stop, and again when they are back', async () => {
  let at = Date.now(), last = null;
  const mails = [];
  const email = createEmail({ send: async m => { mails.push(m); } });
  const jobs = { lastRun: () => last };
  const health = createHealth({ jobs, remindersOn: true, email, alertTo: 'george@example.com', now: () => at, log: { log() {}, error() {} } });
  const app = await boot({ health });
  try {
    const c = app.client();
    last = at;
    assert.deepEqual((await c('GET', '/api/health')).body.reminders, 'sending');
    await health.check();
    assert.equal(mails.length, 0);
    at += STALE_MS + 1000;
    const down = await c('GET', '/api/health');
    assert.equal(down.status, 503);
    assert.equal(down.body.reminders, 'stopped');
    await health.check(); await health.check();
    assert.equal(mails.length, 1, 'one email, not one a minute');
    assert.match(mails[0].subject, /stopped sending/);
    assert.deepEqual(mails[0].to, ['george@example.com']);
    last = at;
    assert.equal((await c('GET', '/api/health')).status, 200);
    await health.check();
    assert.equal(mails.length, 2);
    assert.match(mails[1].subject, /sending again/);
  } finally { await app.close(); }
  const off = createHealth({ jobs: { lastRun: () => null }, remindersOn: false });
  assert.deepEqual(off.status(), { ok: true, reminders: 'off', lastRun: null });
  assert.equal(idleExpired({ shared: false, lastSeen: new Date(0) }), false);
});

test('the privacy policy and terms are written for health information, in the app and before signing in', () => {
  const ctx = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'legal.js'), 'utf8') + ';this.LEGAL=LEGAL;', ctx);
  const { privacy, terms } = ctx.LEGAL;
  for (const words of [/health information/, /never sells health information/, /Business Associate Agreement/, /Deleting the account[^.]*removes it for good, including the discharge papers and the photos/, /Render/, /Cloudflare R2/, /Anthropic/, /Twilio/, /Stripe/])
    assert.match(privacy, words);
  for (const words of [/doesn’t give medical advice/, /call 911/, /keep the patient’s information private/, /Business Associate Agreement/])
    assert.match(terms, words);
  const root = path.join(__dirname, '..');
  assert.match(fs.readFileSync(path.join(root, 'legal.html'), 'utf8'), /<script src="legal.js"><\/script>/);
  assert.match(fs.readFileSync(path.join(root, 'app.html'), 'utf8'), /<script src="legal.js"><\/script><script src="menu.js">/);
  assert.match(fs.readFileSync(path.join(root, 'auth.js'), 'utf8'), /name="consent" type="checkbox"/);
});
