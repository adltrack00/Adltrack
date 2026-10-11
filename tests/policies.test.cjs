const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), os = require('node:os'), path = require('node:path'), fs = require('node:fs');
const { loadPolicies, validate, unsourcedFacts, normalizeStoreName, itemFields, POLICY_DIR } = require('../server/policies');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');

const schema = JSON.parse(fs.readFileSync(path.join(POLICY_DIR, 'schema.json'), 'utf8'));
const files = fs.readdirSync(POLICY_DIR).filter(f => f.endsWith('.json') && f !== 'schema.json');
const read = f => JSON.parse(fs.readFileSync(path.join(POLICY_DIR, f), 'utf8'));
const LAUNCH = ['amazon', 'walmart', 'target', 'costco', 'bestbuy', 'homedepot', 'apple', 'nike', 'zara', 'shein', 'fashionnova'];

test('the 10 launch stores and Fashion Nova each have a policy file', () => {
  assert.deepEqual(files.map(f => f.replace('.json', '')).sort(), [...LAUNCH].sort());
  assert.equal(loadPolicies().list().length, 11);
});

test('every policy file matches the JSON schema', () => {
  for (const f of files) assert.deepEqual(validate(read(f), schema), [], f);
});

test('the schema catches bad files', () => {
  const p = read('amazon.json');
  assert.ok(validate({ ...p, country: 'UK' }, schema).length);
  assert.ok(validate({ ...p, item: { ...p.item, outcome: { ...p.item.outcome, value: 'cash' } } }, schema).length);
  assert.ok(validate({ ...p, item: { ...p.item, window: { ...p.item.window, value: 'thirty' } } }, schema).length);
  assert.ok(validate({ ...p, surprise: true }, schema).length);
  const { checked, ...noDate } = p.item.window;
  assert.ok(validate({ ...p, item: { ...p.item, window: noDate } }, schema).length);
});

