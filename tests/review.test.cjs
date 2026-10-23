const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), os = require('node:os'), path = require('node:path'), fs = require('node:fs');
const { loadPolicies, problems } = require('../server/policies');
const { evaluate } = require('../server/engine');
const { createPolicyFinder, toPolicy, seenUrls, keyFromId, lookupId } = require('../server/lookup');
const { createReview, policyPhrases, pageText } = require('../server/review');
const { createStore } = require('../server/store');
const { createStorage } = require('../server/storage');
const { createData } = require('../server/data');
const { createJobs, defineJobs, defineReviewJobs } = require('../server/jobs');
const { createApp } = require('../server/app');
const C = require('../core.js');

const PG = process.env.TEST_DATABASE_URL || '';
const STORES = [['file store', null], ...(PG ? [['Postgres', PG]] : [])];
const TODAY = '2026-10-12';
const quiet = { log() {}, error() {} };

/* What the model records for a boutique, after searching and reading its official policy page. */
const LUNE = {
  found: true, store_name: 'Maison Lune', official_domain: 'maisonlune.com', policy_url: 'https://www.maisonlune.com/pages/returns', return_url: 'https://returns.maisonlune.com/start',
  window_days: 21, basis: 'delivery', outcome: 'refund', requirement: 'start', conditions: 'Unworn with tags attached.', processing: '5–10 business days',
  receipt_required: 'no', non_returnable: ['Earrings', 'Swimwear'], methods: [{ type: 'mail', label: 'Mail it back', steps: ['Start a return on returns.maisonlune.com', 'Print the label', 'Drop the parcel at USPS'] }]
};
const SEARCH = [
  { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'Maison Lune return policy' } },
  { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: 'https://www.maisonlune.com/pages/returns', title: 'Returns' }, { type: 'web_search_result', url: 'https://couponsite.example/maison-lune', title: 'Coupons' }] }
];
/* A mocked Anthropic client: a paused search turn first (pause_turn), then the record_policy call. */
function mockClient(answer = LUNE, calls = []) {
  return { beta: { messages: { create: async req => {
    calls.push(JSON.parse(JSON.stringify(req)));
    if (calls.length % 2 === 1) return { stop_reason: 'pause_turn', usage: { input_tokens: 900, output_tokens: 80 }, content: SEARCH };
    return { stop_reason: 'tool_use', usage: { input_tokens: 4000, output_tokens: 400 }, content: [{ type: 'web_fetch_tool_result', tool_use_id: 'f1', content: { type: 'web_fetch_result', url: 'https://www.maisonlune.com/pages/returns' } }, { type: 'tool_use', id: 't1', name: 'record_policy', input: typeof answer === 'function' ? answer(req) : answer }] };
  } } } };
}
const seen = ['https://www.maisonlune.com/pages/returns'];

test('a looked-up policy fills the same schema, unverified, with the official page as the source of every fact', () => {
  const p = toPolicy(LUNE, { query: 'MAISON LUNE #12', key: 'maison lune', today: TODAY, seen });
  assert.deepEqual(problems(p), []);
  assert.equal(p.id, 'u-maison-lune');
  assert.equal(keyFromId(p.id), 'maison lune');
  assert.equal(p.status, 'unverified');
  assert.equal(p.item.window.value, 21);
  assert.equal(p.item.window.source, 'https://www.maisonlune.com/pages/returns');
  assert.equal(p.item.url.value, 'https://returns.maisonlune.com/start');
  assert.deepEqual(p.categories[0].examples, ['Earrings', 'Swimwear']);
  assert.deepEqual(p.methods[0].needs, { label: 'unknown', box: 'unknown', qr: 'unknown', printer: 'unknown' }, 'what a way needs is never guessed');
  assert.equal(p.unknowns.length, 0);
  const vague = toPolicy({ ...LUNE, window_days: null, basis: 'unknown', processing: '' }, { query: 'Maison Lune', key: 'maison lune', today: TODAY, seen });
  assert.equal(vague.item.window.value, 'unknown');
  assert.deepEqual(vague.unknowns.map(u => u.topic), ['Return window', 'Window start']);
});

