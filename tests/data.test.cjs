const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), os = require('node:os'), path = require('node:path'), fs = require('node:fs');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { createStorage, signRequest, s3Config } = require('../server/storage');
const { createData } = require('../server/data');
const { createJobs, defineJobs } = require('../server/jobs');
const { encode, decode } = require('../server/items');

// Postgres runs too when TEST_DATABASE_URL points at a throwaway database (its tables are dropped).
const PG = process.env.TEST_DATABASE_URL || '';
const STORES = [['file store', null], ...(PG ? [['Postgres', PG]] : [])];

const jpeg = (n = 1) => 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, n)]).toString('base64');
const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n%receipt\n').toString('base64');

async function boot(databaseUrl, { storage: customStorage } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'returnly-data-'));
  if (databaseUrl) {
    const { Client } = require('pg');
    const c = new Client({ connectionString: databaseUrl });
    await c.connect(); await c.query('drop schema public cascade; create schema public'); await c.end();
  }
  const store = createStore({ databaseUrl, file: path.join(dir, 'store.json') });
  await store.init();
  const storage = customStorage || createStorage({ dir: path.join(dir, 'files') });
  const jobs = createJobs({ store, log: { error() {} } });
  const data = createData({ store, storage, jobs });
  defineJobs(jobs, { store, storage });
  const server = http.createServer(createApp({ store, data }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    const call = async (method, url, body, headers = {}) => {
      const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      const type = res.headers.get('content-type') || '';
      return { status: res.status, headers: res.headers, body: type.startsWith('application/json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
    };
    return call;
  };
  const signUp = async (name) => { const c = client(); assert.equal((await c('POST', '/api/signup', { name, email: `${name.toLowerCase()}@example.com`, password: 'Care-plan-2026' })).status, 201); return c; };
  const filesOnDisk = () => { const d = path.join(dir, 'files', 'files'); return fs.existsSync(d) ? fs.readdirSync(d).filter(f => !f.endsWith('.type')) : []; };
  return { store, storage, jobs, data, client, signUp, filesOnDisk, close: async () => { await jobs.stop(); await new Promise(r => server.close(r)); await store.close(); } };
}

test('item fields round-trip through columns, keeping values that do not fit as they were', () => {
  const item = { id: 'a', name: 'Dress', retailer: 'Fashion Nova', price: 49.99, category: 'dress', channel: 'online', purchased: '2026-10-01', delivered: '', window: 30, basis: 'delivery', confirmed: true, status: 'deciding', packing: { receipt: true, label: false }, received: '12', snoozeUntil: '2026-02-30', evidence: ['r.jpg'], photoKey: 'dress', demo: false };
  const { columns, extra } = encode(item);
  assert.equal(columns.purchased, '2026-10-01');
  assert.equal(columns.delivered, null);
  assert.equal(columns.window_days, 30);
  assert.deepEqual(extra, { delivered: '', received: '12', snoozeUntil: '2026-02-30', evidence: ['r.jpg'], photoKey: 'dress' });
  const back = decode({ ...columns, extra, id: 'a', purchase_id: 'p1', photo_file_id: null });
  const { purchaseId, ...rest } = back;
  assert.equal(purchaseId, 'p1');
  assert.deepEqual(rest, item);
});

test('S3 requests are signed exactly like the AWS reference example', () => {
  const h = signRequest({ method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', headers: { Range: 'bytes=0-9' }, accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', date: new Date('2013-05-24T00:00:00Z') });
  assert.equal(h.authorization, 'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});

test('S3 storage puts, gets and deletes through signed requests', async () => {
  const objects = new Map(), seen = [];
  const fetchImpl = async (url, { method, headers, body }) => {
    seen.push({ url, method, auth: headers.authorization });
    const key = new URL(url).pathname;
    if (method === 'PUT') { objects.set(key, { body: Buffer.from(body), type: headers['content-type'] }); return new Response(null, { status: 200 }); }
    if (method === 'GET') { const o = objects.get(key); return o ? new Response(o.body, { status: 200, headers: { 'content-type': o.type } }) : new Response(null, { status: 404 }); }
    objects.delete(key); return new Response(null, { status: 204 });
  };
  const config = s3Config({ S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com/', S3_BUCKET: 'returnly', S3_ACCESS_KEY_ID: 'id', S3_SECRET_ACCESS_KEY: 'secret' });
  assert.equal(config.region, 'auto');
  assert.equal(s3Config({ S3_BUCKET: 'only-a-bucket' }), null);
  const s3 = createStorage({ s3: { ...config, fetchImpl } });
  await s3.put('files/abc', Buffer.from('hello'), 'image/png');
  assert.equal(seen[0].url, 'https://acct.r2.cloudflarestorage.com/returnly/files/abc');
  assert.match(seen[0].auth, /^AWS4-HMAC-SHA256 Credential=id\/\d{8}\/auto\/s3\/aws4_request/);
  assert.deepEqual(await s3.get('files/abc'), { body: Buffer.from('hello'), contentType: 'image/png' });
  await s3.remove('files/abc');
  assert.equal(await s3.get('files/abc'), null);
  await assert.rejects(s3.put('../escape', Buffer.from('x'), 'image/png'), /Invalid storage key/);
});

for (const [label, databaseUrl] of STORES) {
  test(`${label}: items are created, updated and deleted one at a time`, async () => {
    const app = await boot(databaseUrl);
    try {
      const c = await app.signUp('Ann');
      const a = await c('POST', '/api/items', { id: 'a', name: 'Dress', retailer: 'Zara', price: 40, purchased: '2026-10-01', purchaseId: 'order-1', status: 'deciding' });
      assert.equal(a.status, 201);
      assert.equal(a.body.item.purchaseId, 'order-1');
      assert.ok(a.body.updatedAt);
      assert.equal((await c('POST', '/api/items', { id: 'a', name: 'Again' })).status, 409);
      await c('POST', '/api/items', { id: 'b', name: 'Belt', retailer: 'Zara', price: 15, purchased: '2026-10-01', purchaseId: 'order-1' });
      await c('POST', '/api/items', { id: 'c', name: 'Lamp', retailer: 'Target', price: 25 });
      const put = await c('PUT', '/api/items/a', { name: 'Dress', retailer: 'Zara', price: 40, purchased: '2026-10-01', status: 'started', packing: { receipt: true } });
      assert.equal(put.body.item.status, 'started');
      assert.equal(put.body.item.purchaseId, 'order-1', 'an update without purchaseId keeps the purchase');

      const purchases = (await c('GET', '/api/purchases')).body.purchases;
      assert.equal(purchases.length, 2);
      const order = purchases.find(p => p.id === 'order-1');
      assert.deepEqual({ store: order.store, purchased: order.purchased, source: order.source }, { store: 'Zara', purchased: '2026-10-01', source: 'manual' });

      const data = (await c('GET', '/api/data')).body.data;
      assert.deepEqual(data.purchases.map(i => i.id), ['a', 'b', 'c']);
      assert.deepEqual(data.purchases[0].packing, { receipt: true });
      assert.equal(data.updatedAt, put.body.updatedAt);

      assert.equal((await c('DELETE', '/api/items/c', {})).status, 200);
      assert.equal((await c('DELETE', '/api/items/c', {})).status, 404);
      assert.equal((await c('GET', '/api/purchases')).body.purchases.length, 1, 'an empty purchase is removed with its last item');
      assert.deepEqual((await c('GET', '/api/items')).body.items.map(i => i.id), ['a', 'b']);

      const other = await app.signUp('Bo');
      assert.deepEqual((await other('GET', '/api/items')).body.items, []);
      assert.equal((await other('DELETE', '/api/items/a', {})).status, 404);
      assert.equal((await c('PUT', '/api/items/x', { name: 'x' }, { Origin: 'https://evil.example' })).status, 403);
      assert.equal((await app.client()('GET', '/api/items')).status, 401);
    } finally { await app.close(); }
  });

  test(`${label}: photos move to file storage and are served only to their owner`, async () => {
    const app = await boot(databaseUrl);
    try {
      const c = await app.signUp('Cy');
      const saved = (await c('POST', '/api/items', { id: 'p', name: 'Shoes', photo: jpeg(1) })).body.item;
      assert.match(saved.photo, /^\/api\/files\/[0-9a-f-]{36}$/);
      assert.equal(app.filesOnDisk().length, 1);
      const file = await c('GET', saved.photo);
      assert.equal(file.status, 200);
      assert.equal(file.headers.get('content-type'), 'image/jpeg');
      assert.match(file.headers.get('cache-control'), /^private/);
      assert.deepEqual(file.body, Buffer.from(jpeg(1).split(',')[1], 'base64'));
      assert.equal((await (await app.signUp('Dee'))('GET', saved.photo)).status, 404);
      assert.equal((await app.client()('GET', saved.photo)).status, 401);

      // Sending the same photo (or its URL) back keeps the file; a new photo replaces it.
      assert.equal((await c('PUT', '/api/items/p', { name: 'Shoes', photo: saved.photo })).body.item.photo, saved.photo);
      assert.equal((await c('PUT', '/api/items/p', { name: 'Shoes', photo: jpeg(1) })).body.item.photo, saved.photo);
      const replaced = (await c('PUT', '/api/items/p', { name: 'Shoes', photo: jpeg(2) })).body.item.photo;
      assert.notEqual(replaced, saved.photo);
      assert.equal(app.filesOnDisk().length, 1);
      assert.equal((await c('GET', saved.photo)).status, 404);
      // Something that isn't really an image is kept as it was, not stored as a file and never blocks saving.
      const fake = 'data:image/png;base64,' + Buffer.from('not a png').toString('base64');
      const kept = await c('POST', '/api/items', { id: 'q', name: 'Fake', photo: fake });
      assert.equal(kept.status, 201);
      assert.equal(kept.body.item.photo, fake);
      assert.equal(app.filesOnDisk().length, 1);
      await c('DELETE', '/api/items/q', {});

      // The profile photo is a file too.
      const s = await c('PUT', '/api/settings', { settings: { time: '09:00' }, profile: { name: 'Cy', photo: jpeg(3) } });
      assert.match(s.body.profile.photo, /^\/api\/files\//);
      assert.equal((await c('GET', '/api/data')).body.data.profile.photo, s.body.profile.photo);
      assert.equal(app.filesOnDisk().length, 2);

      // Receipts attach to a purchase.
      const purchaseId = (await c('GET', '/api/items')).body.items[0].purchaseId;
      const receipt = await c('PUT', `/api/purchases/${purchaseId}/receipt`, { data: pdf });
      assert.equal(receipt.status, 200);
      assert.equal((await c('GET', receipt.body.receipt)).headers.get('content-type'), 'application/pdf');
      assert.equal((await c('GET', '/api/purchases')).body.purchases[0].receipt, receipt.body.receipt);
      assert.equal((await c('PUT', '/api/purchases/nope/receipt', { data: pdf })).status, 404);

      // Deleting the item deletes its photo and its purchase's receipt.
      await c('DELETE', '/api/items/p', {});
      assert.equal(app.filesOnDisk().length, 1);
    } finally { await app.close(); }
  });

  test(`${label}: old single-document payloads migrate without losing anything`, async () => {
    const app = await boot(databaseUrl);
    try {
      const c = await app.signUp('Eve');
      const user = await app.store.findUserByEmail('eve@example.com');
      const legacy = [
        { id: 'demo-dress', name: 'The weekend dress', retailer: 'Fashion Nova', price: 49.99, category: 'dress', channel: 'online', purchased: '2026-09-30', delivered: '2026-10-04', window: 30, basis: 'delivery', outcome: 'credit', requirement: 'start', url: 'https://returns.fashionnova.com/', confirmed: true, status: 'deciding', next: 'Try it on.', demo: true, policySource: 'Fashion Nova reference · Oct 8, 2026' },
        { id: 'real-1', name: 'Boots', retailer: 'Store not added', price: 120, channel: 'store', purchased: '2026-10-02', delivered: '', window: 30, basis: 'purchase', outcome: 'unknown', requirement: 'unknown', confirmed: false, url: '', status: 'received', received: 120, returnedOn: '2026-10-09', intent: 'return', photo: jpeg(4), packing: { receipt: true, condition: true, packed: false, label: false, proof: false }, taskDone: true, snoozeUntil: '2026-10-12', dateSet: '2026-10-02', evidence: ['receipt.jpg'] },
        { id: 7, name: 'Number id', price: 'twelve' }
      ];
      const settings = { time: '19:00', daily: true }, profile = { name: 'Eve', photo: jpeg(5) };
      await app.store.putSettings(user.id, { purchases: legacy, settings, profile });
      const before = (await app.store.getRawData(user.id)).updatedAt;

      assert.equal(await app.data.migrateAll(), 1);
      assert.equal(await app.data.migrateAll(), 0, 'running it again does nothing');
      const raw = await app.store.getRawData(user.id);
      assert.equal(raw.payload.purchases, undefined, 'purchases left the document');
      assert.equal(raw.updatedAt, before, 'devices do not need to reload');

      const data = (await c('GET', '/api/data')).body.data;
      assert.equal(data.purchases.length, 3);
      const strip = i => { const { purchaseId, photo, ...rest } = i; return rest; };
      assert.deepEqual(strip(data.purchases[0]), legacy[0]);
      assert.deepEqual(strip(data.purchases[1]), strip(legacy[1]));
      assert.deepEqual(strip(data.purchases[2]), { ...legacy[2], id: '7' });
      assert.deepEqual((await c('GET', data.purchases[1].photo)).body, Buffer.from(jpeg(4).split(',')[1], 'base64'));
      assert.deepEqual(data.settings, settings);
      assert.equal(data.profile.name, 'Eve');
      assert.match(data.profile.photo, /^\/api\/files\//);
      assert.equal(app.filesOnDisk().length, 2);
    } finally { await app.close(); }
  });

  test(`${label}: older apps can still save the whole list through /api/data`, async () => {
    const app = await boot(databaseUrl);
    try {
      const c = await app.signUp('Flo');
      await c('POST', '/api/items', { id: 'keep', name: 'Keep', photo: jpeg(6) });
      await c('POST', '/api/items', { id: 'gone', name: 'Gone', photo: jpeg(7) });
      const put = await c('PUT', '/api/data', { purchases: [{ id: 'new', name: 'New' }, { id: 'keep', name: 'Keep, renamed', photo: jpeg(6) }], settings: { time: '08:00' }, profile: { name: 'Flo' } });
      assert.equal(put.status, 200);
      const data = (await c('GET', '/api/data')).body.data;
      assert.deepEqual(data.purchases.map(i => [i.id, i.name]), [['new', 'New'], ['keep', 'Keep, renamed']]);
      assert.equal(data.updatedAt, put.body.updatedAt);
      assert.equal(app.filesOnDisk().length, 1, 'the removed item took its photo with it; the kept photo was reused');
    } finally { await app.close(); }
  });

  test(`${label}: deleting an account deletes its rows and files`, async () => {
    const app = await boot(databaseUrl);
    try {
      const c = await app.signUp('Gus');
      const other = await app.signUp('Hal');
      await c('POST', '/api/items', { id: 'a', name: 'A', photo: jpeg(8), purchaseId: 'o1' });
      await c('PUT', '/api/purchases/o1/receipt', { data: pdf });
      await c('PUT', '/api/settings', { settings: {}, profile: { photo: jpeg(9) } });
      await other('POST', '/api/items', { id: 'a', name: 'Not yours', photo: jpeg(10) });
      assert.equal(app.filesOnDisk().length, 4);
      const user = await app.store.findUserByEmail('gus@example.com');
      assert.equal((await c('DELETE', '/api/account', { password: 'Care-plan-2026' })).status, 200);
      assert.equal(app.filesOnDisk().length, 1);
      assert.deepEqual(await app.store.listItems(user.id), []);
      assert.deepEqual(await app.store.listPurchases(user.id), []);
      assert.deepEqual(await app.store.listFiles(user.id), []);
      assert.equal(await app.store.getRawData(user.id), null);
      assert.equal((await other('GET', '/api/items')).body.items[0].name, 'Not yours');
    } finally { await app.close(); }
  });

  test(`${label}: files that can't be deleted right away are retried by a background job`, async () => {
    let down = true;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'returnly-flaky-'));
    const real = createStorage({ dir });
    const flaky = { ...real, async remove(key) { if (down) throw new Error('storage unavailable'); return real.remove(key); } };
    const app = await boot(databaseUrl, { storage: flaky });
    try {
      const c = await app.signUp('Ivy');
      const photo = (await c('POST', '/api/items', { id: 'a', name: 'A', photo: jpeg(11) })).body.item.photo;
      const key = `files/${photo.split('/').pop()}`;
      assert.equal((await c('DELETE', '/api/account', { password: 'Care-plan-2026' })).status, 200);
      assert.ok(await real.get(key), 'still stored while storage is down');
      down = false;
      // Due after its backoff; run it now.
      const job = await app.store.claimJob(0);
      assert.equal(job.name, 'files.delete');
      await app.store.retryJob(job.id, 'test', new Date(Date.now() - 1000));
      assert.equal(await app.jobs.drain(), 1);
      assert.equal(await real.get(key), null);
      assert.equal((await app.store.getJob(job.id)).status, 'done');
    } finally { await app.close(); }
  });

  test(`${label}: background jobs run, retry with backoff, give up, and repeat on schedule`, async () => {
    const app = await boot(databaseUrl);
    try {
      const jobs = createJobs({ store: app.store, staleMs: 50, log: { error() {} } });
      const ran = [];
      jobs.define('test.ok', async payload => { ran.push(payload.n); });
      let failures = 0;
      jobs.define('test.flaky', async () => { failures++; throw new Error('nope ' + failures); });
      jobs.define('test.every', async () => { ran.push('every'); }, { every: 60_000 });
      assert.throws(() => jobs.enqueue('test.unknown'), /Unknown job/);

      const ok = await jobs.enqueue('test.ok', { n: 1 });
      await jobs.enqueue('test.ok', { n: 2 }, { runAt: new Date(Date.now() + 60_000) });
      assert.equal(await jobs.drain(), 1, 'only due jobs run');
      assert.deepEqual(ran, [1]);
      assert.equal((await app.store.getJob(ok)).status, 'done');

      // Unique keys keep one active job per key.
      assert.ok(await jobs.enqueue('test.ok', { n: 3 }, { uniqueKey: 'once' }));
      assert.equal(await jobs.enqueue('test.ok', { n: 4 }, { uniqueKey: 'once' }), null);

      const flaky = await jobs.enqueue('test.flaky', {}, { maxAttempts: 2 });
      await jobs.drain();
      let job = await app.store.getJob(flaky);
      assert.equal(job.status, 'queued');
      assert.equal(job.lastError, 'nope 1');
      assert.ok(new Date(job.runAt) > new Date(Date.now() + 20_000), 'retried later, not straight away');
      await app.store.retryJob(flaky, job.lastError, new Date(Date.now() - 1000));
      await jobs.drain();
      job = await app.store.getJob(flaky);
      assert.equal(job.status, 'failed');
      assert.equal(job.attempts, 2);

      // A job whose runner died is picked up again.
      const stuck = await jobs.enqueue('test.ok', { n: 5 });
      assert.equal((await app.store.claimJob(60_000)).id, stuck);
      assert.equal(await app.store.claimJob(60_000), null);
      await new Promise(r => setTimeout(r, 1100));
      await jobs.drain();
      assert.equal((await app.store.getJob(stuck)).status, 'done');

      // Recurring jobs keep exactly one future run queued.
      await jobs.start(); await jobs.stop();
      await jobs.start(); await jobs.stop();
      ran.length = 0;
      await jobs.drain();
      assert.deepEqual(ran.filter(r => r === 'every'), ['every']);
      assert.equal(await app.store.enqueueJob({ name: 'test.every', uniqueKey: 'every:test.every' }), null, 'the next run is already queued');
    } finally { await app.close(); }
  });

  test(`${label}: the example cleanup job removes expired sessions`, async () => {
    const app = await boot(databaseUrl);
    try {
      await app.signUp('Jo');
      const user = await app.store.findUserByEmail('jo@example.com');
      await app.store.createSession(user.id, 'expired-token-hash', new Date(Date.now() - 1000));
      await app.jobs.start(); await app.jobs.stop();
      assert.equal(await app.jobs.drain(), 1);
      assert.equal(await app.store.findSession('expired-token-hash'), null);
      assert.ok(await app.store.enqueueJob({ name: 'maintenance.cleanup', uniqueKey: 'every:maintenance.cleanup' }) === null, 'next run is scheduled');
    } finally { await app.close(); }
  });
}
