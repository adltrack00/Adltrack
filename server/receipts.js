/* Receipt reading: the photos, screenshots or PDF pages of one receipt go to a vision-capable Claude model with structured
   output, and come back as the draft the Item card opens with. Anything the model isn't sure about comes back empty (null),
   never guessed. Card numbers are never asked for and are scrubbed from every field in case one is printed anyway. */
const MODEL = 'claude-opus-5-5';
const MAX_PAGES = 4;
const MAX_ITEMS = 20;

const SYSTEM = `You read shopping receipts and order confirmations for a returns tracker. The user will check and fix what you return, so an empty field is always better than a guess.
- Leave a field empty ("" for text, null for numbers, "unknown" or "none" for choices) when you can't read it clearly or it isn't printed. Never infer a store from the products, a date from context, or a price you can't see.
- The pages are photos or screenshots of one receipt, in order (a long receipt may be split across several). Don't list a line twice where pages overlap.
- items: only products the customer bought. Leave out tax, totals, discounts, coupons, bag fees, deposits, shipping, tips and gift-card loads. price is the amount paid for that line after a discount printed directly under it; quantity is the count printed for that line (1 if none is printed).
- store.name is the store or brand as printed (for example "TARGET" or "Amazon.com"), without slogans. location is the store's address or city as printed.
- purchase_date is YYYY-MM-DD and purchase_time is 24-hour HH:MM, as printed. If a date could be read two ways (03/04/26), leave it empty.
- channel is "online" for an order confirmation, invoice or email, "store" for a register receipt, "unknown" if unclear.
- payment_type is the kind of payment only. Never write any part of a card number, account number, authorization code or the cardholder's name anywhere.
- return_policy_text is any return or exchange policy printed on the receipt, copied word for word, or "" if none is printed.
- problem: "blurry", "dark", "cropped" (part of the receipt is cut off) or "not_receipt" when that stops you reading something; otherwise "none".`;

// Text fields use "" and choices use "unknown"/"none" for "not sure"; only numbers are nullable. Structured outputs limit how
// many fields may be a union (anyOf), so the schema keeps those to the five numbers that need one.
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const str = { type: 'string' };
const PAYMENTS = ['credit', 'debit', 'cash', 'gift_card', 'store_credit', 'mobile_wallet', 'paypal', 'buy_now_pay_later', 'check', 'other'];
const SCHEMA = {
  type: 'object',
  properties: {
    problem: { type: 'string', enum: ['none', 'blurry', 'dark', 'cropped', 'not_receipt'] },
    store: { type: 'object', properties: { name: str, location: str }, required: ['name', 'location'], additionalProperties: false },
    purchase_date: str,
    purchase_time: str,
    order_number: str,
    channel: { type: 'string', enum: ['online', 'store', 'unknown'] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: str, quantity: { type: 'integer' }, price: nullable({ type: 'number' }), item_code: str },
        required: ['name', 'quantity', 'price', 'item_code'],
        additionalProperties: false
      }
    },
    totals: { type: 'object', properties: { subtotal: nullable({ type: 'number' }), tax: nullable({ type: 'number' }), total: nullable({ type: 'number' }) }, required: ['subtotal', 'tax', 'total'], additionalProperties: false },
    payment_type: { type: 'string', enum: [...PAYMENTS, 'unknown'] },
    return_policy_text: str
  },
  required: ['problem', 'store', 'purchase_date', 'purchase_time', 'order_number', 'channel', 'items', 'totals', 'payment_type', 'return_policy_text'],
  additionalProperties: false
};

/* Privacy: removes anything that looks like a card number, whatever field it ended up in. A 13-19 digit run that passes the
   Luhn check is treated as a card number; masked numbers ("**** 1234", "XXXXXXXX1234") are removed too. */
