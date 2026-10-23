/* Subscriptions: one plan per family, paid by that family's admin. Caregivers and family viewers never pay: a caregiver on
   several families is covered by each family's own plan. The plan follows the size of the care team, counting everyone on it
   (the admin too): Solo for one person looking after their own or a loved one's health, then Family and Care team as people
   are added. Adding someone past the plan's size asks an admin to upgrade first.
   A family starts with a free trial (from Settings → Plan, or when the admin first adds someone), then pays by card through
   Stripe Checkout; receipts and changing the card or cancelling go through Stripe too. Text invites and alerts are counted on
   the plan of the family that sends them.
   When a plan lapses (the trial ended unpaid, or the subscription was cancelled or stopped being paid) the family's team
   still sees and does everything, but nobody can be added until an admin pays again. Other families aren't affected.
   Why Stripe: hosted card pages (no card numbers ever reach Adltrack), receipts and a billing page for each customer, and
   one plain HTTPS call per step with no extra library. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET. */
const crypto = require('node:crypto');

class BillingError extends Error { constructor(status, message) { super(message); this.status = status; } }

// The plans George set on 2026-10-22, smallest first: monthly price in cents and how many people each covers.
const TIERS = [
  { id: 'solo', name: 'Solo', amount: 900, people: 1 },
  { id: 'family', name: 'Family', amount: 1900, people: 5 },
  { id: 'team', name: 'Care team', amount: 2900, people: 10 }
];
const PLAN = { currency: 'usd', interval: 'month', trialDays: 14, tiers: TIERS };
// A paid plan whose payment failed keeps working this long after its period ends, while Stripe tries the card again.
const GRACE_DAYS = 3;
const DAY = 864e5;

function planConfig(env = {}) {
  const days = Number(env.PLAN_TRIAL_DAYS);
  return { ...PLAN, ...(Number.isInteger(days) && days >= 0 && days <= 90 ? { trialDays: days } : {}) };
}

/* Stripe settings from the environment, or null when card payments aren't set up. */
function stripeConfig(env) {
  const secret = env.STRIPE_SECRET_KEY || '', webhook = env.STRIPE_WEBHOOK_SECRET || '';
  if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(secret)) return null;
  return { secret, webhook };
}

/* Nested objects as Stripe's form fields: { a: { b: 1 } } → a[b]=1. */
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out); else out.append(key, String(v));
  }
  return out;
}

/* Stripe signs webhooks with HMAC-SHA256 of "timestamp.body", sent as "t=…,v1=…". Older or newer than five minutes is refused. */
function verifyStripe(secret, header, raw, now = Date.now()) {
  const parts = String(header || '').split(','), t = parts.find(p => p.startsWith('t='))?.slice(2);
  if (!secret || !/^\d+$/.test(t || '') || Math.abs(now / 1000 - Number(t)) > 300) return false;
  const want = crypto.createHmac('sha256', secret).update(`${t}.${raw.toString('utf8')}`).digest();
  return parts.filter(p => p.startsWith('v1=')).some(p => { const got = Buffer.from(p.slice(3), 'hex'); return got.length === want.length && crypto.timingSafeEqual(got, want); });
}

