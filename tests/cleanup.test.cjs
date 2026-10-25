/* Step 8: Settings, Support and the landing page, with no Returnly wording left on the pages people see. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const BANNED = /\b(returnly|returns?|returned|refunds?|stores?|receipts?|purchases?|purchased|shop|shopping|retailers?|get paid|policy review|store credit|closet)\b/i;

/* menu.js with stand-ins for the layers before it. */
function menu({ items = [], can = true, saved = [] } = {}) {
  const listeners = {};
  const ctx = { render() {}, gallery: () => '', profileHeader: () => '', profileTools: () => '', items, view: 'overview', profile: {}, toast(m) { ctx.toasted = m; }, setTimeout() {}, location: { search: '' }, history: {}, URLSearchParams, fetch: () => new Promise(() => {}),
    esc: s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])), mayDo: () => can, save: () => saved.push(1), whenToCall: () => [], call911: '<a href="tel:911">Call 911</a>', NO_SIGNS: 'Call your doctor or pharmacist with any concern. In an emergency, call 911.', telLink: (l, p) => p ? `<a href="tel:${p}">${l}</a>` : '',
    Account: { user: () => ({ email: 'george@example.com', admin: true }) }, document: { addEventListener: (n, f) => (listeners[n] = listeners[n] || []).push(f), querySelector: () => null, body: { insertAdjacentHTML() {} } }, $: () => null };
  vm.runInNewContext(read('menu.js') + ';this.menuPages=menuPages;this.careContacts=careContacts;', ctx);
  return { ctx, listeners };
}
const strip = html => html.replace(/<[^>]+>/g, ' ');

