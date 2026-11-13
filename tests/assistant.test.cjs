const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), os = require('node:os'), path = require('node:path'), fs = require('node:fs'), vm = require('node:vm');
const { createAssistant, request, clean, MODEL } = require('../server/assistant');
const { createStore } = require('../server/store');
const { createData } = require('../server/data');
const { createStorage } = require('../server/storage');
const { createApp } = require('../server/app');

/* The assistant (assistant.js in the app, server/assistant.js for what the app can't work out itself). */
const quiet = { log() {}, error() {} };
const mockClient = (answer, calls = [], extra = {}) => ({ messages: { create: async req => { calls.push(req); return { stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 80 }, content: [{ type: 'text', text: JSON.stringify(answer) }], ...extra }; } } });
const ANSWER = { kind: 'task', reply: 'I filled it in. Check it and tap Save.', ids: [], open: '', task: { what: 'Call Dr. Patel about the refill', note: '', date: '2026-11-06', time: '10:00', repeat: 'once' }, appointment: { with: '', place: '', date: '', time: '', note: '' } };

/* The app's side: only the logic, with a few app functions stood in. */
function app() {
  const ctx = { console, items: [], today: () => '2026-11-03', docList: list => list.filter(i => i.doc).map(i => ({ id: i.id, name: i.name, category: i.category, date: i.date || '', files: i.files || [] })), docCategoryName: c => ({ insurance: 'Insurance', results: 'Lab and test results' })[c] || 'Other',
    careContacts: list => ({ doctors: [{ key: 'dr. a patel', name: 'Dr. A Patel', phone: '555-0100', meds: ['Metoprolol tartrate 25 mg'] }], pharmacies: [{ key: 'cvs', name: 'CVS Pharmacy', phone: '555-0199', meds: ['Metoprolol tartrate 25 mg'] }] }), repeatText: () => 'Every Monday at 9:00 AM', clockText: t => t, module: { exports: {} } };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync('assistant.js', 'utf8'), ctx);
  ctx.items.push({ id: 'm1', med: true, name: 'Metoprolol tartrate 25 mg', instructions: 'Take 1 tablet by mouth twice a day', times: ['08:00', '20:00'], pharmacy: { name: 'CVS Pharmacy' }, prescriber: { name: 'Dr. A Patel' }, doses: [{ slot: '08:00', kind: 'taken', at: '2026-11-03T08:05', by: 'George' }] },
    { id: 'm2', med: true, name: 'Lisinopril 10 mg', instructions: 'Take 1 tablet daily' },
    { id: 'd1', doc: true, name: 'Medicare card', category: 'insurance', files: [{ url: '/f/1' }] },
    { id: 'd2', doc: true, name: 'Blood work October', category: 'results' },
    { id: 'a1', appt: true, name: 'Cardiology follow-up', date: '2026-11-12', time: '14:00', place: 'Heart Center' },
    { id: 'a0', appt: true, name: 'Old visit', date: '2026-10-01', status: 'received' },
    { id: 't1', task: true, name: 'Change the dressing', repeat: 'weekly' },
    { id: 'x', med: true, demo: true, name: 'Example med' });
  return ctx.module.exports;
}

test('finding by name is free: a document, a med, an appointment and a doctor are found in the app', () => {
  const a = app();
  assert.deepEqual([...a.adaLocal('Show me her insurance card').things.map(t => t.id)], ['d1']);
  assert.deepEqual(a.adaLocal('where is the metoprolol?').things.map(t => t.id)[0], 'm1');
  assert.deepEqual([...a.adaLocal('Medicare card').things.map(t => t.id)], ['d1']);
  assert.equal(a.adaLocal('when is her next appointment').things[0].id, 'a1');
  assert.equal(a.adaLocal('find dr patel').things[0].kind, 'doctor');
  assert.equal(a.adaLocal('show me the cardiology appointment').things[0].id, 'a1');
  const t = a.adaLocal('where is the medicare card').things[0];
  assert.equal(t.view, 'documents'); assert.equal(t.el, '[data-doc-open="d1"]'); assert.match(t.path, /Documents › Insurance/);
  assert.ok(!a.adaThings().some(x => x.id === 'x'), 'examples are left out');
});

