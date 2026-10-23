const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), os = require('node:os'), path = require('node:path'), fs = require('node:fs');
const { loadPolicies } = require('../server/policies');
const { buildGuide, checklist, needsLine, placeQueries, returnUrl } = require('../server/guide');
const { createPlaces, miles } = require('../server/places');
const { createStore } = require('../server/store');
const { createStorage } = require('../server/storage');
const { createData } = require('../server/data');
const { createJobs, defineJobs } = require('../server/jobs');
const { createApp } = require('../server/app');

const policies = loadPolicies();
const LAUNCH = ['amazon', 'walmart', 'target', 'costco', 'bestbuy', 'homedepot', 'apple', 'nike', 'zara', 'shein', 'fashionnova'];
const keys = list => list.map(c => c.key);

test('every launch retailer gets a guide built only from its policy', () => {
  for (const id of LAUNCH) {
    const policy = policies.get(id), g = buildGuide(policy, { channel: 'online' });
    assert.ok(policy, id);
    assert.equal(g.store, policy.name);
    assert.equal(g.url, policy.item.url.value, `${id}: the return link is the policy's own`);
    assert.equal(g.methods.length, policy.methods.length, `${id}: one entry per way, in the policy's order (easiest first)`);
    g.methods.forEach((m, n) => {
      const src = policy.methods[n];
      assert.equal(m.index, n);
      assert.equal(m.label, src.label);
      assert.deepEqual(m.steps, src.steps, `${id}: steps are the policy's, word for word`);
      assert.ok(m.steps.length >= 1);
      assert.equal(m.source, src.source); assert.equal(m.checked, src.checked);
      assert.deepEqual(keys(m.checklist).filter(k => !['receipt', 'condition', 'packed', 'label', 'proof'].includes(k)), [], 'only the existing packing keys');
      assert.equal(m.places, placeQueries(policy, src).length > 0);
    });
    if (!policy.methods.length) assert.match(g.empty, new RegExp(`${policy.name}'s return steps aren't in our checked policy yet`));
    else assert.equal(g.empty, '');
  }
});

test('Amazon: QR-code drop-off, no box or label, and no label line on the checklist', () => {
  const g = buildGuide(policies.get('amazon'), { orderNumber: '112-4455667-1234567' });
  const m = g.methods[0];
  assert.equal(m.type, 'dropoff');
  assert.equal(m.steps[0], 'Open Your Orders in your Amazon account and choose Return items');
  assert.equal(m.needs, 'Needs: QR code · No return label, box or printer needed');
  assert.deepEqual(keys(m.checklist), ['receipt', 'condition', 'packed', 'proof']);
  assert.equal(m.checklist.find(c => c.key === 'packed').label, 'Item ready to drop off');
  assert.equal(g.orderNumber, '112-4455667-1234567');
  assert.deepEqual(placeQueries(policies.get('amazon'), policies.get('amazon').methods[0]), ['Whole Foods Market', "Kohl's", 'The UPS Store', 'Staples', 'FedEx Office']);
});

test('several ways: easiest first, each saying what it needs; in-store and mail checklists differ', () => {
  const target = buildGuide(policies.get('target'));
  assert.deepEqual(target.methods.map(m => m.label), ['Drive Up return', 'Return in store', 'Mail it back']);
  assert.equal(target.methods[1].needs, 'No QR code, return label, box, printer or receipt needed');
  assert.equal(target.methods[0].checklist.find(c => c.key === 'label').label, 'Store location and hours checked');
  assert.equal(target.methods[0].checklist.find(c => c.key === 'packed').label, 'Item ready to take to the store');
  assert.equal(target.methods[2].checklist.find(c => c.key === 'label').label, 'Return label and instructions checked');
  assert.equal(target.methods[2].checklist.find(c => c.key === 'packed').label, 'Item securely packed');
  assert.equal(target.methods[2].places, false, 'mail has no checked drop-off network');
  assert.deepEqual(placeQueries(policies.get('target'), policies.get('target').methods[1]), ['Target']);
  assert.deepEqual(placeQueries(policies.get('homedepot'), policies.get('homedepot').methods[0]), ['Home Depot']);
  const apple = buildGuide(policies.get('apple'));
  assert.match(apple.methods[0].needs, /^Needs: receipt · No QR code, return label or printer needed · Not confirmed: box$/);
  assert.equal(apple.receipt, 'Apple needs your receipt.');
  // Zara's drop-off names no partners, so there's nothing to look up.
  assert.equal(buildGuide(policies.get('zara')).methods[1].places, false);
});

