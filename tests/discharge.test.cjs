const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), os = require('node:os'), path = require('node:path'), fs = require('node:fs'), vm = require('node:vm');
const { createDischargeReader, clean, dischargeDraft, SCHEMA, MAX_PAGES } = require('../server/discharge');
const { createStore } = require('../server/store');
const { createData } = require('../server/data');
const { createStorage } = require('../server/storage');
const { createApp } = require('../server/app');

// Made-up discharge papers for a fictional patient, as the model would answer them.
const PAPERS = {
  problem: 'none',
  hospital: 'Riverside General Hospital',
  discharge_date: '2026-10-13',
  medications: [
    { name: 'Lisinopril', strength: '10 mg', dose: '1 tablet', route: 'by mouth', frequency: 'once a day', times: ['08:00'], instructions: 'Take 1 tablet by mouth every morning.', duration: '', status: 'new', prescriber_name: 'Dr. Maya Patel', prescriber_phone: '(555) 201-3344' },
    { name: 'Acetaminophen', strength: '500 mg', dose: '2 tablets', route: 'by mouth', frequency: 'every 6 hours as needed for pain', times: [], instructions: 'Take 2 tablets every 6 hours as needed for pain. Do not take more than 8 tablets in 24 hours.', duration: 'for 7 days', status: 'continue', prescriber_name: 'Dr. Maya Patel', prescriber_phone: '(555) 201-3344' },
    { name: 'Metoprolol', strength: '25 mg', dose: '', route: '', frequency: '', times: ['20:00', '08:00', '8 AM', '25:00'], instructions: '', duration: '', status: 'changed', prescriber_name: '', prescriber_phone: '' },
    { name: 'Ibuprofen', strength: '200 mg', dose: '', route: '', frequency: '', times: [], instructions: 'Stop taking ibuprofen.', duration: '', status: 'stop', prescriber_name: '', prescriber_phone: '' },
    { name: '', strength: '5 mg', dose: '', route: '', frequency: '', times: [], instructions: '', duration: '', status: 'unknown', prescriber_name: '', prescriber_phone: '' }
  ],
  pharmacy: { name: 'Main Street Pharmacy', address: '12 Main St, Springfield', phone: '555-300-1200' },
  appointments: [{ with: 'Dr. Maya Patel, cardiology', place: 'Riverside Heart Clinic', date: '2026-10-20', time: '14:00', phone: '555-201-3344', note: 'Bring your medication list.' }],
  warning_signs: [{ text: 'Call your doctor if you have a fever over 101°F.', urgent: false }, { text: 'Call 911 if you have chest pain or trouble breathing.', urgent: true }],
  contacts: [{ name: 'Nurse line', phone: '555-201-9000' }, { name: 'MRN 00482913', phone: 'none' }]
};
const mockClient = (answer, calls = []) => ({ beta: { messages: { create: async req => { calls.push(req); return { stop_reason: 'end_turn', usage: { input_tokens: 4000, output_tokens: 900 }, content: [{ type: 'text', text: JSON.stringify(answer) }] }; } } } });
const quiet = { log() {}, error() {} };
const page = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, 'fixtures', 'receipts', 'target-store.jpg')).toString('base64');

test('discharge papers are read as printed: medications, prescriber, pharmacy, appointments and warning signs', () => {
  const d = clean(PAPERS);
  assert.equal(d.hospital, 'Riverside General Hospital');
  assert.equal(d.discharged, '2026-10-13');
  assert.deepEqual(d.medications.map(m => m.name), ['Lisinopril', 'Acetaminophen', 'Metoprolol', 'Ibuprofen'], 'a line with no name is left out');
  const [lis, ace, met] = d.medications;
  assert.equal(lis.instructions, 'Take 1 tablet by mouth every morning.');
  assert.deepEqual(lis.prescriber, { name: 'Dr. Maya Patel', phone: '(555) 201-3344' });
  assert.deepEqual(ace.times, [], '"every 6 hours" is never turned into clock times');
  assert.deepEqual(met.times, ['08:00', '20:00'], 'only real HH:MM times are kept, in order');
  assert.deepEqual(d.pharmacy, { name: 'Main Street Pharmacy', address: '12 Main St, Springfield', phone: '555-300-1200' });
  assert.equal(d.appointments[0].date, '2026-10-20');
  assert.equal(d.warningSigns.filter(w => w.urgent).length, 1);
  assert.deepEqual(d.contacts, [{ name: 'Nurse line', phone: '555-201-9000' }], 'a contact without a phone number is dropped');
});