test('a page the search never returned, or one off the store’s own site, is never accepted as a source', () => {
  assert.equal(toPolicy(LUNE, { query: 'Maison Lune', key: 'maison lune', today: TODAY, seen: [] }), null);
  assert.equal(toPolicy({ ...LUNE, policy_url: 'https://couponsite.example/maison-lune' }, { query: 'Maison Lune', key: 'maison lune', today: TODAY, seen: ['https://couponsite.example/maison-lune'] }), null);
  assert.equal(toPolicy({ ...LUNE, policy_url: 'http://www.maisonlune.com/pages/returns' }, { query: 'Maison Lune', key: 'maison lune', today: TODAY, seen }), null);
  assert.equal(toPolicy({ ...LUNE, found: false }, { query: 'Maison Lune', key: 'maison lune', today: TODAY, seen }), null);
  // A return link on another site falls back to the policy page.
  assert.equal(toPolicy({ ...LUNE, return_url: 'https://evil.example/returns' }, { query: 'Maison Lune', key: 'maison lune', today: TODAY, seen }).item.url.value, LUNE.policy_url);
  assert.deepEqual(seenUrls(SEARCH), ['https://www.maisonlune.com/pages/returns', 'https://couponsite.example/maison-lune']);
});

test('the finder searches with web search and web fetch, resumes a paused turn, and records through one strict tool', async () => {
  const calls = [];
  const finder = createPolicyFinder({ client: mockClient(LUNE, calls), log: quiet });
  const r = await finder.find('Maison Lune', { today: TODAY });
  assert.equal(r.policy.name, 'Maison Lune');
  assert.equal(calls.length, 2, 'the paused turn was sent back once');
  assert.equal(calls[0].model, 'claude-opus-5-5');
  assert.deepEqual(calls[0].tools.map(t => t.type || t.name), ['web_search_20260209', 'web_fetch_20260209', 'record_policy']);
  assert.equal(calls[0].tools[2].strict, true);
  assert.equal(calls[1].messages.at(-1).role, 'assistant', 'resumed without an extra "continue" message');
  assert.equal((await createPolicyFinder({ client: mockClient({ ...LUNE, found: false }), log: quiet }).find('Nowhere Shop')).policy, null);
  const broken = { beta: { messages: { create: async () => { throw new Error('overloaded'); } } } };
  assert.equal(await createPolicyFinder({ client: broken, log: quiet }).find('Maison Lune'), null);
  assert.equal(createPolicyFinder({ apiKey: '' }).available(), false);
});

