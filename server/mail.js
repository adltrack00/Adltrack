/* Purchases from email: which senders count as shopping mail, the plain text of a message, and the order facts in it.
   Order, shipping, delivery, return and refund emails go to the same Claude model and settings as receipt reading, with
   structured output, and come back as a few fields. The email itself is never kept: only these fields and the message id. */
const { MODEL, scrub, text, money, realDate } = require('./receipts');

/* Launch retailers' sending domains (a subdomain such as email.apple.com counts) → their id in policies/. */
const RETAILER_SENDERS = {
  amazon: ['amazon.com'], walmart: ['walmart.com'], target: ['target.com'], costco: ['costco.com'], bestbuy: ['bestbuy.com'],
  homedepot: ['homedepot.com'], apple: ['apple.com'], nike: ['nike.com'], zara: ['zara.com'], shein: ['shein.com', 'sheinemail.com'],
  fashionnova: ['fashionnova.com']
};
// Services many stores send their order, shipping and return emails through; the store comes from the email itself.
const SERVICE_SENDERS = ['shopifyemail.com', 'narvar.com', 'happyreturns.com', 'loopreturns.com', 'aftership.com'];
const SHOPPING_SUBJECT = /\b(order|ordered|purchase|receipt|confirm|confirmation|ship|shipped|shipping|deliver|delivered|delivery|arriv|package|return|returned|refund|refunded|credit)/i;
const RECENT_DAYS = 90;

const address = from => { const m = /<([^<>\s]+@[^<>\s]+)>/.exec(String(from || '')) || /([^\s<>"']+@[^\s<>"']+)/.exec(String(from || '')); return m ? m[1].toLowerCase() : ''; };
const domainOf = email => email.split('@')[1] || '';
const under = (domain, d) => domain === d || domain.endsWith('.' + d);

/* The sender → { retailerId } for a launch retailer, { service: true } for a shopping service, or null for anything else. */
function knownSender(from) {
  const domain = domainOf(address(from));
  if (!domain) return null;
  for (const [id, ds] of Object.entries(RETAILER_SENDERS)) if (ds.some(d => under(domain, d))) return { retailerId: id };
  return SERVICE_SENDERS.some(d => under(domain, d)) ? { service: true } : null;
}
// Inbox search: known senders, shopping subjects only, so newsletters and everything else are never opened.
const isShoppingEmail = ({ from, subject }) => !!knownSender(from) && SHOPPING_SUBJECT.test(String(subject || ''));
const ALL_DOMAINS = [...Object.values(RETAILER_SENDERS).flat(), ...SERVICE_SENDERS];
/* Gmail search for the first import (the last 90 days) or, with `after` (a Date), everything since the last check. */
const gmailQuery = (after = null) => `${after ? `after:${Math.floor(after.getTime() / 1000)}` : `newer_than:${RECENT_DAYS}d`} from:(${ALL_DOMAINS.join(' OR ')})`;

/* HTML → readable text: no scripts, styles or tags; links keep their words only. */
function htmlToText(html) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
  return String(html || '')
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : entities[e.toLowerCase()] ?? ' ')
    .replace(/[ \t\f\r]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const MAX_TEXT = 30000;
const bodyText = ({ text: plain = '', html = '' }) => (String(plain || '').trim() || htmlToText(html)).slice(0, MAX_TEXT);

/* A forwarded message's original sender ("---------- Forwarded message ---------" / "Begin forwarded message:" blocks). */
function forwardedFrom(body) {
  const m = /(?:forwarded message|original message|begin forwarded message)[\s\S]{0,200}?\bFrom:\s*([^\n]+)/i.exec(String(body || ''));
  return m ? m[1].trim() : '';
}

const SYSTEM = `You read shopping emails for a returns tracker: order confirmations, shipping and delivery notices, return confirmations and refund notices. The user checks what you return, so an empty field is always better than a guess.
- kind: "order" for an order or purchase confirmation or receipt; "shipped" when the order is on its way to the customer; "delivered" when it was delivered or picked up; "return_started" when a return was requested or a return label or QR code was issued; "return_shipped" when the customer's return was dropped off, scanned by the carrier or received by the store before a refund; "refund" when money or store credit was issued; "other" for anything else (marketing, account, surveys).
- Leave a field empty ("" for text, null for numbers, "unknown" for choices) when the email doesn't say it clearly. Never infer a date from when the email was sent unless the email says it happened today.
- store is the store the customer bought from, as the email names it (for example "Amazon" or "Target"), not a shipping company or returns service.
- order_number is the store's order number exactly as printed, without a leading "#".
- order_date and delivered_date are YYYY-MM-DD.
- items: the products the email lists, with the price paid for each line and the quantity printed (1 if none). Leave out tax, shipping, totals, discounts and gift cards.
- refund_amount is the total refunded or credited in this email; refund_method is "refund" for money back to the payment method, "store_credit" for gift card or store credit.
- Never write any part of a card number, account number, address or phone number anywhere.`;

const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const str = { type: 'string' };
const KINDS = ['order', 'shipped', 'delivered', 'return_started', 'return_shipped', 'refund', 'other'];
const SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: KINDS },
    store: str,
    order_number: str,
    order_date: str,
    delivered_date: str,
    items: { type: 'array', items: { type: 'object', properties: { name: str, quantity: { type: 'integer' }, price: nullable({ type: 'number' }) }, required: ['name', 'quantity', 'price'], additionalProperties: false } },
    refund_amount: nullable({ type: 'number' }),
    refund_date: str,
    refund_method: { type: 'string', enum: ['refund', 'store_credit', 'unknown'] }
  },
  required: ['kind', 'store', 'order_number', 'order_date', 'delivered_date', 'items', 'refund_amount', 'refund_date', 'refund_method'],
  additionalProperties: false
};