test('the app’s own forms open without the AI, and a request with a day or time goes to the AI to fill in', () => {
  const a = app();
  assert.equal(a.adaLocal('I want to add her new medication').open, 'med-add');
  assert.equal(a.adaLocal('scan the discharge papers').open, 'scan-papers');
  assert.equal(a.adaLocal('save her insurance card').open, 'document-add');
  assert.equal(a.adaLocal('she fell in the bathroom').open, 'incident-new');
  assert.equal(a.adaLocal('BP is 128 over 82').open, 'vitals');
  assert.equal(a.adaLocal('set a reminder').open, 'task-new');
  assert.equal(a.adaLocal('remind me Friday at 10 to call Dr. Patel'), null);
  assert.equal(a.adaLocal('book an appointment with cardiology on the 12th at 2pm'), null);
  assert.equal(a.adaLocal('where are the refills').open, 'wallet');
  for (const k of Object.keys(a.ADA_PLACES)) assert.ok(a.ADA_PLACES[k].path && a.ADA_PLACES[k].title, k);
});

test('medical questions are never sent anywhere: they get who to call', () => {
  const a = app();
  for (const q of ['She missed her 8am dose. Should I give her two at 8pm?', 'Is it safe to take Tylenol with metoprolol?', 'what are the side effects of lisinopril', 'Can she stop taking it?', 'how much should I give her', 'is it normal that her ankles are swollen', 'what does a BP of 160 mean'])
    assert.equal(a.adaLocal(q).kind, 'medical', q);
  for (const q of ['I want to add her new medication', 'show me her medications', 'remind me to give her pills at 8pm'])
    assert.notEqual(a.adaLocal(q) && a.adaLocal(q).kind, 'medical', q);
});

test('the list the AI may answer from holds names, times and ids, never photos, and no examples', () => {
  const plan = app().adaPlan();
  assert.deepEqual([...plan.medications.map(m => m.id)], ['m1', 'm2']);
  assert.equal(plan.medications[0].times, '08:00, 20:00'); assert.ok('given' in plan.medications[0] && !('today' in plan.medications[0]));
  assert.deepEqual([...plan.documents.map(d => d.id)], ['d1', 'd2']);
  assert.ok(!JSON.stringify(plan).includes('/f/1'), 'no files');
  assert.ok(plan.contacts.some(c => c.kind === 'pharmacy'));
});

test('the server sends Haiku 5.5 the fixed prompt (cached), the plan list and the last turns, and keeps only what the app can use', async () => {
  const calls = [];
  const ai = createAssistant({ client: mockClient(ANSWER, calls), log: quiet });
  const plan = { medications: [{ id: 'm1', name: 'Metoprolol' }], documents: [{ id: 'd1', name: 'Medicare card' }] };
  const r = await ai.ask({ messages: [{ role: 'user', text: 'remind me Friday at 10 to call Dr. Patel about her refill' }], plan, today: '2026-11-03', weekday: 'Tuesday', name: 'Ada' });
  assert.equal(calls[0].model, MODEL); assert.equal(MODEL, 'claude-haiku-5-5');
  assert.equal(calls[0].system[0].cache_control.type, 'ephemeral');
  assert.equal(calls[0].output_config.format.type, 'json_schema');
  assert.match(calls[0].messages.at(-1).content, /Today: Tuesday 2026-11-03/); assert.match(calls[0].messages.at(-1).content, /Medicare card/);
  assert.deepEqual(r.task, ANSWER.task); assert.equal(r.kind, 'task');
  assert.deepEqual(clean({ kind: 'find', reply: 'x', ids: ['d1', 'made-up'], open: '' }, plan).ids, ['d1']);
  assert.equal(clean({ kind: 'task', task: { what: 'x', date: 'Friday', time: '10am', repeat: 'often' } }, plan).task.time, '');
  assert.deepEqual(clean({ kind: 'medical', reply: 'Ask the doctor.', ids: ['d1'] }, plan).ids, []);
  assert.equal(request({ messages: [{ role: 'assistant', text: 'hi' }] }), null);
  const refused = await createAssistant({ client: mockClient(ANSWER, [], { stop_reason: 'refusal' }), log: quiet }).ask({ messages: [{ role: 'user', text: 'x' }] });
  assert.equal(refused.kind, 'medical');
});

