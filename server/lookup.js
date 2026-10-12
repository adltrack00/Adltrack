/* Live policy lookup: for a store we don't have, Claude searches the web for the store's official US return-policy page and
   records what that page says, through one strict tool call. The answer is turned into the same schema as policies/*.json,
   with every fact pointing at the official page, and saved as "unverified": the app shows it with the unconfirmed treatment,
   never says "yes, returnable" from it, and counts from the earlier purchase date. Anything the page doesn't say stays
   "unknown". A page the search never returned is not accepted, so a made-up URL can't become a source. */
const { normalizeStoreName, problems } = require('./policies');

const MODEL = 'claude-opus-5-5';
const MAX_CONTINUES = 3;

const SYSTEM = `You find a store's official US return policy for a returns tracker. The tracker shows what you record to shoppers, so only record what the store's own official policy page says.
- Search for the store's official website and its return or refund policy page. Use the store's own domain only: never a blog, coupon site, forum, marketplace listing or news article.
- Fetch the policy page and read it before recording anything.
- When you've read it, call record_policy once. If you can't find an official US policy page for this store, call record_policy with found=false.
- Leave a field empty ("", [], null or "unknown") when the page doesn't say it clearly. Never fill a field from general knowledge or from another store.
- window_days is the standard number of days to return an item, as printed. basis is what the window counts from.
- non_returnable lists product categories the page says can't be returned, in the page's words.
- methods are the ways to return the page describes (mail, drop-off at a partner, in store), each with short steps in the page's own terms.`;

const str = { type: 'string' };
const ANSWER = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    store_name: str,
    official_domain: str,
    policy_url: str,
    return_url: str,
    window_days: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    basis: { type: 'string', enum: ['delivery', 'purchase', 'shipment', 'unknown'] },
    outcome: { type: 'string', enum: ['refund', 'credit', 'exchange', 'unknown'] },
    requirement: { type: 'string', enum: ['start', 'ship', 'arrive', 'store', 'unknown'] },
    conditions: str,
    processing: str,
    receipt_required: { type: 'string', enum: ['yes', 'no', 'unknown'] },
    non_returnable: { type: 'array', items: str },
    methods: {
      type: 'array',
      items: {
        type: 'object',
        properties: { type: { type: 'string', enum: ['mail', 'dropoff', 'store'] }, label: str, steps: { type: 'array', items: str } },
        required: ['type', 'label', 'steps'],
        additionalProperties: false
      }
    }
  },
  required: ['found', 'store_name', 'official_domain', 'policy_url', 'return_url', 'window_days', 'basis', 'outcome', 'requirement', 'conditions', 'processing', 'receipt_required', 'non_returnable', 'methods'],
  additionalProperties: false
};
const TOOL = { name: 'record_policy', description: 'Record the store\'s official US return policy as its own policy page states it. Call once, at the end.', strict: true, input_schema: ANSWER };

const text = (v, n) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '';
const host = u => { try { const x = new URL(u); return x.protocol === 'https:' ? x.hostname.replace(/^www\./, '').toLowerCase() : null; } catch { return null; } };
const sameSite = (h, domain) => !!h && !!domain && (h === domain || h.endsWith('.' + domain));
/* "Maison Lune" → "u-maison-lune". The key is a normalized store name (letters and spaces only), so the id maps back to it. */
const lookupId = key => 'u-' + key.replace(/ /g, '-');
const keyFromId = id => /^u-[a-z-]+$/.test(id || '') ? id.slice(2).replace(/-/g, ' ') : null;

/* Every URL the search and fetch tools actually returned in this conversation. */
function seenUrls(content) {
  const urls = [];
  for (const b of content || []) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const r of b.content) if (r && r.url) urls.push(r.url);
    if (b.type === 'web_fetch_tool_result' && b.content && b.content.url) urls.push(b.content.url);
  }
  return urls;
}