test('stopped medications are not added, and what is missing is named', () => {
  const d = clean(PAPERS);
  const draft = dischargeDraft(d);
  assert.deepEqual(draft.products.map(p => p.name), ['Lisinopril 10 mg', 'Acetaminophen 500 mg', 'Metoprolol 25 mg']);
  assert.ok(draft.notes.some(n => /stop Ibuprofen/.test(n)));
  assert.ok(draft.notes.some(n => /how to take some medications/.test(n) && /who prescribed some medications/.test(n)));
  assert.equal(draft.products[0].pharmacy.name, 'Main Street Pharmacy');
  assert.equal(draft.products[0].medStatus, 'new');
  assert.equal(draft.discharge.warningSigns.length, 2);
  assert.equal(draft.products[1].price, '');
});

test('record, insurance and card numbers never reach a card', () => {
  const d = clean({ ...PAPERS, medications: [{ ...PAPERS.medications[0], instructions: 'Take 1 tablet daily. MRN: 00482913. Paid with 4111 1111 1111 1111.' }] });
  const all = JSON.stringify(d);
  assert.ok(!all.includes('00482913'));
  assert.ok(!all.includes('4111'));
  assert.match(d.medications[0].instructions, /^Take 1 tablet daily\./);
});

test('unreadable papers say why, and an empty answer never invents a medication', () => {
  assert.deepEqual(clean({ problem: 'blurry', medications: [] }).notes, ['This photo is too blurry to read. Hold the page flat and try again.']);
  assert.deepEqual(clean({ problem: 'not_discharge' }).medications, []);
  assert.match(clean(null).notes[0], /couldn’t find any medications/);
  assert.equal(clean({ ...PAPERS, discharge_date: '03/04/26' }).discharged, null);
});

test('the schema asks the model for every field it fills in', () => {
  const med = SCHEMA.properties.medications.items;
  assert.deepEqual(med.required, Object.keys(med.properties));
  assert.ok(med.properties.status.enum.includes('stop'));
});

test('the reader sends every page and returns null when there is no key or the model refuses', async () => {
  const calls = [];
  const reader = createDischargeReader({ client: mockClient(PAPERS, calls), log: quiet });
  const pages = [{ contentType: 'image/jpeg', body: Buffer.from('a') }, { contentType: 'application/pdf', body: Buffer.from('b') }];
  const d = await reader.read(pages);
  assert.equal(d.medications.length, 4);
  assert.deepEqual(calls[0].messages[0].content.map(c => c.type), ['image', 'document', 'text']);
  assert.equal(createDischargeReader({ apiKey: '', log: quiet }).available(), false);
  const refusing = createDischargeReader({ client: { beta: { messages: { create: async () => ({ stop_reason: 'refusal', content: [] }) } } }, log: quiet });
  assert.equal(await refusing.read(pages), null);
});

async function boot(t, discharge) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adltrack-discharge-'));
  const store = createStore({ databaseUrl: null, file: path.join(dir, 'store.json') });
  await store.init();
  const storage = createStorage({ dir: path.join(dir, 'files') });
  const data = createData({ store, storage, jobs: { enqueue: async () => {} } });
  const server = http.createServer(createApp({ store, data, discharge })).listen(0);
  t.after(async () => { server.close(); await store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  };
}

