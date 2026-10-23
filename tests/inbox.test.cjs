const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), os = require('node:os'), path = require('node:path'), fs = require('node:fs'), crypto = require('node:crypto'), vm = require('node:vm');
const { createEmailReader, cleanEmail, knownSender, isShoppingEmail, gmailQuery, htmlToText, forwardedFrom, orderKey, RETAILER_SENDERS } = require('../server/mail');
const { createInbox } = require('../server/inbox');
const { createOAuth, seal, unseal, idClaims, appleClientSecret, tokenKey } = require('../server/oauth');
const { loadPolicies } = require('../server/policies');
const { createStore } = require('../server/store');
const { createData } = require('../server/data');
const { createStorage } = require('../server/storage');
const { createJobs, defineJobs, defineInboxJobs } = require('../server/jobs');
const { createApp, hashPassword } = require('../server/app');
const { MODEL } = require('../server/receipts');
const C = require('../core.js');

const P = loadPolicies();
const quiet = { log() {}, error() {} };
const TODAY = new Date().toISOString().slice(0, 10);
// Fabricated sample emails; {d-N} is N days ago, so deadlines stay realistic whenever the tests run.
const SAMPLES = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'emails', 'samples.json'), 'utf8').replace(/\{d-(\d+)\}/g, (m, n) => C.shift(TODAY, -Number(n))));
const sample = name => SAMPLES[name];
// The mocked model: answers with the sample whose subject matches.
function mockReader() {
  const calls = [];
  return { calls, available: () => true, read: async email => { calls.push(email); const s = Object.values(SAMPLES).find(x => x.subject === email.subject); return s ? cleanEmail(s.answer, { today: C.shift(TODAY, 1) }) : null; } };
}
function mockOAuth() {
  const revoked = [];
  return { revoked, available: { google: true, microsoft: true, apple: true }, refresh: async () => ({ access_token: 'fresh-access', expires_in: 3600 }), revoke: async (p, t) => { revoked.push([p, t]); return true; } };
}
// Postgres runs too when TEST_DATABASE_URL points at a throwaway database (its tables are dropped).
const PG = process.env.TEST_DATABASE_URL || '';
const STORES = [['file store', null], ...(PG ? [['Postgres', PG]] : [])];
const open = new Set();
test.after(async () => { for (const s of open) await s.close(); });
async function setup({ fetch = async () => { throw new Error('no network in tests'); }, oauth = mockOAuth(), reader = mockReader(), databaseUrl = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-inbox-')), file = path.join(dir, 'store.json');
  if (databaseUrl) {
    const { Client } = require('pg');
    const c = new Client({ connectionString: databaseUrl });
    await c.connect(); await c.query('drop schema public cascade; create schema public'); await c.end();
  }
  const store = createStore({ databaseUrl, file });
  await store.init();
  if (databaseUrl) open.add(store);
  const storage = createStorage({ dir: path.join(dir, 'files') });
  const jobs = createJobs({ store, log: quiet });
  const data = createData({ store, storage, jobs });
  defineJobs(jobs, { store, storage, data });
  // A mocked Resend receiving API: the messages "received" so far, by Resend email id.
  const mailbox = new Map(), RESEND = 'https://api.resend.com/emails/receiving/';
  const all = async (url, opts = {}) => {
    if (!url.startsWith(RESEND)) return fetch(url, opts);
    assert.equal(opts.headers.Authorization, 'Bearer re_test_key');
    const m = mailbox.get(decodeURIComponent(url.slice(RESEND.length)));
    return m ? { ok: true, status: 200, json: async () => m } : { ok: false, status: 404, json: async () => ({}) };
  };
  const inbox = createInbox({ store, data, policies: P, reader, jobs, oauth, key: crypto.randomBytes(32), domain: 'in.returnly.app', resendKey: 're_test_key', publicUrl: 'https://returnly.example', fetch: all, log: quiet });
  defineInboxJobs(jobs, inbox);
  const user = await store.createUser({ email: 'sam@example.com', name: 'Sam', passwordHash: 'x' });
  // The email.received webhook for a message (metadata only), and reading one straight away to see why it was dropped.
  const deliver = m => { mailbox.set(m.id, m); return inbox.inbound({ type: 'email.received', data: { email_id: m.id, from: m.from, to: m.to, subject: m.subject } }); };
  const readNow = m => { mailbox.set(m.id, m); return inbox.readForwarded({ userId: user.id, emailId: m.id }); };
  // Everything the store holds, as text, to check what is (and isn't) kept.
  async function rows(table) {
    if (!databaseUrl) { const db = JSON.parse(fs.readFileSync(file, 'utf8')); const pick = { jobs: Object.values(db.jobs), inbox_messages: Object.values(db.inboxMessages[user.id] || {}), purchases: Object.values(db.purchases[user.id] || {}) }; return table ? pick[table] : [db]; }
    const { Client } = require('pg'); const c = new Client({ connectionString: databaseUrl }); await c.connect();
    try {
      if (table) return (await c.query(`select * from ${table}`)).rows.map(r => ({ ...r, ...(r.fields ? { fields: r.fields } : {}) }));
      const out = [];
      for (const t of ['jobs', 'inbox_messages', 'inbox_connections', 'email_orders', 'purchases', 'items', 'notices', 'inbox_addresses']) out.push((await c.query(`select * from ${t}`)).rows);
      return out;
    } finally { await c.end(); }
  }
  const raw = async () => JSON.stringify(await rows());
  return { store, data, jobs, inbox, user, reader, oauth, raw, rows, deliver, readNow };
}
// A message as Resend's receiving API returns it: Sam forwarding one of the sample emails to their address.
let mailSeq = 0;
const forwarded = (to, name, extra = {}) => { const s = sample(name); return { id: `em_${++mailSeq}`, from: 'Sam <sam@example.com>', to: [to], subject: s.subject, created_at: s.date + 'T12:00:00Z', message_id: `<${name}@mail.example.com>`, text: `---------- Forwarded message ---------\nFrom: ${s.from}\nSubject: ${s.subject}\n\n${s.text || htmlToText(s.html)}`, headers: { 'received-spf': 'Pass (sender SPF authorized)' }, ...extra }; };

test('shopping senders: the launch retailers and shopping services, by domain or subdomain', () => {
  for (const id of P.list().map(p => p.id)) assert.ok(RETAILER_SENDERS[id], `${id} has its sending domains`);
  assert.deepEqual(knownSender('Target <orders@oe.target.com>'), { retailerId: 'target' });
  assert.deepEqual(knownSender('auto-confirm@amazon.com'), { retailerId: 'amazon' });
  assert.deepEqual(knownSender('Returns <noreply@happyreturns.com>'), { service: true });
  assert.equal(knownSender('friend@example.com'), null);
  assert.equal(knownSender('amazon.com.phish@evil.example'), null, 'only the address’s own domain counts');
  assert.deepEqual(knownSender({ name: 'Zara', email: 'noreply@zara.com' }), { retailerId: 'zara' }, 'senders may come as objects');
  assert.equal(isShoppingEmail({ from: sample('amazon-order').from, subject: sample('amazon-order').subject }), true);
  assert.equal(isShoppingEmail({ from: sample('nike-newsletter').from, subject: sample('nike-newsletter').subject }), false, 'newsletters are never opened');
  assert.match(gmailQuery(), /^newer_than:90d from:\(amazon\.com OR walmart\.com OR /);
  assert.match(gmailQuery(new Date('2026-10-01T00:00:00Z')), /^after:1790812800 from:/);
  assert.equal(orderKey('#112-3344556 7788990'), orderKey('1123344556-7788990'));
});

test('email text: HTML without styles or tags, and the original sender of a forwarded message', () => {
  const t = htmlToText(sample('amazon-order').html);
  assert.match(t, /Sony WH-1000XM5 Wireless Headphones/);
  assert.match(t, /\$410\.75 & tax/);
  assert.doesNotMatch(t, /color:red|<td>/);
  assert.equal(forwardedFrom('hi\n---------- Forwarded message ---------\nFrom: Amazon.com <auto-confirm@amazon.com>\nDate: x'), 'Amazon.com <auto-confirm@amazon.com>');
  assert.equal(forwardedFrom('Begin forwarded message:\n\nFrom: ZARA <noreply@zara.com>\n'), 'ZARA <noreply@zara.com>');
});

test('the email reader asks the receipt model with structured output, scrubs card numbers and drops misreads', async () => {
  const calls = [];
  const client = { beta: { messages: { create: async req => { calls.push(req); return { stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 200 }, content: [{ type: 'text', text: JSON.stringify({ ...sample('amazon-order').answer, order_date: '2099-01-01', items: [...sample('amazon-order').answer.items, { name: '', quantity: 1, price: 5 }] }) }] }; } } } };
  const reader = createEmailReader({ client, log: quiet });
  const r = await reader.read({ from: 'auto-confirm@amazon.com', subject: 'Your order', date: 'x', text: 'Paid with card 4111 1111 1111 1111. Thanks.' }, { today: TODAY });
  const req = calls[0];
  assert.equal(req.model, MODEL);
  assert.equal(req.fallbacks, 'default');
  assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.doesNotMatch(req.messages[0].content, /4111/);
  assert.equal(r.kind, 'order');
  assert.equal(r.orderNumber, '112-3344556-7788990', 'a leading # is dropped');
  assert.equal(r.purchased, null, 'a date in the future is a misread');
  assert.equal(r.items.length, 2, 'lines without a name are dropped');
  const refused = createEmailReader({ client: { beta: { messages: { create: async () => ({ stop_reason: 'refusal', content: [] }) } } }, log: quiet });
  assert.equal(await refused.read({ text: 'x' }), null);
  assert.equal(createEmailReader({ apiKey: '' }).available(), false);
});

for (const [label, databaseUrl] of STORES) test(`${label}: forwarded emails: a new order becomes a card, then delivery, return and refund update the items the user added`, async () => {
  const { store, data, jobs, inbox, user, raw, rows, deliver } = await setup({ databaseUrl });
  const { address } = await inbox.status(user);
  assert.match(address, /^u-[a-z0-9]{8}@in\.returnly\.app$/);
  const send = async name => { assert.equal((await deliver(forwarded(address, name))).accepted, true, name); await jobs.drain(); };

  await send('amazon-order');
  let s = await inbox.status(user);
  assert.equal(s.orders.length, 1);
  const order = s.orders[0];
  assert.equal(order.store, 'Amazon', 'the store is the matched retailer’s name');
  assert.equal(order.orderNumber, '112-3344556-7788990');
  assert.equal(order.purchased, C.shift(TODAY, -12));
  assert.deepEqual(order.products.map(p => [p.name, p.price]), [['Sony WH-1000XM5 Wireless Headphones', 348], ['Bamboo Cutting Board, Set of 2', 15], ['Bamboo Cutting Board, Set of 2', 15]], 'one card line per unit');
  assert.equal((await store.getPurchase(user.id, order.id)).source, 'email');
  assert.equal((await store.listItems(user.id)).length, 0, 'nothing becomes a purchase or a return without the user');

  // The user opens the card and taps the headphones on the Item card; the rest are saved as kept (as guided.js does).
  const base = { purchaseId: order.id, retailer: 'Amazon', retailerId: 'amazon', purchased: order.purchased, delivered: '', channel: 'online', basis: 'purchase', window: 30, orderNumber: order.orderNumber, outcome: 'unknown', requirement: 'unknown', confirmed: false };
  await data.saveItem(user.id, { ...base, id: 'phones', name: 'Sony WH-1000XM5 Wireless Headphones', price: 348, status: 'deciding', intent: 'return' });
  await data.saveItem(user.id, { ...base, id: 'board', name: 'Bamboo Cutting Board', price: 15, status: 'kept', intent: 'keep' });
  assert.equal((await inbox.status(user)).orders.length, 0, 'an opened order is no longer a card');

  await send('amazon-delivered');
  let phones = (await store.getItem(user.id, 'phones')).item;
  assert.equal(phones.delivered, C.shift(TODAY, -8));
  const policy = P.get('amazon');
  assert.equal(phones.basis, policy.item.basis.value, 'the deadline is recomputed from the checked policy');
  assert.equal(C.due(phones), C.shift(phones.basis === 'delivery' ? phones.delivered : phones.purchased, phones.window));
  assert.ok(phones.policyLine, 'the Return card line is refreshed too');
  assert.match((await store.listNotices(user.id))[0].text, /Amazon order was delivered/);

  await send('amazon-return-started');
  assert.equal((await store.getItem(user.id, 'phones')).item.status, 'started');
  assert.equal((await store.getItem(user.id, 'board')).item.status, 'kept', 'a kept item never becomes a return from an email');
  await send('amazon-return-shipped');
  phones = (await store.getItem(user.id, 'phones')).item;
  assert.equal(phones.status, 'shipped');
  assert.equal(phones.returnedOn, C.shift(TODAY, -4));
  await send('amazon-refund');
  phones = (await store.getItem(user.id, 'phones')).item;
  assert.equal(phones.status, 'received');
  assert.equal(phones.received, 348);
  assert.match((await store.listNotices(user.id)).map(n => n.text).join(' '), /Amazon refunded \$348\.00 for Sony/);

  // A shipping notice for an order we haven't seen is a new card; a refund for an unknown order changes nothing.
  await send('target-shipped');
  s = await inbox.status(user);
  assert.deepEqual(s.orders.map(o => [o.store, o.orderNumber, o.products.length]), [['Target', '902334455120', 2]]);
  await send('zara-refund-credit');
  await send('nike-newsletter');
  assert.equal((await inbox.status(user)).orders.length, 1);

  // Never stored: the email bodies. The job queue holds only Resend's email id.
  const file = await raw();
  for (const phrase of ['left at front door', 'Visa ending in 4242', 'Thanks for dropping off']) assert.ok(!file.includes(phrase), phrase);
  const forwardJobs = (await rows('jobs')).filter(j => j.name === 'inbox.forwarded');
  assert.ok(forwardJobs.length >= 8 && forwardJobs.every(j => JSON.stringify(Object.keys(j.payload).sort()) === '["emailId","userId"]'));
  const kept = await rows('inbox_messages');
  assert.ok(kept.every(m => /^forward:[0-9a-f]{64}$/.test(m.key)));
  assert.deepEqual(Object.keys(kept.find(m => m.kind === 'order').fields).sort(), ['delivered', 'items', 'kind', 'orderNumber', 'purchased', 'refund', 'refundDate', 'refundMethod', 'store']);
  // The same email twice is read once.
  const before = (await store.listNotices(user.id)).length;
  await send('amazon-refund');
  assert.equal((await store.listNotices(user.id)).length, before);
});

for (const [label, databaseUrl] of STORES) test(`${label}: forwarding address: unknown addresses, other senders and forged mail are dropped; Gmail’s confirmation is shown`, async () => {
  const { store, jobs, inbox, user, reader, deliver, readNow } = await setup({ databaseUrl });
  const { address } = await inbox.status(user);
  assert.equal((await inbox.inbound({ type: 'email.sent', data: { email_id: 'x' } })).reason, 'ignored');
  assert.equal((await deliver(forwarded('u-nobody00@in.returnly.app', 'amazon-order'))).reason, 'unknown_address', 'dropped without being fetched');
  assert.equal((await readNow(forwarded(address, 'amazon-order', { from: 'x@example.com' }))).reason, 'unverified_sender');
  assert.equal((await readNow(forwarded(address, 'zara-refund-credit', { from: { name: 'Sam', email: 'Sam@Example.com' }, to: [{ email: address }] }))).accepted, true, 'senders and recipients may come as objects');
  assert.equal((await readNow(forwarded(address, 'amazon-order', { headers: { 'Received-SPF': 'Fail (not authorized)' } }))).reason, 'unauthenticated');
  assert.equal((await inbox.readForwarded({ userId: user.id, emailId: 'em_missing' })).reason, 'gone');
  // Gmail auto-forwarding: Google sends a code first; the user accepts the address, then its forwarded mail is read.
  const confirm = await readNow({ id: 'em_google', from: 'Gmail Team <forwarding-noreply@google.com>', to: [address], subject: '(#123456789) Gmail Forwarding Confirmation', text: `sam.shops@gmail.com has requested to automatically forward mail to your email address ${address}.\nConfirmation code: 123456789`, headers: {} });
  assert.equal(confirm.accepted, true);
  let s = await inbox.status(user);
  assert.deepEqual([s.gmailRequest.email, s.gmailRequest.code], ['sam.shops@gmail.com', '123456789']);
  assert.ok(!s.senders.includes('sam.shops@gmail.com'), 'the request alone never adds a sender');
  const auto = () => forwarded(address, 'amazon-order', { from: sample('amazon-order').from, text: sample('amazon-order').html.replace(/<[^>]+>/g, ' '), headers: { 'X-Forwarded-For': `sam.shops@gmail.com ${address}`, 'Received-SPF': 'Pass' } });
  assert.equal((await readNow(auto())).reason, 'unverified_sender');
  s = await inbox.acceptSender(user.id, 'sam.shops@gmail.com');
  assert.ok(s.senders.includes('sam.shops@gmail.com'));
  assert.equal(s.gmailRequest, null);
  assert.equal((await deliver(auto())).accepted, true);
  await jobs.drain();
  assert.equal(reader.calls.length, 2);
  assert.equal(reader.calls[0].from, sample('zara-refund-credit').from);
  assert.equal(reader.calls[1].from, sample('amazon-order').from);
  // A new address replaces the old one straight away, also for mail that arrived just before.
  const late = forwarded(address, 'target-shipped');
  const next = (await inbox.newAddress(user.id)).address;
  assert.notEqual(next, address);
  assert.equal((await deliver(forwarded(address, 'amazon-order'))).reason, 'unknown_address');
  assert.equal((await readNow(late)).reason, 'unknown_address');
  assert.equal(await store.findInboxAddress(address.split('@')[0]), null);
});

/* A mocked Gmail API: two messages from known senders, one of them a newsletter. */
function gmailFetch(log) {
  const b64 = s => Buffer.from(s).toString('base64url');
  const messages = {
    m1: { payload: { mimeType: 'multipart/alternative', headers: [{ name: 'From', value: sample('amazon-order').from }, { name: 'Subject', value: sample('amazon-order').subject }, { name: 'Date', value: sample('amazon-order').date }], parts: [{ mimeType: 'text/html', body: { data: b64(sample('amazon-order').html) } }] } },
    m2: { payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: sample('nike-newsletter').from }, { name: 'Subject', value: sample('nike-newsletter').subject }], body: { data: b64(sample('nike-newsletter').text) } } }
  };
  return async (url, opts = {}) => {
    log.push([opts.method || 'GET', url, opts.headers && opts.headers.Authorization]);
    const json = body => ({ ok: true, status: 200, json: async () => body });
    if (url.endsWith('/users/me/profile')) return json({ emailAddress: 'Sam.Shops@gmail.com' });
    const msg = /\/messages\/(m\d)\?format=full$/.exec(url);
    if (msg) return json(messages[msg[1]]);
    if (/\/users\/me\/messages\?/.test(url)) return json({ messages: [{ id: 'm1' }, { id: 'm2' }] });
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

for (const [label, databaseUrl] of STORES) test(`${label}: Gmail: connect saves encrypted tokens, imports 90 days of shopping mail, keeps checking, and disconnect deletes it all`, async () => {
  const log = [];
  const { store, jobs, inbox, user, reader, oauth, raw, rows } = await setup({ fetch: gmailFetch(log), databaseUrl });
  await inbox.connect(user.id, 'gmail', { refresh_token: 'refresh-secret-123', access_token: 'access-1', expires_in: 3600 });
  await jobs.drain();
  const list = log.find(([, url]) => /messages\?/.test(url));
  assert.match(decodeURIComponent(list[1]).replace(/\+/g, ' '), /q=newer_than:90d from:\(amazon\.com/);
  assert.equal(list[2], 'Bearer access-1');
  assert.equal(reader.calls.length, 1, 'the newsletter is fetched but never read');
  let s = await inbox.status(user);
  assert.deepEqual(s.connections.map(c => [c.provider, c.email, c.status]), [['gmail', 'sam.shops@gmail.com', 'active']]);
  assert.ok(s.connections[0].syncedAt);
  assert.equal(s.orders.length, 1);
  assert.ok(s.senders.includes('sam.shops@gmail.com'), 'a connected inbox is a verified sender');
  const all = await raw();
  assert.ok(!all.includes('refresh-secret-123') && !all.includes('access-1'), 'tokens are encrypted at rest');

  // The next check asks only for mail since the last one, and skips messages already read.
  await inbox.poll();
  await jobs.drain();
  assert.match(decodeURIComponent(log.filter(([, url]) => /messages\?/.test(url)).pop()[1]).replace(/\+/g, ' '), /q=after:\d+ from:/);
  assert.equal(reader.calls.length, 1);

  await inbox.disconnect(user.id, 'gmail');
  assert.deepEqual(oauth.revoked, [['gmail', 'refresh-secret-123']], 'access is revoked with Google');
  s = await inbox.status(user);
  assert.equal(s.connections.length, 0);
  assert.equal(s.orders.length, 0, 'orders from that inbox nobody opened are deleted');
  assert.equal((await rows('inbox_messages')).length, 0);
  assert.equal((await rows('purchases')).length, 0);
});

test('Gmail: an expired or revoked grant marks the inbox for reconnecting instead of retrying', async () => {
  const oauth = { ...mockOAuth(), refresh: async () => { throw Object.assign(new Error('Token has been expired or revoked.'), { code: 'invalid_grant' }); } };
  const { jobs, inbox, user } = await setup({ fetch: gmailFetch([]), oauth });
  await inbox.connect(user.id, 'gmail', { refresh_token: 'r', access_token: 'a', expires_in: 0 });
  await jobs.drain();
  assert.equal((await inbox.status(user)).connections[0].status, 'expired');
});

for (const [label, databaseUrl] of STORES) test(`${label}: Outlook: only shopping mail is opened, the Graph subscription is checked by clientState, and renewals keep it alive`, async () => {
  const log = []; let clientState = '';
  const fetch = async (url, opts = {}) => {
    log.push([opts.method || 'GET', url]);
    const json = body => ({ ok: true, status: 200, json: async () => body });
    if (url.endsWith('/subscriptions') && opts.method === 'POST') { const b = JSON.parse(opts.body); clientState = b.clientState; assert.equal(b.notificationUrl, 'https://returnly.example/api/inbox/outlook/notify'); assert.equal(b.resource, "me/mailFolders('inbox')/messages"); return json({ id: 'sub-1' }); }
    if (/\/subscriptions\/sub-1$/.test(url)) return json({});
    if (/\/me\/messages\?/.test(url)) return json({ value: [
      { id: 'o1', subject: sample('target-shipped').subject, from: { emailAddress: { address: 'orders@oe.target.com' } } },
      { id: 'o2', subject: 'Order of events for Saturday', from: { emailAddress: { address: 'friend@example.com' } } },
      { id: 'o3', subject: 'Big savings this weekend', from: { emailAddress: { address: 'deals@walmart.com' } } }
    ] });
    if (/\/me\/messages\/o1\?/.test(url)) { assert.equal(opts.headers.Prefer, 'outlook.body-content-type="text"'); return json({ subject: sample('target-shipped').subject, from: { emailAddress: { name: 'Target', address: 'orders@oe.target.com' } }, receivedDateTime: sample('target-shipped').date + 'T10:00:00Z', body: { contentType: 'text', content: sample('target-shipped').text } }); }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const { store, jobs, inbox, user } = await setup({ fetch, databaseUrl });
  await inbox.connect(user.id, 'outlook', { refresh_token: 'r', access_token: 'a', expires_in: 3600, claims: { email: 'Sam@Outlook.com' } });
  await jobs.drain();
  assert.ok(log.some(([, url]) => /\/me\/messages\/o1\?/.test(url)));
  assert.ok(!log.some(([, url]) => /\/me\/messages\/o[23]\?/.test(url)), 'other mail is never opened');
  assert.deepEqual((await inbox.status(user)).orders.map(o => o.store), ['Target']);
  const conn = (await store.listInboxConnections(user.id))[0];
  assert.equal(conn.subscriptionId, 'sub-1');
  assert.notEqual(conn.subscriptionSecret, clientState, 'only a hash of the clientState is kept');

  const queued = () => jobs.drain();
  await inbox.outlookNotify({ value: [{ subscriptionId: 'sub-1', clientState: 'forged' }] });
  assert.equal(await queued(), 0, 'a notification without our clientState is ignored');
  await inbox.outlookNotify({ value: [{ subscriptionId: 'sub-1', clientState }] });
  assert.ok(await queued() >= 1);
  await store.updateInboxConnection(conn.id, { subscriptionExpires: new Date(Date.now() + 3600e3) });
  await inbox.poll();
  assert.ok(log.some(([m, url]) => m === 'PATCH' && /\/subscriptions\/sub-1$/.test(url)), 'renewed when less than a day is left');
  await inbox.disconnect(user.id, 'outlook');
  assert.ok(log.some(([m, url]) => m === 'DELETE' && /\/subscriptions\/sub-1$/.test(url)));
});

test('tokens: sealed values can’t be read or changed without the key; id tokens and Apple’s client secret are checked', () => {
  const key = crypto.randomBytes(32), sealed = seal(key, { refresh: 'secret' });
  assert.deepEqual(unseal(key, sealed), { refresh: 'secret' });
  assert.ok(!sealed.includes('secret'));
  assert.throws(() => unseal(crypto.randomBytes(32), sealed));
  const parts = sealed.split('.'); parts[3] = Buffer.from('{"refresh":"other"}').toString('base64');
  assert.throws(() => unseal(key, parts.join('.')), 'tampering is caught');
  assert.throws(() => tokenKey('c2hvcnQ='), /32 bytes/);
  const jwt = c => `e30.${Buffer.from(JSON.stringify(c)).toString('base64url')}.`;
  const good = { iss: 'https://accounts.google.com', aud: 'cid', exp: Date.now() / 1000 + 600, nonce: 'n1', sub: '1' };
  assert.equal(idClaims(jwt(good), { issuers: ['https://accounts.google.com'], audience: 'cid', nonce: 'n1' }).sub, '1');
  assert.throws(() => idClaims(jwt({ ...good, aud: 'other' }), { audience: 'cid', nonce: 'n1' }), /audience/);
  assert.throws(() => idClaims(jwt(good), { audience: 'cid', nonce: 'n2' }), /nonce/);
  assert.throws(() => idClaims(jwt({ ...good, exp: 1 }), { audience: 'cid', nonce: 'n1' }), /Expired/);
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const secret = appleClientSecret({ clientId: 'app.returnly.web', teamId: 'TEAM123', keyId: 'KEY123', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const [h, c, sig] = secret.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'ES256', kid: 'KEY123' });
  assert.equal(JSON.parse(Buffer.from(c, 'base64url')).sub, 'app.returnly.web');
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
});

test('OAuth requests ask for the narrowest scopes, and Gmail connect fails when read access wasn’t granted', async () => {
  const oauth = createOAuth({ config: { google: { clientId: 'gid', clientSecret: 'gs' }, microsoft: { clientId: 'mid', clientSecret: 'ms' }, apple: null }, fetch: async () => ({ ok: true, json: async () => ({ access_token: 'a', refresh_token: 'r', scope: 'openid email' }) }) });
  const q = u => new URL(u).searchParams;
  assert.equal(q(oauth.authUrl('gmail', { state: 's', redirectUri: 'https://x/cb' })).get('scope'), 'https://www.googleapis.com/auth/gmail.readonly');
  assert.equal(q(oauth.authUrl('gmail', { state: 's', redirectUri: 'https://x/cb' })).get('access_type'), 'offline');
  assert.equal(q(oauth.authUrl('outlook', { state: 's', nonce: 'n', redirectUri: 'https://x/cb' })).get('scope'), 'openid email offline_access https://graph.microsoft.com/Mail.Read');
  assert.equal(q(oauth.authUrl('signinGoogle', { state: 's', nonce: 'n', redirectUri: 'https://x/cb' })).get('scope'), 'openid email profile', 'signing in never asks for email access');
  await assert.rejects(oauth.exchange('gmail', { code: 'c', redirectUri: 'https://x/cb' }), /Gmail access wasn’t granted/);
  assert.deepEqual(oauth.available, { google: true, microsoft: true, apple: false });
});

test('HTTP: Continue with Google signs in or up, inbox routes need an account, and deleting the account revokes inboxes', async () => {
  let nonce = '';
  const idToken = c => `e30.${Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: 'gid', exp: Date.now() / 1000 + 600, nonce, ...c })).toString('base64url')}.`;
  let claims = { sub: 'g-1', email: 'Nia@Example.com', email_verified: true, given_name: 'Nia' };
  const oauth = createOAuth({ config: { google: { clientId: 'gid', clientSecret: 'gs' }, microsoft: null, apple: null }, fetch: async () => ({ ok: true, json: async () => ({ access_token: 'a', id_token: idToken(claims) }) }) });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-inbox-http-'));
  const store = createStore({ databaseUrl: '', file: path.join(dir, 'store.json') });
  await store.init();
  const storage = createStorage({ dir: path.join(dir, 'files') });
  const jobs = createJobs({ store, log: quiet });
  const data = createData({ store, storage, jobs });
  const forgotten = [];
  const inbox = createInbox({ store, data, policies: P, reader: mockReader(), jobs, oauth, key: crypto.randomBytes(32), domain: 'in.returnly.app', resendKey: 're_test_key', fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }), log: quiet });
  const realForget = inbox.forget; inbox.forget = async id => { forgotten.push(id); return realForget(id); };
  defineInboxJobs(jobs, inbox);
  const hookKey = crypto.randomBytes(24), hookSecret = 'whsec_' + hookKey.toString('base64');
  const server = http.createServer(createApp({ store, data, oauth, inbox, inboundSecret: hookSecret })).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const go = (p, { method = 'GET', cookie = '', body, headers = {} } = {}) => fetch(base + p, { method, redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const cookieOf = (res, name) => (res.headers.getSetCookie().find(c => c.startsWith(name + '=')) || '').split(';')[0];
  try {
    assert.deepEqual(await (await go('/api/auth/providers')).json(), { google: true, apple: false });
    assert.equal((await go('/api/auth/apple/start')).headers.get('location'), '/signin.html?error=unavailable');
    const signIn = async () => {
      const start = await go('/api/auth/google/start');
      assert.equal(start.status, 302);
      const to = new URL(start.headers.get('location'));
      assert.equal(to.origin + to.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
      assert.equal(to.searchParams.get('redirect_uri'), base + '/api/auth/google/callback');
      nonce = to.searchParams.get('nonce');
      return { state: to.searchParams.get('state'), browser: cookieOf(start, 'rl_oauth') };
    };
    let { state, browser } = await signIn();
    // From another browser (no binding cookie), the callback is refused.
    assert.equal((await go(`/api/auth/google/callback?code=c&state=${state}`)).headers.get('location'), '/signin.html?error=expired');
    ({ state, browser } = await signIn());
    const done = await go(`/api/auth/google/callback?code=c&state=${state}`, { cookie: browser });
    assert.equal(done.headers.get('location'), '/signin.html?signed-in=google');
    const session = cookieOf(done, 'rl_session');
    const me = await (await go('/api/me', { cookie: session })).json();
    assert.deepEqual(me.user, { email: 'nia@example.com', name: 'Nia', passwordless: true });
    assert.equal((await go(`/api/auth/google/callback?code=c&state=${state}`, { cookie: browser })).headers.get('location'), '/signin.html?error=expired', 'a state is used once');
    // An unverified email never signs in; an existing password account with a verified email is linked, not duplicated.
    claims = { sub: 'g-2', email: 'x@example.com', email_verified: false };
    ({ state, browser } = await signIn());
    assert.equal((await go(`/api/auth/google/callback?code=c&state=${state}`, { cookie: browser })).headers.get('location'), '/signin.html?error=email');
    const pw = await store.createUser({ email: 'pat@example.com', name: 'Pat', passwordHash: await hashPassword('password123') });
    claims = { sub: 'g-3', email: 'pat@example.com', email_verified: true };
    ({ state, browser } = await signIn());
    const linked = await go(`/api/auth/google/callback?code=c&state=${state}`, { cookie: browser });
    assert.equal((await store.findOAuthIdentity('google', 'g-3')).userId, pw.id);
    assert.deepEqual((await (await go('/api/me', { cookie: cookieOf(linked, 'rl_session') })).json()).user, { email: 'pat@example.com', name: 'Pat' });

    assert.equal((await go('/api/inbox')).status, 401);
    const status = await (await go('/api/inbox', { cookie: session })).json();
    assert.match(status.address, /@in\.returnly\.app$/);
    assert.deepEqual(status.available, { forwarding: true, gmail: true, outlook: false, gmailTesting: true });
    const connect = await go('/api/inbox/gmail/start', { cookie: session });
    assert.equal(new URL(connect.headers.get('location')).searchParams.get('scope'), 'https://www.googleapis.com/auth/gmail.readonly');
    assert.equal((await go('/api/inbox/outlook/start', { cookie: session })).headers.get('location'), '/app.html?inbox_error=unavailable');

    // Resend's webhook must carry a valid, recent Svix signature over the exact body; Graph's handshake echoes the token.
    const event = JSON.stringify({ type: 'email.received', created_at: new Date().toISOString(), data: { email_id: 'em_http', from: 'nia@example.com', to: [status.address], subject: 'Fwd: order' } });
    const sign = (id, ts, body, key = hookKey) => 'v1,' + crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
    const hook = (headers, body = event) => fetch(base + '/api/inbound/email', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
    const now = Math.floor(Date.now() / 1000);
    assert.equal((await hook({})).status, 401);
    assert.equal((await hook({ 'svix-id': 'msg_1', 'svix-timestamp': String(now), 'svix-signature': sign('msg_1', now, event, crypto.randomBytes(24)) })).status, 401, 'wrong secret');
    assert.equal((await hook({ 'svix-id': 'msg_1', 'svix-timestamp': String(now - 600), 'svix-signature': sign('msg_1', now - 600, event) })).status, 401, 'too old to be fresh');
    assert.equal((await hook({ 'svix-id': 'msg_1', 'svix-timestamp': String(now), 'svix-signature': sign('msg_1', now, event) }, event.replace('Fwd', 'Fwd!'))).status, 401, 'a changed body');
    const ok = await hook({ 'svix-id': 'msg_1', 'svix-timestamp': String(now), 'svix-signature': `v1,${Buffer.alloc(32).toString('base64')} ${sign('msg_1', now, event)}` });
    assert.deepEqual(await ok.json(), { accepted: true });
    const echo = await go('/api/inbox/outlook/notify?validationToken=abc%20123', { method: 'POST', headers: { 'Content-Type': 'text/plain' } });
    assert.equal(await echo.text(), 'abc 123');
    assert.match(echo.headers.get('content-type'), /^text\/plain/);

    // An account without a password confirms deletion with its email.
    assert.equal((await go('/api/account', { method: 'DELETE', cookie: session, body: { password: 'wrong@example.com' } })).status, 401);
    assert.equal((await go('/api/account', { method: 'DELETE', cookie: session, body: { password: 'Nia@example.com' } })).status, 200);
    assert.deepEqual(forgotten.length, 1);
    assert.equal(await store.findUserByEmail('nia@example.com'), null);
    assert.equal(await store.findOAuthIdentity('google', 'g-1'), null);
  } finally { server.close(); }
});

