const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), os = require('node:os'), path = require('node:path'), fs = require('node:fs');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { createStorage } = require('../server/storage');
const { createData } = require('../server/data');
const { createPermissions } = require('../server/permissions');

const png = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]).toString('base64');
const MED = { id: 'med-1', name: 'Lisinopril 10 mg', med: true, status: 'deciding', instructions: 'Take 1 tablet by mouth every morning.', times: ['08:00'], pharmacy: { name: 'Main St Pharmacy', phone: '555-0100' }, doses: [] };
const day = new Date().toISOString().slice(0, 10);
const dose = (slot = '08:00') => ({ at: new Date().toISOString(), day, kind: 'taken', slot, by: 'Maria' });

/* George's care team: Maria, a caregiver without the medications tick; Ann, a family viewer; Lee, an admin without My Tasks. */
async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adltrack-perms-'));
  const store = createStore({ file: path.join(dir, 'store.json') });
  await store.init();
  const data = createData({ store, storage: createStorage({ dir: path.join(dir, 'files') }) });
  const server = http.createServer(createApp({ store, data }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (method, url, body) => {
      const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      return { status: res.status, body: await res.json().catch(() => null) };
    };
  };
  const signUp = async (name, address) => { const c = client(); assert.equal((await c('POST', '/api/signup', { name, email: address, password: 'password123' })).status, 201); return c; };
  const george = await signUp('George', 'george@example.com');
  assert.equal((await george('POST', '/api/items', MED)).status, 201);
  assert.equal((await george('PUT', '/api/settings', { settings: { quietStart: '22:00' }, profile: { name: 'Dad' } })).status, 200);
  const join = async (name, address, role, perms = {}) => {
    const add = await george('POST', '/api/team/members', { name, email: address, role, perms });
    const c = await signUp(name, address);
    assert.equal((await c('POST', '/api/invite/accept', { token: add.body.invite.link.split('#t=')[1] })).status, 200);
    return c;
  };
  return {
    george,
    maria: await join('Maria', 'maria@example.com', 'caregiver'),
    ann: await join('Ann', 'ann@example.com', 'viewer'),
    lee: await join('Lee', 'lee@example.com', 'admin'),
    med: async () => (await george('GET', '/api/items')).body.items.find(i => i.id === 'med-1'),
    close: () => new Promise(r => server.close(r))
  };
}

test('a family viewer sees everything but can change nothing, even by calling the API directly', async () => {
  const app = await boot();
  try {
    const { ann, george } = app;
    const before = await george('GET', '/api/data');
    // Sees the same plan.
    assert.equal((await ann('GET', '/api/items')).body.items[0].name, 'Lisinopril 10 mg');
    assert.equal((await ann('GET', '/api/data')).body.data.profile.name, 'Dad');
    const { patient, patients, ...team } = (await ann('GET', '/api/me')).body.team;
    assert.deepEqual(team, { role: 'viewer', perms: { tasks: false, addTasks: false, meds: false }, owner: false });

    const refused = [
      ['PUT', '/api/items/med-1', { ...MED, doses: [dose()] }],
      ['PUT', '/api/items/med-1', { ...MED, name: 'Something else' }],
      ['PUT', '/api/items/med-1', MED],
      ['POST', '/api/items', { id: 'med-2', name: 'Aspirin', med: true }],
      ['DELETE', '/api/items/med-1', {}],
      ['PUT', '/api/items/med-1/label', { data: png }],
      ['PUT', '/api/settings', { settings: { quietStart: '21:00' }, profile: { name: 'Dad' } }],
      ['PUT', '/api/settings', { settings: { quietStart: '22:00', vitals: { bp: '120/80' } }, profile: { name: 'Dad' } }],
      ['PUT', '/api/data', { purchases: [], settings: {}, profile: {} }],
      ['POST', '/api/files/proof', { data: png }],
      ['POST', '/api/discharge/read', { purchaseId: 'p1', pages: [png] }],
      ['POST', '/api/label/read', { photos: [png] }],
      ['POST', '/api/reminders/dose', { action: 'taken', itemId: 'med-1', slot: '08:00' }],
      ['PUT', `/api/purchases/${MED.id}/receipt`, { data: png }]
    ];
    for (const [method, url, body] of refused) {
      const r = await ann(method, url, body);
      assert.equal(r.status, 403, `${method} ${url}`);
      assert.equal(r.body.error, 'You can’t change this.');
    }
    const after = await george('GET', '/api/data');
    assert.deepEqual(after.body.data, before.body.data);

    // Their own things still work: alerts on this phone, and email preferences.
    assert.equal((await ann('PUT', '/api/email/prefs', { daily: false })).status, 200);
  } finally { await app.close(); }
});