test('every fact has an official https source and a checked date', () => {
  for (const f of files) {
    const p = read(f);
    assert.deepEqual(unsourcedFacts(p), [], f);
    for (const k of ['window', 'basis', 'outcome', 'requirement', 'url', 'conditions', 'processing']) {
      assert.match(p.item[k].source, /^https:\/\//, `${f} item.${k}`);
      assert.match(p.item[k].checked, /^2026-\d{2}-\d{2}$/, `${f} item.${k}`);
    }
  }
  const p = read('target.json');
  assert.deepEqual(unsourcedFacts({ ...p, categories: [{ id: 'x', label: 'X', returnable: true }] }), ['$.categories[0]']);
});

test('facts that were not confirmed say "unknown" instead of guessing', () => {
  const p = loadPolicies();
  assert.equal(p.get('bestbuy').item.basis.value, 'unknown');
  assert.ok(p.get('bestbuy').unknowns.some(u => /restocking/i.test(u.topic)));
  assert.equal(p.get('amazon').item.requirement.value, 'unknown');
  // Where sources disagree, the shorter window is kept.
  assert.equal(p.get('homedepot').categories.find(c => c.id === 'gas-generators').window, 7);
  for (const policy of p.list()) assert.ok(policy.unknowns.length, `${policy.id} lists what it couldn't confirm`);
});

test('policies fill the existing item fields', () => {
  const p = loadPolicies();
  const nova = itemFields(p.get('fashionnova'));
  assert.deepEqual({ window: nova.window, basis: nova.basis, outcome: nova.outcome, requirement: nova.requirement, url: nova.url },
    { window: 30, basis: 'delivery', outcome: 'credit', requirement: 'start', url: 'https://returns.fashionnova.com/' });
  assert.equal(nova.policySource, 'Fashion Nova policy · Oct 11, 2026');
  // Unknown start date falls back to the purchase date (the earlier deadline) and is flagged.
  const best = itemFields(p.get('bestbuy'));
  assert.equal(best.basis, 'purchase');
  assert.ok(best.unknown.includes('basis'));
  // Zara counts from shipment; purchase is the earlier, safer stand-in.
  assert.equal(itemFields(p.get('zara')).basis, 'purchase');
  // Costco has no fixed window for most items.
  assert.equal(itemFields(p.get('costco')).window, null);
  for (const policy of p.list()) {
    const f = itemFields(policy);
    assert.ok(['delivery', 'purchase'].includes(f.basis));
    assert.ok(['refund', 'credit', 'exchange', 'final', 'unknown'].includes(f.outcome));
    assert.ok(['start', 'ship', 'arrive', 'store', 'unknown'].includes(f.requirement));
  }
});

test('store names on receipts and card statements match the right retailer', () => {
  const p = loadPolicies();
  const cases = {
    'AMZN Mktp US*2K4AB1C2': 'amazon', 'Amazon.com': 'amazon', 'AMAZON.COM*RT4Y12': 'amazon', 'amzn mktp us': 'amazon',
    'WAL-MART #1234': 'walmart', 'Walmart Supercenter #5260': 'walmart', 'WM SUPERCENTER #123': 'walmart',
    'Target T-1234': 'target', 'TARGET T-0815 MINNEAPOLIS MN': 'target', 'Target.com': 'target',
    'COSTCO WHSE #0123': 'costco', 'Costco Wholesale': 'costco',
    'BEST BUY 00012345': 'bestbuy', 'BestBuy.com': 'bestbuy',
    'THE HOME DEPOT #4501': 'homedepot', 'Home Depot': 'homedepot',
    'Apple Store R123': 'apple', 'apple.com/us': 'apple',
    'NIKE.COM': 'nike', 'Zara USA 3245': 'zara', 'SHEIN.COM': 'shein',
    'Fashion Nova': 'fashionnova', 'FashionNova.com': 'fashionnova'
  };
  for (const [name, id] of Object.entries(cases)) assert.equal(p.match(name)?.id, id, name);
  for (const name of ['', 'Applebee’s', 'Kohl’s', 'Targeted Marketing LLC', 'Studio & Co.', '#1234']) assert.equal(p.match(name), null, name);
  assert.equal(normalizeStoreName('WAL-MART #1234'), 'wal mart');
});

test('version history: a changed policy must get a new version, and past versions are kept', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'returnly-policies-'));
  fs.copyFileSync(path.join(POLICY_DIR, 'schema.json'), path.join(dir, 'schema.json'));
  const v1 = read('zara.json');
  fs.writeFileSync(path.join(dir, 'zara.json'), JSON.stringify(v1));
  const store = createStore({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'returnly-')), 'store.json') });
  await store.init();
  await store.syncPolicies(loadPolicies(dir).versions());
  await store.syncPolicies(loadPolicies(dir).versions());

  const edited = { ...v1, item: { ...v1.item, window: { ...v1.item.window, value: 14 } } };
  fs.writeFileSync(path.join(dir, 'zara.json'), JSON.stringify(edited));
  await assert.rejects(store.syncPolicies(loadPolicies(dir).versions()), /raise the version/);

  fs.mkdirSync(path.join(dir, 'history'));
  fs.writeFileSync(path.join(dir, 'history', 'zara.v1.json'), JSON.stringify(v1));
  fs.writeFileSync(path.join(dir, 'zara.json'), JSON.stringify({ ...edited, version: 2 }));
  await store.syncPolicies(loadPolicies(dir).versions());
  assert.deepEqual((await store.policyVersions('zara')).map(v => v.version), [2, 1]);

  fs.writeFileSync(path.join(dir, 'zara.json'), JSON.stringify({ ...edited, version: 1 }));
  assert.throws(() => loadPolicies(dir), /higher version/);
  fs.writeFileSync(path.join(dir, 'broken.json'), JSON.stringify({ id: 'broken' }));
  assert.throws(() => loadPolicies(dir), /broken\.json is invalid/);
});

test('retailer API lists policies, returns one with its item fields, and matches store names', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'returnly-'));
  const store = createStore({ file: path.join(dir, 'store.json') });
  await store.init();
  const policies = loadPolicies();
  await store.syncPolicies(policies.versions());
  const server = http.createServer(createApp({ store, policies }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const get = async url => { const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`); return { status: res.status, body: await res.json() }; };
  try {
    const list = await get('/api/retailers');
    assert.equal(list.status, 200);
    assert.equal(list.body.retailers.length, 11);
    assert.deepEqual(list.body.retailers.find(r => r.id === 'target'), { id: 'target', name: 'Target', status: 'checked', version: 1, checked: '2026-10-11', window: 90, basis: 'purchase', outcome: 'refund', url: 'https://www.target.com/returns', policySource: 'Target policy · Oct 11, 2026' });

    const one = await get('/api/retailers/amazon');
    assert.equal(one.status, 200);
    assert.equal(one.body.retailer.item.window.value, 30);
    assert.equal(one.body.item.window, 30);
    assert.deepEqual(one.body.versions, [{ version: 1, checked: '2026-10-11' }]);

    assert.equal((await get('/api/retailers/nope')).status, 404);
    assert.equal((await get('/api/retailers/..%2Fpackage')).status, 404);
    assert.equal((await get('/api/retailers?match=' + encodeURIComponent('WAL-MART #1234'))).body.match.id, 'walmart');
    assert.equal((await get('/api/retailers?match=' + encodeURIComponent('Corner Shop'))).body.match, null);
    // Policy files are only reachable through the API, not as static files.
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/policies/amazon.json`)).status, 404);
  } finally { await new Promise(r => server.close(r)); }
});
