const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), os = require('node:os'), path = require('node:path'), fs = require('node:fs'), crypto = require('node:crypto');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { createStorage } = require('../server/storage');
const { createData } = require('../server/data');
const { createJobs, defineJobs } = require('../server/jobs');
const { pick, localParts, cleanSubscription, vapidConfig, createPush, createReminders, dosesDue } = require('../server/reminders');
const C = require('../core.js');

// Postgres runs too when TEST_DATABASE_URL points at a throwaway database. These tests use their own schema, so they can run
// alongside the data tests (which drop the public schema).
const SCHEMA = 'reminders_test';
const PG = process.env.TEST_DATABASE_URL ? process.env.TEST_DATABASE_URL + (process.env.TEST_DATABASE_URL.includes('?') ? '&' : '?') + 'options=' + encodeURIComponent('-c search_path=' + SCHEMA) : '';
const STORES = [['file store', null], ...(PG ? [['Postgres', PG]] : [])];

const today = C.iso(new Date());
const item = (id, o = {}) => ({ id, name: id, retailer: 'Zara', price: 40, channel: 'online', purchased: C.shift(today, -5), delivered: C.shift(today, -3), window: 30, basis: 'delivery', outcome: 'refund', requirement: 'start', confirmed: true, status: 'deciding', next: 'Pack it.', ...o });
const subscription = host => ({ endpoint: `https://${host}/push/${crypto.randomBytes(12).toString('hex')}`, keys: { p256dh: crypto.randomBytes(65).toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } });

/* A fake push service: records each message, and answers with the status set for an endpoint (201 by default). */
function fakePushService() {
  const sent = [], status = new Map();
  const send = async (sub, payload, options) => {
    const code = status.get(sub.endpoint) || 201;
    if (code >= 400) throw Object.assign(new Error('Push service said ' + code), { statusCode: code });
    sent.push({ endpoint: sub.endpoint, keys: sub.keys, message: JSON.parse(payload), options });
  };
  return { sent, status, send };
}

async function boot(databaseUrl, { withPush = true, at = () => new Date() } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'returnly-push-'));
  if (databaseUrl) {
    const { Client } = require('pg');
    const c = new Client({ connectionString: databaseUrl });
    await c.connect(); await c.query(`drop schema if exists ${SCHEMA} cascade; create schema ${SCHEMA}`); await c.end();
  }
  const store = createStore({ databaseUrl, file: path.join(dir, 'store.json') });
  await store.init();
  const storage = createStorage({ dir: path.join(dir, 'files') });
  const jobs = createJobs({ store, log: { error() {} } });
  const data = createData({ store, storage, jobs });
  const service = fakePushService();
  const push = createPush(withPush ? { vapid: { publicKey: 'BPublicKeyForTests', privateKey: 'private', subject: 'mailto:test@example.com' }, send: service.send } : {});
  const clock = { now: at };
  const reminders = createReminders({ store, push, data, now: () => clock.now(), log: { error() {} } });
  defineJobs(jobs, { store, storage, data, reminders });
  const server = http.createServer(createApp({ store, data, push, reminders }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (method, url, body) => {
      const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      return { status: res.status, headers: res.headers, body: (res.headers.get('content-type') || '').startsWith('application/json') ? await res.json() : await res.text() };
    };
  };
  const signUp = async name => { const c = client(); const r = await c('POST', '/api/signup', { name, email: `${name.toLowerCase()}@example.com`, password: 'password123' }); assert.equal(r.status, 201); return c; };
  const userId = async email => (await store.findUserByEmail(email)).id;
  return { store, jobs, service, clock, reminders, base, client, signUp, userId, close: async () => { await jobs.stop(); await new Promise(r => server.close(r)); await store.close(); } };
}

/* The UTC instant when it's `time` on `date` in a time zone (searches whole minutes around the date). */
function instantAt(date, time, tz) {
  const start = Date.parse(date + 'T00:00:00Z') - 36 * 3600e3;
  for (let t = start; t < start + 72 * 3600e3; t += 60e3) { const p = localParts(new Date(t), tz); if (p.date === date && p.time === time) return new Date(t); }
  throw new Error('no such local time');
}