/* Order numbers compare without spaces, dashes, "#" or case: "#112-3344556-7788990" = "112 3344556 7788990". */
const orderKey = n => String(n || '').replace(/[^a-z0-9]/gi, '').toUpperCase();

/* The model's answer → the fields Returnly keeps. Dates after `today` (misreads) are dropped. */
function cleanEmail(raw, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const date = v => { const d = realDate(v); return d && d <= today && d >= '2000-01-01' ? d : null; };
  const items = [];
  for (const line of Array.isArray(r.items) ? r.items : []) {
    if (!line || typeof line !== 'object') continue;
    const name = text(line.name, 100), price = money(line.price);
    if (!name) continue;
    items.push({ name, quantity: Number.isInteger(line.quantity) && line.quantity > 0 && line.quantity <= 99 ? line.quantity : 1, price });
    if (items.length >= 20) break;
  }
  const orderNumber = text(String(r.order_number || '').replace(/^#\s*/, ''), 60);
  return {
    kind: KINDS.includes(r.kind) ? r.kind : 'other',
    store: text(r.store, 80),
    orderNumber,
    purchased: date(r.order_date),
    delivered: date(r.delivered_date),
    items,
    refund: money(r.refund_amount),
    refundDate: date(r.refund_date),
    refundMethod: ['refund', 'store_credit'].includes(r.refund_method) ? r.refund_method : null
  };
}

function createEmailReader({ apiKey = process.env.ANTHROPIC_API_KEY, client = null, log = console } = {}) {
  if (!client && apiKey) {
    const Anthropic = require('@anthropic-ai/sdk');
    client = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 });
  }
  /* email: { from, subject, date, text }. Resolves to the cleaned fields, or null when no answer is available (no API key,
     a refusal). A failed call throws, so the job that asked is retried. */
  async function read(email, { today } = {}) {
    if (!client) return null;
    const body = scrub(String(email.text || '').slice(0, MAX_TEXT));
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: `From: ${scrub(String(email.from || ''))}\nSubject: ${scrub(String(email.subject || ''))}\nDate: ${String(email.date || '')}\n\n${body}` }]
    });
    if (response.usage) log.log(`Email read: ${response.usage.input_tokens} input and ${response.usage.output_tokens} output tokens.`);
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
    const answer = response.content.find(b => b.type === 'text');
    return answer ? cleanEmail(JSON.parse(answer.text), { today }) : null;
  }
  return { read, available: () => !!client };
}

module.exports = { createEmailReader, cleanEmail, knownSender, isShoppingEmail, gmailQuery, htmlToText, bodyText, forwardedFrom, address, orderKey, RETAILER_SENDERS, SERVICE_SENDERS, RECENT_DAYS, SCHEMA };
