const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), os = require('node:os'), path = require('node:path'), fs = require('node:fs');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { createStorage } = require('../server/storage');
const { createData } = require('../server/data');
const { ageOn, infoLines, infoMeds, emsText } = require('../info.js');

/* Patient information (info.js): the page opened by the patient's photo, and its EMS sheet and code. */
const ROSE = { name: 'Rose Diaz', dob: '1944-03-03', code: 'dnr', directive: 'POLST on the fridge', allergies: ['Penicillin, hives'], conditions: ['Heart failure', 'Type 2 diabetes'], mobility: 'walker', contacts: ['Ana Diaz, daughter, (555) 201-3344'] };

test('the age is whole years on that day, and nothing for a date that is not real or not yet', () => {
  assert.equal(ageOn('1944-03-03', '2026-03-02'), 81);
  assert.equal(ageOn('1944-03-03', '2026-03-03'), 82);
  assert.equal(ageOn('2030-01-01', '2026-10-23'), '');
  assert.equal(ageOn('', '2026-10-23'), '');
  assert.deepEqual(infoLines(' Penicillin \n\n Latex '), ['Penicillin', 'Latex']);
});

test('the EMS sheet leads with code status and allergies, and lists the medications still being taken', () => {
  const meds = infoMeds([
    { med: true, status: 'deciding', name: 'Furosemide 20 mg', instructions: 'Take 1 tablet every morning', times: ['08:00'] },
    { med: true, status: 'kept', name: 'Metformin 500 mg', times: ['18:00', '08:00'] },
    { med: true, status: 'received', name: 'Amoxicillin 500 mg' },
    { med: true, demo: true, status: 'deciding', name: 'Example med' },
    { task: true, name: 'Change the dressing' }]);
  assert.deepEqual(meds.map(m => [m.name, m.times, m.unconfirmed]), [['Furosemide 20 mg', ['08:00'], false], ['Metformin 500 mg', ['08:00', '18:00'], true]]);
  const text = emsText(ROSE, meds, { day: '2026-10-23' }), lines = text.split('\n');
  assert.equal(lines[1], 'Name: Rose Diaz');
  assert.equal(lines[2], 'Born: March 3, 1944, age 82');
  assert.ok(lines.indexOf('CODE STATUS: DNR (do not resuscitate)') < lines.indexOf('ALLERGIES: Penicillin, hives'));
  assert.match(text, /Papers kept: POLST on the fridge/);
  assert.match(text, /- Furosemide 20 mg, Take 1 tablet every morning at 08:00\n- Metformin 500 mg at 08:00, 18:00 \(not confirmed yet\)/);
  assert.match(text, /Walking: Uses a walker/);
  assert.match(text, /Emergency contacts: Ana Diaz, daughter, \(555\) 201-3344/);
  assert.doesNotMatch(text, /Amoxicillin|Example med|dressing/);
  // Nothing filled in yet still says so for the two things EMS asks first.
  assert.match(emsText({}, [], { name: 'Rose' }), /Name: Rose\nCODE STATUS: Not added\nALLERGIES: Not added/);
});

test('everyone on the care team sees the patient information; a family viewer cannot change it, an admin can', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adltrack-info-'));
  const store = createStore({ file: path.join(dir, 'store.json') });
  await store.init();
  const data = createData({ store, storage: createStorage({ dir: path.join(dir, 'files') }) });
  const server = http.createServer(createApp({ store, data }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => { let cookie = ''; return async (method, url, body) => { const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }); const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0]; return { status: res.status, body: await res.json().catch(() => null) }; }; };
  try {
    const george = client(), ann = client();
    assert.equal((await george('POST', '/api/signup', { name: 'George', email: 'george@example.com', password: 'password123' })).status, 201);
    assert.equal((await george('PUT', '/api/settings', { settings: {}, profile: { name: 'Rose', info: ROSE } })).status, 200);
    const add = await george('POST', '/api/team/members', { name: 'Ann', email: 'ann@example.com', role: 'viewer', perms: {} });
    assert.equal((await ann('POST', '/api/signup', { name: 'Ann', email: 'ann@example.com', password: 'password123' })).status, 201);
    assert.equal((await ann('POST', '/api/invite/accept', { token: add.body.invite.link.split('#t=')[1] })).status, 200);
    assert.deepEqual((await ann('GET', '/api/data')).body.data.profile.info, ROSE);
    assert.equal((await ann('PUT', '/api/settings', { settings: {}, profile: { name: 'Rose', info: { ...ROSE, code: 'full' } } })).status, 403);
    assert.equal((await george('GET', '/api/data')).body.data.profile.info.code, 'dnr');
    assert.equal((await george('PUT', '/api/settings', { settings: {}, profile: { name: 'Rose', info: { ...ROSE, allergies: [] } } })).status, 200);
    assert.deepEqual((await ann('GET', '/api/data')).body.data.profile.info.allergies, []);
  } finally { await new Promise(r => server.close(r)); }
});