async function boot(t, assistant) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adl-assistant-'));
  const store = createStore({ databaseUrl: null, file: path.join(dir, 'store.json') });
  await store.init();
  const data = createData({ store, storage: createStorage({ dir: path.join(dir, 'files') }), jobs: { enqueue: async () => {} } });
  const server = http.createServer(createApp({ store, data, assistant })).listen(0);
  t.after(async () => { server.close(); await store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  };
}

test('POST /api/assistant needs a signed-in person and answers with the plan for the app', async t => {
  const call = await boot(t, createAssistant({ client: mockClient(ANSWER), log: quiet }));
  assert.equal((await call('POST', '/api/assistant', { messages: [{ role: 'user', text: 'hi' }] })).status, 401);
  assert.equal((await call('POST', '/api/signup', { name: 'George', email: 'george@example.com', password: 'a-long-password-1' })).status, 201);
  const r = await call('POST', '/api/assistant', { messages: [{ role: 'user', text: 'remind me Friday at 10' }], plan: {} });
  assert.equal(r.status, 200); assert.equal(r.json.answer.kind, 'task');
  const off = await boot(t, createAssistant({ apiKey: '', log: quiet }));
  await off('POST', '/api/signup', { name: 'G', email: 'g2@example.com', password: 'a-long-password-1' });
  assert.equal((await off('POST', '/api/assistant', { messages: [{ role: 'user', text: 'x' }] })).json.reason, 'unavailable');
});

test('the app loads the assistant and the offline copy keeps it', () => {
  const html = fs.readFileSync('app.html', 'utf8'), sw = fs.readFileSync('sw.js', 'utf8');
  assert.match(html, /assistant\.css/); assert.match(html, /assistant\.js/);
  assert.match(sw, /'assistant\.js'/); assert.match(sw, /'assistant\.css'/);
});

test('Ada reads what people type while she does a task: times, vital signs and which part of Documents', () => {
  const a = app();
  assert.deepEqual([...a.adaTimes('8am and 8pm')], ['08:00', '20:00']);
  assert.deepEqual([...a.adaTimes('at 8:30 and 20:00')], ['08:30', '20:00']);
  assert.deepEqual([...a.adaTimes('morning and bedtime')], ['08:00', '21:00']);
  assert.deepEqual([...a.adaTimes('2 times a day at 9 and 3')], ['09:00', '15:00']);
  assert.deepEqual([...a.adaTimes('12pm')], ['12:00']);
  assert.deepEqual([...a.adaTimes('take 25 mg')], []);
  assert.deepEqual([...a.adaSuggestTimes(2)], ['08:00', '20:00']);
  assert.deepEqual({ ...a.adaVitalsFrom('BP is 128 over 82, pulse 70, temp 99.14, pain 3 out of 10') }, { sys: '128', dia: '82', pulse: '70', temp: '99.1', pain: '3' });
  assert.deepEqual({ ...a.adaVitalsFrom('her blood pressure 140/90') }, { sys: '140', dia: '90' });
  assert.deepEqual({ ...a.adaVitalsFrom('pain 15') }, {});
  assert.equal(a.adaDocCategory('Medicare card'), 'insurance');
  assert.equal(a.adaDocCategory('Blood work from October'), 'results');
  assert.equal(a.adaDocCategory('Power of attorney'), 'legal');
  assert.equal(a.adaDocCategory('Something'), '');
});

