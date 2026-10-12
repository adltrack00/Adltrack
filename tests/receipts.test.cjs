const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), os = require('node:os'), path = require('node:path'), fs = require('node:fs'), vm = require('node:vm');
const { createReceiptReader, clean, scrub, printedWindow, MODEL } = require('../server/receipts');
const { loadPolicies } = require('../server/policies');
const { evaluate } = require('../server/engine');
const { createStore } = require('../server/store');
const { createData } = require('../server/data');
const { createStorage } = require('../server/storage');
const { createApp, receiptDraft } = require('../server/app');
const C = require('../core.js');

const P = loadPolicies();
const FIXTURES = path.join(__dirname, 'fixtures', 'receipts');
const answers = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'answers.json'), 'utf8'));
const photo = name => 'data:image/jpeg;base64,' + fs.readFileSync(path.join(FIXTURES, name + '.jpg')).toString('base64');
const TODAY = '2026-10-12';
// A mocked Anthropic client: answers with the fixture for the receipt, as the structured-output text block.
const mockClient = (answer, calls = []) => ({ beta: { messages: { create: async req => { calls.push(req); return { stop_reason: 'end_turn', usage: { input_tokens: 1800, output_tokens: 600 }, content: [{ type: 'text', text: JSON.stringify(typeof answer === 'function' ? answer(req) : answer) }] }; } } } });
const quiet = { log() {}, error() {} };

test('a store receipt is read into store, date, items, totals, payment type and printed policy', () => {
  const r = clean(answers['target-store'], { today: TODAY });
  assert.equal(r.store, 'TARGET');
  assert.equal(r.location, 'Brooklyn Atlantic Terminal, 139 Flatbush Ave, Brooklyn NY 11217');
  assert.equal(r.purchased, '2026-10-04');
  assert.equal(r.time, '18:42');
  assert.equal(r.orderNumber, '2-5610-2287-0145-0112-4', 'a receipt number that is not a card number stays');
  assert.equal(r.channel, 'store');
  assert.deepEqual(r.items.map(i => [i.name, i.quantity, i.price, i.code]), [['SONY WH1000XM5 HDPHN', null, 348, '211-01-0587'], ['A NEW DAY KNIT CRDGN', null, 25, '064-12-2205'], ['UP&UP PAPER TOWEL', 2, 12, '247-05-1182']]);
  assert.deepEqual(r.totals, { subtotal: 385, tax: 34.17, total: 419.17 });
  assert.equal(r.payment, 'credit');
  assert.match(r.policyText, /^Most unopened items in new condition returned within 90 days/);
  assert.deepEqual(r.notes, []);
});

test('the draft uses the matched store name and splits a line bought several times into one product each', () => {
  const r = clean(answers['target-store'], { today: TODAY });
  const d = receiptDraft(r, P.get(P.match(r.store).id));
  assert.equal(d.retailer, 'Target');
  assert.equal(d.purchased, '2026-10-04');
  assert.equal(d.channel, 'store');
  assert.deepEqual(d.products.map(p => [p.name, p.price]), [['SONY WH1000XM5 HDPHN', 348], ['A NEW DAY KNIT CRDGN', 25], ['UP&UP PAPER TOWEL', 6], ['UP&UP PAPER TOWEL', 6]]);
  const online = clean(answers['amazon-order'], { today: TODAY });
  assert.equal(receiptDraft(online, P.get(P.match(online.store).id)).retailer, 'Amazon');
  assert.equal(online.channel, 'online');
  const unknown = clean(answers['corner-boutique'], { today: TODAY });
  assert.equal(receiptDraft(unknown, null).retailer, 'MAISON LUNE', 'a store we don’t have keeps its printed name');
});

