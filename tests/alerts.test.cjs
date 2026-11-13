/* Step 6: reminders and alerts per family, to everyone on that family's care team, and live updates between phones. */
const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), os = require('node:os'), path = require('node:path'), fs = require('node:fs'), crypto = require('node:crypto');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { createStorage } = require('../server/storage');
const { createData } = require('../server/data');
const { createJobs, defineJobs } = require('../server/jobs');
const { createPush, createReminders, localParts, daySummary, endOfDayNotification, taskOn } = require('../server/reminders');
const { mergeMarks, markId } = require('../server/items');
const C = require('../core.js');

const TZ = 'America/Chicago';
const today = localParts(new Date(), TZ).date;
const subscription = () => ({ endpoint: `https://fcm.googleapis.com/push/${crypto.randomBytes(12).toString('hex')}`, keys: { p256dh: crypto.randomBytes(65).toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } });
/* The instant when it's `time` on `date` in Chicago (midnight found once per date, then whole minutes after it). */
const midnights = {};
function instantAt(date, time, tz = TZ) {
  if (!midnights[date]) {
    const start = Date.parse(date + 'T00:00:00Z') - 36 * 3600e3;
    for (let t = start; t < start + 72 * 3600e3 && !midnights[date]; t += 60e3) { const p = localParts(new Date(t), tz); if (p.date === date && p.time === '00:00') midnights[date] = t; }
  }
  return new Date(midnights[date] + (Number(time.slice(0, 2)) * 60 + Number(time.slice(3))) * 60e3);
}
const med = (id, name, o = {}) => ({ id, name, med: true, status: 'deciding', dose: '10 mg', instructions: 'Take 1 tablet by mouth every morning.', times: ['08:00'], doses: [], ...o });

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adltrack-alerts-'));
  const store = createStore({ file: path.join(dir, 'store.json') });
  await store.init();
  const storage = createStorage({ dir: path.join(dir, 'files') });
  const jobs = createJobs({ store, log: { error() {} } });
  const data = createData({ store, storage, jobs });
  const sent = [];
  const push = createPush({ vapid: { publicKey: 'BPublicKeyForTests', privateKey: 'private', subject: 'mailto:test@example.com' }, send: async (sub, payload, options) => { sent.push({ endpoint: sub.endpoint, message: JSON.parse(payload), options }); } });
  const clock = { now: () => new Date() };
  const reminders = createReminders({ store, push, data, now: () => clock.now(), log: { error() {} } });
  defineJobs(jobs, { store, storage, data, reminders });
  const server = http.createServer(createApp({ store, data, push, reminders }));
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
  const signUp = async (name) => { const c = client(); assert.equal((await c('POST', '/api/signup', { name, email: name.toLowerCase() + '@example.com', password: 'Care-plan-2026' })).status, 201); c.id = (await c('GET', '/api/me')).body.team.patient; return phone(c); };
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
    assert.equal((await person('POST', '/api/invite/accept', { consent: true, token })).status, 200);
  };
  const person = async name => { const c = await signUp(name); c.who = name; return c; };
  // Runs the every-minute dispatch at a local time, then the jobs it queued; returns what was pushed, by phone.
  const at = async (time, date = today) => {
    clock.now = () => instantAt(date, time);
    sent.length = 0;
    await reminders.dispatch();
    await jobs.drain();
    return sent.slice();
  };
  const to = (list, c) => list.filter(m => m.endpoint === c.sub.endpoint).map(m => m.message);
  return { store, jobs, sent, clock, reminders, client, signUp, family, join, person, at, to, close: async () => { await jobs.stop(); await new Promise(r => server.close(r)); await store.close(); } };
}

