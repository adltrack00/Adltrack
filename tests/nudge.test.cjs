const test = require('node:test'), assert = require('node:assert/strict');
const N = require('../nudge.js');
const C = require('../core.js');

const today = '2026-10-12'; // a Monday
const item = (id, left, o = {}) => ({ id, name: id, retailer: 'Target', price: 40, channel: 'online', purchased: C.shift(today, left - 30), delivered: '', window: 30, basis: 'purchase', outcome: 'refund', requirement: 'start', confirmed: true, status: 'deciding', next: 'Pack it.', ...o });
const guide = { store: 'Target', methods: [
  { index: 0, type: 'store', label: 'In store', steps: ['Bring the item and your receipt to Guest Services.', 'Show the barcode in the Target app.'] },
  { index: 1, type: 'mail', label: 'By mail', steps: ['Start the return in your Target account.', 'Print the label.'] }
] };
const hours = ['Monday: 8:00 AM – 10:00 PM', 'Tuesday: 8:00 AM – 9:30 PM', 'Wednesday: Open 24 hours', 'Thursday: Closed', 'Friday: 8:00 AM – 10:00 PM', 'Saturday: 8:00 AM – 10:00 PM', 'Sunday: 9:00 AM – 9:00 PM'];

test('returns due this week are grouped with their total, and the lead item says what is at stake', () => {
  const r = N.compose([item('Coat', 12, { price: 49.5 }), item('Dress', 4, { price: 49 }), item('Boots', 6, { price: 35, outcome: 'credit' })], today);
  assert.equal(r.title, '2 returns due this week: $84 total');
  assert.equal(r.body, 'Dress · $49 back · 4 days left. Pack it. Plus 2 other return windows.');
  assert.deepEqual(r.items, ['Dress', 'Boots', 'Coat']);
  assert.deepEqual(r.days, { Dress: 4, Boots: 6, Coat: 12 });
  assert.equal(N.compose([item('Boots', 9, { outcome: 'credit' })], today).body, 'Boots · $40 in store credit · 9 days left. Pack it.');
  assert.equal(N.compose([item('Mystery', 9, { outcome: 'unknown', price: '' })], today).body, 'Mystery · 9 days left. Pack it.');
});

test('the wording gets more urgent as the deadline nears: every day, the day before, deadline day', () => {
  assert.equal(N.compose([item('A', 12)], today).title, 'Adltrack · 12 days left');
  assert.equal(N.compose([item('A', 12)], today).stage, 'daily');
  assert.equal(N.compose([item('A', 3)], today).title, 'Adltrack · Only 3 days left');
  assert.equal(N.compose([item('A', 1)], today).title, 'Adltrack · Deadline tomorrow');
  assert.equal(N.compose([item('A', 1)], today).stage, 'tomorrow');
  const last = N.compose([item('A', 0)], today);
  assert.equal(last.title, 'Adltrack · Deadline today');
  assert.equal(last.body, 'A · $40 back · due today. Pack it. Check the exact cutoff time.');
  // The urgent title wins over the group, and the group's total moves to the end.
  const both = N.compose([item('A', 0, { price: 30 }), item('B', 5, { price: 54 })], today);
  assert.equal(both.title, 'Adltrack · Deadline today');
  assert.match(both.body, /Plus 1 other return window \(\$84 due this week\)\.$/);
});

test('the next step comes from the return guide: the QR code when one is saved, otherwise the chosen way\'s first step', () => {
  assert.equal(N.compose([item('A', 9, { returnGuide: guide, policyStore: 'Target' })], today).body, 'A · $40 back · 9 days left. Bring the item and your receipt to Guest Services.');
  assert.equal(N.compose([item('A', 9, { returnGuide: guide, returnMethod: 'By mail' })], today).body, 'A · $40 back · 9 days left. Start the return in your Target account.');
  // A guide for a store the item no longer has is ignored.
  assert.equal(N.compose([item('A', 9, { returnGuide: guide, policyStore: 'Zara' })], today).body, 'A · $40 back · 9 days left. Pack it.');
  const qr = N.compose([item('A', 9, { returnGuide: guide, label: '/api/files/x' })], today);
  assert.match(qr.body, /Tap for your QR code\./);
  assert.deepEqual(qr.actions.map(a => a.title), ['Show QR code', 'Snooze until tomorrow', 'I sent it back', 'I’m keeping it']);
  assert.match(N.compose([item('A', 9, { returnGuide: guide, returnMethod: 'By mail', label: '/api/files/x' })], today).body, /Tap for your return label\./);
  assert.deepEqual(N.compose([item('A', 9)], today).actions.map(a => a.action), ['snooze', 'sent', 'keep']);
});

test('the nearest drop-off is named with its distance, and on deadline day an open store says until when', () => {
  const near = { name: 'Target Grocery', partner: 'Target', miles: 1.2, hours, type: 'store' };
  assert.match(N.compose([item('A', 9, { returnGuide: guide, dropoff: near })], today).body, /Nearest drop-off: Target, 1\.2 mi\.$/);
  assert.match(N.compose([item('A', 0, { returnGuide: guide, dropoff: near })], today).body, /Still possible today: Target closes at 10pm, 1\.2 mi away\.$/);
  assert.match(N.compose([item('A', 0, { returnGuide: guide })], today).body, /Still possible today: Target takes returns in store\.$/);
  // No in-store returns: the usual deadline-day line.
  assert.match(N.compose([item('A', 0, { returnGuide: { store: 'Zara', methods: [guide.methods[1]] } })], today).body, /Check the exact cutoff time\.$/);
  assert.equal(N.closesToday(hours, '2026-10-13'), '9:30pm');
  assert.equal(N.closesToday(hours, '2026-10-14'), 'open 24 hours');
  assert.equal(N.closesToday(hours, '2026-10-15'), null);
  assert.equal(N.closesToday(['Monday: 8:00 AM – 10:00 PM'], today), '10pm');
  assert.equal(N.closesToday([], today), null);
});

test('"Gentle" only reminds at the halfway point and 7, 3 and 1 days before', () => {
  const days = Array.from({ length: 31 }, (_, n) => n).filter(n => N.compose([item('A', n)], today, { gentle: true }));
  assert.deepEqual(days, [1, 3, 7, 15]);
  // Only the items on a gentle day are mentioned.
  assert.deepEqual(N.compose([item('A', 7), item('B', 5)], today, { gentle: true }).items, ['A']);
});

test('examples are left out unless asked for (the Reminders preview)', () => {
  assert.equal(N.compose([item('A', 5, { demo: true })], today), null);
  assert.equal(N.compose([item('A', 5, { demo: true })], today, { examples: true }).itemId, 'A');
});
