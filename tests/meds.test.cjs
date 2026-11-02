const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');

/* Medications (meds.js): a medication's own page, and deleting one. */
function load({ edit = true, ok = true } = {}) {
  const ctx = { items: [], selected: null, planTab: null, view: 'purchases', saved: 0, esc: s => String(s), mayDo: () => edit,
    showDetail() {}, menuPages: { medications: () => '<div class="plus-list"></div>', scan: () => '' }, gallery: () => '', planPage: () => 'old', uploadPage: () => '', readPapers: async () => {},
    plusRow: (a, l) => `<button ${a}>${l}</button>`, subHeader: (t, b) => `<a data-menu-go="${b}"></a>`, find: id => ctx.items.find(i => i.id === id), save() { ctx.saved++; }, confirm: () => ok,
    medPhoto: () => '<img>', medState: () => 'Due now', howText: i => i.instructions || '', slotName: t => ({ '08:00': 'Morning' })[t] || '', clockText: t => t, dosesPerDay: () => 1, validClock: t => /^\d\d:\d\d$/.test(t || ''), toast() {}, render() {}, papersRow: () => '', mapLink: () => '', bottleRow: () => '', readLabel() {}, reviewPage: () => '' };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('meds.js', 'utf8'), ctx);
  return ctx;
}
const med = { id: 'm1', med: true, name: 'Metformin 500 mg', status: 'deciding', instructions: 'Take 1 tablet twice a day.', times: ['08:00'], prescriber: { name: 'Dr. Maya Patel', phone: '555-201-3344' }, pharmacy: { name: 'Main Street Pharmacy', phone: '555-300-1200' }, warnings: ['Take with food.'] };

test('a medication opens its own page: everything about it, no Take buttons, and Delete for people who can change medications', () => {
  const x = load();
  x.items.push({ ...med }); x.selected = 'm1';
  const page = vm.runInContext('planPage()', x);
  for (const want of ['Metformin 500 mg', 'Take 1 tablet twice a day.', 'type="time" value="08:00"', '+ Add a time', 'data-med-tasks="m1"', 'On My Tasks', 'Dr. Maya Patel', 'Call 555-300-1200', 'Take with food.', 'data-med-done="refill"', 'data-med-done="finished"', 'Delete this medication']) assert.ok(page.includes(want), want);
  assert.doesNotMatch(page, /data-med-dose|flow-tabs/);
  vm.runInContext('planTab={id:"m1",tab:"paid"}', x);
  assert.equal(vm.runInContext('planPage()', x), 'old', 'the refill steps still open from Your refills');
  const viewer = vm.runInContext('planTab=null;mayDo=()=>false;planPage()', x);
  assert.doesNotMatch(viewer, /Delete this medication|type="time"|data-med-tasks/);
  assert.ok(viewer.includes('Morning 08:00'), 'people who can only look see the times as words');
});

test('dose times change on the medication page: add one, remove one (never the last), and take it off My Tasks and back', () => {
  const x = load();
  x.items.push({ ...med, times: ['08:00'] }); x.selected = 'm1';
  assert.doesNotMatch(vm.runInContext('planPage()', x), /data-med-time-remove/, 'the only time has no Remove');
  assert.equal(vm.runInContext('addDoseTime("m1","20:30")', x), true);
  assert.deepEqual([...x.items[0].times], ['08:00', '20:30']);
  assert.equal(vm.runInContext('addDoseTime("m1","08:00")', x), false, 'no two doses at the same time');
  assert.match(vm.runInContext('planPage()', x), /data-med-time-remove="m1\|20:30"/);
  assert.equal(vm.runInContext('removeDoseTime("m1","08:00")', x), true);
  assert.deepEqual([...x.items[0].times], ['20:30']);
  assert.equal(vm.runInContext('removeDoseTime("m1","20:30")', x), false, 'the last time stays');
  vm.runInContext('toggleMedTasks("m1")', x);
  assert.equal(x.items[0].offTasks, true);
  assert.ok(x.items.includes(x.items[0]) && x.items[0].med, 'it stays in the medications');
  assert.match(vm.runInContext('planPage()', x), /aria-checked="false"[^>]*>.*Off My Tasks/s);
  vm.runInContext('toggleMedTasks("m1")', x);
  assert.equal('offTasks' in x.items[0], false);
  vm.runInContext('mayDo=()=>false', x);
  assert.equal(vm.runInContext('addDoseTime("m1","12:00")', x), false);
  assert.equal(vm.runInContext('toggleMedTasks("m1")', x), false);
});

test('deleting a medication asks first, then takes it out for good', () => {
  const kept = load({ ok: false });
  kept.items.push({ ...med });
  assert.equal(vm.runInContext('deleteMedication("m1")', kept), false);
  assert.equal(kept.items.length, 1);
  const x = load();
  x.items.push({ ...med }, { id: 'a1', appt: true });
  assert.equal(vm.runInContext('deleteMedication("m1")', x), true);
  assert.deepEqual(x.items.map(i => i.id), ['a1']);
  assert.equal(x.saved, 1);
  assert.equal(vm.runInContext('deleteMedication("a1")', x), false, 'only medications');
});

test('Medications starts with Add a medication, and Scan has Scan a document', () => {
  const x = load();
  assert.match(vm.runInContext('menuPages.medications()', x), /^<button class="primary doc-add" data-menu-go="med-add">Add a medication<\/button>/);
  const add = vm.runInContext('medAddPage()', x);
  assert.match(add, /id="flow-bottles"/); assert.match(add, /id="med-type"/);
});

test('Needs refill lists each medication running low: what is left and how many days until it runs out', () => {
  const x = load();
  x.C = require('../core.js'); x.today = () => '2026-10-29';
  x.items.push({ ...med, quantity: 30, refills: 2, filled: '2026-10-05' }, { ...med, id: 'm2', name: 'Lisinopril 10 mg', quantity: 90, filled: '2026-10-28' }, { ...med, id: 'm3', name: 'Amoxicillin', status: 'received', refill: { step: 'call' } });
  const list = vm.runInContext('refillList().map(i=>i.id)', x);
  assert.deepEqual([...list], ['m1'], 'only open medications that run out within a week or are marked Needs refill');
  const card = vm.runInContext('refillCard(items[0])', x);
  for (const want of ['Metformin 500 mg', '6 days left', 'About 6 pills left', '2 refills left']) assert.ok(card.includes(want), want);
});