test('a caregiver on two families gets both families\' dose reminders, each naming its patient and opening that family', async () => {
  const app = await boot();
  try {
    const rose = await app.family('Grace', 'Rose', 'Lisinopril'), walter = await app.family('Hank', 'Walter', 'Metformin');
    const maria = await app.person('Maria'), ann = await app.person('Ann');
    await app.join(rose, maria, 'caregiver'); await app.join(walter, maria, 'caregiver');
    await app.join(rose, ann, 'viewer');

    const pushed = await app.at('08:00');
    const mine = app.to(pushed, maria).sort((a, b) => a.title.localeCompare(b.title));
    assert.deepEqual(mine.map(m => m.title), ['Rose · 8:00 AM: Lisinopril, 10 mg', 'Walter · 8:00 AM: Metformin, 10 mg']);
    assert.deepEqual(mine.map(m => m.url), [`app.html?patient=${rose.id}&remind=med-rose`, `app.html?patient=${walter.id}&remind=med-walter`]);
    assert.deepEqual(mine.map(m => m.dose.patient), [rose.id, walter.id]);
    // The admin who set the family up has My Tasks too, so gets their own family's reminder; the viewer gets none.
    assert.deepEqual(app.to(pushed, rose).map(m => m.title), ['Rose · 8:00 AM: Lisinopril, 10 mg']);
    assert.deepEqual(app.to(pushed, ann), []);
    // Sent once per family, however many minutes pass.
    assert.equal((await app.at('08:01')).length, 0);

    // Taken on Walter's reminder marks Walter's dose, with Maria's name, and nothing on Rose's plan.
    maria.patient = walter.id;
    const r = await maria('POST', '/api/reminders/dose', { action: 'taken', date: today, time: '08:00', ids: ['med-walter'] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.items[0].doses.map(d => [d.slot, d.kind, d.by]), [['08:00', 'taken', 'Maria']]);
    assert.equal((await rose('GET', '/api/items')).body.items.find(i => i.id === 'med-rose').doses.length, 0);
    // A viewer can't mark one, even by calling the API.
    ann.patient = rose.id;
    assert.equal((await ann('POST', '/api/reminders/dose', { action: 'taken', date: today, time: '08:00', ids: ['med-rose'] })).status, 403);
  } finally { await app.close(); }
});

test('an unmarked dose reminds the caregivers again after an hour, then alerts everyone; a marked one alerts nobody', async () => {
  const app = await boot();
  try {
    const rose = await app.family('Grace', 'Rose', 'Lisinopril');
    await rose('POST', '/api/items', med('med-2', 'Metoprolol', { dose: '25 mg', times: ['09:00'] }));
    const maria = await app.person('Maria'), ann = await app.person('Ann');
    await app.join(rose, maria, 'caregiver'); await app.join(rose, ann, 'viewer');
    await app.at('08:00');
    assert.equal((await app.at('08:59')).length, 0);
    const again = await app.at('09:00');
    assert.deepEqual(app.to(again, maria).filter(m => /Lisinopril/.test(m.title)).map(m => [m.title, m.body.split(' · ')[0]]), [['Rose · 8:00 AM: Lisinopril, 10 mg', 'Not marked yet.']]);
    assert.deepEqual(app.to(again, ann).filter(m => /Lisinopril/.test(m.title + m.body)), []);
    // The 9:00 dose is marked in time: no alert will come for it.
    maria.patient = rose.id;
    await maria('POST', '/api/reminders/dose', { action: 'skipped', date: today, time: '09:00', ids: ['med-2'] });
    const alert = await app.at('09:15');
    for (const c of [rose, maria, ann]) assert.deepEqual(app.to(alert, c).map(m => m.title), ['Rose · Missed dose at 8:00 AM'], c.who);
    assert.match(app.to(alert, ann)[0].body, /^Lisinopril, 10 mg wasn’t marked taken or skipped\. About a missed dose, check the instructions or call the pharmacist\.$/);
    assert.equal(app.to(alert, ann)[0].url, `app.html?patient=${rose.id}`);
    assert.equal((await app.at('10:15')).length, 0);
  } finally { await app.close(); }
});

test('an incident reaches every device on the team straight away, even in quiet hours, without saying who reported it', async () => {
  const app = await boot();
  try {
    const rose = await app.family('Grace', 'Rose', 'Lisinopril');
    const maria = await app.person('Maria'), ann = await app.person('Ann'), luis = await app.person('Luis');
    await app.join(rose, maria, 'caregiver'); await app.join(rose, ann, 'viewer'); await app.join(rose, luis, 'admin');
    // Ann turned every alert off and is in quiet hours: incidents still arrive.
    ann.patient = rose.id;
    assert.equal((await ann('PUT', '/api/alerts/prefs', { missed: false, endOfDay: false, quietStart: '00:00', quietEnd: '23:59' })).status, 200);
    const annLaptop = subscription();
    await ann('POST', '/api/push/subscribe', { subscription: annLaptop, timeZone: TZ });
    app.sent.length = 0;
    maria.patient = rose.id;
    const at = new Date(Date.now() - 5 * 60e3).toISOString();
    assert.equal((await maria('POST', '/api/items', { id: 'inc-1', incident: true, kind: 'fall', name: 'Fall', at, note: 'Slipped by the bed, no injury.', witnesses: 'Ann', by: 'Maria' })).status, 201);
    await app.jobs.drain();
    const got = app.sent.map(m => m.endpoint);
    for (const endpoint of [rose.sub.endpoint, ann.sub.endpoint, annLaptop.endpoint, luis.sub.endpoint]) assert.ok(got.includes(endpoint));
    assert.ok(!got.includes(maria.sub.endpoint));
    const msg = app.sent[0].message;
    assert.equal(msg.title, 'Rose · Incident: Fall');
    assert.match(msg.body, /^\d{1,2}:\d{2} [AP]M · Slipped by the bed, no injury\.$/);
    assert.doesNotMatch(JSON.stringify(msg), /Maria|Reported by/);
    assert.equal(app.sent[0].options.urgency, 'high');
  } finally { await app.close(); }
});

test('each person picks which alerts they get and their quiet hours; viewers too, and nobody else\'s choices change', async () => {
  const app = await boot();
  try {
    const rose = await app.family('Grace', 'Rose', 'Lisinopril');
    const maria = await app.person('Maria'), ann = await app.person('Ann');
    await app.join(rose, maria, 'caregiver'); await app.join(rose, ann, 'viewer');
    assert.deepEqual((await ann('GET', '/api/alerts/prefs')).body.prefs, { doses: true, missed: true, endOfDay: true, endOfDayTime: '20:00' });
    assert.equal((await ann('PUT', '/api/alerts/prefs', { missed: false, endOfDayTime: '21:30', quietStart: '22:00', quietEnd: '07:00', junk: 1 })).status, 200);
    assert.deepEqual((await ann('GET', '/api/alerts/prefs')).body.prefs, { doses: true, missed: false, endOfDay: true, endOfDayTime: '21:30', quietStart: '22:00', quietEnd: '07:00' });
    assert.equal((await maria('GET', '/api/alerts/prefs')).body.prefs.missed, true);
    // Maria's quiet hours cover 8:00: no dose reminder for her.
    await maria('PUT', '/api/alerts/prefs', { quietStart: '07:00', quietEnd: '08:30' });
    assert.deepEqual(app.to(await app.at('08:00'), maria), []);
    // Quiet hours off again; dose reminders off: still none.
    await maria('PUT', '/api/alerts/prefs', { quietStart: '', quietEnd: '', doses: false });
    assert.equal((await maria('GET', '/api/alerts/prefs')).body.prefs.quietStart, undefined);
    await rose('POST', '/api/items', med('med-2', 'Metoprolol', { times: ['12:00'] }));
    assert.deepEqual(app.to(await app.at('12:00'), maria), []);
    // The missed dose alert at 9:15 reaches Maria and the admin, not Ann, who turned it off.
    await app.at('09:00');
    const alert = await app.at('09:15');
    assert.equal(app.to(alert, maria).length, 1);
    assert.equal(app.to(alert, rose).length, 1);
    assert.equal(app.to(alert, ann).length, 0);
    // A viewer turning on notifications on their phone is allowed (it's the only plan setting they may change).
    ann.patient = rose.id;
    const saved = (await ann('GET', '/api/data')).body.data.settings;
    assert.equal((await ann('PUT', '/api/settings', { settings: { ...saved, notifications: true }, profile: { name: 'Rose' } })).status, 200);
    assert.equal((await ann('PUT', '/api/settings', { settings: { ...saved, time: '06:00' }, profile: { name: 'Rose' } })).status, 403);
  } finally { await app.close(); }
});

test('the end-of-day report goes to everyone at their own time, with the day in one line', async () => {
  const app = await boot();
  try {
    const rose = await app.family('Grace', 'Rose', 'Lisinopril');
    await rose('POST', '/api/items', med('med-2', 'Metoprolol', { times: ['08:00', '20:00'], doses: [{ at: new Date().toISOString(), day: today, kind: 'taken', slot: '08:00' }] }));
    await rose('POST', '/api/items', { id: 'task-1', task: true, name: 'Change the dressing', date: today, time: '15:00', repeat: 'once', marks: [{ day: today, key: 'task', kind: 'done', at: new Date().toISOString() }] });
    const ann = await app.person('Ann');
    await app.join(rose, ann, 'viewer');
    await ann('PUT', '/api/alerts/prefs', { endOfDayTime: '21:00' });
    const eight = await app.at('20:00');
    assert.deepEqual(app.to(eight, rose).filter(m => /care report/.test(m.title)).map(m => [m.title, m.body]), [['Rose · Today’s care report', '1 of 3 doses taken · 1 of 1 task done. Tap to see the daily care report.']]);
    assert.deepEqual(app.to(eight, ann), []);
    const nine = await app.at('21:00');
    assert.deepEqual(app.to(nine, ann).map(m => m.title), ['Rose · Today’s care report']);
    assert.equal((await app.at('21:30')).filter(m => /care report/.test(m.message.title)).length, 0);
  } finally { await app.close(); }
});

test('a task from the + is reminded at its time to the people with My Tasks, unless it was already done', async () => {
  const app = await boot();
  try {
    const rose = await app.family('Grace', 'Rose', 'Lisinopril');
    const maria = await app.person('Maria'), ann = await app.person('Ann');
    await app.join(rose, maria, 'caregiver'); await app.join(rose, ann, 'viewer');
    await rose('POST', '/api/items', { id: 'task-1', task: true, name: 'Change the dressing', note: 'Left knee', date: today, time: '15:00', repeat: 'daily', until: C.shift(today, 30), marks: [] });
    await rose('POST', '/api/items', { id: 'task-2', task: true, name: 'Walk', date: today, time: '15:00', repeat: 'once', marks: [{ day: today, key: 'task', kind: 'done', at: new Date().toISOString() }] });
    const pushed = await app.at('15:00');
    assert.deepEqual(app.to(pushed, maria).map(m => [m.title, m.body]), [['Rose · 3:00 PM: Change the dressing', 'Left knee']]);
    assert.deepEqual(app.to(pushed, ann), []);
    assert.ok(taskOn({ task: true, date: today, repeat: 'days', days: [C.parseDate(C.shift(today, 2)).getDay()], until: C.shift(today, 9) }, C.shift(today, 2)));
  } finally { await app.close(); }
});

test('two people marking the same medication at once keep both marks, and taking a mark off still works', async () => {
  const app = await boot();
  try {
    const rose = await app.family('Grace', 'Rose', 'Lisinopril');
    const maria = await app.person('Maria');
    await app.join(rose, maria, 'caregiver');
    maria.patient = rose.id;
    await rose('PUT', '/api/items/med-rose', med('med-rose', 'Lisinopril', { times: ['08:00', '20:00'] }));
    // Both phones load the same copy (no marks yet), then each marks a different dose before seeing the other's.
    const base = (await maria('GET', '/api/items')).body.items.find(i => i.id === 'med-rose'), seen = [];
    const morning = { at: '2026-10-22T13:01:00.000Z', day: today, kind: 'taken', slot: '08:00', by: 'Maria' };
    const evening = { at: '2026-10-22T13:02:00.000Z', day: today, kind: 'taken', slot: '20:00', by: 'Grace' };
    assert.equal((await maria('PUT', '/api/items/med-rose', { ...base, doses: [morning], _seen: seen })).status, 200);
    const r = await rose('PUT', '/api/items/med-rose', { ...base, doses: [evening], _seen: seen });
    assert.deepEqual(r.body.item.doses.map(d => d.slot), ['08:00', '20:00']);
    // Maria saw both, then took the evening mark off: it stays off.
    const both = r.body.item.doses;
    const off = await maria('PUT', '/api/items/med-rose', { ...base, doses: [morning], _seen: both.map(markId) });
    assert.deepEqual(off.body.item.doses.map(d => d.slot), ['08:00']);
    // The same dose marked on two phones keeps one mark, the last to arrive.
    assert.deepEqual(mergeMarks({ doses: [morning] }, { doses: [{ ...morning, at: '2026-10-22T13:05:00.000Z', by: 'Grace' }] }, []).doses.map(d => d.by), ['Grace']);
    // An older app that says nothing about what it saw replaces the marks, as before.
    assert.deepEqual(mergeMarks({ doses: [morning] }, { doses: [] }, undefined).doses, []);

    // Vital signs saved on two phones at once: both kept.
    const v1 = { bp: '120/80', at: '2026-10-22T14:00:00.000Z' }, v2 = { pulse: '72', at: '2026-10-22T14:00:05.000Z' };
    await maria('PUT', '/api/settings', { settings: { time: '09:00', daily: true, timeZone: TZ, vitals: v1, vitalsLog: [v1] }, profile: { name: 'Rose' }, seenVitals: [] });
    const s = await rose('PUT', '/api/settings', { settings: { time: '09:00', daily: true, timeZone: TZ, vitals: v2, vitalsLog: [v2] }, profile: { name: 'Rose' }, seenVitals: [] });
    assert.deepEqual(s.body.settings.vitalsLog.map(v => v.at), [v1.at, v2.at]);
    assert.equal(s.body.settings.vitals.at, v2.at);
  } finally { await app.close(); }
});

test('an open app learns within seconds that someone else saved something, and only for its own family', async () => {
  const app = await boot();
  try {
    const rose = await app.family('Grace', 'Rose', 'Lisinopril'), walter = await app.family('Hank', 'Walter', 'Metformin');
    const maria = await app.person('Maria'), ann = await app.person('Ann');
    await app.join(rose, maria, 'caregiver'); await app.join(walter, maria, 'caregiver'); await app.join(rose, ann, 'viewer');
    ann.patient = rose.id; maria.patient = rose.id;
    const before = (await ann('GET', '/api/changes')).body;
    assert.equal(before.updatedAt, (await ann('GET', '/api/data')).body.data.updatedAt);
    const walterBefore = (await walter('GET', '/api/changes')).body.updatedAt;
    await new Promise(r => setTimeout(r, 5));
    const item = (await maria('GET', '/api/items')).body.items.find(i => i.id === 'med-rose');
    await maria('PUT', '/api/items/med-rose', { ...item, doses: [{ at: new Date().toISOString(), day: today, kind: 'taken', slot: '08:00', by: 'Maria' }] });
    const after = (await ann('GET', '/api/changes')).body;
    assert.notEqual(after.updatedAt, before.updatedAt);
    assert.equal(after.space, before.space);
    assert.equal((await ann('GET', '/api/data')).body.data.purchases.find(i => i.id === 'med-rose').doses[0].by, 'Maria');
    assert.equal((await walter('GET', '/api/changes')).body.updatedAt, walterBefore);
  } finally { await app.close(); }
});

test('the end-of-day line counts doses, tasks and incidents for the day', () => {
  const day = '2026-10-22';
  const list = [med('a', 'A', { times: ['08:00', '20:00'], doses: [{ day, slot: '08:00', kind: 'taken' }, { day, slot: '20:00', kind: 'skipped' }] }), med('b', 'B', { asNeeded: true }), med('c', 'C', { demo: true }),
    { id: 't', task: true, name: 'T', date: day, time: '10:00', repeat: 'once', marks: [] }, { id: 'i', incident: true, name: 'Fall', at: day + 'T15:00:00Z' }];
  const s = daySummary(list, day);
  assert.deepEqual(s, { doses: 2, taken: 1, skipped: 1, tasks: 1, done: 0, incidents: 1 });
  assert.equal(endOfDayNotification(s, day, { id: 'x', name: 'Rose' }).body, '1 of 2 doses taken, 1 skipped · 0 of 1 task done · 1 incident. Tap to see the daily care report.');
  assert.equal(endOfDayNotification(daySummary([], day), day).body, 'Nothing was due today. Tap to see the daily care report.');
});
