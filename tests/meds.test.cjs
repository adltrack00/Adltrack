const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');

/* Medications (meds.js): a medication's own page, and deleting one. */
function load({ edit = true, ok = true } = {}) {
  const ctx = { items: [], selected: null, planTab: null, view: 'purchases', saved: 0, esc: s => String(s), mayDo: () => edit,
    showDetail() {}, menuPages: { medications: () => '<div class="plus-list"></div>', scan: () => '' }, gallery: () => '', planPage: () => 'old', uploadPage: () => '', readPapers: async () => {},
    plusRow: (a, l) => `<button ${a}>${l}</button>`, subHeader: (t, b) => `<a data-menu-go="${b}"></a>`, find: id => ctx.items.find(i => i.id === id), save() { ctx.saved++; }, confirm: () => ok,
    medPhoto: () => '<img>', medState: () => 'Due now', howText: i => i.instructions || '', slotName: t => ({ '08:00': 'Morning' })[t] || '', clockText: t => t, dosesPerDay: () => 1, papersRow: () => '', mapLink: () => '', bottleRow: () => '', readLabel() {}, reviewPage: () => '' };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('meds.js', 'utf8'), ctx);
  return ctx;
}
const med = { id: 'm1', med: true, name: 'Metformin 500 mg', status: 'deciding', instructions: 'Take 1 tablet twice a day.', times: ['08:00'], prescriber: { name: 'Dr. Maya Patel', phone: '555-201-3344' }, pharmacy: { name: 'Main Street Pharmacy', phone: '555-300-1200' }, warnings: ['Take with food.'] };

test('a medication opens its own page: everything about it, no Take buttons, and Delete for people who can change medications', () => {
  const x = load();
  x.items.push({ ...med }); x.selected = 'm1';
  const page = vm.runInContext('planPage()', x);
  for (const want of ['Metformin 500 mg', 'Take 1 tablet twice a day.', 'Morning 08:00', 'Dr. Maya Patel', 'Call 555-300-1200', 'Take with food.', 'data-med-done="refill"', 'data-med-done="finished"', 'Delete this medication']) assert.ok(page.includes(want), want);
  assert.doesNotMatch(page, /data-med-dose|flow-tabs/);
  vm.runInContext('planTab={id:"m1",tab:"paid"}', x);
  assert.equal(vm.runInContext('planPage()', x), 'old', 'the refill steps still open from Your refills');
  assert.doesNotMatch(vm.runInContext('planTab=null;mayDo=()=>false;planPage()', x), /Delete this medication/);
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