test('POST /api/discharge/read saves the pages privately and returns one card per medication', async t => {
  const call = await boot(t, createDischargeReader({ client: mockClient(PAPERS), log: quiet }));
  assert.equal((await call('POST', '/api/discharge/read', { purchaseId: 'd1', pages: [page] })).status, 401);
  await call('POST', '/api/signup', { name: 'Ana', email: 'ana@example.com', password: 'correct horse' });
  const tooMany = await call('POST', '/api/discharge/read', { purchaseId: 'd1', pages: Array(MAX_PAGES + 1).fill(page) });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.json.error, /discharge papers/);
  const r = await call('POST', '/api/discharge/read', { purchaseId: 'd1', pages: [page, page] });
  assert.equal(r.status, 200);
  assert.equal(r.json.files.length, 2);
  assert.equal(r.json.draft.products.length, 3);
  assert.equal(r.json.draft.products[0].prescriber.name, 'Dr. Maya Patel');
});

test('without a reader the pages are still saved and the Confirm card opens empty', async t => {
  const call = await boot(t, null);
  await call('POST', '/api/signup', { name: 'Ana', email: 'ana@example.com', password: 'correct horse' });
  const r = await call('POST', '/api/discharge/read', { purchaseId: 'd2', pages: [page] });
  assert.equal(r.status, 200);
  assert.equal(r.json.papers, null);
  assert.equal(r.json.reason, 'unavailable');
  assert.equal(r.json.files.length, 1);
});

/* The Scan step in the app: a page of the discharge papers is read and the Confirm card opens with each medication. */
function journey(response) {
  const listeners = {}, requests = [];
  const ctx = { render() {}, exampleOrder() {}, view: 'upload', draft: { products: [], channel: 'online', evidence: [], retailer: '', purchased: '2026-10-12', delivered: '' }, evidenceFiles: [], items: [], settings: { time: '09:00', daily: false }, selected: null,
    document: { body: { classList: { toggle() {} } }, addEventListener(n, fn) { (listeners[n] = listeners[n] || []).push(fn); }, hidden: false, createElement() { return {}; } },
    window: { scrollTo() {}, addEventListener() {} }, navigator: {}, $: () => null, crypto: { randomUUID: () => 'scan-1' }, today: () => '2026-10-12', save() {}, toast() {}, find: id => ctx.items.find(i => i.id === id), gallery() {}, C: {}, esc: s => s, icon: () => '',
    fetch: async (url, opts) => { requests.push({ url, body: JSON.parse(opts.body) }); return { ok: true, json: async () => typeof response === 'function' ? response() : response }; } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('guided.js', 'utf8'), ctx);
  const file = { name: 'Discharge-page-1.jpg', type: 'image/jpeg', size: 30000 };
  return { ctx, requests, scan: () => ctx.acceptReceipt(file, page), submit: () => listeners.submit.forEach(fn => fn({ target: { id: 'flow-item-form' }, preventDefault() {} })), click: button => listeners.click.forEach(fn => fn({ target: { closest: () => button }, preventDefault() {} })) };
}

test('scanning fills the Confirm card with each medication as printed, and saving keeps it on the card', async () => {
  const d = clean(PAPERS);
  const x = journey({ purchaseId: 'scan-1', files: ['/api/files/x'], papers: d, draft: dischargeDraft(d) });
  await x.scan();
  assert.equal(x.requests[0].url, '/api/discharge/read');
  assert.equal(x.requests[0].body.purchaseId, 'scan-1');
  assert.equal(x.ctx.view, 'review');
  assert.deepEqual(x.ctx.draft.products.map(p => p.name), ['Lisinopril 10 mg', 'Acetaminophen 500 mg', 'Metoprolol 25 mg']);
  assert.match(vm.runInContext('journey.error', x.ctx), /stop Ibuprofen/);
  x.submit();
  const [lis] = x.ctx.items;
  assert.equal(lis.purchaseId, 'scan-1');
  assert.equal(lis.instructions, 'Take 1 tablet by mouth every morning.');
  assert.deepEqual(lis.times, ['08:00']);
  assert.equal(lis.prescriber.name, 'Dr. Maya Patel');
  assert.equal(lis.pharmacy.name, 'Main Street Pharmacy');
  assert.equal(lis.discharge.hospital, 'Riverside General Hospital');
});