test('unconfirmed needs are said as such, never guessed', () => {
  assert.equal(needsLine({ label: 'unknown', box: 'unknown', qr: 'unknown', printer: 'unknown' }), 'Not confirmed: QR code, return label, box, printer');
  const shein = buildGuide(policies.get('shein')).methods[0];
  assert.equal(keys(shein.checklist).includes('label'), true, 'a label that might be needed stays on the checklist');
  assert.equal(buildGuide(policies.get('fashionnova')).methods[0].cost, '$5.99 return label');
});

test('stores without a policy get no guide; stores without steps get the general checklist', () => {
  assert.equal(buildGuide(null), null);
  const g = buildGuide(policies.get('bestbuy'));
  assert.deepEqual(g.methods, []);
  assert.deepEqual(keys(g.checklist), ['receipt', 'condition', 'packed', 'label', 'proof']);
  assert.deepEqual(keys(checklist(null)), ['receipt', 'condition', 'packed', 'label', 'proof']);
});

test('order-specific link only when the policy documents one and the order number looks like one', () => {
  const p = JSON.parse(JSON.stringify(policies.get('amazon')));
  assert.equal(returnUrl(p, '112-1'), p.item.url.value, 'no documented order link: the return page');
  p.item.orderUrl = { value: 'https://www.example.com/orders/{order}/return', source: 'https://www.example.com/help', checked: '2026-10-12' };
  assert.equal(returnUrl(p, '112-4455667-1234567'), 'https://www.example.com/orders/112-4455667-1234567/return');
  assert.equal(returnUrl(p, ''), p.item.url.value);
  assert.equal(returnUrl(p, '../../x?y'), p.item.url.value, 'odd order numbers never go into the link');
});

/* Places: a fake Google Places API. */
function fakePlaces() {
  const calls = [];
  const near = (lat, lng, n) => ({ latitude: lat + n * 0.01, longitude: lng });
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const ok = json => ({ ok: true, status: 200, json: async () => json });
    if (url.endsWith(':searchText')) {
      const b = JSON.parse(init.body), { latitude, longitude } = b.locationBias.circle.center;
      return ok({ places: [
        { id: b.textQuery + '-1', location: near(latitude, longitude, 2), displayName: { text: b.textQuery } },
        { id: b.textQuery + '-2', location: near(latitude, longitude, 1), displayName: { text: b.textQuery + ' Downtown' } },
        { id: 'other', location: near(latitude, longitude, 0), displayName: { text: 'Applebee\'s Grill' } }
      ] });
    }
    const id = decodeURIComponent(url.split('/').pop());
    return ok({ id, displayName: { text: id.replace(/-\d$/, '') }, shortFormattedAddress: '1 Main St', currentOpeningHours: { openNow: true, weekdayDescriptions: ['Monday: 9:00 AM – 9:00 PM'] } });
  };
  return { fetch, calls };
}

async function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'returnly-guide-'));
  const store = createStore({ databaseUrl: null, file: path.join(dir, 'store.json') });
  await store.init();
  return { dir, store };
}

