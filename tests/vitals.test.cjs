const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), os = require('node:os'), path = require('node:path'), fs = require('node:fs');
const { createVitalsReader, clean } = require('../server/vitals');
const { createStore } = require('../server/store');
const { createData } = require('../server/data');
const { createStorage } = require('../server/storage');
const { createApp } = require('../server/app');

/* Vital-sign photos: the numbers on a blood pressure cuff or thermometer fill that vital sign's form (server/vitals.js). */
const mockClient = (answer, calls = []) => ({ beta: { messages: { create: async req => { calls.push(req); return { stop_reason: 'end_turn', usage: { input_tokens: 1500, output_tokens: 60 }, content: [{ type: 'text', text: JSON.stringify(answer) }] }; } } } });
const quiet = { log() {}, error() {} };
const photo = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, 'fixtures', 'receipts', 'target-store.jpg')).toString('base64');
const CUFF = { problem: 'none', systolic: 120, diastolic: 76, pulse: 72, temperature: null, temperature_unit: '' };

test('a cuff gives systolic, diastolic and pulse; a thermometer in °C is turned into °F; odd numbers are left empty', () => {
  assert.deepEqual(clean(CUFF), { sys: '120', dia: '76', pulse: '72', temp: '', problem: '' });
  assert.equal(clean({ temperature: 37, temperature_unit: 'C' }).temp, '98.6');
  assert.equal(clean({ temperature: 99.1, temperature_unit: 'F' }).temp, '99.1');
  assert.deepEqual([clean({ systolic: 120, diastolic: null }).sys, clean({ pulse: 900 }).pulse, clean({ temperature: 300 }).temp], ['', '', '']);
  assert.equal(clean({ problem: 'blurry' }).problem, 'blurry');
});

async function boot(t, vitals) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adl-vitals-'));
  const store = createStore({ databaseUrl: null, file: path.join(dir, 'store.json') });
  await store.init();
  const data = createData({ store, storage: createStorage({ dir: path.join(dir, 'files') }), jobs: { enqueue: async () => {} } });
  const server = http.createServer(createApp({ store, data, vitals })).listen(0);
  t.after(async () => { server.close(); await store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  };
}

test('POST /api/vitals/read reads one photo of the reading', async t => {
  const calls = [];
  const call = await boot(t, createVitalsReader({ client: mockClient(CUFF, calls), log: quiet }));
  assert.equal((await call('POST', '/api/vitals/read', { photo })).status, 401);
  await call('POST', '/api/signup', { name: 'Ana', email: 'ana@example.com', password: 'correct horse' });
  assert.equal((await call('POST', '/api/vitals/read', { photo: 'nope' })).status, 400);
  const r = await call('POST', '/api/vitals/read', { photo });
  assert.equal(r.status, 200);
  assert.equal(calls[0].messages[0].content.filter(c => c.type === 'image').length, 1);
  assert.deepEqual(r.json.reading, { sys: '120', dia: '76', pulse: '72', temp: '', problem: '' });
});

test('without a reader the vitals endpoint says so', async t => {
  const call = await boot(t, null);
  await call('POST', '/api/signup', { name: 'Ana', email: 'ana@example.com', password: 'correct horse' });
  const r = await call('POST', '/api/vitals/read', { photo });
  assert.deepEqual(r.json, { reading: null, reason: 'unavailable' });
});