test('Settings: no email import or Policy review, and My doctors and pharmacies sits where email import was', () => {
  const { ctx } = menu();
  const rows = [...ctx.settingsPage().matchAll(/data-menu-go="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(rows, ['overview', 'people', 'my-profile', 'care-contacts', 'privacy', 'terms'], 'Policy review is gone even for admin accounts');
  assert.match(ctx.settingsPage(), /<span>My doctors and pharmacies<\/span>/);
  assert.equal(ctx.menuPages['email-import'], undefined);
  assert.equal(ctx.menuPages['policy-review'], undefined);
});

test('Support, Medications 101, Security and privacy and the terms are written for Adltrack', () => {
  const { ctx } = menu();
  const support = ctx.supportPage();
  assert.match(support, /data-menu-go="medications-101"><span>Medications 101/);
  for (const q of ['Does Adltrack give medical advice?', 'What if the papers and the bottle don’t match?', 'I don’t have the discharge papers.']) assert.ok(support.includes(q), q);
  assert.match(ctx.medications101Page(), /Reading a pharmacy label[\s\S]*A missed dose[\s\S]*Call the pharmacist[\s\S]*How refills work/);
  assert.match(ctx.termsPage(), /Adltrack doesn’t give medical advice/);
  assert.match(ctx.privacyPage(), /including the discharge papers and bottle photos/);
  for (const page of ['settingsPage', 'supportPage', 'medications101Page', 'termsPage', 'privacyPage', 'careContactsPage']) assert.doesNotMatch(strip(ctx[page]()), BANNED, page);
});

test('My doctors and pharmacies lists each one once with its medications, and fixing a number fixes every medication', () => {
  const doc = { name: 'Dr. Maya Patel', phone: '(555) 201-3344' }, ph = { name: 'Main Street Pharmacy', phone: '', address: '12 Main St' };
  const items = [
    { id: 'a', med: true, name: 'Lisinopril 10 mg', prescriber: { ...doc }, pharmacy: { ...ph } },
    { id: 'b', med: true, name: 'Metoprolol 25 mg', prescriber: { ...doc, name: 'dr. maya  patel' }, pharmacy: { ...ph } },
    { id: 'c', appt: true, name: 'Follow-up visit' }
  ];
  const saved = [], { ctx, listeners } = menu({ items, saved });
  const { doctors, pharmacies } = JSON.parse(JSON.stringify(ctx.careContacts()));
  assert.equal(doctors.length, 1, 'the same doctor written two ways is one entry');
  assert.deepEqual(doctors[0].meds, ['Lisinopril 10 mg', 'Metoprolol 25 mg']);
  assert.equal(pharmacies[0].address, '12 Main St');
  const page = ctx.careContactsPage();
  assert.match(page, /<summary>How this works<\/summary>/);
  assert.match(page, /<summary>Main Street Pharmacy<\/summary>/);
  const form = { dataset: { contact: 'pharmacy', contactKey: 'main street pharmacy' }, elements: { phone: { value: ' (555) 300-1200 ' }, address: { value: '12 Main St' } } };
  form.closest = () => form;
  listeners.submit.forEach(f => f({ target: form, preventDefault() {} }));
  assert.deepEqual(items.filter(i => i.med).map(i => i.pharmacy.phone), ['(555) 300-1200', '(555) 300-1200']);
  assert.equal(saved.length, 1);
  assert.match(ctx.toasted, /All 2 of its medications use it now/);
});

test('people who may not change medications see the numbers but can’t edit them', () => {
  const items = [{ id: 'a', med: true, name: 'Lisinopril 10 mg', prescriber: { name: 'Dr. Patel', phone: '555' } }];
  const saved = [], { ctx, listeners } = menu({ items, can: false, saved });
  const page = ctx.careContactsPage();
  assert.doesNotMatch(page, /data-contact=/);
  assert.match(page, /href="tel:555"/);
  const form = { dataset: { contact: 'prescriber', contactKey: 'dr. patel' }, elements: { phone: { value: '1' } } };
  form.closest = () => form;
  listeners.submit.forEach(f => f({ target: form, preventDefault() {} }));
  assert.equal(items[0].prescriber.phone, '555');
  assert.equal(saved.length, 0);
});

test('the landing page, sign in, sign up, email pages, guide, manifest and package have no Returnly wording', () => {
  for (const f of ['index.html', 'landing.html', 'daily-meds.html', 'appointments.html', 'check-ins.html', 'your-circle.html', 'next-chapter.html', 'signin.html', 'signup.html', 'email.html', 'forgot.html', 'reset.html', 'join.html']) {
    const html = read(f);
    assert.doesNotMatch(strip(html.replace(/<script[\s\S]*?<\/script>/g, '')), BANNED, f);
    for (const m of html.matchAll(/(?:alt|aria-label|content)="([^"]*)"/g)) assert.doesNotMatch(m[1], BANNED, f);
    assert.doesNotMatch(html, /cardigan|font-family='Arial'%3ER%3C/, f + ': clothing photo or the R icon');
  }
  assert.match(read('index.html'), /<h1 id="family-hero-title">One family\.<br>Together in care\.<\/h1>/);
  for (const f of ['index.html', 'landing.html', 'daily-meds.html', 'appointments.html', 'check-ins.html', 'your-circle.html', 'next-chapter.html']) assert.match(read(f), /<div class="header-account"><a class="header-login" href="signin\.html">Log in<\/a><a class="header-signup" href="signup\.html">Sign up<\/a><\/div>/, f + ': Log in and Sign up in the header');
  const app = read('app.html');
  assert.doesNotMatch(app.match(/<title>[^<]*<\/title>/)[0], BANNED);
  assert.doesNotMatch(strip(app.match(/<dialog id="guide-dialog">[\s\S]*?<\/dialog>/)[0]), BANNED);
  assert.doesNotMatch(read('manifest.webmanifest'), BANNED);
  assert.equal(JSON.parse(read('package.json')).name, 'adltrack');
  assert.doesNotMatch(read('auth.js').match(/step===0\?`<h1>.*?<\/p>/g).join(' '), BANNED);
});