test('anything the model was unsure about stays empty and is named, never guessed', () => {
  const r = clean({ ...answers['target-store'], store: { name: null, location: null }, purchase_date: null, items: [{ name: 'SONY WH1000XM5 HDPHN', quantity: null, price: null, item_code: null }, { name: null, quantity: null, price: 25, item_code: null }] }, { today: TODAY });
  assert.equal(r.store, null);
  assert.equal(r.purchased, null);
  const d = receiptDraft(r, null);
  assert.equal(d.retailer, '');
  assert.equal(d.purchased, '');
  assert.deepEqual(d.products.map(p => [p.name, p.price]), [['SONY WH1000XM5 HDPHN', ''], ['', 25]]);
  assert.match(r.notes[0], /couldn’t read the store name, the purchase date or some item names or prices/);
  assert.match(r.notes[1], /counts from today/);
  // Misread or impossible values are dropped rather than kept.
  const odd = clean({ ...answers['target-store'], purchase_date: '2026-11-30', purchase_time: '25:61', channel: 'phone', payment_type: 'bitcoin', items: [{ name: 'Lamp', quantity: -1, price: -5, item_code: null }] }, { today: TODAY });
  assert.equal(odd.purchased, null, 'a date after today is a misread');
  assert.equal(odd.time, null);
  assert.equal(odd.channel, null);
  assert.equal(odd.payment, null);
  assert.deepEqual(odd.items, [{ name: 'Lamp', quantity: null, price: null, code: null }]);
  assert.equal(clean({ ...answers['target-store'], purchase_date: '2026-02-30' }, { today: TODAY }).purchased, null);
});

test('the model’s "not sure" values (empty text, "unknown", "none") come back empty', () => {
  const r = clean({ problem: 'none', store: { name: '', location: '' }, purchase_date: '', purchase_time: '', order_number: '', channel: 'unknown', items: [{ name: 'Lamp', quantity: 1, price: 20, item_code: '' }], totals: { subtotal: null, tax: null, total: null }, payment_type: 'unknown', return_policy_text: '' }, { today: TODAY });
  assert.deepEqual({ ...r, notes: undefined }, { problem: null, store: null, location: null, purchased: null, time: null, orderNumber: null, channel: null, items: [{ name: 'Lamp', quantity: 1, price: 20, code: null }], totals: { subtotal: null, tax: null, total: null }, payment: null, policyText: null, notes: undefined });
  assert.equal(receiptDraft(r, null).products.length, 1, 'quantity 1 stays one card');
});

test('blurry, dark, cropped and non-receipt photos explain what went wrong', () => {
  const blurry = clean(answers.blurry, { today: TODAY });
  assert.equal(blurry.items.length, 0);
  assert.match(blurry.notes[0], /too blurry to read/);
  assert.match(clean({ ...answers.blurry, problem: 'not_receipt' }).notes[0], /doesn’t look like a receipt/);
  assert.match(clean({ ...answers.blurry, problem: null }).notes[0], /couldn’t find any items/);
  const cropped = clean(answers['walmart-long-1'], { today: TODAY });
  assert.equal(cropped.items.length, 5);
  assert.match(cropped.notes[0], /cut off\. Check the items, or go back and scan the rest/);
  assert.match(cropped.notes[1], /purchase date/);
});

test('card numbers never leave the reader, whatever field they end up in', () => {
  assert.equal(scrub('Visa 4111 1111 1111 1111'), 'Visa');
  assert.equal(scrub('4111-1111-1111-1111'), '');
  assert.equal(scrub('DEBIT CARD ****  ****  **** 8862'), 'DEBIT CARD');
  assert.equal(scrub('Card XXXXXXXXXXXX0457 approved'), 'Card approved');
  assert.equal(scrub('TC# 2849 6730 1957 2846 1093'), 'TC# 2849 6730 1957 2846 1093', 'a transaction number that fails the card check stays');
  assert.equal(scrub('Order #112-4839201-6638715'), 'Order #112-4839201-6638715');
  const r = clean({ ...answers['corner-boutique'], order_number: '5500 0000 0000 0004', items: [{ name: 'Dress paid with 5500000000000004', quantity: null, price: 148, item_code: null }], return_policy_text: 'Returns within 14 days. Card ****5521' }, { today: TODAY });
  const all = JSON.stringify(r);
  assert.ok(!/5500\s?0000|0004\b|5521/.test(all), all);
  assert.equal(r.orderNumber, null);
});

test('the shortest window printed on a receipt is read from its own words', () => {
  assert.equal(printedWindow(answers['target-store'].return_policy_text), 90);
  assert.equal(printedWindow(answers['corner-boutique'].return_policy_text), 14);
  assert.equal(printedWindow('Refunds within 30 days. Exchanges within 60 days.'), 30);
  assert.equal(printedWindow('Returns: 7-day window with receipt'), 7);
  assert.equal(printedWindow('All sales final.'), null);
  assert.equal(printedWindow('Thank you! Open 7 days a week.'), null, 'a number of days that is not about returns');
  assert.equal(printedWindow(null), null);
});