test('a blurry page stays on Scan with the reason; no reading opens an empty Confirm card and says so', async () => {
  const blurry = clean({ problem: 'blurry', medications: [] });
  const x = journey({ purchaseId: 'scan-1', files: [], papers: blurry, draft: dischargeDraft(blurry) });
  await x.scan();
  assert.equal(x.ctx.view, 'upload');
  assert.match(vm.runInContext('journey.error', x.ctx), /too blurry/);

  const y = journey({ purchaseId: 'scan-1', files: ['/api/files/x'], papers: null, reason: 'unavailable' });
  await y.scan();
  assert.equal(y.ctx.view, 'review');
  assert.equal(y.ctx.draft.products.length, 1);
  assert.equal(y.ctx.draft.products[0].name, '');
  assert.match(vm.runInContext('journey.error', y.ctx), /isn’t available right now/);
});

test('a cut-off page keeps the pages, so the next photo is read together with them', async () => {
  const part = clean({ ...PAPERS, problem: 'cropped', medications: PAPERS.medications.slice(0, 1) }), whole = clean(PAPERS);
  let n = 0;
  const x = journey(() => { const d = n++ ? whole : part; return { purchaseId: 'scan-1', files: [], papers: d, draft: dischargeDraft(d) }; });
  await x.scan();
  assert.match(vm.runInContext('journey.error', x.ctx), /cut off/);
  assert.equal(x.ctx.draft.products.length, 1);
  await x.scan();
  assert.equal(x.requests[1].body.pages.length, 2);
  assert.equal(x.ctx.draft.products.length, 3);
});

test('on the Take card a skipped dose is only recorded, Needs refill starts the call to the prescriber, and Finished stops it', async () => {
  const x = journey({});
  const med = { id: 'm1', med: true, name: 'Lisinopril 10 mg', status: 'deciding', prescriber: { name: 'Dr. Maya Patel', phone: '(555) 201-3344' }, times: ['08:00'] };
  x.ctx.items.push(med); x.ctx.selected = 'm1'; x.ctx.view = 'plan';
  const toasts = []; x.ctx.toast = t => toasts.push(t);
  const click = attrs => x.click({ dataset: attrs, hasAttribute: k => k in attrs || k.replace(/^data-/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase()) in attrs });
  click({ medDose: 'skipped' });
  assert.equal(med.doses.length, 1);
  assert.equal(med.doses[0].kind, 'skipped');
  assert.deepEqual(med.times, ['08:00'], 'a skipped dose never moves or adds a dose');
  assert.match(toasts[0], /Don’t take an extra dose/);
  click({ medDone: 'refill' });
  assert.deepEqual(med.refill.step, 'call');
  assert.match(toasts[1], /Call Dr\. Maya Patel for a refill/);
  click({ medRefill: 'called' }); click({ medRefill: 'ready' }); click({ medRefill: 'picked' });
  assert.equal(med.refill, null);
  click({ medDone: 'finished' });
  assert.equal(med.status, 'received');
});

test('the bottle-photo guide shows the 3 example shots, marks the next one, and hides once all 3 are taken', () => {
  const x = journey({});
  const guide = n => vm.runInContext(`bottleGuide(${n})`, x.ctx);
  const none = guide(0);
  assert.match(none, /<details class="pick-edit" open>/);
  assert.equal((none.match(/<figure/g) || []).length, 3);
  assert.match(none, /1\. Front/); assert.match(none, /2\. Turn it/); assert.match(none, /3\. Turn again/);
  assert.match(none, /not a real prescription/);
  const one = guide(1);
  assert.doesNotMatch(one, / open>/);
  assert.match(one, /✓ 1\. Front/);
  assert.match(one, /<figure class="is-next">.*2\. Turn it/s);
  const row = vm.runInContext(`bottleRow({labelPhotos:[]},0)`, x.ctx);
  assert.match(row, /Photo 1: the front/);
});

