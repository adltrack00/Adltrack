const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), os = require('node:os'), path = require('node:path'), fs = require('node:fs');
const { loadPolicies } = require('../server/policies');
const { evaluate } = require('../server/engine');
const { createClassifier } = require('../server/classify');
const { createStore } = require('../server/store');
const { createData } = require('../server/data');
const { createStorage } = require('../server/storage');
const { createApp } = require('../server/app');
const C = require('../core.js');

const P = loadPolicies();
const item = { name: 'Dress', retailer: 'x', purchased: '2026-10-01', delivered: '2026-10-04', channel: 'online', window: 30, basis: 'purchase' };
const run = (id, extra = {}) => evaluate({ item: { ...item, ...extra.item }, policy: P.get(id), answers: extra.answers, category: 'category' in extra ? extra.category : 'general' });
const due = r => C.due({ ...item, ...r.fields, delivered: item.delivered, purchased: item.purchased });

test('delivery-based windows start at delivery, purchase-based ones at purchase', () => {
  const amazon = run('amazon');
  assert.equal(amazon.fields.basis, 'delivery');
  assert.equal(due(amazon), '2026-11-03');
  const walmart = run('walmart');
  assert.equal(walmart.fields.basis, 'purchase');
  assert.equal(due(walmart), '2026-12-30');
});

test('without a delivery date, a delivery-based window counts from the earlier purchase date and says so', () => {
  const r = run('amazon', { item: { delivered: '' } });
  assert.equal(r.fields.basis, 'purchase');
  assert.equal(C.due({ ...item, delivered: '', ...r.fields }), '2026-10-31');
  assert.match(r.line, /purchase date until the delivery date is added/);
});