test('saying what happened is not a medical question, asking what to do is', () => {
  const a = app();
  for (const q of ['she missed her 8am dose', 'He missed a dose this morning, mark it skipped'])
    assert.notEqual(a.adaLocal(q) && a.adaLocal(q).kind, 'medical', q);
  for (const q of ['she missed her dose, what should I do?', 'He missed a dose. Can he take it now?'])
    assert.equal(a.adaLocal(q).kind, 'medical', q);
});

test('the AI says which task it is, and only checked values come back', () => {
  const plan = { medications: [{ id: 'm1', name: 'Metoprolol' }] };
  const r = clean({ kind: 'dose', reply: 'Okay.', ids: [], open: '', fields: { med_id: 'm1', slot: '08:00', mark: 'taken', note: '', sys: '400' } }, plan);
  assert.equal(r.fields.med_id, 'm1'); assert.equal(r.fields.slot, '08:00'); assert.equal(r.fields.mark, 'taken'); assert.equal(r.fields.sys, '');
  assert.equal(clean({ kind: 'dose', fields: { med_id: 'zzz' } }, plan).fields.med_id, '');
  assert.equal(clean({ kind: 'incident', fields: { incident: 'explosion' } }, plan).fields.incident, '');
  assert.equal(clean({ kind: 'document', fields: { name: 'Medicare card', category: 'insurance' } }, plan).fields.category, 'insurance');
  assert.equal(clean({ kind: 'find', fields: { name: 'x' } }, plan).fields, null);
});

test('a dose given or skipped is understood in the app, for free', () => {
  const a = app();
  const r = a.adaLocal('I gave her the metoprolol at 8am');
  assert.equal(r.kind, 'dose'); assert.equal(r.med_id, 'm1'); assert.equal(r.mark, 'taken'); assert.equal(r.slot, '08:00');
  assert.equal(a.adaLocal('she skipped the lisinopril').mark, 'skipped');
  assert.equal(a.adaLocal('she missed the lisinopril, can she take it now?').kind, 'medical');
});

test('days in plain words', () => {
  const d = app().adaDate;
  assert.equal(d('Friday', '2026-11-03'), '2026-11-06');
  assert.equal(d('nov 12', '2026-11-03'), '2026-11-12');
  assert.equal(d('Oct 2, 2026', '2026-11-03', 'past'), '2026-10-02');
  assert.equal(d('Dec 1', '2026-11-03', 'past'), '2025-12-01');
  assert.equal(d('11/20', '2026-11-03'), '2026-11-20');
  assert.equal(d('tomorrow', '2026-11-03'), '2026-11-04');
  assert.equal(d('the 2nd', '2026-11-03'), '2026-12-02');
  assert.equal(d('Feb 30', '2026-11-03'), '');
  assert.equal(d('whenever', '2026-11-03'), '');
});

test('asked when a dose was given, Ada has the exact time it was marked, not the time it was due (George 2026-11-08)', () => {
  const a = app(), now = new Date('2026-11-03T21:00');
  const said = a.adaGiven([{ slot: '08:00', kind: 'taken', at: '2026-11-03T08:12', by: 'George' }, { slot: '20:00', kind: 'skipped', at: '2026-11-02T20:40' }, { slot: '08:00', kind: 'taken', at: '2026-10-20T08:00' }], now);
  assert.match(said, /^today: 8 AM dose taken at 8:12\sAM by George; yesterday: 8 PM dose marked skipped at 8:40\sPM$/);
  assert.equal(a.adaGiven([], now), '');
  // A late dose marked after midnight belongs to the day it was for.
  assert.match(a.adaGiven([{ day: '2026-11-02', slot: '23:00', kind: 'taken', at: '2026-11-03T00:20' }], now), /^yesterday: 11 PM dose taken at 12:20\sAM$/);
  const SYS = require('fs').readFileSync(require('path').join(__dirname, '../server/assistant.js'), 'utf8');
  assert.match(SYS, /exact time it was marked/);
});