/* The model's answer → a policy in the policies/ schema with status "unverified", or null when it isn't usable. */
function toPolicy(answer, { query, key, today, seen }) {
  const a = answer && typeof answer === 'object' ? answer : {};
  if (!a.found) return null;
  const domain = host('https://' + text(a.official_domain, 100).replace(/^https?:\/\//, '').replace(/\/.*$/, ''));
  const policyUrl = text(a.policy_url, 500);
  // The source must be on the store's own site and must be a page the tools actually returned.
  if (!sameSite(host(policyUrl), domain) || !seen.some(u => sameSite(host(u), domain))) return null;
  const fact = (value, note) => ({ value, ...(note ? { note } : {}), source: policyUrl, checked: today });
  const returnUrl = sameSite(host(a.return_url), domain) ? text(a.return_url, 500) : policyUrl;
  const window = Number.isInteger(a.window_days) && a.window_days >= 0 && a.window_days <= 730 ? a.window_days : 'unknown';
  const name = text(a.store_name, 80) || query;
  const unknowns = [];
  const unknown = (topic, ok) => { if (!ok) unknowns.push({ topic, note: 'The official policy page doesn\'t say.', source: policyUrl, checked: today }); };
  unknown('Return window', window !== 'unknown');
  unknown('Window start', a.basis !== 'unknown');
  unknown('Outcome', a.outcome !== 'unknown');
  const nonReturnable = (Array.isArray(a.non_returnable) ? a.non_returnable : []).map(x => text(x, 80)).filter(Boolean).slice(0, 12);
  const methods = (Array.isArray(a.methods) ? a.methods : []).filter(m => m && ['mail', 'dropoff', 'store'].includes(m.type) && text(m.label, 80)).slice(0, 4).map(m => ({
    type: m.type, label: text(m.label, 80),
    needs: { label: 'unknown', box: 'unknown', qr: 'unknown', printer: 'unknown' },
    steps: (Array.isArray(m.steps) ? m.steps : []).map(s => text(s, 200)).filter(Boolean).slice(0, 6),
    source: policyUrl, checked: today
  }));
  const names = [...new Set([query, name].map(n => text(n, 80)).filter(n => n.length >= 2))];
  const policy = {
    id: lookupId(key), name, version: 1, country: 'US', status: 'unverified', checked: today,
    aliases: { names, prefixes: [] },
    item: {
      window: fact(window),
      basis: fact(a.basis || 'unknown'),
      outcome: fact(a.outcome || 'unknown'),
      requirement: fact(a.requirement || 'unknown'),
      url: { value: returnUrl, source: returnUrl, checked: today },
      conditions: fact(text(a.conditions, 600) || 'Not confirmed'),
      processing: fact(text(a.processing, 200) || 'unknown')
    },
    categories: nonReturnable.length ? [{ id: 'non-returnable', label: 'Non-returnable items', examples: nonReturnable, returnable: false, source: policyUrl, checked: today }] : [],
    membership: [], holiday: [],
    receipt: fact({ required: a.receipt_required === 'yes' ? true : a.receipt_required === 'no' ? false : 'unknown', without: '' }),
    refund: { timing: fact(text(a.processing, 200) || 'Not confirmed'), fees: [] },
    methods, unknowns,
    research: `Found by an automatic web lookup on ${today}. Not checked by Returnly.`
  };
  const bad = problems(policy);
  return bad.length ? null : policy;
}

function createPolicyFinder({ apiKey = process.env.ANTHROPIC_API_KEY, client = null, log = console } = {}) {
  if (!client && apiKey) {
    const Anthropic = require('@anthropic-ai/sdk');
    client = new Anthropic({ apiKey, timeout: 180_000, maxRetries: 1 });
  }

  /* name: the store name as the user or receipt gave it; url: a page to read first (the freshness job's re-read).
     Resolves to { policy } (found), { policy: null } (no official policy found), or null (no answer: no key, a refusal or an error). */
  async function find(name, { today = new Date().toISOString().slice(0, 10), url = '' } = {}) {
    const query = text(name, 120), key = normalizeStoreName(query);
    if (!client || !key) return null;
    const messages = [{ role: 'user', content: `Store: ${JSON.stringify(query)}${url ? `\nRead this official page first: ${url}` : ''}\nFind its official US return policy and record it.` }];
    const seen = [];
    try {
      for (let turn = 0; turn <= MAX_CONTINUES; turn++) {
        const response = await client.beta.messages.create({
          model: MODEL,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'medium' },
          system: SYSTEM,
          tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }, { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 4 }, TOOL],
          messages
        });
        if (response.usage) log.log(`Store lookup "${query}": ${response.usage.input_tokens} input and ${response.usage.output_tokens} output tokens.`);
        seen.push(...seenUrls(response.content));
        if (response.stop_reason === 'refusal') return null;
        const call = response.content.find(b => b.type === 'tool_use' && b.name === 'record_policy');
        if (call) return { policy: toPolicy(call.input, { query, key, today, seen: url ? [...seen, url] : seen }) };
        // The server's search loop paused: send the turn back and it carries on where it stopped.
        if (response.stop_reason !== 'pause_turn') return { policy: null };
        messages.push({ role: 'assistant', content: response.content });
      }
      return null;
    } catch (err) {
      log.error('Store lookup failed:', err.message);
      return null;
    }
  }
  return { find, available: () => !!client };
}

module.exports = { createPolicyFinder, toPolicy, seenUrls, lookupId, keyFromId, MODEL, ANSWER };
