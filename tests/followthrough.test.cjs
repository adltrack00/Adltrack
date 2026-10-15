const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), os = require('node:os'), path = require('node:path'), fs = require('node:fs'), crypto = require('node:crypto');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { createStorage } = require('../server/storage');
const { createData } = require('../server/data');
const { createJobs, defineJobs } = require('../server/jobs');
const { pick, localParts, quiet, sendTime, isDue, createPush, createReminders } = require('../server/reminders');
const { createEmail, createTokens } = require('../server/email');
const C = require('../core.js');

const today = C.iso(new Date());
const item = (id, left, o = {}, on = today) => ({ id, name: id, retailer: 'Zara', price: 40, channel: 'online', purchased: C.shift(on, left - 30), delivered: '', window: 30, basis: 'purchase', outcome: 'refund', requirement: 'start', confirmed: true, status: 'deciding', next: 'Pack it.', ...o });
const subscription = () => ({ endpoint: `https://fcm.googleapis.com/push/${crypto.randomBytes(12).toString('hex')}`, keys: { p256dh: crypto.randomBytes(65).toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } });

/* The UTC instant when it's `time` on `date` in a time zone (searches whole minutes around the date). */
function instantAt(date, time, tz) {
  const start = Date.parse(date + 'T00:00:00Z') - 36 * 3600e3;
  for (let t = start; t < start + 72 * 3600e3; t += 60e3) { const p = localParts(new Date(t), tz); if (p.date === date && p.time === time) return new Date(t); }
  throw new Error('no such local time');
}

async function boot({ withEmail = true, withPush = true, support = '' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'returnly-follow-'));
  const store = createStore({ databaseUrl: null, file: path.join(dir, 'store.json') });
  await store.init();
  const storage = createStorage({ dir: path.join(dir, 'files') });
  const jobs = createJobs({ store, log: { error() {} } });
  const data = createData({ store, storage, jobs });
  const pushed = [], mails = [];
  const push = createPush(withPush ? { vapid: { publicKey: 'BPublicKeyForTests', privateKey: 'private', subject: 'mailto:test@example.com' }, send: async (sub, payload) => { pushed.push(JSON.parse(payload)); } } : {});
  const email = createEmail(withEmail ? { secret: 'test-secret', send: async m => { mails.push(m); } } : {});
  const clock = { now: () => new Date() };
  const reminders = createReminders({ store, push, email, data, now: () => clock.now(), log: { error() {} } });
  defineJobs(jobs, { store, storage, data, reminders });
  const server = http.createServer(createApp({ store, data, push, reminders, email, supportEmail: support }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (method, url, body, headers = {}) => {
      const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: typeof body === 'string' ? body : body ? JSON.stringify(body) : undefined });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      return { status: res.status, body: (res.headers.get('content-type') || '').startsWith('application/json') ? await res.json() : await res.text() };
    };
  };
  const signUp = async name => { const c = client(); const r = await c('POST', '/api/signup', { name, email: `${name.toLowerCase()}@example.com`, password: 'password123' }); assert.equal(r.status, 201); return c; };
  const userId = async name => (await store.findUserByEmail(`${name.toLowerCase()}@example.com`)).id;
  return { store, jobs, data, pushed, mails, clock, reminders, email, base, client, signUp, userId, close: async () => { await jobs.stop(); await new Promise(r => server.close(r)); await store.close(); } };
}
const tokenFrom = (mail, pattern) => new URLSearchParams(new URL(mail.text.match(pattern)[1]).hash.slice(1));

test('quiet hours hold the reminder until they end, including across midnight', () => {
  const s = { time: '22:30', quietStart: '22:00', quietEnd: '07:00' };
  assert.equal(quiet(s, '23:59'), true);
  assert.equal(quiet(s, '06:59'), true);
  assert.equal(quiet(s, '07:00'), false);
  assert.equal(sendTime(s), '07:00');
  assert.equal(isDue(s, '06:59'), false);
  assert.equal(isDue(s, '07:00'), true);
  assert.equal(isDue(s, '22:30'), false);
  const day = { time: '13:00', quietStart: '12:00', quietEnd: '14:00' };
  assert.equal(sendTime(day), '14:00');
  assert.equal(isDue(day, '13:30'), false);
  assert.equal(isDue(day, '14:00'), true);
  // Unset or equal times mean no quiet hours.
  assert.equal(quiet({ quietStart: '09:00', quietEnd: '09:00' }, '09:00'), false);
  assert.equal(quiet({ quietStart: 'soon' }, '09:00'), false);
  assert.equal(isDue({ time: '09:00' }, '09:00'), true);
});