test('the daily reminder leads with the most urgent item, its money, days left and next step, plus how many other windows', () => {
  const list = [item('Later', { delivered: C.shift(today, -1) }), item('Soonest', { delivered: C.shift(today, -28) }), item('Middle', { delivered: C.shift(today, -10) })];
  const r = pick(list, today);
  assert.equal(r.title, 'Adltrack · Only 2 days left');
  assert.equal(r.body, 'Soonest · $40 back · 2 days left. Pack it. Plus 2 other return windows.');
  assert.equal(r.itemId, 'Soonest');
  assert.equal(r.url, 'app.html?remind=Soonest');
  assert.equal(pick([item('Last day', { delivered: C.shift(today, -30) })], today).title, 'Adltrack · Deadline today');
  assert.equal(pick([item('One', { delivered: C.shift(today, -29) })], today).body, 'One · $40 back · due tomorrow. Pack it.');
});

test('snoozed, example, sent back, kept, received, ended and unconfirmed items get no reminder', () => {
  const skip = [
    item('Snoozed', { snoozeUntil: C.shift(today, 1) }),
    item('Example', { demo: true }),
    item('Shipped', { status: 'shipped' }),
    item('Kept', { status: 'kept' }),
    item('Received', { status: 'received' }),
    item('Ended', { delivered: C.shift(today, -40) }),
    item('Unconfirmed', { confirmed: false }),
    item('Unknown rule', { requirement: 'unknown' }),
    item('No date', { delivered: '' })
  ];
  assert.equal(pick(skip, today), null);
  // A snooze ends on its day; a started return is reminded even before its window is confirmed.
  assert.equal(pick([item('Was snoozed', { snoozeUntil: today })], today).itemId, 'Was snoozed');
  assert.equal(pick([item('Started', { confirmed: false, requirement: 'unknown', status: 'started' })], today).itemId, 'Started');
});

test('local reminder time follows the time zone, across daylight saving changes', () => {
  assert.deepEqual(localParts(new Date('2026-07-01T13:00:00Z'), 'America/New_York'), { date: '2026-07-01', time: '09:00' });
  assert.deepEqual(localParts(new Date('2026-12-01T13:00:00Z'), 'America/New_York'), { date: '2026-12-01', time: '08:00' });
  assert.deepEqual(localParts(new Date('2026-07-01T23:30:00Z'), 'Asia/Tokyo'), { date: '2026-07-02', time: '08:30' });
  assert.deepEqual(localParts(new Date('2026-07-01T13:00:00Z'), 'Not/AZone'), { date: '2026-07-01', time: '13:00' });
});

test('only subscriptions from browser push services are accepted', () => {
  assert.ok(cleanSubscription(subscription('fcm.googleapis.com')));
  assert.ok(cleanSubscription(subscription('web.push.apple.com')));
  assert.ok(cleanSubscription(subscription('updates.push.services.mozilla.com')));
  assert.ok(cleanSubscription(subscription('wns2-by3p.notify.windows.com')));
  assert.equal(cleanSubscription(subscription('example.com')), null);
  assert.equal(cleanSubscription(subscription('fcm.googleapis.com.evil.com')), null);
  assert.equal(cleanSubscription(subscription('localhost')), null);
  assert.equal(cleanSubscription({ ...subscription('fcm.googleapis.com'), endpoint: 'http://fcm.googleapis.com/x' }), null);
  assert.equal(cleanSubscription({ ...subscription('fcm.googleapis.com'), endpoint: 'https://fcm.googleapis.com:8443/x' }), null);
  assert.equal(cleanSubscription({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'short', auth: 'x' } }), null);
  assert.equal(vapidConfig({}), null);
  assert.deepEqual(vapidConfig({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:a@b.c' }), { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:a@b.c' });
});