test('the reader sends every page to a vision model with structured output and the refusal fallback', async () => {
  const calls = [];
  const reader = createReceiptReader({ client: mockClient(answers['walmart-long'], calls), log: quiet });
  const pages = ['walmart-long-1', 'walmart-long-2'].map(n => ({ contentType: 'image/jpeg', body: fs.readFileSync(path.join(FIXTURES, n + '.jpg')) }));
  pages.push({ contentType: 'application/pdf', body: Buffer.from('%PDF-1.4\n') });
  const r = await reader.read(pages, { today: TODAY });
  assert.equal(r.items.length, 7);
  assert.equal(r.store, 'Walmart');
  const req = calls[0];
  assert.equal(req.model, MODEL);
  assert.equal(MODEL, 'claude-opus-5-5');
  assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(req.fallbacks, 'default');
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.ok(req.output_config.format.schema.required.includes('return_policy_text'));
  assert.ok(!JSON.stringify(req.output_config.format.schema).includes('card_number'));
  assert.ok((JSON.stringify(req.output_config.format.schema).match(/anyOf/g) || []).length <= 8, 'few union fields: structured outputs limit them');
  const content = req.messages[0].content;
  assert.deepEqual(content.map(b => b.type), ['image', 'image', 'document', 'text']);
  assert.equal(content[0].source.media_type, 'image/jpeg');
  assert.equal(content[2].source.media_type, 'application/pdf');
  assert.match(content[3].text, /3 pages are one receipt/);
  assert.match(req.system, /Never write any part of a card number/);

  const refused = createReceiptReader({ client: { beta: { messages: { create: async () => ({ stop_reason: 'refusal', content: [] }) } } }, log: quiet });
  assert.equal(await refused.read(pages), null);
  const broken = createReceiptReader({ client: { beta: { messages: { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] }) } } }, log: quiet });
  assert.equal(await broken.read(pages), null);
  const failing = createReceiptReader({ client: { beta: { messages: { create: async () => { throw new Error('overloaded'); } } } }, log: quiet });
  assert.equal(await failing.read(pages), null);
  const none = createReceiptReader({ apiKey: '' });
  assert.equal(none.available(), false);
  assert.equal(await none.read(pages), null);
});

test('a printed return window becomes a fact, and the date for a store we don’t have', () => {
  const item = { name: 'Silk slip dress', retailer: 'MAISON LUNE', purchased: '2026-10-06', channel: 'store', receiptPolicy: answers['corner-boutique'].return_policy_text };
  const r = evaluate({ item, policy: null });
  assert.equal(r.fields.window, 14);
  assert.equal(r.fields.basis, 'purchase');
  assert.equal(r.fields.confirmed, true);
  assert.equal(r.fields.policySource, 'Printed on your receipt');
  assert.equal(r.returnable, 'unsure');
  assert.equal(r.facts[0].source, 'Printed on your receipt');
  assert.equal(r.facts[0].value, item.receiptPolicy);
  assert.equal(r.facts[0].checked, '2026-10-06');
  assert.equal(C.due({ ...item, ...r.fields }), '2026-10-20');
  assert.match(r.line, /^Printed on your receipt: 14 days from purchase/);
  // A manual date stays the user's.
  assert.equal(evaluate({ item: { ...item, dateSet: true }, policy: null }).fields.window, undefined);
  // Printed text with no window, or no text: the existing unconfirmed treatment stays.
  const vague = evaluate({ item: { ...item, receiptPolicy: 'Exchanges only. Thank you!' }, policy: null });
  assert.equal(vague.fields.confirmed, false);
  assert.equal(vague.facts.length, 1);
  assert.equal(evaluate({ item: { ...item, receiptPolicy: '' }, policy: null }).facts.length, 0);
});

test('for a store we have, a shorter printed window wins and a longer one changes nothing', () => {
  const base = { name: 'Cardigan', retailer: 'Target', purchased: '2026-10-04', channel: 'store' };
  const plain = evaluate({ item: base, policy: P.get('target'), category: 'general' });
  assert.equal(plain.fields.window, 90);
  const same = evaluate({ item: { ...base, receiptPolicy: answers['target-store'].return_policy_text }, policy: P.get('target'), category: 'general' });
  assert.equal(same.fields.window, 90);
  assert.ok(same.facts.some(f => f.source === 'Printed on your receipt'));
  const shorter = evaluate({ item: { ...base, receiptPolicy: 'Returns within 30 days with receipt.' }, policy: P.get('target'), category: 'general' });
  assert.equal(shorter.fields.window, 30);
  assert.equal(shorter.fields.basis, 'purchase');
  assert.match(shorter.reason + shorter.line, /printed on your receipt gives 30 days/);
});