test('unverified data never says "yes, returnable" and always counts from the earlier purchase date', () => {
  const p = toPolicy({ ...LUNE, non_returnable: [] }, { query: 'Maison Lune', key: 'maison lune', today: TODAY, seen });
  const item = { name: 'Linen dress', retailer: 'Maison Lune', purchased: '2026-10-01', delivered: '2026-10-06', channel: 'online' };
  const r = evaluate({ item, policy: p, category: 'general' });
  assert.equal(r.returnable, 'unsure');
  assert.equal(r.unverified, true);
  assert.match(r.reason, /found online and hasn't been checked yet/);
  assert.equal(r.fields.confirmed, false, 'shown as "Date unconfirmed" with a dashed calendar entry');
  assert.equal(r.fields.basis, 'purchase');
  assert.equal(C.due({ ...item, ...r.fields }), '2026-10-22', '21 days from purchase, not from delivery');
  // The same facts, checked, count from delivery and can say yes.
  const checked = evaluate({ item, policy: { ...p, status: 'checked' }, category: 'general' });
  assert.equal(checked.returnable, 'yes');
  assert.equal(C.due({ ...item, ...checked.fields }), '2026-10-27');
});

test('policy phrases: windows, dates, fees and terms change; wording and banners don’t', () => {
  const page = '<html><script>var x=1</script><h1>Returns</h1><p>Return within 30 days for a refund. Holiday purchases: return by January 15, 2027. Restocking fee $15.00.</p></html>';
  assert.equal(pageText(page), 'Returns Return within 30 days for a refund. Holiday purchases: return by January 15, 2027. Restocking fee $15.00.');
  assert.deepEqual(policyPhrases(pageText(page)), ['$15.00', '30 days', 'holiday', 'january 15, 2027', 'refund', 'restocking fee']);
  assert.deepEqual(policyPhrases('Free shipping today! Return within 30 days for a refund, holiday January 15, 2027, restocking fee $15.00'), policyPhrases(pageText(page)));
});

async function boot(t, databaseUrl, { client = mockClient(), pages = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'returnly-review-'));
  if (databaseUrl) {
    const { Client } = require('pg');
    const c = new Client({ connectionString: databaseUrl });
    await c.connect(); await c.query('drop schema public cascade; create schema public'); await c.end();
  }
  const store = createStore({ databaseUrl, file: path.join(dir, 'store.json') });
  await store.init();
  const storage = createStorage({ dir: path.join(dir, 'files') });
  const jobs = createJobs({ store, log: quiet });
  const data = createData({ store, storage, jobs });
  defineJobs(jobs, { store, storage, data });
  const policies = loadPolicies();
  const fetchPage = async url => pages[url] === undefined ? { ok: false, status: 404, text: async () => '' } : { ok: true, status: 200, text: async () => pages[url] };
  const review = createReview({ store, data, policies, finder: createPolicyFinder({ client, apiKey: '', log: quiet }), jobs, admins: ['admin@example.com'], fetch: fetchPage, log: quiet });
  defineReviewJobs(jobs, review);
  const server = http.createServer(createApp({ store, data, policies, review })).listen(0);
  t.after(async () => { server.close(); await store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const client_ = async email => {
    let cookie = '';
    const call = async (method, url, body) => {
      const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
      return { status: res.status, json: await res.json().catch(() => null) };
    };
    const r = await call('POST', '/api/signup', { name: email.split('@')[0], email, password: 'Care-plan-2026' });
    assert.equal(r.status, 201);
    return Object.assign(call, { user: r.json.user });
  };
  return { client: client_, store, jobs, policies, review };
}
const lune = { name: 'Linen dress', retailer: 'MAISON LUNE #12', purchased: '2026-10-01', channel: 'store' };

for (const [kind, databaseUrl] of STORES) test(`an unknown store is looked up once in the background, cached for everyone and counted (${kind})`, async t => {
  const calls = [];
  const app = await boot(t, databaseUrl, { client: mockClient(LUNE, calls) });
  const ana = await app.client('ana@example.com'), ben = await app.client('ben@example.com');
  let r = await ana('POST', '/api/policy', { item: lune });
  assert.equal(r.status, 200);
  assert.equal(r.json.lookup, 'pending');
  assert.equal(r.json.retailer, null);
  assert.match(r.json.result.line, /Looking up MAISON LUNE #12's return policy/);
  assert.equal(r.json.result.fields.confirmed, false);
  assert.equal((await ana('POST', '/api/policy', { item: lune })).json.lookup, 'pending', 'asking again doesn’t queue a second lookup');
  await app.jobs.drain();
  assert.equal(calls.length, 2, 'one lookup (two requests: the paused turn and its continuation)');
  r = await ana('POST', '/api/policy', { item: lune });
  assert.equal(r.json.lookup, 'unverified');
  assert.deepEqual(r.json.retailer, { id: 'u-maison-lune', name: 'Maison Lune', version: 1, checked: r.json.retailer.checked, unverified: true });
  assert.equal(r.json.result.returnable, 'unsure');
  assert.equal(r.json.result.fields.confirmed, false);
  assert.equal(r.json.result.fields.window, 21);
  assert.equal(r.json.guide.methods[0].label, 'Mail it back');
  // Another account buying there gets the answer straight away, with no new lookup.
  r = await ben('POST', '/api/policy', { item: { ...lune, retailer: 'Maison Lune' } });
  assert.equal(r.json.lookup, 'unverified');
  await app.jobs.drain();
  assert.equal(calls.length, 2);
  // A receipt that prints its own window is used instead of a lookup.
  r = await ben('POST', '/api/policy', { item: { ...lune, retailer: 'Corner Shop', receiptPolicy: 'Returns accepted within 14 days with receipt.' } });
  assert.equal(r.json.lookup, undefined);
  assert.equal(r.json.result.fields.window, 14);
  // Checked retailers never trigger a lookup.
  assert.equal((await ben('POST', '/api/policy', { item: { ...lune, retailer: 'Target' } })).json.lookup, undefined);
  // Only admins see the review page; it ranks stores by how many people use them.
  assert.equal((await ana('GET', '/api/admin/review')).status, 404);
  const admin = await app.client('admin@example.com');
  assert.equal(admin.user.admin, true);
  assert.equal(ana.user.admin, undefined);
  const page = (await admin('GET', '/api/admin/review')).json;
  assert.deepEqual(page.stores.map(s => [s.name, s.users, s.status]), [['Maison Lune', 2, 'found']]);
  assert.equal(page.stores[0].policy.window, 21);
});

for (const [kind, databaseUrl] of STORES) test(`"Is this wrong?" reports are saved for review, and approving a looked-up store makes it checked (${kind})`, async t => {
  const app = await boot(t, databaseUrl);
  const ana = await app.client('ana@example.com'), admin = await app.client('admin@example.com');
  await ana('POST', '/api/policy', { item: lune });
  await app.jobs.drain();
  await ana('POST', '/api/items', { id: 'dress', ...lune, price: 120, status: 'deciding', window: 21, basis: 'purchase', confirmed: false, retailerId: 'u-maison-lune', policyCategory: 'general' });
  const sent = await ana('POST', '/api/policy/report', { retailerId: 'u-maison-lune', store: 'Maison Lune', itemName: 'Linen dress', policyVersion: 1, policyLine: 'Not sure it’s returnable', note: '  They told me 30 days in store.  ' });
  assert.equal(sent.status, 201);
  assert.equal((await ana('POST', '/api/policy/report', { store: '' })).status, 400);
  let page = (await admin('GET', '/api/admin/review')).json;
  assert.deepEqual(page.reports.map(r => [r.store, r.itemName, r.note]), [['Maison Lune', 'Linen dress', 'They told me 30 days in store.']]);
  assert.equal((await admin('POST', `/api/admin/reports/${page.reports[0].id}/resolve`, {})).status, 200);
  assert.equal((await admin('POST', '/api/admin/stores/approve', { key: 'maison lune' })).status, 200);
  const r = await ana('POST', '/api/policy', { item: lune });
  assert.equal(r.json.retailer.id, 'maison-lune');
  assert.equal(r.json.retailer.unverified, undefined);
  assert.equal(r.json.result.fields.confirmed, true);
  assert.equal(app.policies.get('maison-lune').status, 'checked');
  // The item moved to the approved policy.
  const item = (await ana('GET', '/api/items')).json.items.find(i => i.id === 'dress');
  assert.equal(item.retailerId, 'maison-lune');
  assert.equal(item.confirmed, true);
  page = (await admin('GET', '/api/admin/review')).json;
  assert.deepEqual(page.stores, []);
  assert.deepEqual(page.reports, []);
  // Approved policies survive a restart.
  const fresh = loadPolicies();
  assert.equal(fresh.get('maison-lune'), null);
  assert.equal(await createReview({ store: app.store, policies: fresh, admins: [] }).loadApproved(), 1);
  assert.equal(fresh.match('Maison Lune').id, 'maison-lune');
  // Deleting the account deletes its reports, notices and usage counts.
  assert.equal((await ana('DELETE', '/api/account', { password: 'Care-plan-2026' })).status, 200);
});

for (const [kind, databaseUrl] of STORES) test(`the weekly freshness check flags meaningful changes, and an approved earlier deadline updates items and tells their owners (${kind})`, async t => {
  const pages = {};
  const app = await boot(t, databaseUrl, { pages, client: mockClient(() => ({ ...LUNE, store_name: 'Zara', official_domain: 'zara.com', policy_url: 'https://www.zara.com/us/en/help-center/HowToReturn', window_days: 15 })) });
  const zara = app.policies.get('zara');
  const url = zara.item.window.source;
  pages[url] = '<p>You have 30 days from the shipping confirmation to return your purchase for a refund.</p>';
  const ana = await app.client('ana@example.com'), admin = await app.client('admin@example.com');
  await ana('POST', '/api/items', { id: 'coat', name: 'Wool coat', retailer: 'Zara', retailerId: 'zara', price: 129, purchased: '2026-10-05', channel: 'store', status: 'deciding', window: 30, basis: 'purchase', confirmed: true, policyCategory: 'general' });
  await ana('POST', '/api/items', { id: 'kept', name: 'Scarf', retailer: 'Zara', retailerId: 'zara', price: 29, purchased: '2026-10-05', status: 'kept', window: 30, basis: 'purchase' });
  // First run: baseline only.
  const first = await app.review.freshness({ now: new Date('2026-11-02T10:00:00Z') });
  assert.deepEqual([first.checked, first.flagged], [1, 0]);
  assert.ok(first.failed > 0, 'pages that can’t be fetched are counted and skipped');
  // A new banner isn't a change; a new window is.
  pages[url] = '<div>Free shipping this week!</div><p>You have 30 days from the shipping confirmation to return your purchase for a refund.</p>';
  assert.equal((await app.review.freshness({ now: new Date('2026-11-09T10:00:00Z') })).flagged, 0);
  pages[url] = '<p>You have 15 days to return your purchase for a refund. Holiday purchases: return by January 15, 2027.</p>';
  assert.equal((await app.review.freshness({ now: new Date('2026-11-16T10:00:00Z') })).flagged, 1);
  assert.equal(app.policies.get('zara').version, zara.version, 'nothing changes automatically');
  const notices = (await admin('GET', '/api/notices')).json.notices;
  assert.match(notices[0].text, /1 policy change flagged for review/);
  const flag = (await admin('GET', '/api/admin/review')).json.flags[0];
  assert.equal(flag.store, 'Zara');
  assert.equal(flag.holiday, true, 'a holiday change in October to December is marked');
  assert.deepEqual(flag.added, ['15 days', 'holiday', 'january 15, 2027']);
  assert.deepEqual(flag.removed, ['30 days']);
  assert.equal(flag.proposed.window, 15);
  assert.equal((await ana('POST', `/api/admin/flags/${flag.id}`, { action: 'approve', window: 15 })).status, 404, 'admins only');
  const done = await admin('POST', `/api/admin/flags/${flag.id}`, { action: 'approve', window: 15 });
  assert.equal(done.status, 200);
  assert.deepEqual([done.json.retailer.version, done.json.changed, done.json.notified], [zara.version + 1, 1, 1]);
  assert.equal(app.policies.get('zara').item.window.value, 15);
  assert.equal(app.policies.get('zara').item.window.source, url);
  const items = (await ana('GET', '/api/items')).json.items;
  assert.equal(C.due(items.find(i => i.id === 'coat')), '2026-10-20');
  assert.equal(items.find(i => i.id === 'kept').window, 30, 'kept items are left alone');
  const told = (await ana('GET', '/api/notices')).json.notices;
  assert.deepEqual(told.map(n => n.text), ['Zara changed its return policy. Return Wool coat by Oct 20.']);
  await ana('POST', '/api/notices/read', { ids: told.map(n => n.id) });
  assert.deepEqual((await ana('GET', '/api/notices')).json.notices, []);
  assert.equal((await admin('POST', `/api/admin/flags/${flag.id}`, { action: 'dismiss' })).status, 404, 'already reviewed');
});

test('outside October to December a change isn’t marked as a holiday-season change', async t => {
  const pages = {};
  const app = await boot(t, null, { pages, client: null });
  const url = app.policies.get('zara').item.window.source;
  pages[url] = '<p>30 days. Holiday returns until January 8.</p>';
  await app.review.freshness({ now: new Date('2026-05-01T10:00:00Z') });
  pages[url] = '<p>30 days. Holiday returns until January 15.</p>';
  await app.review.freshness({ now: new Date('2026-05-08T10:00:00Z') });
  const [flag] = await app.store.listPolicyFlags();
  assert.equal(flag.holiday, false);
  assert.equal(flag.proposed, null, 'no AI key: no proposal, the admin reads the page');
  assert.equal(lookupId('maison lune'), 'u-maison-lune');
});
