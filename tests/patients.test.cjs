const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), os = require('node:os'), path = require('node:path'), fs = require('node:fs');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { createStorage } = require('../server/storage');
const { createData } = require('../server/data');

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adltrack-families-'));
  const store = createStore({ file: path.join(dir, 'store.json') });
  await store.init();
  const data = createData({ store, storage: createStorage({ dir: path.join(dir, 'files') }) });
  const server = http.createServer(createApp({ store, data }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  // Each client is one browser: its cookie, and the family it picked (sent as X-Patient, as the app does).
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
  const signUp = async (name, address) => { const c = client(); assert.equal((await c('POST', '/api/signup', { name, email: address, password: 'Care-plan-2026' })).status, 201); return c; };
  /* A family: its admin, the patient's name (and photo) on the plan's profile, and one medication. */
  const family = async (admin, address, patient, med, photo) => {
    const c = await signUp(admin, address);
    await c('PUT', '/api/settings', { settings: {}, profile: { name: patient, ...(photo ? { photo } : {}) } });
    await c('POST', '/api/items', { id: 'med-' + patient.toLowerCase(), name: med, med: true });
    c.id = (await c('GET', '/api/me')).body.team.patient;
    return c;
  };
  const invite = async (admin, name, address, role, perms = {}) => (await admin('POST', '/api/team/members', { name, email: address, role, perms })).body.invite.link.split('#t=')[1];
  return { client, signUp, family, invite, close: () => new Promise(r => server.close(r)) };
}

test('a caregiver signed up by three families switches between them and sees only those families', async () => {
  const app = await boot();
  try {
    const rose = await app.family('Grace', 'grace@example.com', 'Rose', 'Lisinopril', PHOTO);
    const walter = await app.family('Hank', 'hank@example.com', 'Walter', 'Metformin');
    const june = await app.family('Ivy', 'ivy@example.com', 'June', 'Warfarin');
    const other = await app.family('Kim', 'kim@example.com', 'Al', 'Aspirin');
    const maria = await app.signUp('Maria', 'maria@example.com');
    // Each family's admin signs her up, with their own ticks: only June's family lets her change medications.
    for (const [fam, perms] of [[rose, {}], [walter, {}], [june, { meds: true }]]) {
      const r = await maria('POST', '/api/invite/accept', { consent: true, token: await app.invite(fam, 'Maria', 'maria@example.com', 'caregiver', perms) });
      assert.equal(r.status, 200);
      assert.equal(r.body.patient, fam.id);
    }
    const me = (await maria('GET', '/api/me')).body.team;
    assert.deepEqual(me.patients.map(p => [p.name, p.by]), [['Rose', 'Grace'], ['Walter', 'Hank'], ['June', 'Ivy']]);
    assert.match(me.patients[0].photo, /^\/api\/files\//);

    // Each pick shows that family's own medications, report and settings, with that family's permissions.
    const seen = [];
    for (const fam of [rose, walter, june]) {
      maria.patient = fam.id;
      const d = (await maria('GET', '/api/data')).body;
      seen.push([d.data.profile.name, d.data.purchases.map(i => i.name).join(), (await maria('GET', '/api/me')).body.team.perms.meds]);
    }
    assert.deepEqual(seen, [['Rose', 'Lisinopril', false], ['Walter', 'Metformin', false], ['June', 'Warfarin', true]]);
    // A dose she marks for Walter reaches Walter's family, and nobody else's.
    maria.patient = walter.id;
    assert.equal((await maria('PUT', '/api/items/med-walter', { name: 'Metformin', med: true, doses: [{ kind: 'taken', by: 'Maria' }] })).status, 200);
    assert.equal((await walter('GET', '/api/items')).body.items[0].doses[0].by, 'Maria');
    assert.equal((await rose('GET', '/api/items')).body.items[0].doses, undefined);
    // Medications: Walter's family didn't allow it, June's did.
    assert.equal((await maria('PUT', '/api/items/med-walter', { name: 'Metformin 1000 mg', med: true })).status, 403);
    maria.patient = june.id;
    assert.equal((await maria('PUT', '/api/items/med-june', { name: 'Warfarin 3 mg', med: true })).status, 200);
    // The patient photo of every family she's on opens, for the picker.
    assert.equal((await maria('GET', me.patients[0].photo)).status, 200);

    // A family that didn't sign her up is out of reach: asking for it gets her first family instead.
    maria.patient = other.id;
    assert.deepEqual((await maria('GET', '/api/items')).body.items.map(i => i.name), ['Lisinopril']);
    // A write lands on her first family, where she can't add a medication, never on Al's.
    assert.equal((await maria('PUT', '/api/items/med-al', { name: 'Aspirin', med: true, doses: [{ kind: 'taken' }] })).status, 403);
    assert.equal((await other('GET', '/api/items')).body.items[0].doses, undefined);
    await other('PUT', '/api/settings', { settings: {}, profile: { name: 'Al', photo: PHOTO } });
    assert.equal((await maria('GET', (await other('GET', '/api/data')).body.data.profile.photo)).status, 404);

    // Each family's People shows only that family's team.
    maria.patient = rose.id;
    assert.deepEqual((await maria('GET', '/api/team')).body.members.map(m => m.name).sort(), ['Grace', 'Maria']);
    maria.patient = walter.id;
    assert.deepEqual((await maria('GET', '/api/team')).body.members.map(m => m.name).sort(), ['Hank', 'Maria']);
  } finally { await app.close(); }
});

test('a family viewer only ever sees their own relative, and a family that removes the caregiver drops off her list', async () => {
  const app = await boot();
  try {
    const rose = await app.family('Grace', 'grace@example.com', 'Rose', 'Lisinopril');
    const june = await app.family('Ivy', 'ivy@example.com', 'June', 'Warfarin');
    const ann = await app.signUp('Ann', 'ann@example.com');
    await ann('POST', '/api/invite/accept', { consent: true, token: await app.invite(june, 'Ann', 'ann@example.com', 'viewer') });
    for (const id of [null, rose.id, june.id]) {
      ann.patient = id;
      assert.deepEqual((await ann('GET', '/api/data')).body.data.purchases.map(i => i.name), ['Warfarin']);
    }
    assert.deepEqual((await ann('GET', '/api/me')).body.team.patients.map(p => p.name), ['June']);

    const maria = await app.signUp('Maria', 'maria@example.com');
    for (const fam of [rose, june]) await maria('POST', '/api/invite/accept', { consent: true, token: await app.invite(fam, 'Maria', 'maria@example.com', 'caregiver') });
    const id = (await rose('GET', '/api/team')).body.members.find(m => m.name === 'Maria').id;
    assert.equal((await rose('DELETE', `/api/team/members/${id}`, {})).status, 200);
    assert.deepEqual((await maria('GET', '/api/me')).body.team.patients.map(p => p.name), ['June']);
    maria.patient = rose.id;
    assert.deepEqual((await maria('GET', '/api/items')).body.items.map(i => i.name), ['Warfarin']);
    // Leaving a family takes her off that one only.
    maria.patient = june.id;
    assert.equal((await maria('POST', '/api/team/leave', {})).status, 200);
    assert.equal((await maria('GET', '/api/data')).body.data, null);
  } finally { await app.close(); }
});
