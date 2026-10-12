/* Policy engine: applies a retailer's checked policy (policies/) to one item and the user's answers, and fills the
   existing item fields. Every fact it uses comes from the policy file with its source and checked date. When something
   is unknown it takes the earlier possible deadline and says why, and it never answers "yes, returnable" without a
   checked fact behind it. */
const C = require('../core.js');
const { itemFields } = require('./policies');

// Categories that describe the purchase rather than the product. They're asked about, not guessed by the classifier.
const SITUATIONS = { 'final-sale': 'final', 'damaged-or-wrong': 'damaged', 'clearance-stores': 'clearance' };
const OUTCOMES = { credit: 'Store credit', refund: 'Money back', exchange: 'Exchange only', final: 'Final sale', unknown: 'Outcome unconfirmed' };
// What a condition question checks for, matched against the policy's own conditions text.
const CONDITION_CHECKS = [
  ['tags', /\btags?\b/i, 'Tags still on?', 'items with their original tags'],
  ['opened', /\b(unopened|opened|unused|unworn|factory-sealed)\b/i, 'Opened, worn or used?', 'unopened, unused items'],
  ['packaging', /\boriginal (factory-sealed )?packaging\b/i, 'In its original packaging?', 'items in their original packaging']
];
const SITUATION_QUESTIONS = { final: 'Marked final sale?', damaged: 'Arrived damaged or wrong?', clearance: 'Bought at a clearance store?' };

const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// "Activatable devices" in a membership exclusion names the category "Activatable devices".
const sameThing = (a, b) => { const x = words(a), y = words(b); return !!x && !!y && (x === y || x.startsWith(y + ' ') || y.startsWith(x + ' ')); };
const productCategories = policy => policy.categories.filter(c => !SITUATIONS[c.id]);
const situation = (policy, kind) => policy.categories.find(c => SITUATIONS[c.id] === kind) || null;
const source = f => ({ source: f.source, checked: f.checked });

/* Membership programs that change the window for this category. A program is left out when it excludes the category,
   or when the policy lists the combination as unknown (for example "Circle Card and electronics"). */
function memberPrograms(policy, cat) {
  return policy.membership.filter(m => Number.isInteger(m.window) || Number.isInteger(m.extraDays)).map(m => {
    if (!cat) return { m, applies: true };
    const excluded = (m.excludes || []).some(x => sameThing(x, cat.label) || sameThing(x, cat.id));
    const unknown = policy.unknowns.find(u => {
      const [who, what] = u.topic.toLowerCase().split(' and ');
      return what && words(m.program).includes(words(who)) && (words(cat.id).includes(words(what)) || words(cat.label).includes(words(what)));
    });
    return { m, applies: !excluded && !unknown, unknown };
  });
}

/* "Target Circle Card" and "Target Circle 360" → "Circle Card or 360", short enough to sit beside its answer on a phone. */
function programLabel(policy, names) {
  const split = names.map(n => n.split(' '));
  let common = 0;
  while (split.every(w => w.length > common + 1 && w[common] === split[0][common])) common++;
  const label = [split[0].join(' '), ...split.slice(1).map(w => w.slice(common).join(' '))].join(' or ');
  return label.replace(new RegExp(`^${policy.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} `, 'i'), '') || label;
}