test('nearest drop-offs: closest first, store names only, ids and coordinates cached, details fresh', async () => {
  const { store } = await tempStore();
  const fake = fakePlaces();
  const places = createPlaces({ apiKey: 'test-key', store, fetch: fake.fetch, log: { error() {} } });
  assert.equal(places.available(), true);
  assert.equal(createPlaces({ apiKey: '', store }).available(), false);
  const got = await places.nearest(['Apple'], 40.741, -73.99);
  assert.deepEqual(got.map(p => p.id), ['Apple-2', 'Apple-1'], "closest first; Applebee's isn't Apple");
  assert.equal(got[0].openNow, true);
  assert.equal(got[0].address, '1 Main St');
  assert.ok(got[0].miles > 0 && got[0].miles < 2);
  assert.match(got[0].directions, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=.*&destination_place_id=Apple-2$/);
  const search = fake.calls.find(c => c.url.endsWith(':searchText'));
  assert.equal(search.init.headers['X-Goog-Api-Key'], 'test-key');
  assert.equal(search.init.headers['X-Goog-FieldMask'], 'places.id,places.location,places.displayName');
  // The exact location never leaves the server: the search uses the ~1 km area.
  assert.deepEqual(JSON.parse(search.init.body).locationBias.circle.center, { latitude: 40.74, longitude: -73.99 });

  const cached = await store.getPlaceCache('apple@40.74,-73.99', new Date(0));
  assert.deepEqual(Object.keys(cached[0]).sort(), ['id', 'lat', 'lng', 'query'], 'only ids and coordinates are cached');
  const searches = () => fake.calls.filter(c => c.url.endsWith(':searchText')).length;
  await places.nearest(['Apple'], 40.7412, -73.9898);
  assert.equal(searches(), 1, 'the same area is answered from the cache');
  await places.nearest(['Apple'], 34.05, -118.24);
  assert.equal(searches(), 2, 'another area is searched');
  await assert.rejects(places.nearest(['Apple'], 200, 0), /location/);
  assert.equal(await store.deleteOldPlaceCache(new Date(Date.now() + 1000)), 2);
  assert.ok(Math.abs(miles({ lat: 40.7128, lng: -74.006 }, { lat: 34.0522, lng: -118.2437 }) - 2445) < 10);
});

