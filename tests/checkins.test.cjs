/* Ada's check-ins after symptoms (server/checkins.js): every 30 minutes until "went" or "didn't go" to the ER, and a request for
   help that reaches the rest of the care team. */
const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), os = require('node:os'), path = require('node:path'), fs = require('node:fs'), crypto = require('node:crypto');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { createStorage } = require('../server/storage');
const { createData } = require('../server/data');
const { createJobs, defineJobs } = require('../server/jobs');
const { createPush, createReminders } = require('../server/reminders');
const { createCheckins, bpOutOfRange } = require('../server/checkins');

const TZ = 'America/Chicago';
const subscription = () => ({ endpoint: `https://fcm.googleapis.com/push/${crypto.randomBytes(12).toString('hex')}`, keys: { p256dh: crypto.randomBytes(65).toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } });
const MIN = 60e3;

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adltrack-checkins-'));
  const store = createStore({ file: path.join(dir, 'store.json') });
  await store.init();
  const storage = createStorage({ dir: path.join(dir, 'files') });
  const jobs = createJobs({ store, log: { error() {} } });
  const data = createData({ store, storage, jobs });
  const sent = [];
  const push = createPush({ vapid: { publicKey: 'BPublicKeyForTests', privateKey: 'private', subject: 'mailto:test@example.com' }, send: async (sub, payload, options) => { sent.push({ endpoint: sub.endpoint, message: JSON.parse(payload), options }); } });
  const clock = { now: () => new Date() };
  const reminders = createReminders({ store, push, data, now: () => clock.now(), log: { error() {} } });
  const texts = [];
  const sms = { available: () => true, sendText: async (to, body) => { texts.push({ to, body }); } };
  const checkins = createCheckins({ store, data, reminders, sms, now: () => clock.now(), log: { error() {} } });
  defineJobs(jobs, { store, storage, data, reminders, checkins });
  const server = http.createServer(createApp({ store, data, push, reminders, checkins }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  // Each client is one phone: its cookie, its push subscription and the family it picked (sent as X-Patient, as the app does).
  const client = () => {
    let cookie = '';
    const call = async (method, url, body) => {
      const headers = { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(call.patient ? { 'X-Patient': call.patient } : {}) };
      const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      return { status: res.status, body: await res.json().catch(() => null) };
    };
    return call;
  };
  const phone = async c => { c.sub = subscription(); assert.equal((await c('POST', '/api/push/subscribe', { subscription: c.sub, timeZone: TZ })).status, 200); return c; };
  const signUp = async (name) => { const c = client(); assert.equal((await c('POST', '/api/signup', { name, email: name.toLowerCase() + '@example.com', password: 'password123' })).status, 201); c.id = (await c('GET', '/api/me')).body.team.patient; return phone(c); };
  /* A family: its admin, the patient's name on the plan's profile, and one medication at 8:00 AM. */
  const family = async (admin, patient, medName) => {
    const c = await signUp(admin);
    await c('PUT', '/api/settings', { settings: { time: '09:00', daily: true, timeZone: TZ }, profile: { name: patient } });
    await c('POST', '/api/items', med('med-' + patient.toLowerCase(), medName));
    return c;
  };
  const join = async (fam, person, role, perms = {}) => {
    const added = await fam('POST', '/api/team/members', { name: person.who, email: person.who.toLowerCase() + '@example.com', role, perms });
    assert.equal(added.status, 201, JSON.stringify(added.body));
    const token = added.body.invite.link.split('#t=')[1];
    assert.equal((await person('POST', '/api/invite/accept', { token })).status, 200);
  };
  const person = async name => { const c = await signUp(name); c.who = name; return c; };
  // Runs the every-minute dispatch at a local time, then the jobs it queued; returns what was pushed, by phone.
  const at = async when => {
    clock.now = () => when;
    sent.length = 0;
    await reminders.dispatch();
    await checkins.dispatch();
    await jobs.drain();
    return sent.slice();
  };
  const to = (list, c) => list.filter(m => m.endpoint === c.sub.endpoint).map(m => m.message);
  return { texts, checkins, store, jobs, sent, clock, reminders, client, signUp, family, join, person, at, to, close: async () => { await jobs.stop(); await new Promise(r => server.close(r)); await store.close(); } };
}


test('blood pressure starts check-ins only when it is high or low', () => {
  assert.equal(bpOutOfRange('120/80'), '');
  assert.equal(bpOutOfRange('150/85'), 'high');
  assert.equal(bpOutOfRange('130/92'), 'high');
  assert.equal(bpOutOfRange('85/55'), 'low');
  assert.equal(bpOutOfRange('nonsense'), '');
});

test('symptoms get a check-in every 30 minutes, to the person who logged them, until they log the ER', async () => {
  const app = await boot();
  try {
    const t0 = new Date('2026-11-06T15:00:00Z');
    app.clock.now = () => t0;
    const george = await app.person('George');
    await george('PUT', '/api/settings', { settings: { timeZone: TZ }, profile: { name: 'George' } });
    await app.at(t0);
    const started = await george('POST', '/api/checkins', { about: 'Stomach pain', symptomId: 'sym-1' });
    assert.equal(started.status, 201, JSON.stringify(started.body));
    const c = started.body.checkin;
    assert.equal(c.self, true); assert.equal(c.mine, true);
    assert.equal(c.next, new Date(t0.getTime() + 30 * MIN).toISOString());

    // Nothing before 30 minutes; at 30, one notification that opens the check-in in Ada.
    assert.deepEqual(app.to(await app.at(new Date(t0.getTime() + 29 * MIN)), george), []);
    const first = app.to(await app.at(new Date(t0.getTime() + 30 * MIN)), george);
    assert.equal(first.length, 1);
    assert.equal(first[0].title, 'Hi George, checking in on “Stomach pain”');
    assert.match(first[0].body, /Are you still having it\?/);
    assert.ok(first[0].url.endsWith('&checkin=' + c.id));
    // Sent once; the next one is 30 minutes on, even without an answer.
    assert.deepEqual(app.to(await app.at(new Date(t0.getTime() + 31 * MIN)), george), []);
    assert.equal(app.to(await app.at(new Date(t0.getTime() + 60 * MIN)), george).length, 1);

    // Yes needs how bad it is, 1 to 10.
    assert.equal((await george('POST', `/api/checkins/${c.id}`, { still: true })).status, 400);
    const yes = await george('POST', `/api/checkins/${c.id}`, { still: true, score: 9 });
    assert.equal(yes.status, 200);
    assert.deepEqual(yes.body.checkin.answers.map(a => [a.still, a.score]), [[true, 9]]);
    // "I didn't go to the ER" ends it: no more check-ins.
    assert.equal((await george('POST', `/api/checkins/${c.id}`, { end: 'not' })).body.checkin.end.er, 'not');
    assert.deepEqual(app.to(await app.at(new Date(t0.getTime() + 200 * MIN)), george), []);
    // In the family's settings for the daily report, and an ordinary settings save doesn't wipe them.
    await george('PUT', '/api/settings', { settings: { timeZone: TZ, checkins: [] }, profile: { name: 'George' } });
    const list = (await george('GET', '/api/checkins')).body.checkins;
    assert.equal(list.length, 1); assert.equal(list[0].end.er, 'not');
    assert.equal((await george('GET', '/api/data')).body.data.settings.checkins.length, 1);
  } finally { await app.close(); }
});

test('"really bad, can\'t get to the ER" tells the rest of the care team, who can say they are coming', async () => {
  const app = await boot();
  try {
    const t0 = new Date('2026-11-06T15:00:00Z');
    app.clock.now = () => t0;
    const george = await app.person('George');
    await george('PUT', '/api/settings', { settings: { timeZone: TZ }, profile: { name: 'George' } });
    const ann = await app.person('Ann'), ben = await app.person('Ben');
    await app.join(george, ann, 'viewer'); await app.join(george, ben, 'caregiver');
    for (const p of [george, ann, ben]) p.patient = george.id;
    // A viewer can't start one (they can't log symptoms), and only George can answer his own.
    assert.equal((await ann('POST', '/api/checkins', { about: 'Pain' })).status, 403);
    const c = (await george('POST', '/api/checkins', { about: 'Chest pain' })).body.checkin;
    assert.equal((await ben('POST', `/api/checkins/${c.id}`, { still: false })).status, 403);
    await george('POST', `/api/checkins/${c.id}`, { still: true, score: 10 });

    app.sent.length = 0; app.texts.length = 0;
    const help = await george('POST', `/api/checkins/${c.id}`, { help: true });
    assert.equal(help.status, 200); assert.equal(help.body.checkin.help.score, 10);
    await app.jobs.drain();
    for (const p of [ann, ben]) assert.deepEqual(app.to(app.sent, p).map(m => m.title), ['George needs help getting to the ER']);
    assert.deepEqual(app.to(app.sent, george), []);
    assert.match(app.to(app.sent, ann)[0].body, /10 out of 10/);

    // Ten minutes, nobody coming: everyone is asked again and George is told.
    app.sent.length = 0;
    await app.at(new Date(t0.getTime() + 11 * MIN));
    assert.deepEqual(app.to(app.sent, ann).map(m => m.title), ['No one is coming for George: please call 911']);
    assert.match(app.to(app.sent, ann)[0].body, /please call 911 for them/);
    assert.ok(app.to(app.sent, george).some(m => m.title === 'No one has answered yet'));

    // Ann (a viewer) says she's coming: George hears it, by name.
    app.sent.length = 0;
    const r = await ann('POST', `/api/checkins/${c.id}/reply`, { coming: true });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.checkin.help.replies.map(x => [x.name, x.coming, x.mine]), [['Ann', true, true]]);
    assert.deepEqual(app.to(app.sent, george).map(m => m.title), ['Ann is on the way']);
    // George can't answer his own request.
    assert.equal((await george('POST', `/api/checkins/${c.id}/reply`, { coming: true })).status, 400);
  } finally { await app.close(); }
});