// Postgres runs too when TEST_DATABASE_URL points at a throwaway database (its tables are dropped).
const PG = process.env.TEST_DATABASE_URL || '';
const STORES = [['file store', null], ...(PG ? [['Postgres', PG]] : [])];

async function boot(t, receipts, databaseUrl = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'returnly-receipts-'));
  if (databaseUrl) {
    const { Client } = require('pg');
    const c = new Client({ connectionString: databaseUrl });
    await c.connect(); await c.query('drop schema public cascade; create schema public'); await c.end();
  }
  const store = createStore({ databaseUrl, file: path.join(dir, 'store.json') });
  await store.init();
  const storage = createStorage({ dir: path.join(dir, 'files') });
  const data = createData({ store, storage, jobs: { enqueue: async () => {} } });
  const server = http.createServer(createApp({ store, data, policies: P, receipts })).listen(0);
  t.after(async () => { server.close(); await store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  return { call, data, store };
}

for (const [kind, databaseUrl] of STORES) test(`POST /api/receipts/read saves the pages privately, reads them and returns the draft (${kind})`, async t => {
  let answer = answers['target-store'];
  const calls = [];
  const reader = createReceiptReader({ client: mockClient(() => answer, calls), log: quiet });
  const { call, data, store } = await boot(t, reader, databaseUrl);
  assert.equal((await call('POST', '/api/receipts/read', { purchaseId: 'p1', pages: [photo('target-store')] })).status, 401);
  await call('POST', '/api/signup', { name: 'Ana', email: 'ana@example.com', password: 'correct horse' });
  assert.equal((await call('POST', '/api/receipts/read', { purchaseId: 'p1', pages: ['data:text/plain;base64,aGk='] })).status, 400);
  assert.equal((await call('POST', '/api/receipts/read', { purchaseId: 'p1', pages: Array(5).fill(photo('blurry')) })).status, 400);

  const r = await call('POST', '/api/receipts/read', { purchaseId: 'p1', pages: [photo('target-store')], today: TODAY });
  assert.equal(r.status, 200);
  assert.equal(r.json.retailer.id, 'target');
  assert.equal(r.json.draft.retailer, 'Target');
  assert.equal(r.json.draft.purchased, '2026-10-04');
  assert.equal(r.json.draft.products.length, 4);
  assert.equal(r.json.draft.orderNumber, '2-5610-2287-0145-0112-4');
  assert.equal(r.json.draft.payment, 'credit');
  assert.ok(!JSON.stringify(r.json).includes('0457'), 'no part of the card number');
  assert.equal(r.json.files.length, 1);
  const [purchase] = (await call('GET', '/api/purchases')).json.purchases;
  assert.equal(purchase.id, 'p1');
  assert.equal(purchase.source, 'receipt');
  assert.equal(purchase.store, 'Target');
  assert.equal(purchase.orderNumber, '2-5610-2287-0145-0112-4');
  assert.equal(purchase.retailerId, 'target');
  assert.equal(purchase.receipt, r.json.files[0]);

  // A long receipt: the second photo is added; the first page is kept, not stored twice.
  answer = answers['walmart-long'];
  const user = (await store.findUserByEmail('ana@example.com')).id;
  const long = await call('POST', '/api/receipts/read', { purchaseId: 'p2', pages: [photo('walmart-long-1')], today: TODAY });
  const both = await call('POST', '/api/receipts/read', { purchaseId: 'p2', pages: [photo('walmart-long-1'), photo('walmart-long-2')], today: TODAY });
  assert.equal(both.json.files[0], long.json.files[0]);
  assert.equal(both.json.files.length, 2);
  assert.equal(both.json.draft.products.length, 7);
  assert.equal(calls.at(-1).messages[0].content.filter(b => b.type === 'image').length, 2);
  const p2 = (await call('GET', '/api/purchases')).json.purchases.find(p => p.id === 'p2');
  assert.deepEqual([p2.receipt, ...p2.receiptPages], both.json.files);
  assert.equal((await store.listFiles(user)).length, 3);

  // Saving the items keeps the receipt with the purchase; deleting them deletes the receipt pages too.
  for (const [n, p] of both.json.draft.products.slice(0, 2).entries()) assert.equal((await call('POST', '/api/items', { id: 'w' + n, purchaseId: 'p2', name: p.name, price: p.price, retailer: 'Walmart', purchased: '2026-10-02' })).status, 201);
  assert.equal((await call('GET', '/api/purchases')).json.purchases.find(p => p.id === 'p2').receipt, both.json.files[0]);
  assert.equal((await call('GET', both.json.files[1])).status, 200);
  await call('DELETE', '/api/items/w0', {});
  await call('DELETE', '/api/items/w1', {});
  assert.equal((await call('GET', both.json.files[0])).status, 404);
  assert.equal((await call('GET', both.json.files[1])).status, 404);

  // A purchase that already has its items can't be turned into a scan.
  await call('POST', '/api/items', { id: 'm1', name: 'Mug', price: 5 });
  const manual = (await call('GET', '/api/purchases')).json.purchases.find(p => p.source === 'manual');
  assert.equal((await call('POST', '/api/receipts/read', { purchaseId: manual.id, pages: [photo('target-store')] })).status, 409);

  // An abandoned scan (never saved with an item) is cleaned up after two days, with its file.
  assert.equal(await data.cleanupReceipts(new Date(Date.now() - 48 * 3600e3)), 0, 'not yet');
  assert.equal(await data.cleanupReceipts(new Date(Date.now() + 1000)), 1, 'two days later');
  assert.equal((await call('GET', r.json.files[0])).status, 404);
  assert.deepEqual((await call('GET', '/api/purchases')).json.purchases.map(p => p.id), [manual.id]);
});

test('unreadable photos, no AI key and no store name are each handled', async t => {
  const reader = createReceiptReader({ client: mockClient(req => req.messages[0].content.length > 2 ? answers['walmart-long'] : answers.blurry), log: quiet });
  const { call } = await boot(t, reader);
  await call('POST', '/api/signup', { name: 'Ana', email: 'ana@example.com', password: 'correct horse' });
  const blurry = await call('POST', '/api/receipts/read', { purchaseId: 'b1', pages: [photo('blurry')] });
  assert.equal(blurry.status, 200);
  assert.deepEqual(blurry.json.draft.products, []);
  assert.match(blurry.json.draft.notes[0], /too blurry/);

  const off = await boot(t, createReceiptReader({ apiKey: '' }));
  await off.call('POST', '/api/signup', { name: 'Bo', email: 'bo@example.com', password: 'correct horse' });
  const unavailable = await off.call('POST', '/api/receipts/read', { purchaseId: 'u1', pages: [photo('target-store')] });
  assert.equal(unavailable.json.receipt, null);
  assert.equal(unavailable.json.reason, 'unavailable');
  assert.equal(unavailable.json.files.length, 1, 'the receipt is still saved privately');

  const nameless = await boot(t, createReceiptReader({ client: mockClient({ ...answers['corner-boutique'], store: { name: null, location: null } }), log: quiet }));
  await nameless.call('POST', '/api/signup', { name: 'Cy', email: 'cy@example.com', password: 'correct horse' });
  const n = await nameless.call('POST', '/api/receipts/read', { purchaseId: 'n1', pages: [photo('corner-boutique')], today: TODAY });
  assert.equal(n.json.retailer, null);
  assert.equal(n.json.draft.retailer, '');
  assert.equal(n.json.draft.products.length, 2);
  assert.match(n.json.draft.notes.join(' '), /couldn’t read the store name/);
});

/* The Scan step in the app: a photo is read and the existing Item card opens filled in. */
function journey(response) {
  const listeners = {}, requests = [];
  const ctx = { render() {}, exampleOrder() {}, view: 'upload', draft: { products: [], channel: 'online', evidence: [], retailer: '', purchased: '2026-10-12', delivered: '' }, evidenceFiles: [], items: [], settings: { time: '09:00', daily: false }, selected: null,
    document: { body: { classList: { toggle() {} } }, addEventListener(n, fn) { (listeners[n] = listeners[n] || []).push(fn); }, hidden: false, createElement() { return {}; } },
    window: { scrollTo() {}, addEventListener() {} }, navigator: {}, $: () => null, crypto: { randomUUID: () => 'scan-1' }, today: () => '2026-10-12', save() {}, toast() {}, find: id => ctx.items.find(i => i.id === id), gallery() {}, C: {}, esc: s => s, icon: () => '',
    fetch: async (url, opts) => { requests.push({ url, body: JSON.parse(opts.body) }); return { ok: true, json: async () => typeof response === 'function' ? response() : response }; } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('guided.js', 'utf8'), ctx);
  const file = { name: 'Receipt-photo.jpg', type: 'image/jpeg', size: 30000 };
  return { ctx, requests, scan: () => ctx.acceptReceipt(file, photo('target-store')), submit: () => listeners.submit.forEach(fn => fn({ target: { id: 'flow-item-form' }, preventDefault() {} })) };
}

test('scanning fills the existing Item card: names and prices, the real store and date', async () => {
  const r = clean(answers['target-store'], { today: TODAY });
  const x = journey({ purchaseId: 'scan-1', files: ['/api/files/x'], receipt: r, retailer: { id: 'target', name: 'Target' }, draft: receiptDraft(r, P.get('target')) });
  await x.scan();
  assert.equal(x.requests[0].url, '/api/receipts/read');
  assert.equal(x.requests[0].body.purchaseId, 'scan-1');
  assert.equal(x.requests[0].body.pages.length, 1);
  assert.equal(x.ctx.view, 'review');
  assert.equal(x.ctx.draft.retailer, 'Target');
  assert.equal(x.ctx.draft.purchased, '2026-10-04');
  assert.equal(x.ctx.draft.channel, 'store');
  assert.deepEqual(x.ctx.draft.products.map(p => [p.name, p.price, p.intent]), [['SONY WH1000XM5 HDPHN', 348, 'keep'], ['A NEW DAY KNIT CRDGN', 25, 'keep'], ['UP&UP PAPER TOWEL', 6, 'keep'], ['UP&UP PAPER TOWEL', 6, 'keep']]);
  assert.equal(vm.runInContext('journey.error', x.ctx), '');
  // Saving joins the scan's purchase and keeps what the receipt said.
  x.ctx.draft.products[0].intent = 'return';
  x.submit();
  assert.equal(x.ctx.items.length, 4);
  const [first] = x.ctx.items;
  assert.equal(first.purchaseId, 'scan-1');
  assert.equal(first.retailer, 'Target');
  assert.equal(first.purchased, '2026-10-04');
  assert.equal(first.code, '211-01-0587');
  assert.equal(first.orderNumber, '2-5610-2287-0145-0112-4');
  assert.match(first.receiptPolicy, /within 90 days/);
  assert.equal(first.status, 'deciding');
  assert.equal(x.ctx.items[1].status, 'kept');
});

test('a blurry photo stays on Scan with the reason; no reading leaves the Item card empty and says so', async () => {
  const blurry = clean(answers.blurry);
  const x = journey({ purchaseId: 'scan-1', files: [], receipt: blurry, draft: receiptDraft(blurry, null) });
  await x.scan();
  assert.equal(x.ctx.view, 'upload');
  assert.match(vm.runInContext('journey.error', x.ctx), /too blurry/);
  assert.equal(x.ctx.draft.products.length, 0);

  const y = journey({ purchaseId: 'scan-1', files: ['/api/files/x'], receipt: null, reason: 'unavailable' });
  await y.scan();
  assert.equal(y.ctx.view, 'review');
  assert.equal(y.ctx.draft.products.length, 1);
  assert.equal(y.ctx.draft.products[0].name, '');
  assert.match(vm.runInContext('journey.error', y.ctx), /isn’t available right now/);
});

test('a cut-off receipt keeps its pages, so the next photo is read together with them', async () => {
  const part = clean(answers['walmart-long-1'], { today: TODAY }), whole = clean(answers['walmart-long'], { today: TODAY });
  let n = 0;
  const x = journey(() => { const r = n++ ? whole : part; return { purchaseId: 'scan-1', files: [], receipt: r, draft: receiptDraft(r, P.get('walmart')) }; });
  await x.scan();
  assert.match(vm.runInContext('journey.error', x.ctx), /cut off/);
  assert.equal(x.ctx.draft.products.length, 5);
  assert.equal(x.ctx.draft.purchased, '');
  await x.scan();
  assert.equal(x.requests[1].body.pages.length, 2);
  assert.equal(x.requests[1].body.purchaseId, 'scan-1');
  assert.equal(x.ctx.draft.products.length, 7);
  assert.equal(x.ctx.draft.purchased, '2026-10-02');
});