test('without push, the reminder is emailed at the user\'s time in their time zone, across daylight saving changes', async () => {
  const app = await boot({ withPush: false });
  try {
    const c = await app.signUp('Ana');
    await c('PUT', '/api/settings', { settings: { time: '09:00', daily: true, timeZone: 'America/Los_Angeles' }, profile: {} });
    // US daylight saving ends on 2026-11-01 and starts on 2027-03-14: 09:00 in Los Angeles is a different UTC hour each side.
    for (const [n, date] of [[0, '2026-10-31'], [1, '2026-11-01'], [2, '2026-11-02'], [3, '2027-03-14']]) {
      await c('POST', '/api/items', item('Item' + n, 10, {}, date));
      app.clock.now = () => new Date(instantAt(date, '08:59', 'America/Los_Angeles'));
      assert.equal(await app.reminders.dispatch(), 0, date);
      app.clock.now = () => new Date(instantAt(date, '09:00', 'America/Los_Angeles'));
      assert.equal(await app.reminders.dispatch(), 1, date);
      await app.jobs.drain();
      assert.equal(app.mails.length, n + 1, date);
      assert.equal(await app.reminders.dispatch(), 0, date);
    }
    assert.notEqual(instantAt('2026-10-31', '09:00', 'America/Los_Angeles').getUTCHours(), instantAt('2026-11-02', '09:00', 'America/Los_Angeles').getUTCHours());
    const mail = app.mails[0];
    assert.deepEqual(mail.to, ['ana@example.com']);
    assert.equal(mail.subject, 'Adltrack: 10 days left');
    assert.match(mail.text, /Item0 · \$40 back · 10 days left\. Pack it\./);
    assert.match(mail.html, /Snooze until tomorrow/);
    assert.deepEqual(Object.keys(mail.headers), ['List-Unsubscribe', 'List-Unsubscribe-Post']);
    assert.equal(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    assert.deepEqual(mail.tags, [{ name: 'type', value: 'reminder-daily' }]);
  } finally { await app.close(); }
});

test('quiet hours move the pushed reminder to their end; the open app is told to wait', async () => {
  const app = await boot();
  try {
    const c = await app.signUp('Ana');
    await c('PUT', '/api/settings', { settings: { time: '22:30', daily: true, quietStart: '22:00', quietEnd: '07:00' }, profile: {} });
    await c('POST', '/api/push/subscribe', { subscription: subscription(), timeZone: 'Europe/Paris' });
    await c('POST', '/api/items', item('Bag', 9));
    app.clock.now = () => new Date(instantAt(today, '22:30', 'Europe/Paris'));
    assert.equal(await app.reminders.dispatch(), 0);
    app.clock.now = () => new Date(instantAt(today, '06:59', 'Europe/Paris'));
    assert.equal(await app.reminders.dispatch(), 0);
    assert.deepEqual((await c('POST', '/api/reminders/claim', { date: today, time: '06:59' })).body, { reminder: null, quiet: true });
    app.clock.now = () => new Date(instantAt(today, '07:00', 'Europe/Paris'));
    assert.equal(await app.reminders.dispatch(), 1);
    await app.jobs.drain();
    assert.equal(app.pushed.length, 1);
    assert.equal(app.pushed[0].itemId, 'Bag');
  } finally { await app.close(); }
});

test('one grouped reminder a day; snoozed items wait a day; sent back, kept and received items stop', async () => {
  const app = await boot({ withEmail: false });
  try {
    const c = await app.signUp('Ana'), id = await app.userId('Ana');
    await c('POST', '/api/push/subscribe', { subscription: subscription(), timeZone: 'UTC' });
    for (const [name, left, price] of [['Dress', 4, 49], ['Boots', 6, 35], ['Coat', 20, 80]]) await c('POST', '/api/items', item(name, left, { price }));
    await app.reminders.send({ userId: id, date: today });
    assert.equal(app.pushed.length, 1);
    assert.equal(app.pushed[0].title, '2 returns due this week: $84 total');
    assert.equal(app.pushed[0].body, 'Dress · $49 back · 4 days left. Pack it. Plus 2 other return windows.');
    // Same day again: nothing.
    await app.reminders.send({ userId: id, date: today });
    assert.equal(app.pushed.length, 1);

    // "Snooze until tomorrow" from the notification: Dress is left out for the rest of today (an email follow-up, the open
    // app) and comes back tomorrow.
    assert.equal((await c('POST', '/api/reminders/action', { itemId: 'Dress', action: 'snooze', today })).body.item.snoozeUntil, C.shift(today, 1));
    const tomorrow = C.shift(today, 1), after = C.shift(today, 2);
    assert.deepEqual(pick(await app.store.listItems(id), today).items, ['Boots', 'Coat']);
    await app.reminders.send({ userId: id, date: tomorrow });
    assert.equal(app.pushed[1].itemId, 'Dress');
    // "I sent it back" and "I'm keeping it": those stop; a received item stopped already.
    const sent = (await c('POST', '/api/reminders/action', { itemId: 'Dress', action: 'sent', today })).body.item;
    assert.equal(sent.status, 'shipped');
    assert.equal(sent.returnedOn, today);
    assert.equal((await c('POST', '/api/reminders/action', { itemId: 'Boots', action: 'keep', today })).body.item.status, 'kept');
    await c('PUT', '/api/items/Coat', item('Coat', 20, { status: 'received', received: 80 }));
    await app.reminders.send({ userId: id, date: after });
    assert.equal(app.pushed.length, 2);
    // The account's copy changed, so the app picks it up the next time it opens.
    assert.equal((await c('GET', '/api/items')).body.items.find(i => i.id === 'Dress').status, 'shipped');
    assert.equal((await c('POST', '/api/reminders/action', { itemId: 'Nope', action: 'sent', today })).status, 404);
    assert.equal((await c('POST', '/api/reminders/action', { itemId: 'Coat', action: 'delete', today })).status, 400);
  } finally { await app.close(); }
});

test('a pushed reminder that isn\'t opened 3 days before the deadline is followed by email', async () => {
  const app = await boot();
  try {
    const c = await app.signUp('Ana'), id = await app.userId('Ana');
    await c('POST', '/api/push/subscribe', { subscription: subscription(), timeZone: 'UTC' });
    await c('POST', '/api/items', item('Dress', 3));
    app.clock.now = () => new Date(instantAt(today, '09:00', 'UTC'));
    await app.reminders.send({ userId: id, date: today });
    assert.equal(app.pushed.length, 1);
    assert.equal(app.mails.length, 0);
    app.clock.now = () => new Date(instantAt(today, '13:00', 'UTC'));
    await app.reminders.followup({ userId: id, date: today });
    assert.equal(app.mails.length, 1);
    assert.equal(app.mails[0].subject, 'Adltrack: Only 3 days left');
    assert.deepEqual(app.mails[0].tags, [{ name: 'type', value: 'reminder-unopened' }]);

    // Opened (tapped) the next time: no email follows.
    const next = C.shift(today, 1);
    await c('PUT', '/api/items/Dress', item('Dress', 4));
    app.clock.now = () => new Date(instantAt(next, '09:00', 'UTC'));
    await app.reminders.send({ userId: id, date: next });
    await c('POST', '/api/reminders/opened', {});
    app.clock.now = () => new Date(instantAt(next, '13:00', 'UTC'));
    await app.reminders.followup({ userId: id, date: next });
    assert.equal(app.mails.length, 1);
  } finally { await app.close(); }
});

test('email links: actions work without signing in, unsubscribe is one click per type, and "Also email me" turns both on', async () => {
  const app = await boot({ withPush: false });
  try {
    const c = await app.signUp('Ana'), id = await app.userId('Ana');
    await c('PUT', '/api/settings', { settings: { time: '09:00', daily: true, timeZone: 'UTC' }, profile: {} });
    await c('POST', '/api/items', item('Dress', 9));
    await app.reminders.send({ userId: id, date: today });
    const [mail] = app.mails, stranger = app.client();
    // "I sent it back" from the email.
    const act = tokenFrom(mail, /I sent it back: (\S+)/);
    assert.equal(act.get('a'), 'sent');
    assert.deepEqual((await stranger('POST', '/api/email/act', { token: act.get('t') })).body, { ok: true, action: 'sent', name: 'Dress' });
    assert.equal((await c('GET', '/api/items')).body.items[0].status, 'shipped');
    assert.equal((await stranger('POST', '/api/email/act', { token: act.get('t') + 'x' })).status, 400);
    // A forged token (another secret) doesn't work.
    const forged = createTokens('other').sign({ t: 'act', u: id, i: 'Dress', a: 'keep' });
    assert.equal((await stranger('POST', '/api/email/act', { token: forged })).status, 400);
    // An unsubscribe token can't be used as an action.
    const unsub = tokenFrom(mail, /Unsubscribe from daily reminder emails: (\S+)/);
    assert.equal((await stranger('POST', '/api/email/act', { token: unsub.get('t') })).status, 400);

    // One-click from the mail app: a form post to the List-Unsubscribe URL.
    const oneClick = mail.headers['List-Unsubscribe'].slice(1, -1);
    const r = await stranger('POST', new URL(oneClick).pathname + new URL(oneClick).search, 'List-Unsubscribe=One-Click', { 'Content-Type': 'application/x-www-form-urlencoded' });
    assert.deepEqual(r.body, { ok: true, kind: 'daily' });
    assert.deepEqual((await c('GET', '/api/email/prefs')).body, { available: true, daily: false, unopened: true });
    // Daily emails off: nothing is queued at reminder time.
    await c('PUT', '/api/items/Dress', item('Dress', 8));
    app.clock.now = () => new Date(instantAt(C.shift(today, 1), '09:30', 'UTC'));
    assert.equal(await app.reminders.dispatch(), 0);
    // The other type from the page the email links to.
    const other = tokenFrom(mail, /Unsubscribe from emails when a reminder wasn’t opened[^:]*: (\S+)/);
    assert.equal(other.get('u'), 'unopened');
    assert.deepEqual((await stranger('POST', '/api/email/unsubscribe', { token: other.get('t') })).body, { ok: true, kind: 'unopened' });
    assert.deepEqual((await c('GET', '/api/email/prefs')).body, { available: true, daily: false, unopened: false });
    // "Also email me" on Reminders turns both back on.
    assert.deepEqual((await c('PUT', '/api/email/prefs', { daily: true, unopened: true })).body, { available: true, daily: true, unopened: true });
    assert.equal(await app.reminders.dispatch(), 1);
  } finally { await app.close(); }
});

test('password reset: an emailed link works once, for an hour, and signs out every other device', async () => {
  const app = await boot();
  try {
    const c = await app.signUp('Ana'), stranger = app.client();
    assert.deepEqual((await stranger('POST', '/api/password/forgot', { email: 'nobody@example.com' })).body, { ok: true });
    assert.deepEqual((await stranger('POST', '/api/password/forgot', { email: 'ANA@example.com' })).body, { ok: true });
    for (let n = 0; n < 20 && app.mails.length < 1; n++) await new Promise(r => setTimeout(r, 10));
    assert.equal(app.mails.length, 1);
    assert.deepEqual(app.mails[0].to, ['ana@example.com']);
    const token = new URLSearchParams(new URL(app.mails[0].text.match(/(http\S+reset\.html\S+)/)[1]).hash.slice(1)).get('token');
    assert.equal((await stranger('POST', '/api/password/reset', { token, password: 'short' })).status, 400);
    const r = await stranger('POST', '/api/password/reset', { token, password: 'newpassword1' });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.email, 'ana@example.com');
    assert.equal((await stranger('GET', '/api/me')).status, 200);
    assert.equal((await c('GET', '/api/me')).status, 401);
    assert.equal((await app.client()('POST', '/api/login', { email: 'ana@example.com', password: 'password123' })).status, 401);
    assert.equal((await app.client()('POST', '/api/login', { email: 'ana@example.com', password: 'newpassword1' })).status, 200);
    // Used once.
    assert.equal((await app.client()('POST', '/api/password/reset', { token, password: 'another-one' })).status, 400);
    // Expired after an hour.
    const id = await app.userId('Ana'), old = crypto.randomBytes(32).toString('base64url');
    await app.store.createPasswordReset(id, crypto.createHash('sha256').update(old).digest('hex'), new Date(Date.now() - 1000));
    assert.equal((await app.client()('POST', '/api/password/reset', { token: old, password: 'another-one' })).status, 400);
  } finally { await app.close(); }
});