/* One way of reading the policy for this item: the general rule, or one category's exception. */
function rule(policy, cat, item, answers) {
  const g = policy.item, why = [], facts = [];
  let window = cat && cat.window !== undefined ? cat.window : g.window.value;
  const windowSource = cat && cat.window !== undefined ? source(cat) : source(g.window);
  const rawBasis = cat && cat.basis || g.basis.value;
  const outcome = cat && cat.outcome || g.outcome.value;
  const returnable = cat ? cat.returnable : window === 'unknown' ? 'unknown' : true;
  if (cat) facts.push({ label: 'Category', value: cat.label + (cat.note ? '. ' + cat.note : ''), ...source(cat) });
  if (returnable !== true) return { cat, returnable, outcome: returnable === false ? 'final' : outcome, deadline: null, why, facts, note: cat && cat.note || '' };

  // Membership: the least generous program the user could mean, so a wrong guess never makes the date later.
  let member = null;
  const programs = memberPrograms(policy, cat);
  if (answers.member === true && Number.isInteger(window) && programs.length) {
    const days = Math.min(...programs.map(({ m, applies }) => !applies ? window : Number.isInteger(m.window) ? m.window : window + m.extraDays));
    if (days > window) { member = programs.map(p => p.m.program).join(' or '); facts.push({ label: 'Membership', value: programs.filter(p => p.applies).map(p => `${p.m.program}: ${p.m.effect}`).join(' '), ...source(programs.find(p => p.applies).m) }); window = days; }
    for (const p of programs) if (p.unknown) why.push(p.unknown.note);
  }

  if (window === 'none') {
    facts.push({ label: 'Return window', value: g.window.note || 'No fixed window', ...windowSource });
    return { cat, returnable: true, outcome, deadline: 'none', why, facts, note: cat && cat.note || '' };
  }
  if (!Number.isInteger(window)) return { cat, returnable: 'unknown', outcome, deadline: null, why: [...why, `${policy.name} hasn't confirmed how long you have.`], facts, note: '' };

  // Start date: delivery only when the policy says so and the delivery date is known; otherwise the earlier purchase date.
  let basis = 'purchase';
  if (rawBasis === 'delivery' && item.delivered) basis = 'delivery';
  else if (rawBasis === 'delivery' && item.channel === 'online') why.push(`Counted from the purchase date until the delivery date is added.`);
  else if (rawBasis === 'shipment') why.push(`${policy.name} counts from shipment; we count from the earlier purchase date.`);
  else if (rawBasis === 'unknown') why.push(`${policy.name} doesn't say if the window starts at purchase or delivery, so we count from purchase.`);
  const start = basis === 'delivery' ? item.delivered : item.purchased;
  if (!C.parseDate(start)) return { cat, returnable: true, outcome, deadline: null, why, facts, note: '' };
  let deadline = C.shift(start, window), holiday = null;
  facts.push({ label: 'Return window', value: `${window} days from ${basis}`, ...windowSource });

  // Holiday extensions only ever move the date later, and only with a published return-by date.
  for (const h of policy.holiday) {
    const bought = h.dateBasis === 'delivery' ? item.delivered : item.purchased;
    if (!C.parseDate(bought) || bought < h.purchasedFrom || bought > h.purchasedTo) continue;
    const forAll = !h.appliesTo || /^(most|all) items/i.test(h.appliesTo);
    if (!forAll && !(cat && (sameThing(h.appliesTo, cat.label) || words(h.appliesTo).includes(words(cat.id))))) continue;
    if (h.returnBy === 'unknown') { why.push(`The ${h.season} holiday return date wasn't published, so the normal window applies.`); continue; }
    const exception = (h.exceptions || []).find(e => cat && sameThing(e.label, cat.label));
    const returnBy = exception ? exception.returnBy : h.returnBy;
    if (returnBy > deadline) { deadline = returnBy; holiday = { season: h.season, returnBy, ...source(h) }; facts.push({ label: 'Holiday returns', value: `Bought ${h.purchasedFrom} to ${h.purchasedTo}: return by ${returnBy}${exception ? ` (${exception.label})` : ''}`, ...source(h) }); }
  }
  return { cat, returnable: true, outcome, deadline, basis, start, holiday, member, why, facts, note: cat && cat.note || '' };
}

/* Unknown store: nothing to apply. The existing unconfirmed treatment stays ("Date unconfirmed", dashed calendar). */
function unknownStore(item) {
  const store = item.retailer && item.retailer !== 'Store not added' ? item.retailer : 'this store';
  return {
    fields: { outcome: 'unknown', requirement: 'unknown', url: '', conditions: '', processing: '', policySource: 'Entered by you · policy not confirmed', confirmed: false },
    returnable: 'unsure', reason: `We don't have ${store}'s return policy yet, so the date is a guess.`,
    holiday: null, facts: [], questions: [], line: `Not sure it's returnable · We don't have ${store}'s policy yet.`
  };
}