function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
function scrub(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/(?:[*xX•#]{2,}[\s-]*){1,4}\d{4}\b/g, '')
    .replace(/\b\d(?:[ -]?\d){12,18}\b/g, run => { const d = run.replace(/\D/g, ''); return /^[3-6]/.test(d) && luhn(d) ? '' : run; })
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const text = (v, n) => { const s = typeof v === 'string' ? scrub(v).replace(/\s+/g, ' ').trim().slice(0, n) : ''; return s || null; };
const money = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100000 ? Math.round(v * 100) / 100 : null;
const realDate = v => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
};
// Shown in the error line under the Scan card when nothing could be read, and under the Item card when some of it could.
const PROBLEMS = {
  blurry: 'This photo is too blurry to read. Hold the receipt flat and try again.',
  dark: 'This photo is too dark to read. Try again in better light.',
  cropped: 'Part of the receipt is cut off. Try again with the whole receipt in the frame.',
  not_receipt: 'This doesn’t look like a receipt or order confirmation. Try another photo.'
};
const PARTLY = {
  blurry: 'Part of this photo is blurry. Check the items below.',
  dark: 'This photo is dark. Check the items below.',
  cropped: 'Part of the receipt is cut off. Check the items, or go back and scan the rest.'
};

/* The model's answer → what the app needs. `today` keeps future dates (misreads) out. Returns the receipt plus a
   `notes` list of what couldn't be read, so nothing is filled in silently. */
function clean(raw, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const problem = Object.hasOwn(PROBLEMS, r.problem) ? r.problem : null;
  let purchased = realDate(r.purchase_date);
  if (purchased && (purchased > today || purchased < '2000-01-01')) purchased = null;
  const time = typeof r.purchase_time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.purchase_time) ? r.purchase_time : null;
  const items = [];
  for (const line of Array.isArray(r.items) ? r.items : []) {
    if (!line || typeof line !== 'object') continue;
    const name = text(line.name, 100), price = money(line.price), code = text(line.item_code, 40);
    if (!name && price === null) continue;
    const quantity = Number.isInteger(line.quantity) && line.quantity > 0 && line.quantity <= 99 ? line.quantity : null;
    items.push({ name, quantity, price, code });
    if (items.length >= MAX_ITEMS) break;
  }
  const totals = r.totals && typeof r.totals === 'object' ? r.totals : {};
  const receipt = {
    problem,
    store: text(r.store && r.store.name, 80),
    location: text(r.store && r.store.location, 160),
    purchased,
    time,
    orderNumber: text(r.order_number, 60),
    channel: ['online', 'store'].includes(r.channel) ? r.channel : null,
    items,
    totals: { subtotal: money(totals.subtotal), tax: money(totals.tax), total: money(totals.total) },
    payment: PAYMENTS.includes(r.payment_type) ? r.payment_type : null,
    policyText: text(r.return_policy_text, 2000)
  };
  receipt.notes = notes(receipt);
  return receipt;
}

/* What the user needs to check, in the words shown in the error line under the card. Empty when everything was read. */
function notes(r) {
  if (!r.items.length) return [r.problem ? PROBLEMS[r.problem] : 'We couldn’t find any items on this receipt. Try another photo, or add them yourself.'];
  const out = [];
  if (PARTLY[r.problem]) out.push(PARTLY[r.problem]);
  const missing = [];
  if (!r.store) missing.push('the store name');
  if (!r.purchased) missing.push('the purchase date');
  if (r.items.some(i => !i.name || i.price === null)) missing.push('some item names or prices');
  if (missing.length) out.push(`We couldn’t read ${missing.join(', ').replace(/, ([^,]*)$/, ' or $1')}. Please add ${missing.length > 1 ? 'them' : 'it'}.`);
  if (!r.purchased) out.push('Until you add the purchase date, the return date counts from today.');
  return out;
}

/* Printed return-policy text → the shortest return window it states, in days, or null. Read from the words themselves, so
   the number always has the printed text behind it. When the text gives several windows, the earliest is used. */
function printedWindow(policyText) {
  if (typeof policyText !== 'string' || !/\b(return|refund|exchange)/i.test(policyText)) return null;
  const days = [...policyText.matchAll(/\b(\d{1,3})[\s-]*(?:calendar |business )?days?\b/gi)].map(m => Number(m[1])).filter(n => n > 0 && n <= 365);
  return days.length ? Math.min(...days) : null;
}

function createReceiptReader({ apiKey = process.env.ANTHROPIC_API_KEY, client = null, log = console } = {}) {
  if (!client && apiKey) {
    const Anthropic = require('@anthropic-ai/sdk');
    client = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 });
  }

  /* pages: [{ contentType, body }] of one receipt. Resolves to the cleaned receipt, or null when no answer is available
     (no API key, a refusal, or the call failed), so the app falls back to the empty Item card. */
  async function read(pages, { today } = {}) {
    if (!client || !pages.length) return null;
    const content = pages.slice(0, MAX_PAGES).map(p => p.contentType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.body.toString('base64') } }
      : { type: 'image', source: { type: 'base64', media_type: p.contentType, data: p.body.toString('base64') } });
    content.push({ type: 'text', text: pages.length > 1 ? `These ${pages.length} pages are one receipt, in order. Read it.` : 'Read this receipt.' });
    try {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
        system: SYSTEM,
        messages: [{ role: 'user', content }]
      });
      if (response.usage) log.log(`Receipt read: ${pages.length} page(s), ${response.usage.input_tokens} input and ${response.usage.output_tokens} output tokens.`);
      if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
      const answer = response.content.find(b => b.type === 'text');
      return answer ? clean(JSON.parse(answer.text), { today }) : null;
    } catch (err) {
      log.error('Receipt reading failed:', err.message);
      return null;
    }
  }
  return { read, available: () => !!client };
}

module.exports = { createReceiptReader, clean, scrub, printedWindow, SCHEMA, MODEL, MAX_PAGES, text, money, realDate };