test('without an email service, reset says so and nothing is emailed; Support shows the contact address when set', async () => {
  const off = await boot({ withEmail: false });
  try {
    await off.signUp('Ana');
    assert.equal((await off.client()('POST', '/api/password/forgot', { email: 'ana@example.com' })).status, 503);
    assert.deepEqual((await off.client()('GET', '/api/contact')).body, { email: null });
    assert.deepEqual((await (await off.signUp('Ben'))('GET', '/api/email/prefs')).body, { available: false, daily: true, unopened: true });
  } finally { await off.close(); }
  const on = await boot({ support: 'help@returnly.example' });
  try { assert.deepEqual((await on.client()('GET', '/api/contact')).body, { email: 'help@returnly.example' }); } finally { await on.close(); }
});

test('the new pages are served and the app loads the reminder scripts', async () => {
  const app = await boot();
  try {
    const c = app.client();
    for (const page of ['forgot.html', 'reset.html', 'email.html']) {
      const r = await c('GET', '/' + page);
      assert.equal(r.status, 200, page);
      assert.match(r.body, /<script src="auth.js"><\/script>/);
    }
    assert.match((await c('GET', '/app.html')).body, /<script src="nudge.js"><\/script>[\s\S]*<script src="remind.js"><\/script>/);
    assert.match(fs.readFileSync(path.join(__dirname, '..', 'auth.js'), 'utf8'), /href="forgot.html">Forgot password\?<\/a>/);
  } finally { await app.close(); }
});

