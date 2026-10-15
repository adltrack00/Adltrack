const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), os = require('node:os'), path = require('node:path'), fs = require('node:fs');
const { createLabelReader, clean, compare, SCHEMA, MAX_PHOTOS } = require('../server/label');
const { createStore } = require('../server/store');
const { createData } = require('../server/data');
const { createStorage } = require('../server/storage');
const { createApp } = require('../server/app');

// A made-up pharmacy label for a fictional patient, as the model would answer it.
const LABEL = {
  problem: 'none', name: 'LISINOPRIL', strength: '10 MG', form: 'TABLET',
  directions: 'Take 1 tablet by mouth every day', pill_description: 'This is a PINK, ROUND tablet imprinted with L 10.',
  pharmacy: { name: 'Main Street Pharmacy', address: '12 Main St, Springfield', phone: '555-300-1200' },
  prescriber: 'M. Patel', quantity: 30, refills: 2, refill_by: '2027-01-15', filled: '2026-10-13', discard_after: '2027-10-13',
  warnings: ['May cause dizziness.', 'RX: 339806 Do not share this medication.']
};
const mockClient = (answer, calls = []) => ({ beta: { messages: { create: async req => { calls.push(req); return { stop_reason: 'end_turn', usage: { input_tokens: 3000, output_tokens: 400 }, content: [{ type: 'text', text: JSON.stringify(answer) }] }; } } } });
const quiet = { log() {}, error() {} };
const photo = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, 'fixtures', 'receipts', 'target-store.jpg')).toString('base64');
const papers = { name: 'Lisinopril 10 mg', instructions: 'Take 1 tablet by mouth once a day.' };

test('a label is read as printed, with refills, dates and the pill description; Rx numbers never reach the card', () => {
  const l = clean(LABEL);
  assert.equal(l.directions, 'Take 1 tablet by mouth every day');
  assert.equal(l.quantity, 30);
  assert.equal(l.refills, 2);
  assert.equal(l.refillBy, '2027-01-15');
  assert.match(l.pillLooks, /PINK, ROUND/);
  assert.ok(!JSON.stringify(l).includes('339806'));
  assert.equal(l.note, '');
  assert.match(clean({ problem: 'blurry' }).note, /too blurry/);
  assert.match(clean({ ...LABEL, directions: '' }).note, /couldn’t read the directions/);
});

test('papers and bottle that say the same thing in different words match', () => {
  const rows = compare(papers, clean(LABEL));
  assert.deepEqual(rows.map(r => [r.field, r.match]), [['Medication', true], ['Strength', true], ['Directions', true]]);
});

test('a different strength, amount or frequency is flagged; anything unclear is left for the family to check', () => {
  assert.equal(compare(papers, clean({ ...LABEL, strength: '20 MG' }))[1].match, false);
  assert.equal(compare(papers, clean({ ...LABEL, directions: 'Take 2 tablets by mouth every day' }))[2].match, false);
  assert.equal(compare(papers, clean({ ...LABEL, directions: 'Take 1 tablet by mouth twice a day' }))[2].match, false);
  assert.equal(compare({ ...papers, instructions: 'Take 1 tablet every 6 hours as needed' }, clean(LABEL))[2].match, false);
  assert.equal(compare(papers, clean({ ...LABEL, name: 'METOPROLOL' }))[0].match, false);
  assert.equal(compare(papers, clean({ ...LABEL, directions: 'Use as directed' }))[2].match, null);
  assert.equal(compare({ name: 'Lisinopril', instructions: '' }, clean(LABEL))[1].match, null);
  assert.equal(compare({ ...papers, instructions: 'Take 1 tablet twice a day' }, clean({ ...LABEL, directions: 'Take 1 tablet every 12 hours' }))[2].match, true);
});

test('the schema asks for every field, and never for the patient', () => {
  assert.deepEqual(SCHEMA.required, Object.keys(SCHEMA.properties));
  assert.ok(!Object.keys(SCHEMA.properties).some(k => /patient|address|rx/i.test(k)));
});

async function boot(t, labels) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adltrack-label-'));
  const store = createStore({ databaseUrl: null, file: path.join(dir, 'store.json') });
  await store.init();
  const data = createData({ store, storage: createStorage({ dir: path.join(dir, 'files') }), jobs: { enqueue: async () => {} } });
  const server = http.createServer(createApp({ store, data, labels })).listen(0);
  t.after(async () => { server.close(); await store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  };
}

test('POST /api/label/read reads up to 3 photos as one label and checks it against the papers', async t => {
  const calls = [];
  const call = await boot(t, createLabelReader({ client: mockClient(LABEL, calls), log: quiet }));
  assert.equal((await call('POST', '/api/label/read', { photos: [photo] })).status, 401);
  await call('POST', '/api/signup', { name: 'Ana', email: 'ana@example.com', password: 'correct horse' });
  assert.equal((await call('POST', '/api/label/read', { photos: Array(MAX_PHOTOS + 1).fill(photo) })).status, 400);
  const r = await call('POST', '/api/label/read', { photos: [photo, photo, photo], med: papers });
  assert.equal(r.status, 200);
  assert.equal(calls[0].messages[0].content.filter(c => c.type === 'image').length, 3);
  assert.equal(r.json.label.refills, 2);
  assert.ok(r.json.check.every(row => row.match === true));
  const bottlesOnly = await call('POST', '/api/label/read', { photos: [photo] });
  assert.deepEqual(bottlesOnly.json.check, [], 'with no papers there is nothing to compare');
});

test('without a reader the label endpoint says so', async t => {
  const call = await boot(t, null);
  await call('POST', '/api/signup', { name: 'Ana', email: 'ana@example.com', password: 'correct horse' });
  const r = await call('POST', '/api/label/read', { photos: [photo] });
  assert.equal(r.json.label, null);
  assert.equal(r.json.reason, 'unavailable');
});
