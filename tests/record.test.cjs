const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), os = require('node:os'), path = require('node:path'), fs = require('node:fs');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { createStorage } = require('../server/storage');
const { createData } = require('../server/data');

/* The doctor record (server/record.js): one private link, opened by scanning the For EMS code, read-only, with no sign-in. */
const PNG = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64');
const ago = days => new Date(Date.now() - days * 864e5).toISOString();

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adltrack-record-'));
  const store = createStore({ file: path.join(dir, 'store.json') });
  await store.init();
  const data = createData({ store, storage: createStorage({ dir: path.join(dir, 'files') }) });
  const server = http.createServer(createApp({ store, data }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => { let cookie = ''; return async (method, url, body) => { const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }); const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0]; const type = res.headers.get('content-type') || ''; return { status: res.status, type, body: /json/.test(type) ? await res.json() : Buffer.from(await res.arrayBuffer()) }; }; };
  return { base, client, close: () => new Promise(r => server.close(r)) };
}

test('the doctor record shows meds, the last 30 days and only the documents marked for the doctor; a new code stops the old one', async () => {
  const { client, close } = await setup();
  try {
    const george = client(), ann = client(), doctor = client();
    assert.equal((await george('POST', '/api/signup', { name: 'George', email: 'george@example.com', password: 'Care-plan-2026' })).status, 201);
    const lab = (await george('POST', '/api/files/document', { data: PNG })).body, card = (await george('POST', '/api/files/document', { data: PNG })).body;
    for (const item of [
      { id: 'm1', med: true, status: 'deciding', name: 'Furosemide 20 mg', instructions: 'Take 1 tablet every morning', times: ['08:00'], pharmacy: { name: 'CVS Pharmacy' }, prescriber: { name: 'Dr. A Patel' }, doses: [{ day: ago(1).slice(0, 10), kind: 'taken', slot: '08:00', at: ago(1) }, { day: ago(2).slice(0, 10), kind: 'skipped', slot: '08:00', at: ago(2) }, { day: ago(40).slice(0, 10), kind: 'taken', slot: '08:00', at: ago(40) }] },
      { id: 's1', symptom: true, name: 'Symptoms', note: 'Short of breath at night', at: ago(3) },
      { id: 's0', symptom: true, name: 'Symptoms', note: 'Old cough', at: ago(45) },
      { id: 'i1', incident: true, kind: 'fall', name: 'Fall', note: 'Slipped by the bed', at: ago(5) },
      { id: 'd1', doc: true, name: 'Blood work', category: 'results', files: [{ url: lab.url, type: 'image/png' }] },
      { id: 'd2', doc: true, name: 'Insurance card', category: 'insurance', files: [{ url: card.url, type: 'image/png' }] }])
      assert.equal((await george('POST', '/api/items', item)).status, 201);
    const settings = { vitalsLog: [{ bp: '128/80', at: ago(2) }, { heart: '72', at: ago(2) }, { temp: '99.1', at: ago(60) }], recordDocs: ['d1'] };
    assert.equal((await george('PUT', '/api/settings', { settings, profile: { name: 'Rose', info: { name: 'Rose Diaz', allergies: ['Penicillin, hives'], code: 'dnr' } } })).status, 200);

    assert.deepEqual((await george('GET', '/api/record')).body, { on: false });
    // Only an admin turns it on; a viewer on the team sees the link but can't change it.
    const add = await george('POST', '/api/team/members', { name: 'Ann', email: 'ann@example.com', role: 'viewer', perms: {} });
    await ann('POST', '/api/signup', { name: 'Ann', email: 'ann@example.com', password: 'Care-plan-2026' });
    await ann('POST', '/api/invite/accept', { consent: true, token: add.body.invite.link.split('#t=')[1] });
    assert.equal((await ann('PUT', '/api/record', {})).status, 403);
    const on = (await george('PUT', '/api/record', {})).body, token = on.link.split('#')[1];
    assert.equal(on.on, true); assert.equal(on.pin, false); assert.match(on.link, /\/record\.html#[A-Za-z0-9_-]{32}$/);
    assert.equal((await ann('GET', '/api/record')).body.link, on.link);

    const r = (await doctor('POST', '/api/record/open', { token })).body.record;
    assert.equal(r.name, 'Rose Diaz'); assert.equal(r.info.code, 'dnr');
    assert.deepEqual(r.meds.map(m => [m.name, m.pharmacy, m.prescriber, m.taken, m.skipped]), [['Furosemide 20 mg', 'CVS Pharmacy', 'Dr. A Patel', 1, 1]]);
    assert.deepEqual(r.vitals.map(v => Object.keys(v).sort().join()), ['at,bp', 'at,heart']);
    assert.deepEqual(r.symptoms.map(s => s.note), ['Short of breath at night']);
    assert.deepEqual(r.incidents.map(i => i.name), ['Fall']);
    assert.deepEqual(r.documents.map(d => d.name), ['Blood work']);
    // A shared document's page opens; a document not marked for the doctor doesn't, nor does any other file.
    const page = await doctor('POST', '/api/record/file', { token, doc: 'd1', page: 0 });
    assert.equal(page.status, 200); assert.equal(page.type, 'image/png');
    assert.equal((await doctor('POST', '/api/record/file', { token, doc: 'd2', page: 0 })).status, 404);
    assert.equal((await doctor('GET', lab.url)).status, 401);
    assert.equal((await george('GET', '/api/record')).body.views.length, 1);

    // A new code with a PIN: the old code stops working, and the new one asks for the PIN.
    assert.equal((await george('PUT', '/api/record', { pin: '12' })).status, 400);
    const again = (await george('PUT', '/api/record', { pin: '4821' })).body, token2 = again.link.split('#')[1];
    assert.equal(again.pin, true); assert.notEqual(token2, token);
    assert.equal((await doctor('POST', '/api/record/open', { token })).status, 404);
    const need = await doctor('POST', '/api/record/open', { token: token2 });
    assert.equal(need.status, 401); assert.equal(need.body.needPin, true);
    assert.equal((await doctor('POST', '/api/record/open', { token: token2, pin: '0000' })).status, 401);
    assert.equal((await doctor('POST', '/api/record/open', { token: token2, pin: '4821' })).status, 200);
    assert.equal((await doctor('POST', '/api/record/file', { token: token2, doc: 'd1', page: 0 })).status, 401);

    // Turned off: the code opens nothing.
    assert.deepEqual((await george('DELETE', '/api/record')).body, { on: false });
    assert.equal((await doctor('POST', '/api/record/open', { token: token2, pin: '4821' })).status, 404);
  } finally { await close(); }
});