test('the installable app files are served, and the CSP allows only this site\'s service worker and manifest', async () => {
  const app = await boot(null, { withPush: false });
  try {
    const c = app.client();
    const manifest = await c('GET', '/manifest.webmanifest');
    assert.equal(manifest.status, 200);
    assert.equal(manifest.headers.get('content-type'), 'application/manifest+json');
    const m = JSON.parse(manifest.body);
    assert.equal(m.start_url, '/app.html');
    assert.equal(m.display, 'standalone');
    for (const icon of m.icons) assert.equal((await fetch(app.base + '/' + icon.src)).status, 200);
    const sw = await c('GET', '/sw.js');
    assert.equal(sw.status, 200);
    assert.match(sw.headers.get('content-type'), /javascript/);
    assert.match(sw.headers.get('content-security-policy'), /worker-src 'self'; manifest-src 'self'/);
    // Every file the service worker caches exists, so its install can't fail.
    const files = JSON.parse(sw.body.match(/SHELL_FILES = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
    for (const f of files) assert.equal((await fetch(app.base + '/' + f)).status, 200, f);
    const html = await c('GET', '/app.html');
    assert.match(html.body, /<link rel="manifest" href="manifest.webmanifest">/);
    assert.match(html.body, /<script src="push.js"><\/script>/);
  } finally { await app.close(); }
});

test('without VAPID keys push is off and the open app still gets its reminder', async () => {
  const app = await boot(null, { withPush: false });
  try {
    const c = await app.signUp('Ana');
    assert.deepEqual((await c('GET', '/api/push/key')).body, { key: null });
    assert.equal((await c('POST', '/api/push/subscribe', { subscription: subscription('fcm.googleapis.com'), timeZone: 'UTC' })).status, 503);
    await c('POST', '/api/items', item('Dress'));
    const r = await c('POST', '/api/reminders/claim', { date: today });
    assert.equal(r.body.reminder.itemId, 'Dress');
    assert.equal((await c('POST', '/api/reminders/claim', { date: today })).body.reminder, null);
    assert.equal(await app.reminders.dispatch(), 0);
  } finally { await app.close(); }
});

for (const [label, db] of STORES) {
  test(`${label}: devices subscribe, move between accounts, unsubscribe and are deleted with the account`, async () => {
    const app = await boot(db);
    try {
      const ana = await app.signUp('Ana'), ben = await app.signUp('Ben');
      assert.deepEqual((await ana('GET', '/api/push/key')).body, { key: 'BPublicKeyForTests' });
      assert.equal((await app.client()('POST', '/api/push/subscribe', { subscription: subscription('fcm.googleapis.com') })).status, 401);
      assert.equal((await ana('POST', '/api/push/subscribe', { subscription: subscription('example.com'), timeZone: 'UTC' })).status, 400);
      const phone = subscription('fcm.googleapis.com'), laptop = subscription('updates.push.services.mozilla.com');
      assert.equal((await ana('POST', '/api/push/subscribe', { subscription: phone, timeZone: 'America/Chicago' })).status, 200);
      assert.equal((await ana('POST', '/api/push/subscribe', { subscription: laptop, timeZone: 'Not/AZone' })).status, 200);
      const anaId = await app.userId('ana@example.com'), benId = await app.userId('ben@example.com');
      const subs = await app.store.listPushSubscriptions(anaId);
      assert.equal(subs.length, 2);
      assert.deepEqual(subs.find(s => s.endpoint === phone.endpoint), { endpoint: phone.endpoint, p256dh: phone.keys.p256dh, auth: phone.keys.auth, timeZone: 'America/Chicago' });
      assert.equal(subs.find(s => s.endpoint === laptop.endpoint).timeZone, 'UTC');
      // Ben signs in on Ana's laptop: the laptop now gets Ben's reminders, not Ana's.
      await ben('POST', '/api/push/subscribe', { subscription: laptop, timeZone: 'UTC' });
      assert.deepEqual((await app.store.listPushSubscriptions(anaId)).map(s => s.endpoint), [phone.endpoint]);
      assert.deepEqual((await app.store.listPushSubscriptions(benId)).map(s => s.endpoint), [laptop.endpoint]);
      // Ana can't remove Ben's device; Ben can.
      await ana('POST', '/api/push/unsubscribe', { endpoint: laptop.endpoint });
      assert.equal((await app.store.listPushSubscriptions(benId)).length, 1);
      await ben('POST', '/api/push/unsubscribe', { endpoint: laptop.endpoint });
      assert.equal((await app.store.listPushSubscriptions(benId)).length, 0);
      // Deleting the account deletes its subscriptions and reminder days.
      await app.store.claimReminderDay(anaId, today, 'app');
      assert.equal((await ana('DELETE', '/api/account', { password: 'password123' })).status, 200);
      assert.deepEqual(await app.store.listPushSubscriptions(anaId), []);
      assert.deepEqual((await app.store.reminderCandidates()).filter(c => c.userId === anaId), []);
    } finally { await app.close(); }
  });

  test(`${label}: the reminder is pushed once at the user's time in their time zone, and the open app doesn't repeat it`, async () => {
    const app = await boot(db);
    try {
      const c = await app.signUp('Ana');
      const sub = subscription('fcm.googleapis.com');
      await c('PUT', '/api/settings', { settings: { time: '09:00', daily: true, notifications: true }, profile: {} });
      await c('POST', '/api/push/subscribe', { subscription: sub, timeZone: 'America/New_York' });
      await c('POST', '/api/items', item('Dress', { delivered: C.shift(today, -25) }));
      await c('POST', '/api/items', item('Shoes'));
      await c('POST', '/api/items', item('Example', { demo: true, delivered: C.shift(today, -29) }));

      app.clock.now = () => new Date(instantAt(today, '08:59', 'America/New_York'));
      assert.equal(await app.reminders.dispatch(), 0);
      await app.jobs.drain();
      assert.equal(app.service.sent.length, 0);

      app.clock.now = () => new Date(instantAt(today, '09:00', 'America/New_York'));
      assert.equal(await app.reminders.dispatch(), 1);
      await app.jobs.drain();
      assert.equal(app.service.sent.length, 1);
      const [msg] = app.service.sent;
      assert.equal(msg.endpoint, sub.endpoint);
      assert.deepEqual(msg.keys, sub.keys);
      assert.deepEqual(msg.message, { title: 'Adltrack · 5 days left', body: 'Dress · $40 back · 5 days left. Pack it. Plus 1 other return window.', itemId: 'Dress', url: 'app.html?remind=Dress',
        actions: [{ action: 'snooze', title: 'Snooze until tomorrow' }, { action: 'sent', title: 'I sent it back' }, { action: 'keep', title: 'I’m keeping it' }] });
      assert.deepEqual(msg.options, { TTL: 43200, urgency: 'normal', topic: 'daily' });

      // Later the same day: nothing more by push, and the open app's check finds the day already done.
      app.clock.now = () => new Date(instantAt(today, '18:00', 'America/New_York'));
      assert.equal(await app.reminders.dispatch(), 0);
      await app.jobs.drain();
      assert.equal(app.service.sent.length, 1);
      assert.equal((await c('POST', '/api/reminders/claim', { date: today })).body.reminder, null);
    } finally { await app.close(); }
  });

  test(`${label}: when the open app shows the reminder first, push skips that day; turned off or snoozed means no push`, async () => {
    const app = await boot(db);
    try {
      const c = await app.signUp('Ana');
      await c('PUT', '/api/settings', { settings: { time: '07:30', daily: true }, profile: {} });
      await c('POST', '/api/push/subscribe', { subscription: subscription('web.push.apple.com'), timeZone: 'Europe/London' });
      await c('POST', '/api/items', item('Bag', { snoozeUntil: C.shift(today, 1) }));
      // Snoozed: the day is checked once and nothing is sent.
      app.clock.now = () => new Date(instantAt(today, '07:30', 'Europe/London'));
      assert.equal(await app.reminders.dispatch(), 1);
      await app.jobs.drain();
      assert.equal(app.service.sent.length, 0);
      assert.equal((await c('POST', '/api/reminders/claim', { date: today })).body.reminder, null);

      // Next day the app is open first: it gets the reminder, so push doesn't send one too.
      const tomorrow = C.shift(today, 1), id = await app.userId('ana@example.com');
      const r = await app.reminders.claim(id, tomorrow, 'app');
      assert.equal(r.reminder.itemId, 'Bag');
      app.clock.now = () => new Date(instantAt(tomorrow, '08:00', 'Europe/London'));
      assert.equal(await app.reminders.dispatch(), 0);

      // Daily reminders turned off: no push the day after.
      await c('PUT', '/api/settings', { settings: { time: '07:30', daily: false }, profile: {} });
      app.clock.now = () => new Date(instantAt(C.shift(today, 2), '08:00', 'Europe/London'));
      assert.equal(await app.reminders.dispatch(), 0);
      await app.jobs.drain();
      assert.equal(app.service.sent.length, 0);
    } finally { await app.close(); }
  });

  test(`${label}: expired subscriptions are removed, and a failed send is retried`, async () => {
    const app = await boot(db);
    try {
      const c = await app.signUp('Ana');
      const gone = subscription('fcm.googleapis.com'), flaky = subscription('updates.push.services.mozilla.com');
      await c('POST', '/api/push/subscribe', { subscription: gone, timeZone: 'UTC' });
      await c('POST', '/api/push/subscribe', { subscription: flaky, timeZone: 'UTC' });
      await c('POST', '/api/items', item('Coat'));
      app.service.status.set(gone.endpoint, 410);
      app.service.status.set(flaky.endpoint, 503);
      const id = await app.userId('ana@example.com');
      await assert.rejects(app.reminders.send({ userId: id, date: today }), /Push failed/);
      assert.deepEqual((await app.store.listPushSubscriptions(id)).map(s => s.endpoint), [flaky.endpoint]);
      // Nothing reached a device, so the day is free again and the retry delivers it.
      app.service.status.delete(flaky.endpoint);
      await app.reminders.send({ userId: id, date: today });
      assert.equal(app.service.sent.length, 1);
      assert.equal(app.service.sent[0].message.itemId, 'Coat');
      await app.reminders.send({ userId: id, date: today });
      assert.equal(app.service.sent.length, 1);
    } finally { await app.close(); }
  });
}

test('"Send a test notification" is pushed only to the caller\'s own device', async () => {
  const app = await boot(null);
  try {
    const ana = await app.signUp('Ana'), ben = await app.signUp('Ben');
    const sub = subscription('fcm.googleapis.com');
    await ana('POST', '/api/push/subscribe', { subscription: sub, timeZone: 'UTC' });
    assert.deepEqual((await ben('POST', '/api/push/test', { endpoint: sub.endpoint })).body, { sent: false });
    assert.equal(app.service.sent.length, 0);
    assert.deepEqual((await ana('POST', '/api/push/test', { endpoint: sub.endpoint })).body, { sent: true });
    assert.equal(app.service.sent[0].message.title, 'Adltrack · Reminders are on');
  } finally { await app.close(); }
});

test('the open app can only claim a date near today', async () => {
  const app = await boot(null);
  try {
    const c = await app.signUp('Ana');
    assert.equal((await c('POST', '/api/reminders/claim', { date: '2020-01-01' })).status, 400);
    assert.equal((await c('POST', '/api/reminders/claim', { date: 'today' })).status, 400);
    assert.equal((await c('POST', '/api/reminders/claim', { date: today })).status, 200);
  } finally { await app.close(); }
});

test('the reminder jobs run inside the job runner every minute', async () => {
  const app = await boot(null);
  try {
    const c = await app.signUp('Ana');
    await c('PUT', '/api/settings', { settings: { time: '00:00', daily: true }, profile: {} });
    await c('POST', '/api/push/subscribe', { subscription: subscription('fcm.googleapis.com'), timeZone: 'UTC' });
    await c('POST', '/api/items', item('Skirt'));
    app.clock.now = () => new Date();
    await app.jobs.start();
    for (let n = 0; n < 50 && !app.service.sent.length; n++) await new Promise(r => setTimeout(r, 20));
    await app.jobs.drain();
    assert.equal(app.service.sent.length, 1);
    assert.equal(app.service.sent[0].message.itemId, 'Skirt');
  } finally { await app.close(); }
});

test('the real web-push library accepts our message and options (encrypted body and VAPID headers)', () => {
  const webpush = require('web-push');
  const vapid = webpush.generateVAPIDKeys(), ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
  assert.ok(cleanSubscription(sub));
  const message = pick([item('Dress')], today);
  const r = webpush.generateRequestDetails(sub, JSON.stringify(message), { TTL: 43200, urgency: 'normal', topic: 'daily', vapidDetails: { subject: 'mailto:test@example.com', publicKey: vapid.publicKey, privateKey: vapid.privateKey } });
  assert.equal(r.endpoint, sub.endpoint);
  assert.equal(r.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(r.headers.TTL, 43200);
  assert.equal(r.headers.Urgency, 'normal');
  assert.equal(r.headers.Topic, 'daily');
  assert.match(r.headers.Authorization, /^vapid t=.+, k=/);
  assert.ok(!r.body.toString('latin1').includes('Dress'));
});

const med = (id, o = {}) => ({ id, name: id, med: true, status: 'deciding', intent: 'return', instructions: 'Take 1 tablet by mouth every morning.', times: ['08:00'], doses: [], price: 0, retailer: '', channel: 'store', purchased: today, window: 30, basis: 'purchase', outcome: 'unknown', requirement: 'unknown', confirmed: false, ...o });

test('a dose is due from its time until an hour after, unless it was marked; as needed, pickups, finished and examples never are', () => {
  const items = [med('Lisinopril 10 mg'), med('Metoprolol 25 mg', { times: ['08:00', '21:00'] }), med('Taken', { doses: [{ at: today + 'T08:01:00Z', day: today, kind: 'taken', slot: '08:00' }] }),
    med('Tylenol', { asNeeded: true }), med('Pickup', { pickup: true }), med('Finished', { status: 'received' }), med('Unconfirmed', { status: 'kept' }), med('Example', { demo: true }), item('Dress')];
  assert.deepEqual(dosesDue(items, today, '07:59'), []);
  assert.deepEqual(dosesDue(items, today, '08:00').map(d => [d.time, d.items.map(i => i.id)]), [['08:00', ['Lisinopril 10 mg', 'Metoprolol 25 mg']]]);
  assert.equal(dosesDue(items, today, '08:59').length, 1);
  assert.deepEqual(dosesDue(items, today, '09:00'), []);
  assert.deepEqual(dosesDue(items, today, '21:10').map(d => d.items.map(i => i.id)), [['Metoprolol 25 mg']]);
  // Yesterday's mark doesn't count today.
  assert.equal(dosesDue([med('Taken', { doses: [{ at: C.shift(today, -1) + 'T08:01:00Z', day: C.shift(today, -1), kind: 'taken', slot: '08:00' }] })], today, '08:05').length, 1);
});

for (const [label, db] of STORES) {
  test(`${label}: each dose time is pushed once with the medications due then, in the instructions' own words`, async () => {
    const app = await boot(db);
    try {
      const c = await app.signUp('Ana');
      await c('PUT', '/api/settings', { settings: { time: '09:00', daily: true }, profile: {} });
      const sub = subscription('fcm.googleapis.com');
      await c('POST', '/api/push/subscribe', { subscription: sub, timeZone: 'America/Chicago' });
      await c('POST', '/api/items', med('Lisinopril 10 mg'));
      await c('POST', '/api/items', med('Metoprolol 25 mg', { instructions: 'Take 1 tablet by mouth twice a day.', times: ['08:00', '21:00'] }));
      await c('POST', '/api/items', med('Tylenol', { asNeeded: true, times: [] }));

      app.clock.now = () => new Date(instantAt(today, '07:59', 'America/Chicago'));
      assert.equal(await app.reminders.dispatch(), 0);
      app.clock.now = () => new Date(instantAt(today, '08:02', 'America/Chicago'));
      assert.equal(await app.reminders.dispatch(), 1);
      await app.jobs.drain();
      assert.equal(app.service.sent.length, 1);
      const [msg] = app.service.sent;
      assert.equal(msg.message.title, '8:00 AM: 2 medications');
      assert.deepEqual(msg.message.actions.map(a => a.title), ['Taken', 'Snooze 15 minutes', 'Skipped']);
      assert.deepEqual(msg.message.dose, { date: today, time: '08:00', ids: ['Lisinopril 10 mg', 'Metoprolol 25 mg'] });
      assert.equal(msg.message.body, 'Lisinopril 10 mg: Take 1 tablet by mouth every morning. · Metoprolol 25 mg: Take 1 tablet by mouth twice a day.');
      assert.deepEqual(msg.options, { TTL: 3600, urgency: 'high', topic: 'dose' });
      // The next minute: already sent, so nothing more.
      app.clock.now = () => new Date(instantAt(today, '08:03', 'America/Chicago'));
      assert.equal(await app.reminders.dispatch(), 0);
      await app.jobs.drain();
      assert.equal(app.service.sent.length, 1);
      // Marked taken before its time: no push for it.
      const anaId = await app.userId('ana@example.com');
      const meto = (await app.store.listItems(anaId)).find(i => i.id === 'Metoprolol 25 mg');
      assert.equal((await c('PUT', '/api/items/' + encodeURIComponent(meto.id), { ...meto, doses: [{ at: new Date().toISOString(), day: today, kind: 'taken', slot: '21:00' }] })).status, 200);
      app.clock.now = () => new Date(instantAt(today, '21:00', 'America/Chicago'));
      await app.reminders.dispatch();
      await app.jobs.drain();
      assert.equal(app.service.sent.length, 1);
    } finally { await app.close(); }
  });
}

for (const [label, db] of STORES) {
  test(`${label}: a dose reminder's Taken, Skipped and Snooze 15 minutes work without the app, and the test notification shows a dose`, async () => {
    const app = await boot(db);
    try {
      const c = await app.signUp('Ana');
      await c('PUT', '/api/settings', { settings: { time: '09:00', daily: true }, profile: { name: 'Ana' } });
      const sub = subscription('fcm.googleapis.com');
      await c('POST', '/api/push/subscribe', { subscription: sub, timeZone: 'America/Chicago' });
      await c('POST', '/api/items', med('Lisinopril 10 mg', { dose: '1 tablet', times: ['08:00', '20:00'] }));
      await c('POST', '/api/items', med('Metoprolol 25 mg', { times: ['20:00'] }));
      const anaId = await app.userId('ana@example.com');

      // The test notification: the next unmarked dose, one medication, with the three buttons.
      app.clock.now = () => new Date(instantAt(today, '19:30', 'America/Chicago'));
      assert.deepEqual((await c('POST', '/api/push/test', { endpoint: sub.endpoint })).body, { sent: true });
      const test1 = app.service.sent.pop().message;
      assert.equal(test1.title, '8:00 PM: Lisinopril 10 mg, 1 tablet');
      assert.equal(test1.body, 'Take 1 tablet by mouth every morning.');
      assert.deepEqual(test1.actions.map(a => a.action), ['taken', 'snooze15', 'skipped']);
      assert.deepEqual(test1.dose, { date: today, time: '20:00', ids: ['Lisinopril 10 mg'] });

      // Taken marks the dose, with who marked it; a second tap keeps the first mark.
      let r = await c('POST', '/api/reminders/dose', { action: 'taken', ...test1.dose });
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.items[0].doses.map(d => [d.day, d.slot, d.kind, d.by]), [[today, '20:00', 'taken', 'Ana']]);
      r = await c('POST', '/api/reminders/dose', { action: 'skipped', ...test1.dose });
      assert.deepEqual(r.body.items, []);
      assert.equal((await app.store.getItem(anaId, 'Lisinopril 10 mg')).item.doses.length, 1);

      // Skipped is only recorded: the dose isn't moved and no new time appears.
      r = await c('POST', '/api/reminders/dose', { action: 'skipped', date: today, time: '20:00', ids: ['Metoprolol 25 mg'] });
      const meto = r.body.items[0];
      assert.deepEqual(meto.times, ['20:00']);
      assert.deepEqual(meto.doses.map(d => [d.slot, d.kind]), [['20:00', 'skipped']]);

      // Snooze: the same reminder again in 15 minutes, for what still isn't marked.
      await c('POST', '/api/reminders/dose', { action: 'snooze15', date: today, time: '08:00', ids: ['Lisinopril 10 mg'] });
      app.clock.now = () => new Date(instantAt(today, '09:10', 'America/Chicago'));
      await app.reminders.sendDose({ userId: anaId, date: today, time: '08:00', ids: ['Lisinopril 10 mg'] });
      const again = app.service.sent.pop().message;
      assert.equal(again.title, '8:00 AM: Lisinopril 10 mg, 1 tablet');
      await c('POST', '/api/reminders/dose', { action: 'taken', date: today, time: '08:00', ids: ['Lisinopril 10 mg'] });
      await app.reminders.sendDose({ userId: anaId, date: today, time: '08:00', ids: ['Lisinopril 10 mg'] });
      assert.equal(app.service.sent.length, 0);

      // Nothing else is accepted.
      assert.equal((await c('POST', '/api/reminders/dose', { action: 'sent', date: today, time: '08:00', ids: ['Lisinopril 10 mg'] })).status, 400);
      assert.equal((await c('POST', '/api/reminders/dose', { action: 'taken', date: today, time: '8pm', ids: ['Lisinopril 10 mg'] })).status, 400);
    } finally { await app.close(); }
  });
}