test('the Take card lists today’s dose times, each marked once, and as needed has no times', () => {
  const x = journey({});
  const med = { id: 'm2', med: true, name: 'Metoprolol 25 mg', status: 'deciding', instructions: 'Take 1 tablet by mouth twice a day.', times: ['08:00', '21:00'], doses: [] };
  x.ctx.items.push(med); x.ctx.selected = 'm2'; x.ctx.view = 'plan';
  const rows = () => vm.runInContext('doseRows(find("m2"))', x.ctx);
  assert.match(rows(), /Morning.*data-slot="08:00".*Bedtime.*data-slot="21:00"/s);
  x.click({ dataset: { medDose: 'taken', slot: '08:00' }, hasAttribute: () => false });
  assert.equal(med.doses[0].slot, '08:00');
  assert.equal(med.doses[0].day, '2026-10-12');
  assert.doesNotMatch(rows(), /data-slot="08:00"/);
  assert.match(rows(), /✓ Taken/);
  assert.match(rows(), /data-slot="21:00"/);
  const prn = vm.runInContext('doseRows({asNeeded:true,times:[],doses:[]})', x.ctx);
  assert.match(prn, /Only when needed/);
  assert.doesNotMatch(prn, /Skipped/);
});

test('bottles only: 3 label photos are read as one label, the card fills itself in, and only what wasn’t read is typed', async () => {
  const label = { name: 'LISINOPRIL', strength: '10 MG', directions: 'Take 1 tablet by mouth every day', pharmacy: { name: 'Main St Pharmacy', address: '', phone: '' }, prescriber: 'M. Patel', warnings: [], mainPhoto: 1, note: '' };
  // Uploaded: the photo with the name and directions becomes the card's photo, no extra photo asked for.
  const up = journey({ label, check: [] });
  vm.runInContext('startBottles()', up.ctx);
  assert.equal(up.ctx.view, 'upload');
  assert.match(vm.runInContext('uploadPage()', up.ctx), /Photo 1 of 3/);
  await vm.runInContext('addBottleShots(["front","side"],"upload")', up.ctx);
  assert.equal(up.requests.length, 0, 'not read until all 3 are in');
  assert.match(vm.runInContext('uploadPage()', up.ctx), /Photo 3 of 3/);
  await vm.runInContext('addBottleShots(["back"],"upload")', up.ctx);
  assert.equal(up.requests[0].url, '/api/label/read');
  assert.deepEqual(up.requests[0].body, { photos: ['front', 'side', 'back'], med: null });
  assert.equal(up.ctx.view, 'review');
  const [p] = up.ctx.draft.products;
  assert.equal(p.name, 'LISINOPRIL 10 MG');
  assert.equal(p.photo, 'side');
  up.ctx.photo = () => '';
  const card = vm.runInContext('reviewPage()', up.ctx);
  assert.doesNotMatch(card, /<textarea class="pick-name" name="name-0"/, 'what was read is not retyped');
  assert.match(card, /Fix a mistake/);
  // Camera: once read, one clear photo for the card.
  const cam = journey({ label, check: [] });
  vm.runInContext('startBottles()', cam.ctx);
  await vm.runInContext('addBottleShots(["a"],"camera").then(()=>addBottleShots(["b"],"camera")).then(()=>addBottleShots(["c"],"camera"))', cam.ctx);
  assert.equal(vm.runInContext('journey.step', cam.ctx), 'cardPhoto');
  assert.match(vm.runInContext('uploadPage()', cam.ctx), /One photo for the card/);
  vm.runInContext('finishBottleScan("card")', cam.ctx);
  assert.equal(cam.ctx.draft.products[0].photo, 'card');
  assert.equal(cam.ctx.view, 'review');
  // Not read: the card opens to type it in.
  const none = journey({ label: null, reason: 'failed' });
  vm.runInContext('startBottles()', none.ctx);
  await vm.runInContext('addBottleShots(["a","b","c"],"camera")', none.ctx);
  assert.equal(none.ctx.view, 'review');
  none.ctx.photo = () => '';
  assert.match(vm.runInContext('reviewPage()', none.ctx), /<textarea class="pick-name" name="name-0"/);
  assert.match(vm.runInContext('journey.error', none.ctx), /Type it in from the bottle/);
});