async function boot({ places = null } = {}) {
  const { dir, store } = await tempStore();
  const storage = createStorage({ dir: path.join(dir, 'files') });
  const jobs = createJobs({ store, log: { error() {} } });
  const data = createData({ store, storage, jobs });
  defineJobs(jobs, { store, storage });
  const server = http.createServer(createApp({ store, data, policies, places }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.startsWith('application/json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };
  assert.equal((await call('POST', '/api/signup', { name: 'Ava', email: 'ava@example.com', password: 'Care-plan-2026' })).status, 201);
  const filesOnDisk = () => { const d = path.join(dir, 'files', 'files'); return fs.existsSync(d) ? fs.readdirSync(d).filter(f => !f.endsWith('.type')) : []; };
  return { call, store, filesOnDisk, close: async () => { await jobs.stop(); await new Promise(r => server.close(r)); await store.close(); } };
}

test('POST /api/policy returns the guide and fills url for known stores', async () => {
  const app = await boot();
  try {
    const r = await app.call('POST', '/api/policy', { item: { name: 'Echo Dot', retailer: 'AMZN Mktp US', purchased: '2026-10-07', channel: 'online', orderNumber: '112-4455667-1234567' }, answers: {}, category: 'general', retailerId: 'amazon' });
    assert.equal(r.status, 200);
    assert.equal(r.body.guide.store, 'Amazon');
    assert.equal(r.body.guide.orderNumber, '112-4455667-1234567');
    assert.equal(r.body.result.fields.url, policies.get('amazon').item.url.value);
    const none = await app.call('POST', '/api/policy', { item: { name: 'Vase', retailer: 'Studio & Co.', purchased: '2026-10-07' } });
    assert.equal(none.body.guide, null);
    assert.equal(none.body.result.fields.url, '');
  } finally { await app.close(); }
});

test('POST /api/places/nearest looks up only what the policy names, and says when it is unavailable', async () => {
  const fake = fakePlaces();
  const app = await boot({ places: createPlaces({ apiKey: 'k', store: null, fetch: fake.fetch }) });
  try {
    // Ways and stores the policy doesn't name are refused before any lookup.
    assert.equal((await app.call('POST', '/api/places/nearest', { retailerId: 'target', method: 2, lat: 40, lng: -73 })).status, 400, 'mail has nothing to look up');
    assert.equal((await app.call('POST', '/api/places/nearest', { retailerId: 'nope', method: 0, lat: 40, lng: -73 })).status, 400);
  } finally { await app.close(); }
  const off = await boot();
  try {
    const r = await off.call('POST', '/api/places/nearest', { retailerId: 'amazon', method: 0, lat: 40, lng: -73 });
    assert.deepEqual(r.body, { places: [], reason: 'unavailable' });
  } finally { await off.close(); }
  const { store } = await tempStore();
  const on = await boot({ places: createPlaces({ apiKey: 'k', store, fetch: fake.fetch }) });
  try {
    const r = await on.call('POST', '/api/places/nearest', { retailerId: 'target', method: 1, lat: 40.7411, lng: -73.9897 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.places.map(p => p.name), ['Target', 'Target']);
    assert.equal((await on.call('POST', '/api/places/nearest', { retailerId: 'target', method: 1, lat: 'x', lng: 1 })).status, 400);
  } finally { await on.close(); }
});

const png = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]).toString('base64');
const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n%label\n').toString('base64');

test('QR code or label: saved privately on the item, kept by later syncs, replaced, removed and deleted with the item', async () => {
  const app = await boot();
  try {
    const item = { id: 'i1', name: 'Echo Dot', retailer: 'Amazon', price: 49.99, status: 'deciding' };
    assert.equal((await app.call('POST', '/api/items', item)).status, 201);
    assert.equal((await app.call('PUT', '/api/items/nope/label', { data: png })).status, 404);
    assert.equal((await app.call('PUT', '/api/items/i1/label', { data: 'data:text/html;base64,PGI+' })).status, 400);
    const r = await app.call('PUT', '/api/items/i1/label', { data: png });
    assert.equal(r.status, 200);
    assert.match(r.body.item.label, /^\/api\/files\/[0-9a-f-]{36}$/);
    assert.equal((await app.call('GET', r.body.item.label)).status, 200);
    assert.equal(app.filesOnDisk().length, 1);

    // A sync from a copy without the label (made before it was added) keeps it; a sync can't point it at another file.
    await app.call('PUT', '/api/items/i1', { ...item, name: 'Echo Dot (4th gen)' });
    await app.call('PUT', '/api/items/i1', { ...item, labelFileId: '00000000-0000-4000-8000-000000000000', label: '/api/files/00000000-0000-4000-8000-000000000000' });
    let list = (await app.call('GET', '/api/items')).body.items;
    assert.equal(list[0].label, r.body.item.label);

    // Replacing removes the old file; a PDF is fine.
    const r2 = await app.call('PUT', '/api/items/i1/label', { data: pdf });
    assert.notEqual(r2.body.item.label, r.body.item.label);
    assert.equal((await app.call('GET', r.body.item.label)).status, 404);
    assert.equal(app.filesOnDisk().length, 1);

    assert.equal((await app.call('DELETE', '/api/items/i1/label', {})).status, 200);
    list = (await app.call('GET', '/api/items')).body.items;
    assert.equal(list[0].label, undefined);
    assert.equal(app.filesOnDisk().length, 0);

    await app.call('PUT', '/api/items/i1/label', { data: png });
    assert.equal(app.filesOnDisk().length, 1);
    await app.call('DELETE', '/api/items/i1', {});
    assert.equal(app.filesOnDisk().length, 0, 'deleting the item deletes its label');
  } finally { await app.close(); }
});