test('emails go to Resend\'s API with the key, our sender, reply-to and unsubscribe headers', async () => {
  const { emailConfig } = require('../server/email');
  assert.equal(emailConfig({ EMAIL_FROM: 'a@b.c', APP_URL: 'https://x.test' }), null);
  assert.equal(emailConfig({ RESEND_API_KEY: 're_x', EMAIL_FROM: 'a@b.c', APP_URL: 'not a url' }), null);
  const config = emailConfig({ RESEND_API_KEY: 're_test', EMAIL_FROM: 'Adltrack <hello@returnly.live>', APP_URL: 'https://returnly.test/', SUPPORT_EMAIL: 'hello@returnly.live' });
  assert.equal(config.appUrl, 'https://returnly.test');
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); return { ok: calls.length === 1, status: calls.length === 1 ? 200 : 422 }; };
  const email = createEmail({ config, secret: 's', fetch });
  await email.sendReminder('ana@example.com', 'u1', { title: 'Adltrack · 5 days left', body: 'Dress.', itemId: 'Dress', url: 'app.html?remind=Dress', actions: [{ action: 'snooze', title: 'Snooze until tomorrow' }] }, { kind: 'daily', date: today });
  const [{ url, init }] = calls, body = JSON.parse(init.body);
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal(init.headers.Authorization, 'Bearer re_test');
  assert.equal(body.from, 'Adltrack <hello@returnly.live>');
  assert.deepEqual(body.to, ['ana@example.com']);
  assert.equal(body.reply_to, 'hello@returnly.live');
  assert.match(body.headers['List-Unsubscribe'], /^<https:\/\/returnly\.test\/api\/email\/unsubscribe\?t=/);
  assert.match(body.text, /https:\/\/returnly\.test\/app\.html\?remind=Dress/);
  // A refused send is an error, so the reminder job retries it.
  await assert.rejects(email.sendReset('ana@example.com', 'tok'), /Email failed \(422\)/);
});
