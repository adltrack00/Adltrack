const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), os = require('node:os'), path = require('node:path'), fs = require('node:fs');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { createStorage } = require('../server/storage');
const { createData } = require('../server/data');
const { docList, docGroups, docCategory } = require('../documents.js');

/* Documents (documents.js): the scanned discharge papers and the documents added on the page, sorted into categories. */
const png = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]).toString('base64');
const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n%test\n').toString('base64');

test('the scanned discharge papers show once per scan, with the medications read from them; examples are left out', () => {
  const list = [
    { id: 'm1', med: true, name: 'Lisinopril 10 mg', purchaseId: 'scan-a', papers: ['/api/files/a1', '/api/files/a2'], discharge: { hospital: 'Mercy Hospital', discharged: '2026-10-10' } },
    { id: 'm2', med: true, name: 'Metformin 500 mg', purchaseId: 'scan-a', papers: ['/api/files/a1', '/api/files/a2'], discharge: { hospital: 'Mercy Hospital', discharged: '2026-10-10' } },
    { id: 'm3', med: true, name: 'Aspirin', purchaseId: 'bottle', labelPhotos: ['x'] },
    { id: 'm4', med: true, demo: true, name: 'Example', purchaseId: 'demo', papers: ['/api/files/d1'] },
    { id: 'd1', doc: true, name: 'Medicare card', category: 'insurance', files: [{ url: '/api/files/c1', type: 'image/jpeg' }], date: '2026-10-20' },
    { id: 'd2', doc: true, name: 'Old note', category: 'something-else', files: [], addedAt: '2026-09-01T10:00:00Z' },
    { id: 't1', task: true, name: 'Walk' }
  ];
  const docs = docList(list);
  assert.deepEqual(docs.map(d => d.id), ['d1', 'scan-scan-a', 'd2'], 'newest first');
  const scan = docs[1];
  assert.equal(scan.name, 'Discharge papers · Mercy Hospital');
  assert.equal(scan.category, 'discharge');
  assert.equal(scan.files.length, 2);
  assert.deepEqual(scan.meds, ['Lisinopril 10 mg', 'Metformin 500 mg']);
  assert.equal(docs[2].category, 'other', 'an unknown category goes to Other');
  assert.equal(docs[2].date, '2026-09-01');
  assert.deepEqual(docGroups(docs).map(g => [g.key, g.docs.length]), [['discharge', 1], ['insurance', 1], ['other', 1]], 'in the categories’ order, empty ones left out');
  assert.equal(docCategory('legal'), 'legal');
  assert.equal(docCategory(undefined), 'other');
});

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adltrack-docs-'));
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
  const join = async (name, address, role, perms = {}) => {
    const add = await george('POST', '/api/team/members', { name, email: address, role, perms });
    const c = await signUp(name, address);
    assert.equal((await c('POST', '/api/invite/accept', { token: add.body.invite.link.split('#t=')[1] })).status, 200);
    return c;
  };
  return { george, maria: await join('Maria', 'maria@example.com', 'caregiver'), ann: await join('Ann', 'ann@example.com', 'viewer'), close: () => new Promise(r => server.close(r)) };
}

test('a document’s pages are a photo or a PDF; adding needs the medications tick, everyone sees it, and removing it deletes its pages', async () => {
  const app = await boot();
  try {
    const { george, maria, ann } = app;
    const photo = await george('POST', '/api/files/document', { data: png });
    assert.equal(photo.status, 201);
    assert.match(photo.body.url, /^\/api\/files\/[0-9a-f-]{36}$/);
    assert.equal(photo.body.type, 'image/png');
    const paper = await george('POST', '/api/files/document', { data: pdf });
    assert.equal(paper.status, 201);
    assert.equal(paper.body.type, 'application/pdf');
    assert.equal((await george('POST', '/api/files/document', { data: 'data:text/plain;base64,aGk=' })).status, 400);

    const doc = { id: 'doc-1', doc: true, name: 'Medicare card', category: 'insurance', files: [photo.body, paper.body], addedAt: new Date().toISOString() };
    assert.equal((await george('POST', '/api/items', doc)).status, 201);

    // Without the medications tick, a caregiver and a viewer see it and open its pages, but can't add, move or remove one.
    for (const c of [maria, ann]) {
      assert.equal((await c('GET', '/api/items')).body.items.find(i => i.id === 'doc-1').name, 'Medicare card');
      assert.equal((await c('GET', photo.body.url)).status, 200);
      assert.equal((await c('POST', '/api/files/document', { data: png })).status, 403);
      assert.equal((await c('POST', '/api/items', { ...doc, id: 'doc-2' })).status, 403);
      assert.equal((await c('PUT', '/api/items/doc-1', { ...doc, category: 'other' })).status, 403);
      assert.equal((await c('DELETE', '/api/items/doc-1', {})).status, 403);
    }

    assert.equal((await george('PUT', '/api/items/doc-1', { ...doc, category: 'legal' })).status, 200);
    assert.equal((await george('DELETE', '/api/items/doc-1', {})).status, 200);
    assert.equal((await george('GET', photo.body.url)).status, 404);
    assert.equal((await george('GET', paper.body.url)).status, 404);
  } finally { await app.close(); }
});

test('papers filed by Scan show as one document until their confirmed medications carry them', async () => {
  const filed = { id: 'd1', doc: true, scanned: true, purchaseId: 'p1', name: 'Discharge papers · Riverside', category: 'discharge', files: [{ url: '/api/files/a' }], date: '2026-10-29' };
  assert.deepEqual(docList([filed]).map(d => d.id), ['d1']);
  const med = { id: 'm1', med: true, name: 'Lisinopril', purchaseId: 'p1', papers: ['/api/files/a'], discharge: { hospital: 'Riverside', discharged: '2026-10-29' } };
  assert.deepEqual(docList([filed, med]).map(d => d.id), ['scan-p1'], 'once confirmed, the medications’ scan takes its place');
});
