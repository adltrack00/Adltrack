const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), os = require('node:os'), path = require('node:path'), fs = require('node:fs');
const { createStore } = require('../server/store');
const { createApp, hashPassword, verifyPassword } = require('../server/app');
const { createStorage } = require('../server/storage');
const { createData } = require('../server/data');
const { createJobs, defineJobs } = require('../server/jobs');

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'returnly-'));
  const store = createStore({ file: path.join(dir, 'store.json') });
  await store.init();
  const storage = createStorage({ dir: path.join(dir, 'files') });
  const jobs = createJobs({ store });
  const data = createData({ store, storage, jobs });
  defineJobs(jobs, { store, storage });
  const server = http.createServer(createApp({ store, data }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (method, url, body, headers = {}) => {
      const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
    };
  };
  return { client, base, close: () => new Promise(r => server.close(r)) };
}

test('passwords are hashed and verified', async () => {
  const h = await hashPassword('correct horse');
  assert.match(h, /^scrypt\$/);
  assert.ok(!h.includes('correct horse'));
  assert.equal(await verifyPassword('correct horse', h), true);
  assert.equal(await verifyPassword('wrong horse', h), false);
});

test('sign up, sync data, sign out and sign back in on another device', async () => {
  const app = await boot();
  try {
    const phone = app.client();
    const signup = await phone('POST', '/api/signup', { name: 'George', email: ' George@Example.com ', password: 'password123' });
    assert.equal(signup.status, 201);
    assert.deepEqual(signup.body.user, { email: 'george@example.com', name: 'George' });
    assert.match(signup.headers.get('set-cookie'), /HttpOnly/);
    const put = await phone('PUT', '/api/data', { purchases: [{ id: 'a', name: 'Shoes' }], settings: { time: '09:00' }, profile: { name: 'George' } });
    assert.equal(put.status, 200);
    assert.equal((await phone('POST', '/api/logout', {})).status, 200);
    assert.equal((await phone('GET', '/api/data')).status, 401);

    const laptop = app.client();
    assert.equal((await laptop('POST', '/api/login', { email: 'george@example.com', password: 'nope-nope' })).status, 401);
    const login = await laptop('POST', '/api/login', { email: 'GEORGE@example.com', password: 'password123' });
    assert.equal(login.status, 200);
    assert.equal(login.body.data.purchases[0].name, 'Shoes');
  } finally { await app.close(); }
});

test('each account only sees its own purchases', async () => {
  const app = await boot();
  try {
    const a = app.client(), b = app.client();
    await a('POST', '/api/signup', { name: 'Ann', email: 'ann@example.com', password: 'password123' });
    await b('POST', '/api/signup', { name: 'Bo', email: 'bo@example.com', password: 'password123' });
    await a('PUT', '/api/data', { purchases: [{ id: 'secret' }] });
    assert.equal((await b('GET', '/api/data')).body.data, null);
  } finally { await app.close(); }
});

test('duplicate emails, weak passwords and bad emails are rejected', async () => {
  const app = await boot();
  try {
    const c = app.client();
    assert.equal((await c('POST', '/api/signup', { name: 'A', email: 'a@example.com', password: 'short' })).status, 400);
    assert.equal((await c('POST', '/api/signup', { name: 'A', email: 'not-an-email', password: 'password123' })).status, 400);
    assert.equal((await c('POST', '/api/signup', { name: 'A', email: 'a@example.com', password: 'password123' })).status, 201);
    assert.equal((await app.client()('POST', '/api/signup', { name: 'A', email: 'A@example.com', password: 'password123' })).status, 409);
  } finally { await app.close(); }
});

test('cross-site writes and non-JSON posts are refused', async () => {
  const app = await boot();
  try {
    const c = app.client();
    assert.equal((await c('POST', '/api/signup', { name: 'A', email: 'x@example.com', password: 'password123' }, { Origin: 'https://evil.example' })).status, 403);
    const form = await fetch(app.base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=a&password=b' });
    assert.equal(form.status, 415);
  } finally { await app.close(); }
});

test('repeated wrong passwords lock the email temporarily', async () => {
  const app = await boot();
  try {
    const c = app.client();
    await c('POST', '/api/signup', { name: 'L', email: 'lock@example.com', password: 'password123' });
    const other = app.client();
    for (let i = 0; i < 10; i++) await other('POST', '/api/login', { email: 'lock@example.com', password: 'wrong-' + i }, { 'X-Forwarded-For': '10.0.0.' + i });
    const locked = await other('POST', '/api/login', { email: 'lock@example.com', password: 'password123' }, { 'X-Forwarded-For': '10.0.1.1' });
    assert.equal(locked.status, 429);
  } finally { await app.close(); }
});

test('deleting an account needs the password and removes the data', async () => {
  const app = await boot();
  try {
    const c = app.client();
    await c('POST', '/api/signup', { name: 'D', email: 'd@example.com', password: 'password123' });
    await c('PUT', '/api/data', { purchases: [{ id: 1 }] });
    assert.equal((await c('DELETE', '/api/account', { password: 'wrong-pass' })).status, 401);
    assert.equal((await c('DELETE', '/api/account', { password: 'password123' })).status, 200);
    assert.equal((await app.client()('POST', '/api/login', { email: 'd@example.com', password: 'password123' })).status, 401);
  } finally { await app.close(); }
});

test('app files are served but server code, tests and package files are not', async () => {
  const app = await boot();
  try {
    const ok = await fetch(app.base + '/app.html');
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-security-policy'), /script-src 'self'/);
    for (const p of ['/server.js', '/server/app.js', '/server/store.js', '/tests/server.test.cjs', '/package.json', '/data/dev-store.json', '/.gitignore', '/node_modules/pg/package.json'])
      assert.equal((await fetch(app.base + p)).status, 404, p);
  } finally { await app.close(); }
});

test('a dose photo is saved privately to the account and removed with its medication', async () => {
  const app = await boot();
  try {
    const a = app.client(), b = app.client();
    await a('POST', '/api/signup', { name: 'Ann', email: 'ann@example.com', password: 'password123' });
    await b('POST', '/api/signup', { name: 'Bo', email: 'bo@example.com', password: 'password123' });
    const jpg = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, 'fixtures/receipts/blurry.jpg')).toString('base64');
    assert.equal((await a('POST', '/api/files/proof', { data: 'data:text/plain;base64,aGk=' })).status, 400);
    const r = await a('POST', '/api/files/proof', { data: jpg });
    assert.equal(r.status, 201); assert.match(r.body.url, /^\/api\/files\/[0-9a-f-]{36}$/);
    assert.equal((await a('GET', r.body.url)).status, 200);
    assert.equal((await b('GET', r.body.url)).status, 404, 'only the owner can open it');
    await a('POST', '/api/items', { id: 'm1', med: true, doses: [{ day: '2026-10-18', slot: '08:00', kind: 'taken', note: 'Fine.', photos: [r.body.url] }] });
    assert.equal((await a('GET', '/api/items')).body.items[0].doses[0].photos[0], r.body.url, 'the dose keeps its photo');
    assert.equal((await a('DELETE', '/api/items/m1', {})).status, 200);
    assert.equal((await a('GET', r.body.url)).status, 404);
  } finally { await app.close(); }
});