test('a caregiver without the medications tick does the tasks but can’t change a medication', async () => {
  const app = await boot();
  try {
    const { maria } = app;
    // Marks a dose with a photo, the refill steps and Finished, and saves vital signs.
    const photo = await maria('POST', '/api/files/proof', { data: png });
    assert.equal(photo.status, 201);
    const taken = await maria('PUT', '/api/items/med-1', { ...MED, doses: [{ ...dose(), photos: [photo.body.url] }] });
    assert.equal(taken.status, 200);
    assert.equal((await app.med()).doses[0].by, 'Maria');
    assert.equal((await maria('PUT', '/api/items/med-1', { ...(await app.med()), refill: { step: 'call', since: day }, log: [{ at: day, kind: 'refill-needed', by: 'Maria' }] })).status, 200);
    assert.equal((await maria('PUT', '/api/items/med-1', { ...(await app.med()), status: 'received', returnedOn: day, finishedAt: new Date().toISOString(), finishedBy: 'Maria' })).status, 200);
    assert.equal((await maria('PUT', '/api/items/med-1', { ...(await app.med()), status: 'deciding' })).status, 200);
    assert.equal((await maria('PUT', '/api/settings', { settings: { quietStart: '22:00', vitals: { bp: '120/80', at: day } }, profile: { name: 'Dad' } })).status, 200);

    // Can't change the medication itself, add or remove one, scan papers, or change the plan's settings.
    const med = await app.med();
    const refused = [
      ['PUT', '/api/items/med-1', { ...med, name: 'Lisinopril 20 mg' }],
      ['PUT', '/api/items/med-1', { ...med, instructions: 'Take 2 tablets.' }],
      ['PUT', '/api/items/med-1', { ...med, times: ['09:00'] }],
      ['PUT', '/api/items/med-1', { ...med, pharmacy: { name: 'Other Pharmacy' } }],
      ['PUT', '/api/items/med-1', { ...med, photo: png }],
      ['PUT', '/api/items/med-1', { ...med, status: 'kept' }],
      ['POST', '/api/items', { id: 'med-2', name: 'Aspirin', med: true }],
      ['PUT', '/api/items/med-2', { id: 'med-2', name: 'Aspirin', med: true }],
      ['DELETE', '/api/items/med-1', {}],
      ['PUT', '/api/items/med-1/label', { data: png }],
      ['POST', '/api/discharge/read', { purchaseId: 'p1', pages: [png] }],
      ['POST', '/api/label/read', { photos: [png] }],
      ['PUT', '/api/settings', { settings: { ...(await app.george('GET', '/api/data')).body.data.settings, quietStart: '20:00' }, profile: { name: 'Dad' } }],
      ['PUT', '/api/settings', { settings: (await app.george('GET', '/api/data')).body.data.settings, profile: { name: 'Mom' } }],
      ['PUT', '/api/data', { purchases: [], settings: {}, profile: {} }]
    ];
    for (const [method, url, body] of refused) {
      const r = await maria(method, url, body);
      assert.equal(r.status, 403, `${method} ${url} ${JSON.stringify(body).slice(0, 60)}`);
    }
    assert.equal((await maria('PUT', '/api/items/med-1', { ...med, name: 'x' })).body.error, 'Ask an admin to let you scan papers and change medications.');
    const after = await app.med();
    assert.equal(after.name, 'Lisinopril 10 mg');
    assert.deepEqual(after.times, ['08:00']);
    assert.equal((await app.george('GET', '/api/items')).body.items.length, 1);
  } finally { await app.close(); }
});

test('the medications tick lets a caregiver change medications, and an admin without My Tasks can’t mark doses', async () => {
  const app = await boot();
  try {
    const { george, maria, lee } = app;
    const members = (await george('GET', '/api/team')).body.members;
    await george('PUT', `/api/team/members/${members.find(m => m.name === 'Maria').id}`, { role: 'caregiver', perms: { meds: true } });
    assert.equal((await maria('PUT', '/api/items/med-1', { ...(await app.med()), name: 'Lisinopril 20 mg' })).status, 200);
    assert.equal((await maria('POST', '/api/items', { id: 'med-2', name: 'Aspirin', med: true })).status, 201);
    assert.equal((await maria('DELETE', '/api/items/med-2', {})).status, 200);

    // Lee is an admin without My Tasks: changes the plan, but doesn't mark doses.
    assert.equal((await lee('PUT', '/api/items/med-1', { ...(await app.med()), instructions: 'Take 1 tablet every morning with food.' })).status, 200);
    const r = await lee('PUT', '/api/items/med-1', { ...(await app.med()), doses: [dose()] });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'Only people with My Tasks can mark doses and tasks. Ask an admin to add it.');
    assert.equal((await lee('POST', '/api/files/proof', { data: png })).status, 403);
    // Moving a dose time takes today's marked dose with it.
    assert.equal((await maria('PUT', '/api/items/med-1', { ...(await app.med()), doses: [dose()] })).status, 200);
    const moved = await app.med();
    assert.equal((await lee('PUT', '/api/items/med-1', { ...moved, times: ['09:00'], doses: moved.doses.map(d => ({ ...d, slot: '09:00' })) })).status, 200);
    // Once ticked, Lee does the tasks too.
    await george('PUT', `/api/team/members/${members.find(m => m.name === 'Lee').id}`, { role: 'admin', perms: { tasks: true } });
    assert.equal((await lee('PUT', '/api/items/med-1', { ...(await app.med()), doses: [] })).status, 200);
    // Their app learns who changed it, for the note it shows.
    const { patient: _p, patients: _ps, ...leeTeam } = (await lee('GET', '/api/me')).body.team;
    assert.deepEqual(leeTeam, { role: 'admin', perms: { tasks: true, addTasks: true, meds: true }, owner: false, changedBy: 'George' });
  } finally { await app.close(); }
});

test('a saved item compares equal to itself however its keys come back ordered', () => {
  const may = createPermissions({ role: 'caregiver', perms: { tasks: true, meds: false } });
  const before = { id: 'a', name: 'X', pharmacy: { name: 'P', phone: '1' }, doses: [], extra: null };
  assert.doesNotThrow(() => may.item(before, { name: 'X', pharmacy: { phone: '1', name: 'P' }, doses: [], id: 'a' }));
  assert.doesNotThrow(() => may.item(before, { ...before, doses: [{ kind: 'taken' }] }));
  assert.throws(() => may.item(before, { ...before, pharmacy: { name: 'Q', phone: '1' } }), { status: 403 });
  assert.throws(() => may.item(null, before), { status: 403 });
});
