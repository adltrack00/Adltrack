/* How to return it: a short numbered guide for one item at one store, built only from the policy's return-method data
   (policies/<id>.json → methods, easiest first). Each way says what it needs (box, label, printer, QR code, receipt, ID),
   the packing checklist follows the chosen way, and the return link is order-specific when the policy documents one. */

const NEEDS = { qr: 'QR code', label: 'return label', box: 'box', printer: 'printer', receipt: 'receipt', id: 'photo ID' };

// Checked words only: "true" is needed, "false" isn't, anything else is unconfirmed.
function needsLine(needs) {
  const yes = [], no = [], unsure = [];
  for (const [k, name] of Object.entries(NEEDS)) {
    if (!(k in needs)) continue;
    (needs[k] === true ? yes : needs[k] === false ? no : unsure).push(name);
  }
  const list = a => a.length < 3 ? a.join(' or ') : a.slice(0, -1).join(', ') + ' or ' + a[a.length - 1];
  const parts = [];
  if (yes.length) parts.push(`Needs: ${yes.join(', ')}`);
  if (no.length) parts.push(`No ${list(no)} needed`);
  if (unsure.length) parts.push(`Not confirmed: ${unsure.join(', ')}`);
  return parts.join(' · ');
}

/* The existing packing checklist (packing: receipt, condition, packed, label, proof), worded for this way of returning.
   A QR-code drop-off with no label gets no label line. */
function checklist(method) {
  const n = method ? method.needs : {};
  const list = [['receipt', 'Receipt or order number'], ['condition', 'Condition and tags checked']];
  if (method && method.type === 'store' && n.box !== true) list.push(['packed', 'Item ready to take to the store']);
  else if (method && method.type === 'dropoff' && n.box === false) list.push(['packed', 'Item ready to drop off']);
  else list.push(['packed', 'Item securely packed']);
  if (n.label === true || !method || (method.type !== 'store' && n.label !== false)) list.push(['label', 'Return label and instructions checked']);
  else if (method.type === 'store') list.push(['label', 'Store location and hours checked']);
  list.push(['proof', 'Drop-off or return proof saved']);
  return list.map(([key, label]) => ({ key, label }));
}

/* Where "Nearest drop-off" looks: the partners of a drop-off, or the store itself for in-store returns. Mail has no checked
   drop-off network, so it gets none. */
function placeQueries(policy, method) {
  if (!method) return [];
  if (method.type === 'dropoff') return (method.partners || []).slice(0, 5);
  if (method.type === 'store') return [policy.name.replace(/^The /, '')];
  return [];
}

/* The return link: the policy's order-specific link when it documents one and the order number is known, otherwise its
   return page. */
function returnUrl(policy, orderNumber) {
  const o = policy.item.orderUrl, order = String(orderNumber || '').trim();
  if (o && order && /^[A-Za-z0-9-]{3,40}$/.test(order)) return o.value.replace('{order}', encodeURIComponent(order));
  return policy.item.url.value;
}

/* policy: a file from policies/ (or null); item: { channel, orderNumber }. Returns null for stores without a policy. */
function buildGuide(policy, item = {}) {
  if (!policy) return null;
  const order = typeof item.orderNumber === 'string' ? item.orderNumber.trim().slice(0, 40) : '';
  const methods = policy.methods.map((m, index) => ({
    index, type: m.type, label: m.label,
    cost: m.cost || '',
    steps: m.steps.slice(),
    needs: needsLine(m.needs),
    note: m.note || '',
    checklist: checklist(m),
    places: placeQueries(policy, m).length > 0,
    source: m.source, checked: m.checked
  }));
  const receipt = policy.receipt.value;
  return {
    store: policy.name,
    url: returnUrl(policy, order),
    orderNumber: order,
    methods,
    // Stores whose return steps aren't in the checked policy still get the return link and the general checklist.
    empty: methods.length ? '' : `${policy.name}'s return steps aren't in our checked policy yet. Use the return link above.`,
    checklist: checklist(null),
    receipt: receipt.required === true ? `${policy.name} needs your receipt.` : receipt.without && receipt.without !== 'unknown' ? receipt.without : '',
    marketplace: policy.marketplace ? policy.marketplace.value : ''
  };
}

module.exports = { buildGuide, checklist, needsLine, placeQueries, returnUrl };