/* The Stripe calls Adltrack makes. `call(method, path, params)` is the HTTPS call (tests pass a fake). */
function createStripe({ config = null, call = null, fetch: fetchImpl = globalThis.fetch } = {}) {
  const request = call || (config ? async (method, path, params = {}) => {
    const query = method === 'GET' ? form(params).toString() : '';
    const res = await fetchImpl('https://api.stripe.com/v1' + path + (query ? '?' + query : ''), {
      method,
      headers: { Authorization: 'Bearer ' + config.secret, ...(method === 'GET' ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }) },
      body: method === 'GET' ? undefined : form(params).toString(),
      signal: AbortSignal.timeout(15000)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Stripe ${path} failed (${res.status}): ${body.error?.message || ''}`);
    return body;
  } : null);
  return {
    available: () => !!request,
    verify: (header, raw) => !!config && verifyStripe(config.webhook, header, raw),
    call: (method, path, params) => request(method, path, params)
  };
}

function createBilling({ store, stripe = null, plan = PLAN }) {
  const now = () => Date.now();
  const month = (t = now()) => new Date(t).toISOString().slice(0, 7);
  const load = async ownerId => (await store.familyPlan(ownerId)) || {};
  const tierOf = id => plan.tiers.find(t => t.id === id) || null;
  const largest = () => plan.tiers[plan.tiers.length - 1];
  // Everyone on the team counts, invited or joined, the admin too. Nobody added yet: just the admin.
  const teamSize = async ownerId => Math.max(1, (await store.listMembers(ownerId)).length);

  /* Where a family's plan stands: 'none' (never started), 'trial', 'paid' or 'lapsed'. */
  function standing(p, t = now()) {
    if (p.subscription) {
      const end = p.periodEnd ? Date.parse(p.periodEnd) : 0;
      if (['active', 'trialing'].includes(p.status) && end > t) return 'paid';
      if (['active', 'trialing', 'past_due'].includes(p.status) && end + GRACE_DAYS * DAY > t) return 'paid';
    }
    if (p.trialEnds && Date.parse(p.trialEnds) > t) return 'trial';
    return p.trialEnds || p.subscription ? 'lapsed' : 'none';
  }
  /* How many people the family's plan covers right now: the paid plan's size, or the largest during the free trial. */
  const limitOf = (p, s) => s === 'paid' ? (tierOf(p.tier) || largest()).people : s === 'lapsed' ? 0 : largest().people;

  /* The trial runs once per family, from when it's started. */
  async function startTrial(ownerId) {
    const p = await load(ownerId);
    if (p.trialEnds || p.subscription) return p;
    const next = { ...p, trialEnds: new Date(now() + plan.trialDays * DAY).toISOString() };
    await store.saveFamilyPlan(ownerId, next);
    return next;
  }

  /* Adding one more person needs a running trial or a paid plan with room for them. A family that never had either starts
     its trial now. */
  async function requireRoom(ownerId) {
    let p = await load(ownerId), s = standing(p);
    if (s === 'none') { p = await startTrial(ownerId); s = standing(p); }
    if (s === 'lapsed') throw new BillingError(402, 'This family’s plan has ended, so nobody new can be added. An admin can pay for it in Settings → Plan.');
    const size = await teamSize(ownerId), limit = limitOf(p, s);
    if (size + 1 <= limit) return p;
    if (limit >= largest().people) throw new BillingError(402, `A care team can have up to ${largest().people} people for now.`);
    const tier = tierOf(p.tier);
    throw new BillingError(402, `The ${tier.name} plan is for ${tier.people === 1 ? 'one person' : `up to ${tier.people} people`}. Upgrade in Settings → Plan to add someone.`);
  }

  /* Sending an invite again (the person is already counted) only needs a plan that hasn't lapsed. */
  async function requireActive(ownerId) {
    if (standing(await load(ownerId)) === 'lapsed') throw new BillingError(402, 'This family’s plan has ended, so invites can’t be sent. An admin can pay for it in Settings → Plan.');
  }

  /* One more text sent for this family this month (invites now, text alerts too when they're added). */
  async function countText(ownerId) {
    const p = await load(ownerId), m = month();
    const texts = p.texts?.month === m ? { month: m, count: p.texts.count + 1 } : { month: m, count: 1 };
    await store.saveFamilyPlan(ownerId, { ...p, texts });
  }

  const requireAdmin = access => { if (access.role !== 'admin') throw new BillingError(403, 'Only an admin can see and pay for this family’s plan.'); };
  const requireStripe = () => { if (!stripe || !stripe.available()) throw new BillingError(503, 'Card payments aren’t set up on this server yet.'); };
  async function pickTier(ownerId, id) {
    const tier = tierOf(id);
    if (!tier) throw new BillingError(400, 'Choose a plan.');
    const size = await teamSize(ownerId);
    if (size > tier.people) throw new BillingError(400, `Your care team has ${size} people, more than the ${tier.name} plan covers.`);
    return tier;
  }

  /* The plan as Settings → Plan shows it to the family's admins. */
  async function view(access) {
    requireAdmin(access);
    const p = await load(access.ownerId), s = standing(p);
    return {
      tiers: plan.tiers, currency: plan.currency, interval: plan.interval, trialDays: plan.trialDays,
      status: s, tier: s === 'paid' ? p.tier || null : null, people: await teamSize(access.ownerId),
      trialEnds: p.trialEnds || null, periodEnd: p.periodEnd || null, cancelAtEnd: !!p.cancelAtEnd,
      card: !!p.customer, payments: !!stripe && stripe.available(),
      texts: p.texts?.month === month() ? p.texts.count : 0,
      receipts: (p.receipts || []).slice(0, 24)
    };
  }

  /* A brief for the People page: whether one more person can be added, and if not, why. */
  async function brief(ownerId) {
    const p = await load(ownerId), s = standing(p), size = await teamSize(ownerId);
    return { status: s, canAdd: size < limitOf(p, s === 'none' ? 'trial' : s), tier: s === 'paid' ? tierOf(p.tier)?.name || null : null };
  }

  async function trial(access) {
    requireAdmin(access);
    const p = await load(access.ownerId);
    if (p.trialEnds || p.subscription) throw new BillingError(400, 'This family has already had its free trial.');
    await startTrial(access.ownerId);
    return view(access);
  }

  /* Stripe Checkout for the plan the admin picked. A trial still running carries on, and the card is charged when it ends. */
  async function checkout(access, user, base, tierId) {
    requireAdmin(access); requireStripe();
    const tier = await pickTier(access.ownerId, tierId);
    const p = await load(access.ownerId);
    if (standing(p) === 'paid') throw new BillingError(400, 'This family’s plan is already paid. Pick another plan to switch.');
    const trialEnd = p.trialEnds && Date.parse(p.trialEnds) > now() + 2 * DAY ? Math.floor(Date.parse(p.trialEnds) / 1000) : undefined;
    const s = await stripe.call('POST', '/checkout/sessions', {
      mode: 'subscription', client_reference_id: access.ownerId,
      line_items: [{ price_data: { currency: plan.currency, unit_amount: tier.amount, recurring: { interval: plan.interval }, product_data: { name: `Adltrack ${tier.name}` } }, quantity: 1 }],
      ...(p.customer ? { customer: p.customer } : { customer_email: user.email }),
      subscription_data: { metadata: { owner: access.ownerId, tier: tier.id }, ...(trialEnd ? { trial_end: trialEnd } : {}) },
      metadata: { owner: access.ownerId, tier: tier.id },
      success_url: `${base}/app.html?plan=paid&session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/app.html?plan=cancelled`
    });
    return { url: s.url };
  }

  /* A paid family moves to a bigger or smaller plan on the same card. Stripe charges or credits the difference. */
  async function change(access, tierId) {
    requireAdmin(access); requireStripe();
    const tier = await pickTier(access.ownerId, tierId);
    const p = await load(access.ownerId);
    if (standing(p) !== 'paid' || !p.subscription) throw new BillingError(400, 'Pay for a plan first.');
    if (p.tier === tier.id) return view(access);
    const sub = await stripe.call('GET', `/subscriptions/${encodeURIComponent(p.subscription)}`);
    const item = sub.items?.data?.[0];
    if (!item) throw new BillingError(400, 'This plan can’t be changed here. Use Change card or cancel.');
    const product = typeof item.price?.product === 'string' ? item.price.product : item.price?.product?.id;
    await stripe.call('POST', `/subscriptions/${encodeURIComponent(p.subscription)}`, {
      items: [{ id: item.id, price_data: { currency: plan.currency, unit_amount: tier.amount, recurring: { interval: plan.interval }, product } }],
      metadata: { owner: access.ownerId, tier: tier.id }, proration_behavior: 'create_prorations'
    });
    await store.saveFamilyPlan(access.ownerId, { ...p, tier: tier.id });
    await sync(access.ownerId);
    return view(access);
  }

  /* Reads the family's subscription and paid invoices back from Stripe. */
  async function sync(ownerId) {
    const p = await load(ownerId);
    if (!p.customer || !stripe || !stripe.available()) return p;
    const next = { ...p };
    if (p.subscription) {
      const sub = await stripe.call('GET', `/subscriptions/${encodeURIComponent(p.subscription)}`);
      const end = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
      Object.assign(next, { status: sub.status, periodEnd: end ? new Date(end * 1000).toISOString() : null, cancelAtEnd: !!sub.cancel_at_period_end, ...(tierOf(sub.metadata?.tier) ? { tier: sub.metadata.tier } : {}) });
    }
    const invoices = await stripe.call('GET', '/invoices', { customer: p.customer, status: 'paid', limit: 24 });
    next.receipts = (invoices.data || []).filter(i => i.amount_paid > 0).map(i => ({ id: i.id, at: new Date(i.created * 1000).toISOString(), amount: i.amount_paid, currency: i.currency, url: /^https:\/\//.test(i.hosted_invoice_url || '') ? i.hosted_invoice_url : '' }));
    await store.saveFamilyPlan(ownerId, next);
    return next;
  }

  /* Back from Stripe Checkout: the session must be this family's, and complete. */
  async function confirm(access, sessionId) {
    requireAdmin(access); requireStripe();
    if (typeof sessionId !== 'string' || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new BillingError(400, 'That payment wasn’t found.');
    const s = await stripe.call('GET', `/checkout/sessions/${sessionId}`).catch(() => null);
    if (!s || s.client_reference_id !== access.ownerId) throw new BillingError(400, 'That payment wasn’t found.');
    if (s.status !== 'complete') throw new BillingError(400, 'The payment didn’t finish. Try again.');
    await completed(access.ownerId, s);
    return view(access);
  }
  async function completed(ownerId, s) {
    const p = await load(ownerId);
    await store.saveFamilyPlan(ownerId, { ...p, customer: s.customer, subscription: s.subscription, ...(tierOf(s.metadata?.tier) ? { tier: s.metadata.tier } : {}) });
    await sync(ownerId);
  }

  /* Stripe's billing page for this family: change the card, see invoices, or cancel. */
  async function portal(access, base) {
    requireAdmin(access); requireStripe();
    const p = await load(access.ownerId);
    if (!p.customer) throw new BillingError(400, 'There’s no card on this family’s plan yet.');
    const s = await stripe.call('POST', '/billing_portal/sessions', { customer: p.customer, return_url: `${base}/app.html?plan=back` });
    return { url: s.url };
  }

  /* Stripe's webhook: a finished checkout, and any change to a subscription or invoice, is read back for that family. */
  async function webhook(event) {
    const o = event?.data?.object || {};
    if (event.type === 'checkout.session.completed' && o.mode === 'subscription' && typeof o.client_reference_id === 'string' && await store.findUserById(o.client_reference_id)) {
      await completed(o.client_reference_id, o);
    } else if (/^(customer\.subscription|invoice)\./.test(event.type || '') && typeof o.customer === 'string') {
      const found = await store.familyPlanByCustomer(o.customer);
      if (found) await sync(found.ownerId);
    }
    return { received: true };
  }

  return { stripe, standing, startTrial, requireRoom, requireActive, countText, view, brief, trial, checkout, change, confirm, portal, webhook, sync };
}

module.exports = { createBilling, createStripe, stripeConfig, planConfig, verifyStripe, BillingError, PLAN, TIERS };
