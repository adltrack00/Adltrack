const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), os = require('node:os'), path = require('node:path'), fs = require('node:fs'), crypto = require('node:crypto');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { createStorage } = require('../server/storage');
const { createData } = require('../server/data');
const { createSms } = require('../server/sms');
const { createBilling, createStripe, verifyStripe, TIERS } = require('../server/billing');

/* A stand-in for Stripe: checkout sessions an admin "pays" by calling pay(), subscriptions, invoices and the billing page. */
function fakeStripe() {
  const sessions = {}, subs = {}, invoices = [], calls = [];
  let n = 0;
  const id = p => `${p}_${++n}`;
  async function call(method, route, params = {}) {
    calls.push({ method, route, params });
    if (method === 'POST' && route === '/checkout/sessions') {
      const s = { id: 'cs_' + (++n), url: `https://checkout.stripe.test/${n}`, mode: 'subscription', status: 'open', client_reference_id: params.client_reference_id, metadata: params.metadata, params };
      sessions[s.id] = s;
      return s;
    }
    let m = /^\/checkout\/sessions\/(.+)$/.exec(route);
    if (m) return sessions[m[1]];
    m = /^\/subscriptions\/(.+)$/.exec(route);
    if (m && method === 'GET') return subs[m[1]];
    if (m && method === 'POST') {
      const sub = subs[m[1]], amount = params.items[0].price_data.unit_amount;
      sub.items.data[0].price = { product: params.items[0].price_data.product, unit_amount: amount };
      sub.metadata = params.metadata;
      return sub;
    }
    if (route === '/invoices') return { data: invoices.filter(i => i.customer === params.customer) };
    if (route === '/billing_portal/sessions') return { url: 'https://billing.stripe.test/' + params.customer };
    throw new Error('unexpected Stripe call ' + route);
  }
  /* The admin enters a card on Stripe's page: the session completes, with a subscription and its first invoice. */
  function pay(sessionId, { status = 'active' } = {}) {
    const s = sessions[sessionId], customer = id('cus'), sub = id('sub');
    const amount = s.params.line_items[0].price_data.unit_amount;
    subs[sub] = { id: sub, status, customer, cancel_at_period_end: false, metadata: s.params.subscription_data.metadata, items: { data: [{ id: id('si'), current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, price: { product: 'prod_1', unit_amount: amount } }] } };
    invoices.push({ id: id('in'), customer, amount_paid: amount, currency: 'usd', created: Math.floor(Date.now() / 1000), hosted_invoice_url: 'https://invoice.stripe.test/1' });
    Object.assign(s, { status: 'complete', customer, subscription: sub });
    return s;
  }
  return { call, pay, subs, calls };
}