/* item: the app's item; policy: a file from policies/ (or null); answers: {final, opened, member, damaged, tags, packaging, clearance}
   as true/false (missing = not answered); category: a category id, 'general' (none of them), or null/'unsure' (not classified). */
function evaluate({ item, policy, answers = {}, category = null }) {
  if (!policy) return unknownStore(item);
  const base = itemFields(policy), g = policy.item, a = answers || {};
  const products = productCategories(policy);
  const chosen = products.find(c => c.id === category);
  const classified = !!chosen || category === 'general';
  const final = situation(policy, 'final'), damaged = situation(policy, 'damaged'), clearance = situation(policy, 'clearance');
  const pending = [];

  // Which readings of the policy could apply. More than one means we're not sure, and the earliest date wins.
  let cats;
  if (final && a.final === true) cats = [final];
  else if (clearance && a.clearance === true) cats = [clearance];
  else if (chosen) cats = chosen.id.startsWith('opened-') ? a.opened === true ? [chosen] : a.opened === false ? [null] : [chosen, null] : [chosen];
  else if (classified) cats = [null];
  else cats = [null, ...products.filter(c => !c.id.startsWith('opened-') || a.opened !== false)];
  if (final && a.final === undefined) pending.push('final');

  const rules = cats.map(c => rule(policy, c, item, a));
  const open = rules.filter(r => r.returnable === true);
  const dated = open.filter(r => r.deadline && r.deadline !== 'none');
  const earliest = dated.sort((x, y) => x.deadline < y.deadline ? -1 : x.deadline > y.deadline ? 1 : 0)[0] || null;
  const pick = earliest || open.find(r => r.deadline === 'none') || rules[0];
  const agree = rules.every(r => r.returnable === rules[0].returnable && r.deadline === rules[0].deadline && r.outcome === rules[0].outcome && r.note === rules[0].note);
  const why = [...new Set(rules.flatMap(r => r.why))];
  const facts = [], seen = new Set();
  for (const f of [
    ...pick.facts,
    { label: 'Outcome', value: OUTCOMES[pick.outcome] || pick.outcome, ...source(g.outcome) },
    { label: 'Deadline means', value: g.requirement.value === 'unknown' ? g.requirement.note || 'Not confirmed' : g.requirement.value, ...source(g.requirement) },
    { label: 'Conditions', value: g.conditions.value, ...source(g.conditions) },
    { label: 'Refund timing', value: g.processing.value, ...source(g.processing) }
  ]) if (!seen.has(f.label)) { seen.add(f.label); facts.push(f); }

  let returnable, reason = '';
  if (rules.every(r => r.returnable === false)) { returnable = 'no'; reason = pick.cat ? `${pick.cat.label} can't be returned.` : `${policy.name} doesn't accept this return.`; }
  else if (policy.status !== 'checked') { returnable = 'unsure'; reason = `${policy.name}'s policy hasn't been checked yet.`; }
  else if (!agree) { returnable = 'unsure'; reason = classified ? 'Answer the question below to confirm.' : `We couldn't tell which ${policy.name} category this is, so we use the shortest window that could apply.`; }
  else if (pick.returnable !== true) { returnable = 'unsure'; reason = pick.cat ? `${policy.name} hasn't confirmed the terms for ${pick.cat.label.toLowerCase()}.` : why[0] || `${policy.name} hasn't confirmed the terms.`; }
  else if (pending.length) { returnable = 'unsure'; reason = 'Answer the question below to confirm.'; }
  else returnable = 'yes';

  // Condition questions from the policy's own wording. A "no" makes it uncertain rather than inventing a refusal.
  const conditionText = [pick.cat && pick.cat.conditions, cats.length === 1 && !pick.cat ? g.conditions.value : ''].filter(Boolean).join(' ');
  const checks = CONDITION_CHECKS.filter(([, re]) => re.test(conditionText));
  for (const [id, , , wants] of checks) {
    const failed = id === 'opened' ? a.opened === true : a[id] === false;
    if (failed && returnable === 'yes') { returnable = 'unsure'; reason = `${policy.name}'s policy covers ${wants}.`; }
  }

  // Damaged or wrong items follow their own terms (for example a refund instead of store credit).
  let outcome = returnable === 'no' ? 'final' : agree ? pick.outcome : 'unknown';
  const extra = [];
  if (damaged && a.damaged === true && returnable !== 'no') {
    if (damaged.outcome) outcome = damaged.outcome;
    extra.push([damaged.conditions, damaged.note].filter(Boolean).join(' '));
    facts.push({ label: 'Damaged or wrong', value: [damaged.note, damaged.conditions].filter(Boolean).join(' '), ...source(damaged) });
  }
  if (pick.note && agree && pick.returnable === true) extra.push(pick.note);

  // Deadline fields. A manual date stays the user's.
  const fields = {
    outcome,
    requirement: g.requirement.value !== 'unknown' ? g.requirement.value : policy.methods.length && policy.methods.every(m => m.type === 'store') ? 'store' : 'ship',
    url: base.url,
    conditions: [base.conditions, ...extra].filter(Boolean).join(' '),
    processing: base.processing,
    policySource: base.policySource,
    // A checked policy gives a firm date, even when it's the earliest of several that could apply.
    confirmed: policy.status === 'checked' && (returnable === 'no' || !!earliest || pick.deadline === 'none')
  };
  // Shipping by the date is the safer reading when the store doesn't say whether starting the return is enough.
  const meaning = g.requirement.value === 'unknown' ? `${policy.name} doesn't say if starting the return is enough, so treat the date as the day it must be on its way.` : '';
  if (!item.dateSet) {
    if (pick.deadline === 'none') { fields.window = null; fields.basis = 'purchase'; }
    else if (earliest) { fields.basis = earliest.basis; fields.window = C.days(earliest.deadline, earliest.start); }
  }

  // Up to three questions, only ones whose answer changes something for this store and category.
  const questions = [];
  const ask = (id, label) => { if (questions.length < 3 && !questions.some(q => q.id === id)) questions.push({ id, label }); };
  if (final) ask('final', SITUATION_QUESTIONS.final);
  if ((chosen && chosen.id.startsWith('opened-')) || (!classified && products.some(c => c.id.startsWith('opened-')))) ask('opened', CONDITION_CHECKS[1][2]);
  const programs = memberPrograms(policy, pick.cat);
  if (Number.isInteger(pick.cat && pick.cat.window !== undefined ? pick.cat.window : g.window.value) && programs.some(p => p.applies) && !programs.some(p => !p.applies)) ask('member', `${programLabel(policy, programs.map(p => p.m.program))} member?`);
  if (damaged) ask('damaged', SITUATION_QUESTIONS.damaged);
  for (const [id, , label] of checks) ask(id, label);
  if (clearance) ask('clearance', SITUATION_QUESTIONS.clearance);

  const holiday = pick.holiday || null;
  const line = returnable === 'no' ? `Not returnable · ${reason}`
    : returnable === 'unsure' ? `Not sure it's returnable · ${reason}`
    : [`${OUTCOMES[outcome]} · ${base.processing || 'timing not confirmed'}`, ...extra, ...why].map(s => s.replace(/\.$/, '')).join('. ') + '.';
  return { fields, returnable, reason: reason || [...why, meaning].filter(Boolean).join(' '), holiday, facts, questions, line, category: chosen ? chosen.id : classified ? 'general' : null };
}

module.exports = { evaluate, productCategories, SITUATIONS, OUTCOMES };
