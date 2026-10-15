/* Any store, always current:
   - lookups: stores we don't have are looked up once (in a background job) and cached for everyone, with a count of how many
     accounts use each store;
   - review: the admin page's data (unverified stores by usage, "Is this wrong?" reports, flagged changes) and approvals;
   - freshness: a weekly job re-fetches every checked retailer's source pages and flags meaningful changes for review;
   - recompute: after an approved change, active items of that store are recomputed and users whose deadline moved earlier
     get a notice. Nothing about a policy changes without an admin's approval. */
const crypto = require('node:crypto');
const C = require('../core.js');
const { normalizeStoreName, sourceUrls, problems } = require('./policies');
const { evaluate } = require('./engine');
const { keyFromId } = require('./lookup');

const DAY = 24 * 60 * 60 * 1000;
// A found policy is looked up again after this long; a store with no official policy is retried sooner, a failed lookup sooner still.
const FRESH = { found: 30 * DAY, not_found: 7 * DAY, failed: DAY, pending: 15 * 60 * 1000 };
const ACTIVE = ['deciding', 'started'];
const SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const fmt = d => SHORT.format(new Date(d + 'T00:00:00Z'));
const todayIso = () => new Date().toISOString().slice(0, 10);

/* Page HTML → plain text, enough to compare one week's copy with the next. */
function pageText(html) {
  return String(html || '')
    .replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

const TERMS = ['store credit', 'gift card', 'refund', 'exchange', 'final sale', 'restocking fee', 'return fee', 'original packaging', 'receipt', 'holiday', 'extended return', 'opened', 'tags', 'membership'];
const HOLIDAY = /holiday|season|extended return|gift|january|jan\./i;
/* The policy facts a page states: windows ("30 days"), dates, fees and policy terms. A change to these is a meaningful change;
   a new banner or reworded paragraph is not. */
function policyPhrases(text) {
  const t = String(text || '').toLowerCase(), out = new Set();
  for (const m of t.matchAll(/\b(\d{1,3})[\s-]*(calendar |business )?days?\b/g)) out.add(`${m[1]} ${m[2] || ''}days`.replace(/\s+/g, ' '));
  for (const m of t.matchAll(/\b(january|february|march|april|may|june|july|august|september|october|november|december) \d{1,2}(, \d{4})?/g)) out.add(m[0]);
  for (const m of t.matchAll(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g)) out.add(m[0]);
  for (const m of t.matchAll(/\$\d+(\.\d{2})?/g)) out.add(m[0]);
  for (const term of TERMS) if (t.includes(term)) out.add(term);
  return [...out].sort();
}

function createReview({ store, data, policies, finder = null, jobs = null, admins = [], fetch: fetchImpl = globalThis.fetch, log = console }) {
  const adminEmails = new Set(admins.map(e => String(e).trim().toLowerCase()).filter(Boolean));
  const isAdmin = user => !!user && adminEmails.has(String(user.email).toLowerCase());

  /* Approved policies from earlier runs go on top of policies/*.json, unless a committed file is the same version or newer. */
  async function loadApproved() {
    let n = 0;
    for (const p of await store.listApprovedPolicies()) if (!problems(p).length && policies.add(p)) n++;
    return n;
  }

  /* --- Lookups --- */
  /* The policy for a store we don't have a checked file for. Counts this account as a user of the store, and queues a lookup
     when there's no fresh answer. state: unverified | pending | not_found | unavailable | approved. */
  async function forStore(name, userId, { canLookUp = true } = {}) {
    const key = normalizeStoreName(name);
    if (!key) return { policy: null, state: 'not_found' };
    let row = await store.getStoreLookup(key);
    if (row && row.status === 'approved') {
      await store.countStoreUser(key, userId);
      return { policy: policies.get(row.retailerId), state: 'approved' };
    }
    const fresh = row && Date.now() - new Date(row.lookedUpAt).getTime() < FRESH[row.status];
    if (!fresh && finder && finder.available() && jobs && canLookUp) {
      if (!row) await store.saveStoreLookup({ key, name: String(name).trim().slice(0, 80), status: 'pending' });
      await jobs.enqueue('stores.lookup', { key, name: String(name).trim().slice(0, 120) }, { uniqueKey: `lookup:${key}`, maxAttempts: 2 });
      row = await store.getStoreLookup(key);
    }
    if (!row) return { policy: null, state: 'unavailable' };
    await store.countStoreUser(key, userId);
    if (row.status === 'found') return { policy: row.policy, state: 'unverified' };
    return { policy: null, state: row.status === 'not_found' ? 'not_found' : row.status === 'pending' ? 'pending' : 'unavailable' };
  }
  /* The background job: one web lookup, saved for everyone. */
  async function runLookup({ key, name }) {
    const row = await store.getStoreLookup(key);
    if (row && row.status === 'approved') return;
    const r = await finder.find(name, { today: todayIso() });
    if (!r) { await store.saveStoreLookup({ key, name: row ? row.name : name, status: row && row.status === 'found' ? 'found' : 'failed', policy: row && row.policy }); return; }
    await store.saveStoreLookup({ key, name: r.policy ? r.policy.name : row ? row.name : name, status: r.policy ? 'found' : 'not_found', policy: r.policy });
  }
  /* A policy by id, for checked retailers and looked-up ("u-…") stores alike. */
  async function policyById(id) {
    const p = policies.get(id);
    if (p) return p;
    const key = keyFromId(id), row = key && await store.getStoreLookup(key);
    return row && row.status === 'found' ? row.policy : null;
  }

  /* --- Reports --- */
  async function report(userId, body) {
    const t = (v, n) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '';
    const store_ = t(body.store, 80);
    if (!store_) throw Object.assign(new Error('Add the store first.'), { status: 400 });
    await store.createPolicyReport({ id: crypto.randomUUID(), userId, retailerId: t(body.retailerId, 80) || null, store: store_, itemName: t(body.itemName, 100), policyVersion: Number.isInteger(body.policyVersion) ? body.policyVersion : null, policyLine: t(body.policyLine, 500), note: t(body.note, 500) });
    return { ok: true };
  }

  /* --- Notices --- */
  async function notifyAdmins(text) {
    for (const email of adminEmails) { const u = await store.findUserByEmail(email); if (u) await store.addNotice(u.id, { text }); }
  }

  /* --- Recompute after an approved change --- */
  /* Recomputes the active items that use any of `ids` with `policy`. Items whose deadline moved earlier get a notice. A date the
     user set themselves stays theirs. Returns how many items changed and how many users were told. */
  async function recompute(ids, policy) {
    let changed = 0; const told = new Set();
    for (const { userId, item } of await store.itemsByRetailer(ids)) {
      if (!ACTIVE.includes(item.status) || item.demo) continue;
      const result = evaluate({ item, policy, answers: item.conditionAnswers || {}, category: item.policyCategory || null });
      const next = { ...item, ...result.fields, retailerId: policy.id, policyChecked: policy.checked, policyVersion: policy.version, returnable: result.returnable, returnableReason: result.reason, holidayReturnBy: result.holiday ? result.holiday.returnBy : '', policyFacts: result.facts, policyQuestions: result.questions, policyLine: result.line, policyUnverified: !!result.unverified };
      if (item.dateSet) { next.window = item.window; next.basis = item.basis; }
      const before = C.due(item), after = C.due(next);
      if (JSON.stringify(next) === JSON.stringify(item)) continue;
      await data.saveItem(userId, next);
      changed++;
      if (before && after && after < before) {
        await store.addNotice(userId, { itemId: item.id, text: `${policy.name} changed its return policy. Return ${item.name} by ${fmt(after)}.` });
        told.add(userId);
      }
    }
    return { changed, notified: told.size };
  }

  /* --- Admin page --- */
  async function overview() {
    const stores = (await store.listStoreLookups()).filter(l => l.status !== 'approved').map(l => ({
      key: l.key, name: l.name, status: l.status, users: l.users, lookedUpAt: l.lookedUpAt,
      policy: l.policy && { window: l.policy.item.window.value, basis: l.policy.item.basis.value, outcome: l.policy.item.outcome.value, conditions: l.policy.item.conditions.value, source: l.policy.item.window.source, checked: l.policy.checked }
    }));
    const flags = (await store.listPolicyFlags()).map(f => {
      const p = policies.get(f.retailerId);
      return { ...f, store: p ? p.name : f.retailerId, current: p ? { window: p.item.window.value, basis: p.item.basis.value, outcome: p.item.outcome.value, version: p.version } : null };
    });
    return { stores, reports: await store.listPolicyReports(), flags };
  }

  async function saveVersion(policy, by, reason) {
    const bad = problems(policy);
    if (bad.length) throw Object.assign(new Error('That policy isn’t valid: ' + bad[0]), { status: 400 });
    await store.saveApprovedPolicy({ policy, by, reason });
    policies.add(policy);
  }

  /* An unverified store becomes a checked retailer, with the looked-up facts and the admin's approval. */
  async function approveStore(key, admin) {
    const row = await store.getStoreLookup(key);
    if (!row || row.status !== 'found' || !row.policy) throw Object.assign(new Error('There’s no looked-up policy to approve for this store.'), { status: 404 });
    let id = row.policy.id.replace(/^u-/, '');
    for (let n = 2; policies.get(id) && !(policies.get(id).status === 'checked' && policies.get(id).research.includes(`lookup:${key}`)); n++) id = `${row.policy.id.replace(/^u-/, '')}-${n}`;
    const old = policies.get(id);
    const policy = { ...row.policy, id, version: old ? old.version + 1 : 1, status: 'checked', checked: todayIso(), research: `${row.policy.research} Approved by ${admin.email} on ${todayIso()} (lookup:${key}).` };
    await saveVersion(policy, admin.email, `Approved looked-up policy for ${row.name}`);
    await store.saveStoreLookup({ key, name: row.name, status: 'approved', policy: row.policy, retailerId: id });
    return { retailer: { id, name: policy.name }, ...(await recompute([id, row.policy.id], policy)) };
  }

  /* A flagged change, approved with the window (and start and outcome) the admin confirmed on the source page. */
  async function decideFlag(id, { action, window, basis, outcome }, admin) {
    const flag = await store.getPolicyFlag(id);
    if (!flag || flag.status !== 'open') throw Object.assign(new Error('This change was already reviewed.'), { status: 404 });
    if (action === 'dismiss') { await store.setPolicyFlagStatus(id, 'dismissed'); return { ok: true }; }
    const current = policies.get(flag.retailerId);
    if (!current) throw Object.assign(new Error('That store isn’t loaded.'), { status: 404 });
    const today = todayIso(), next = JSON.parse(JSON.stringify(current));
    const fact = value => ({ value, source: flag.url, checked: today });
    if (Number.isInteger(window) && window >= 0 && window <= 730) next.item.window = fact(window);
    if (['delivery', 'purchase', 'shipment'].includes(basis)) next.item.basis = fact(basis);
    if (['refund', 'credit', 'exchange'].includes(outcome)) next.item.outcome = fact(outcome);
    Object.assign(next, { version: current.version + 1, checked: today });
    await saveVersion(next, admin.email, `Approved change on ${flag.url}`);
    await store.setPolicyFlagStatus(id, 'approved');
    return { retailer: { id: next.id, name: next.name, version: next.version }, ...(await recompute([next.id], next)) };
  }

  /* --- Freshness (weekly job) --- */
  async function fetchText(url) {
    const res = await fetchImpl(url, { headers: { 'User-Agent': 'Adltrack policy freshness check', Accept: 'text/html,text/plain' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return pageText(await res.text());
  }
  /* Re-fetches every checked retailer's source pages and flags meaningful changes for review. In October to December a change
     that mentions holiday returns is flagged as a holiday-season change. Changes nothing itself. */
  async function freshness({ now = new Date() } = {}) {
    const holidaySeason = now.getUTCMonth() >= 9;
    let checked = 0, flagged = 0, failed = 0;
    for (const policy of policies.list().filter(p => p.status === 'checked')) {
      for (const url of sourceUrls(policy).slice(0, 12)) {
        let text;
        try { text = await fetchText(url); } catch (err) { failed++; log.error(`Freshness: couldn't fetch ${url}: ${err.message}`); continue; }
        checked++;
        const hash = crypto.createHash('sha256').update(text).digest('hex'), phrases = policyPhrases(text);
        const prev = await store.getSourceSnapshot(url);
        await store.putSourceSnapshot(url, { hash, phrases });
        if (!prev || prev.hash === hash) continue;
        const added = phrases.filter(p => !prev.phrases.includes(p)), removed = prev.phrases.filter(p => !phrases.includes(p));
        if (!added.length && !removed.length) continue;
        const holiday = holidaySeason && [...added, ...removed].some(p => HOLIDAY.test(p));
        // A proposal from re-reading the page, when the AI lookup is available. The admin still confirms it on the page.
        let proposed = null;
        if (finder && finder.available()) {
          const r = await finder.find(policy.name, { url, today: todayIso() });
          if (r && r.policy) proposed = { window: r.policy.item.window.value, basis: r.policy.item.basis.value, outcome: r.policy.item.outcome.value };
        }
        if (await store.createPolicyFlag({ id: crypto.randomUUID(), retailerId: policy.id, url, hash, added, removed, holiday, proposed })) flagged++;
      }
    }
    if (flagged) await notifyAdmins(`${flagged} policy change${flagged === 1 ? '' : 's'} flagged for review. Open Settings → Policy review.`);
    log.log(`Freshness: ${checked} pages checked, ${flagged} changes flagged, ${failed} couldn't be fetched.`);
    return { checked, flagged, failed };
  }

  return { isAdmin, loadApproved, forStore, runLookup, policyById, report, overview, approveStore, decideFlag, recompute, freshness, notifyAdmins };
}

module.exports = { createReview, policyPhrases, pageText };