async function boot({ payments = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adltrack-billing-'));
  const store = createStore({ file: path.join(dir, 'store.json') });
  await store.init();
  const data = createData({ store, storage: createStorage({ dir: path.join(dir, 'files') }) });
  const fake = fakeStripe(), texts = [];
  const stripe = payments ? createStripe({ call: fake.call }) : null;
  const billing = createBilling({ store, stripe });
  const server = http.createServer(createApp({ store, data, sms: createSms({ send: async m => { texts.push(m); } }), billing }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    const call = async (method, url, body) => {
      const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(call.patient ? { 'X-Patient': call.patient } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      return { status: res.status, body: await res.json().catch(() => null) };
    };
    return call;
  };
  const signUp = async (name, address) => { const c = client(); assert.equal((await c('POST', '/api/signup', { name, email: address, password: 'Care-plan-2026' })).status, 201); return c; };
  let people = 0;
  const add = (admin, role = 'viewer', phone = '') => admin('POST', '/api/team/members', { name: 'Person ' + (++people), email: `p${people}@example.com`, phone, role });
  const ownerOf = async c => (await c('GET', '/api/me')).body.team.patient;
  return { store, fake, texts, base, client, signUp, add, ownerOf, close: () => new Promise(r => server.close(r)) };
}

test('the plans are Solo for one person, Family up to 5 and Care team up to 10, smallest first', () => {
  assert.deepEqual(TIERS.map(t => [t.id, t.amount, t.people]), [['solo', 900, 1], ['family', 1900, 5], ['team', 2900, 10]]);
});

test('an admin starts the free trial, pays by card and sees the plan and receipt in Settings', async () => {
  const app = await boot();
  try {
    const george = await app.signUp('George', 'george@example.com');
    const fresh = await george('GET', '/api/plan');
    assert.equal(fresh.body.status, 'none');
    assert.equal(fresh.body.people, 1);

    const trial = await george('POST', '/api/plan/trial', {});
    assert.equal(trial.body.status, 'trial');
    assert.ok(Math.abs(Date.parse(trial.body.trialEnds) - Date.now() - 14 * 864e5) < 60_000);
    assert.equal((await george('POST', '/api/plan/trial', {})).status, 400, 'one trial per family');

    // Pay by card for the Family plan: Stripe's page, with the trial carried on until it ends.
    const go = await george('POST', '/api/plan/checkout', { tier: 'family' });
    assert.match(go.body.url, /^https:\/\/checkout\.stripe\.test\//);
    const sent = app.fake.calls.find(c => c.route === '/checkout/sessions').params;
    assert.equal(sent.line_items[0].price_data.unit_amount, 1900);
    assert.equal(sent.customer_email, 'george@example.com');
    assert.equal(sent.subscription_data.trial_end, Math.floor(Date.parse(trial.body.trialEnds) / 1000));
    assert.match(sent.success_url, /\/app\.html\?plan=paid&session=\{CHECKOUT_SESSION_ID\}$/);

    const session = app.fake.pay('cs_' + go.body.url.split('/').pop());
    const unfinished = await george('POST', '/api/plan/confirm', { session: 'cs_999' });
    assert.equal(unfinished.status, 400);
    const paid = await george('POST', '/api/plan/confirm', { session: session.id });
    assert.equal(paid.status, 200);
    assert.equal(paid.body.status, 'paid');
    assert.equal(paid.body.tier, 'family');
    assert.equal(paid.body.card, true);
    assert.deepEqual(paid.body.receipts.map(r => [r.amount, r.url]), [[1900, 'https://invoice.stripe.test/1']]);
    assert.match((await george('POST', '/api/plan/portal', {})).body.url, /^https:\/\/billing\.stripe\.test\//);
  } finally { await app.close(); }
});

test('only the family’s admins see or pay for the plan; caregivers and viewers never pay', async () => {
  const app = await boot();
  try {
    const george = await app.signUp('George', 'george@example.com');
    const invite = await george('POST', '/api/team/members', { name: 'Maria', email: 'maria@example.com', role: 'caregiver' });
    const maria = await app.signUp('Maria', 'maria@example.com');
    await maria('POST', '/api/invite/accept', { consent: true, token: invite.body.invite.link.split('#t=')[1] });
    for (const [method, url] of [['GET', '/api/plan'], ['POST', '/api/plan/checkout'], ['POST', '/api/plan/trial'], ['POST', '/api/plan/portal']]) {
      assert.equal((await maria(method, url, method === 'POST' ? { tier: 'family' } : undefined)).status, 403, url);
    }
    // Maria's People page doesn't carry the plan.
    assert.equal('plan' in (await maria('GET', '/api/team')).body, false);
  } finally { await app.close(); }
});

test('adding the first person starts the trial; a Solo plan must upgrade before anyone is added', async () => {
  const app = await boot();
  try {
    const george = await app.signUp('George', 'george@example.com');
    assert.equal((await app.add(george)).status, 201);
    assert.equal((await george('GET', '/api/plan')).body.status, 'trial');
    assert.equal((await george('GET', '/api/team')).body.plan.canAdd, true);

    // With two people on the team, Solo is too small to pick.
    assert.equal((await george('POST', '/api/plan/checkout', { tier: 'solo' })).status, 400);

    // Rose is on her own and pays for Solo.
    const rose = await app.signUp('Rose', 'rose@example.com');
    await rose('POST', '/api/plan/trial', {});
    const go = await rose('POST', '/api/plan/checkout', { tier: 'solo' });
    await rose('POST', '/api/plan/confirm', { session: app.fake.pay('cs_' + go.body.url.split('/').pop()).id });
    assert.equal((await rose('GET', '/api/plan')).body.tier, 'solo');
    const full = await app.add(rose);
    assert.equal(full.status, 402);
    assert.match(full.body.error, /Solo plan is for one person\. Upgrade/);
    assert.deepEqual((await rose('GET', '/api/team')).body.plan, { status: 'paid', canAdd: false, tier: 'Solo' });

    // Upgrading to Family changes the same subscription, then people can be added up to 5.
    const up = await rose('POST', '/api/plan/change', { tier: 'family' });
    assert.equal(up.body.tier, 'family');
    const change = app.fake.calls.find(c => c.method === 'POST' && /^\/subscriptions\//.test(c.route)).params;
    assert.equal(change.items[0].price_data.unit_amount, 1900);
    assert.equal(change.items[0].price_data.product, 'prod_1');
    for (let i = 0; i < 4; i++) assert.equal((await app.add(rose)).status, 201);
    assert.match((await app.add(rose)).body.error, /Family plan is for up to 5 people/);
    // Nobody can move to a plan smaller than the team.
    assert.equal((await rose('POST', '/api/plan/change', { tier: 'solo' })).status, 400);
  } finally { await app.close(); }
});

test('a lapsed plan keeps the team seeing everything but adds nobody, and the caregiver’s other families aren’t affected', async () => {
  const app = await boot();
  try {
    const rose = await app.signUp('Rose', 'rose@example.com'), june = await app.signUp('June', 'june@example.com');
    await rose('POST', '/api/items', { id: 'med-1', name: 'Lisinopril', med: true });
    const maria = await app.signUp('Maria', 'maria@example.com');
    for (const fam of [rose, june]) {
      const r = await fam('POST', '/api/team/members', { name: 'Maria', email: 'maria@example.com', role: 'caregiver' });
      await maria('POST', '/api/invite/accept', { consent: true, token: r.body.invite.link.split('#t=')[1] });
    }
    const roseId = await app.ownerOf(rose);
    // Rose's trial ended without paying.
    const p = await app.store.familyPlan(roseId);
    await app.store.saveFamilyPlan(roseId, { ...p, trialEnds: new Date(Date.now() - 864e5).toISOString() });
    assert.equal((await rose('GET', '/api/plan')).body.status, 'lapsed');

    const refused = await app.add(rose);
    assert.equal(refused.status, 402);
    assert.match(refused.body.error, /plan has ended/);
    assert.equal((await rose('GET', '/api/team')).body.plan.canAdd, false);
    // Sending an invite again is refused too.
    const pending = (await rose('GET', '/api/team')).body.members.find(m => m.status === 'invited');
    if (pending) assert.equal((await rose('POST', `/api/team/members/${pending.id}/invite`, {})).status, 402);

    // Everyone still sees everything and keeps doing the care.
    maria.patient = roseId;
    assert.deepEqual((await maria('GET', '/api/items')).body.items.map(i => i.name), ['Lisinopril']);
    assert.equal((await maria('PUT', '/api/items/med-1', { name: 'Lisinopril', med: true, doses: [{ kind: 'taken', by: 'Maria' }] })).status, 200);

    // June's family has its own plan: she still adds people.
    assert.equal((await app.add(june)).status, 201);
    assert.equal((await june('GET', '/api/plan')).body.status, 'trial');
  } finally { await app.close(); }
});

test('texts are counted on the plan of the family that sends them', async () => {
  const app = await boot();
  try {
    const rose = await app.signUp('Rose', 'rose@example.com'), june = await app.signUp('June', 'june@example.com');
    await app.add(rose, 'viewer', '(555) 123-4567');
    await app.add(rose, 'caregiver', '(555) 123-4568');
    await app.add(rose, 'viewer');
    await app.add(june, 'viewer', '(555) 123-4569');
    assert.equal(app.texts.length, 3);
    assert.equal((await rose('GET', '/api/plan')).body.texts, 2);
    assert.equal((await june('GET', '/api/plan')).body.texts, 1);
  } finally { await app.close(); }
});

test('without Stripe, trials still run and paying says card payments aren’t set up', async () => {
  const app = await boot({ payments: false });
  try {
    const george = await app.signUp('George', 'george@example.com');
    assert.equal((await george('GET', '/api/plan')).body.payments, false);
    const r = await george('POST', '/api/plan/checkout', { tier: 'family' });
    assert.equal(r.status, 503);
    assert.match(r.body.error, /Card payments aren’t set up/);
    assert.equal((await george('POST', '/api/plan/trial', {})).body.status, 'trial');
  } finally { await app.close(); }
});

test('Stripe’s webhook is checked by its signature, and a cancelled subscription lapses the plan', async () => {
  const secret = 'whsec_test';
  const raw = Buffer.from('{"id":"evt_1"}'), t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  assert.equal(verifyStripe(secret, `t=${t},v1=${sig}`, raw), true);
  assert.equal(verifyStripe(secret, `t=${t},v1=${'0'.repeat(64)}`, raw), false);
  assert.equal(verifyStripe(secret, `t=${t - 600},v1=${sig}`, raw), false, 'too old');

  const app = await boot();
  try {
    // Without the webhook secret set, nothing from outside is accepted.
    assert.equal((await fetch(app.base + '/api/stripe/webhook', { method: 'POST', body: '{}', headers: { 'Stripe-Signature': `t=${t},v1=${sig}` } })).status, 401);

    const george = await app.signUp('George', 'george@example.com');
    const go = await george('POST', '/api/plan/checkout', { tier: 'family' });
    const s = app.fake.pay('cs_' + go.body.url.split('/').pop());
    await george('POST', '/api/plan/confirm', { session: s.id });
    const ownerId = await app.ownerOf(george);
    // Stripe says the subscription was cancelled: read back, the plan lapses.
    app.fake.subs[s.subscription].status = 'canceled';
    const billing = createBilling({ store: app.store, stripe: createStripe({ call: app.fake.call }) });
    await billing.webhook({ type: 'customer.subscription.deleted', data: { object: { customer: s.customer } } });
    assert.equal(billing.standing(await app.store.familyPlan(ownerId)), 'lapsed');
  } finally { await app.close(); }
});