test('an unknown start (Nike) or a shipment start (Zara) uses the purchase date', () => {
  const nike = run('nike', { answers: { final: false } });
  assert.equal(nike.fields.basis, 'purchase');
  assert.equal(due(nike), '2026-11-30');
  assert.match(nike.line, /doesn't say if the window starts at purchase or delivery/);
  const zara = run('zara');
  assert.equal(zara.fields.basis, 'purchase');
  assert.match(zara.line, /counts from shipment/);
});

test('category exceptions change the window, and non-returnable categories say no', () => {
  assert.equal(due(run('target', { category: 'electronics' })), '2026-10-31');
  assert.equal(due(run('target', { category: 'apple-beats' })), '2026-10-15');
  assert.equal(due(run('target', { category: 'owned-brands' })), '2027-10-01');
  assert.equal(run('walmart', { category: 'major-appliances' }).fields.window, 2);
  const gift = run('target', { category: 'non-returnable' });
  assert.equal(gift.returnable, 'no');
  assert.equal(gift.fields.outcome, 'final');
  assert.match(gift.line, /^Not returnable/);
  const swim = run('fashionnova', { category: 'non-returnable' });
  assert.equal(swim.returnable, 'no');
});

test('categories that depend on opening ask about it', () => {
  const cosmetics = run('shein', { category: 'opened-cosmetics' });
  assert.equal(cosmetics.returnable, 'unsure');
  assert.ok(cosmetics.questions.some(q => q.id === 'opened'));
  assert.equal(run('shein', { category: 'opened-cosmetics', answers: { opened: true } }).returnable, 'no');
  assert.equal(run('shein', { category: 'opened-cosmetics', answers: { opened: false } }).returnable, 'yes');
});

test('membership extends the window only where the policy says so', () => {
  assert.ok(run('target').questions.some(q => q.id === 'member'));
  assert.equal(due(run('target', { answers: { member: true } })), '2027-01-29');
  // Best Buy members get 60 days on most products, but activatable devices stay 14.
  assert.equal(run('bestbuy', { answers: { member: true } }).fields.window, 60);
  const phone = run('bestbuy', { category: 'activatable-devices', answers: { member: true } });
  assert.equal(phone.fields.window, 14);
  assert.ok(!phone.questions.some(q => q.id === 'member'));
  // Not confirmed whether the Circle Card extra 30 days applies to electronics: keep the shorter window.
  assert.equal(due(run('target', { category: 'electronics', answers: { member: true } })), '2026-10-31');
  // Programs that don't change the window aren't asked about.
  assert.ok(!run('nike').questions.some(q => q.id === 'member'));
  assert.ok(!run('costco').questions.some(q => q.id === 'member'));
});

test('holiday extensions apply inside the season and only move the date later', () => {
  const holiday = run('amazon', { item: { purchased: '2025-11-20', delivered: '2025-11-22' } });
  assert.equal(C.due({ purchased: '2025-11-20', delivered: '2025-11-22', ...holiday.fields }), '2026-01-31');
  assert.equal(holiday.holiday.returnBy, '2026-01-31');
  assert.ok(holiday.facts.some(f => f.label === 'Holiday returns' && /^https:/.test(f.source)));
  const apple = run('amazon', { category: 'apple-products', item: { purchased: '2025-11-20', delivered: '2025-11-22' } });
  assert.equal(apple.holiday.returnBy, '2026-01-15');
  // Delivered in January: 30 days from delivery is already later than January 31, so the extension doesn't apply.
  const late = run('amazon', { item: { purchased: '2025-12-30', delivered: '2026-01-03' } });
  assert.equal(C.due({ purchased: '2025-12-30', delivered: '2026-01-03', ...late.fields }), '2026-02-02');
  assert.equal(late.holiday, null);
  // Outside the season nothing changes.
  assert.equal(run('amazon').holiday, null);
  // An unpublished holiday date never extends the window.
  const target = run('target', { category: 'electronics', item: { purchased: '2025-11-15' } });
  assert.equal(C.due({ purchased: '2025-11-15', ...target.fields }), '2025-12-15');
  assert.match(target.reason, /holiday return date wasn't published/);
});

test('final sale is asked about, and a yes means not returnable', () => {
  const nike = run('nike');
  assert.equal(nike.returnable, 'unsure');
  assert.equal(nike.questions[0].id, 'final');
  const final = run('nike', { answers: { final: true } });
  assert.equal(final.returnable, 'no');
  assert.equal(final.fields.outcome, 'final');
  assert.equal(run('nike', { answers: { final: false } }).returnable, 'yes');
});

test('unknowns: an unclassified item takes the shortest window that could apply and is never a yes', () => {
  const r = run('target', { category: null });
  assert.equal(r.returnable, 'unsure');
  assert.equal(r.fields.window, 14);
  assert.equal(r.fields.outcome, 'unknown');
  assert.match(r.reason, /shortest window/);
  assert.equal(r.category, null);
  // Costco: no fixed window for general merchandise, 90 days for electronics.
  assert.equal(run('costco', { category: null }).fields.window, 90);
  const costco = run('costco');
  assert.equal(costco.fields.window, null);
  assert.equal(C.due({ ...item, ...costco.fields }), null);
  // Unknown outcome stays unknown, unknown deadline meaning becomes the safer ship-by reading.
  const bestbuy = run('bestbuy');
  assert.equal(bestbuy.fields.outcome, 'unknown');
  assert.equal(bestbuy.fields.requirement, 'ship');
  assert.match(bestbuy.reason, /must be on its way/);
});

test('a store without a policy keeps the unconfirmed treatment', () => {
  const r = evaluate({ item: { ...item, retailer: 'Corner Boutique' }, policy: null });
  assert.equal(r.fields.confirmed, false);
  assert.equal(r.returnable, 'unsure');
  assert.equal(r.fields.window, undefined);
  assert.match(r.line, /Corner Boutique/);
});

test('unverified policies never answer yes', () => {
  const r = evaluate({ item, policy: { ...P.get('zara'), status: 'unverified' }, category: 'general' });
  assert.equal(r.returnable, 'unsure');
  assert.equal(r.fields.confirmed, false);
});

test('condition answers that break the policy make it uncertain, not a guessed refusal', () => {
  const nova = run('fashionnova');
  assert.deepEqual(nova.questions.map(q => q.id), ['damaged', 'tags', 'opened']);
  assert.equal(run('fashionnova', { answers: { tags: false } }).returnable, 'unsure');
  assert.equal(run('fashionnova', { answers: { tags: true, opened: false } }).returnable, 'yes');
  const damaged = run('fashionnova', { answers: { damaged: true } });
  assert.equal(damaged.fields.outcome, 'refund');
  assert.match(damaged.fields.conditions, /14 days of delivery/);
  assert.match(nova.line, /^Store credit · 5–7 business days/);
});

test('every result carries its facts with sources and dates, and at most three questions', () => {
  for (const p of P.list()) for (const category of [null, 'general', ...p.categories.map(c => c.id)]) {
    const r = evaluate({ item, policy: p, category });
    assert.ok(r.questions.length <= 3, p.id);
    assert.ok(['yes', 'no', 'unsure'].includes(r.returnable));
    for (const f of r.facts) { assert.match(f.source, /^https:\/\//, p.id); assert.match(f.checked, /^\d{4}-\d{2}-\d{2}$/, p.id); }
    if (r.returnable === 'yes') assert.ok(r.fields.confirmed, p.id);
  }
});

test('date edge cases: month ends, leap days, and a manual date the user set', () => {
  const leap = evaluate({ item: { ...item, purchased: '2028-01-30', delivered: '' }, policy: P.get('apple'), category: 'general' });
  assert.equal(C.due({ purchased: '2028-01-30', ...leap.fields }), '2028-02-13');
  const year = evaluate({ item: { ...item, purchased: '2026-12-31', channel: 'store' }, policy: P.get('target'), category: 'electronics' });
  assert.equal(C.due({ purchased: '2026-12-31', ...year.fields }), '2027-01-30');
  const manual = evaluate({ item: { ...item, dateSet: true }, policy: P.get('target'), category: 'general' });
  assert.equal(manual.fields.window, undefined);
  assert.equal(manual.fields.basis, undefined);
  assert.equal(C.due({ ...item, window: undefined }), null);
});

test('the classifier sends the categories and reads a structured answer', async () => {
  const calls = [];
  const client = { beta: { messages: { create: async req => { calls.push(req); return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"category":"electronics"}' }] }; } } } };
  const c = createClassifier({ client });
  assert.equal(await c.classify('Sony WH-1000XM5 headphones', P.get('target')), 'electronics');
  assert.equal(await c.classify('Sony WH-1000XM5 headphones', P.get('target')), 'electronics');
  assert.equal(calls.length, 1, 'cached');
  assert.equal(calls[0].model, 'claude-opus-5-5');
  assert.ok(calls[0].output_config.format.schema.properties.category.enum.includes('owned-brands'));
  assert.ok(!calls[0].output_config.format.schema.properties.category.enum.includes('final-sale'));
  assert.equal(await c.classify('Shoes', P.get('zara')), 'general', 'no categories, no call');
  const bad = createClassifier({ client: { beta: { messages: { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"category":"made-up"}' }] }) } } } });
  assert.equal(await bad.classify('Thing', P.get('target')), null);
  const refused = createClassifier({ client: { beta: { messages: { create: async () => ({ stop_reason: 'refusal', content: [] }) } } } });
  assert.equal(await refused.classify('Thing', P.get('target')), null);
  assert.equal(await createClassifier({ apiKey: '' }).classify('Thing', P.get('target')), null);
});

test('POST /api/policy matches the store, classifies once and returns the engine result', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'returnly-engine-'));
  const store = createStore({ file: path.join(dir, 'store.json') });
  await store.init();
  const storage = createStorage({ dir: path.join(dir, 'files') });
  const data = createData({ store, storage, jobs: { enqueue: async () => {} } });
  let classified = 0;
  const classifier = { classify: async () => { classified++; return 'apple-beats'; } };
  const server = http.createServer(createApp({ store, data, policies: P, classifier })).listen(0);
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, json: await res.json() };
  };
  assert.equal((await call('POST', '/api/policy', { item })).status, 401);
  await call('POST', '/api/signup', { name: 'Ana', email: 'ana@example.com', password: 'correct horse' });
  const first = await call('POST', '/api/policy', { item: { ...item, name: 'AirPods Pro', retailer: 'TARGET T-1234' } });
  assert.equal(first.status, 200);
  assert.equal(first.json.retailer.id, 'target');
  assert.equal(first.json.category, 'apple-beats');
  assert.equal(first.json.result.fields.window, 14);
  assert.equal(first.json.result.fields.confirmed, true);
  const again = await call('POST', '/api/policy', { item: { ...item, name: 'AirPods Pro', retailer: 'Target' }, retailerId: 'target', category: 'apple-beats', answers: { member: true, junk: 'x' } });
  assert.equal(classified, 1);
  assert.deepEqual(again.json.answers, { member: true });
  const unknown = await call('POST', '/api/policy', { item: { ...item, retailer: 'Corner Boutique' } });
  assert.equal(unknown.json.retailer, null);
  assert.equal(unknown.json.result.fields.confirmed, false);
});
