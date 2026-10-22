const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), os = require('node:os'), path = require('node:path'), fs = require('node:fs');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { createStorage } = require('../server/storage');
const { createData } = require('../server/data');

const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adltrack-patients-'));
  const store = createStore({ file: path.join(dir, 'store.json') });
  await store.init();
  const data = createData({ store, storage: createStorage({ dir: path.join(dir, 'files') }) });
  const server = http.createServer(createApp({ store, data }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  // Each client is one browser: its cookie, and the patient it picked (sent as X-Patient, as the app does).
  const client = () => {
    let cookie = '';
    const call = async (method, url, body) => {
      const headers = { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(call.patient ? { 'X-Patient': call.patient } : {}) };
      const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      return { status: res.status, body: await res.json().catch(() => null), res };
    };
    return call;
  };
  const signUp = async (name, address) => { const c = client(); assert.equal((await c('POST', '/api/signup', { name, email: address, password: 'password123' })).status, 201); return c; };
  const join = async (admin, name, address, role, patients) => {
    const add = await admin('POST', '/api/team/members', { name, email: address, role, patients });
    assert.equal(add.status, 201, JSON.stringify(add.body));
    const c = await signUp(name, address);
    assert.equal((await c('POST', '/api/invite/accept', { token: add.body.invite.link.split('#t=')[1] })).status, 200);
    return c;
  };
  return { client, signUp, join, store, close: () => new Promise(r => server.close(r)) };
}

/* A home with three patients, each with their own medication and dose. */
async function home(app) {
  const admin = await app.signUp('Grace', 'grace@example.com');
  // The plan the home already had is the first patient.
  await admin('PUT', '/api/settings', { settings: {}, profile: { name: 'Rose' } });
  await admin('POST', '/api/items', { id: 'med-rose', name: 'Lisinopril', med: true });
  const ids = [(await admin('GET', '/api/me')).body.team.patient];
  for (const [name, med] of [['Walter', 'Metformin'], ['June', 'Warfarin']]) {
    const r = await admin('POST', '/api/patients', { name, photo: PHOTO });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    ids.push(r.body.patient.id);
    admin.patient = r.body.patient.id;
    assert.equal((await admin('POST', '/api/items', { id: 'med-' + name.toLowerCase(), name: med, med: true })).status, 201);
    admin.patient = null;
  }
  return { admin, ids };
}

test('a home with 3 patients shows each one their own medications, report and profile', async () => {
  const app = await boot();
  try {
    const { admin, ids } = await home(app);
    const me = await admin('GET', '/api/me');
    assert.deepEqual(me.body.team.patients.map(p => p.name), ['Rose', 'Walter', 'June']);
    assert.equal(me.body.team.patients[0].first, true);
    assert.match(me.body.team.patients[1].photo, /^\/api\/files\//);

    const names = [];
    for (const id of ids) {
      admin.patient = id;
      const d = (await admin('GET', '/api/data')).body;
      names.push([d.data.profile.name, d.data.purchases.map(i => i.name).join()]);
      // The photo of every patient opens, from any patient, for the picker.
      admin.patient = ids[0];
      if (id !== ids[0]) assert.equal((await admin('GET', me.body.team.patients[ids.indexOf(id)].photo)).status, 200);
    }
    assert.deepEqual(names, [['Rose', 'Lisinopril'], ['Walter', 'Metformin'], ['June', 'Warfarin']]);
    // Each patient is its own space, so the app swaps its copy when the patient changes.
    admin.patient = ids[1];
    const s1 = (await admin('GET', '/api/data')).body.space;
    admin.patient = ids[2];
    assert.notEqual((await admin('GET', '/api/data')).body.space, s1);

    // A dose marked for June stays June's.
    await admin('PUT', '/api/items/med-june', { name: 'Warfarin', med: true, doses: [{ kind: 'taken', by: 'Grace' }] });
    admin.patient = ids[1];
    assert.equal((await admin('GET', '/api/items')).body.items[0].doses, undefined);
  } finally { await app.close(); }
});

test('a caregiver on two patients switches between them and can’t reach the third', async () => {
  const app = await boot();
  try {
    const { admin, ids } = await home(app);
    const maria = await app.join(admin, 'Maria', 'maria@example.com', 'caregiver', [ids[1], ids[2]]);
    const me = (await maria('GET', '/api/me')).body.team;
    assert.deepEqual(me.patients.map(p => p.name), ['Walter', 'June']);
    // Nothing chosen yet: the first of hers.
    assert.equal(me.patient, ids[1]);

    maria.patient = ids[2];
    assert.deepEqual((await maria('GET', '/api/items')).body.items.map(i => i.name), ['Warfarin']);
    assert.equal((await maria('PUT', '/api/items/med-june', { name: 'Warfarin', med: true, doses: [{ kind: 'taken', by: 'Maria' }] })).status, 200);
    maria.patient = ids[1];
    assert.deepEqual((await maria('GET', '/api/items')).body.items.map(i => i.name), ['Metformin']);

    // Asking for Rose, who she isn't on, gets her own first patient instead, never Rose's data.
    maria.patient = ids[0];
    assert.deepEqual((await maria('GET', '/api/items')).body.items.map(i => i.name), ['Metformin']);
    assert.equal((await maria('PUT', '/api/items/med-rose', { name: 'Lisinopril', med: true, doses: [{ kind: 'taken' }] })).status, 403);
    admin.patient = ids[0];
    assert.equal((await admin('GET', '/api/items')).body.items[0].doses, undefined);
    // Nor Rose's photos.
    await admin('PUT', '/api/settings', { settings: {}, profile: { name: 'Rose', photo: PHOTO } });
    const rosePhoto = (await admin('GET', '/api/data')).body.data.profile.photo;
    assert.equal((await maria('GET', rosePhoto)).status, 404);
    // Caregivers don't manage patients.
    assert.equal((await maria('POST', '/api/patients', { name: 'Al' })).status, 403);
  } finally { await app.close(); }
});

test('a family viewer only ever sees their own relative', async () => {
  const app = await boot();
  try {
    const { admin, ids } = await home(app);
    await app.join(admin, 'Maria', 'maria@example.com', 'caregiver', [ids[1], ids[2]]);
    const ann = await app.join(admin, 'Ann', 'ann@example.com', 'viewer', [ids[2]]);
    const me = (await ann('GET', '/api/me')).body.team;
    assert.deepEqual(me.patients.map(p => p.name), ['June']);
    for (const id of [null, ...ids]) {
      ann.patient = id;
      assert.deepEqual((await ann('GET', '/api/data')).body.data.purchases.map(i => i.name), ['Warfarin']);
    }
    // The team list shows the admins and the people on June, not other families.
    const bob = await app.join(admin, 'Bob', 'bob@example.com', 'viewer', [ids[1]]);
    const seen = (await ann('GET', '/api/team')).body;
    assert.deepEqual(seen.members.map(m => m.name).sort(), ['Ann', 'Grace', 'Maria']);
    assert.deepEqual(seen.patients.map(p => p.name), ['June']);
    assert.deepEqual((await bob('GET', '/api/team')).body.members.map(m => m.name).sort(), ['Bob', 'Grace', 'Maria']);
  } finally { await app.close(); }
});

test('admins choose who each person is on, rename and remove patients, and the first patient stays', async () => {
  const app = await boot();
  try {
    const { admin, ids } = await home(app);
    // With several patients, a caregiver or viewer must be on at least one.
    assert.equal((await admin('POST', '/api/team/members', { name: 'Lee', email: 'lee@example.com', role: 'viewer' })).status, 400);
    assert.equal((await admin('POST', '/api/team/members', { name: 'Lee', email: 'lee@example.com', role: 'viewer', patients: ['00000000-0000-4000-8000-000000000000'] })).status, 400);
    const lee = await app.join(admin, 'Lee', 'lee@example.com', 'viewer', [ids[1]]);
    const member = (await admin('GET', '/api/team')).body.members.find(m => m.name === 'Lee');
    assert.deepEqual(member.patients, [ids[1]]);
    assert.equal((await admin('PUT', `/api/team/members/${member.id}`, { patients: [ids[1], ids[2]] })).status, 200);
    assert.deepEqual((await lee('GET', '/api/me')).body.team.patients.map(p => p.name), ['Walter', 'June']);

    // Renamed: the new name is the patient's profile, so Home shows it.
    assert.equal((await admin('PUT', `/api/patients/${ids[1]}`, { name: 'Walt', photo: null })).status, 200);
    lee.patient = ids[1];
    assert.equal((await lee('GET', '/api/data')).body.data.profile.name, 'Walt');
    assert.equal((await lee('GET', '/api/data')).body.data.profile.photo, undefined);

    // Removing June takes her off Lee's list; removing Walt too would leave Lee on nobody, so it's refused.
    assert.equal((await admin('DELETE', `/api/patients/${ids[2]}`, {})).status, 200);
    assert.deepEqual((await lee('GET', '/api/me')).body.team.patients.map(p => p.name), ['Walt']);
    const refused = await admin('DELETE', `/api/patients/${ids[1]}`, {});
    assert.equal(refused.status, 409);
    assert.match(refused.body.error, /Lee is only on Walt/);
    assert.equal((await admin('DELETE', `/api/patients/${ids[0]}`, {})).status, 400);
    assert.equal(await app.store.findUserById(ids[2]), null);

    // Up to 10 patients.
    for (let n = 2; n < 10; n++) assert.equal((await admin('POST', '/api/patients', { name: 'P' + n })).status, 201);
    assert.equal((await admin('POST', '/api/patients', { name: 'Eleven' })).status, 400);
    // Nobody can sign in as a patient.
    const holder = await app.store.findUserById(ids[1]);
    assert.equal((await app.client()('POST', '/api/login', { email: holder.email, password: 'patient' })).status, 401);
  } finally { await app.close(); }
});

test('deleting the account that set up the home deletes its patients too', async () => {
  const app = await boot();
  try {
    const { admin, ids } = await home(app);
    assert.equal((await admin('DELETE', '/api/account', { password: 'password123' })).status, 200);
    for (const id of ids) assert.equal(await app.store.findUserById(id), null);
  } finally { await app.close(); }
});
