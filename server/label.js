/* Bottle-label reading: up to 3 photos of one pharmacy label (the label wraps around the bottle) go to a vision-capable
   Claude model with structured output. The answer is what the family checks the discharge papers against: name, strength,
   directions, the pill's description, the pharmacy, the prescriber, quantity, refills and dates. The patient's name and
   address, Rx and DEA numbers and barcodes are never asked for, and are scrubbed if they turn up anyway. */
const { scrub, realDate } = require('./receipts');

const MODEL = 'claude-opus-5-5';
const MAX_PHOTOS = 3;

const SYSTEM = `You read pharmacy labels on medication bottles and boxes for a family caregiver app. The family checks what you read against the hospital discharge papers, so an empty field is always better than a guess.
- The photos show one label from different sides, in order. Read them together as one label; don't repeat anything where photos overlap.
- Copy only what is printed. Never reword directions, never work out a dose, and never add anything that isn't on the label.
- Leave a field empty ("" for text, null for numbers, [] for lists) when you can't read it clearly or it isn't printed.
- name is the medication name as printed ("ESTRADIOL"); strength as printed ("2 MG"); form as printed ("TABLET").
- directions is the full directions line copied word for word ("Take 1 tablet by mouth every day").
- pill_description is the printed description of what the pill looks like, word for word, or "".
- pharmacy: the pharmacy's name, street address and phone as printed.
- prescriber is the prescriber's name as printed (after "PRSCBR", "Dr." or "Prescriber").
- quantity is the number of units dispensed (QTY); refills is the number of refills left; refill_by, filled and discard_after are YYYY-MM-DD. If a date could be read two ways, leave it empty.
- warnings: each warning or "Important information" line copied word for word.
- Never write the patient's name or home address, the Rx number, DEA number, NDC, barcode digits, or any insurance or card number anywhere.
- problem: "blurry", "dark", "cropped" (part of the label is cut off) or "not_label" when that stops you reading something; otherwise "none".`;

const str = { type: 'string' };
const obj = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const SCHEMA = obj({
  problem: { type: 'string', enum: ['none', 'blurry', 'dark', 'cropped', 'not_label'] },
  name: str, strength: str, form: str, directions: str, pill_description: str,
  pharmacy: obj({ name: str, address: str, phone: str }),
  prescriber: str,
  quantity: nullable({ type: 'integer' }),
  refills: nullable({ type: 'integer' }),
  refill_by: str, filled: str, discard_after: str,
  warnings: { type: 'array', items: str }
});

const ID_LINE = /\b(RX|DEA|NDC|MRN|ST DEA)\b\s*[#:]?\s*[A-Z0-9-]{4,}/gi;
const text = (v, n) => typeof v === 'string' ? scrub(v).replace(ID_LINE, '').replace(/\s+/g, ' ').trim().slice(0, n) : '';
const phone = v => { const s = text(v, 30); return /\d{3}.*\d{4}/.test(s) ? s : ''; };
const count = (v, max) => Number.isInteger(v) && v >= 0 && v <= max ? v : null;

const PROBLEMS = {
  blurry: 'This photo is too blurry to read. Hold the bottle still and try again.',
  dark: 'This photo is too dark to read. Try again in better light.',
  cropped: 'Part of the label is cut off. Turn the bottle and take another photo.',
  not_label: 'This doesn’t look like a pharmacy label. Photograph the sticker on the bottle.'
};

function clean(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const p = r.pharmacy && typeof r.pharmacy === 'object' ? r.pharmacy : {};
  const label = {
    problem: Object.hasOwn(PROBLEMS, r.problem) ? r.problem : null,
    name: text(r.name, 100), strength: text(r.strength, 40), form: text(r.form, 40),
    directions: text(r.directions, 400), pillLooks: text(r.pill_description, 300),
    pharmacy: { name: text(p.name, 100), address: text(p.address, 200), phone: phone(p.phone) },
    prescriber: text(r.prescriber, 80),
    quantity: count(r.quantity, 2000), refills: count(r.refills, 20),
    refillBy: realDate(r.refill_by), filled: realDate(r.filled), discardAfter: realDate(r.discard_after),
    warnings: (Array.isArray(r.warnings) ? r.warnings : []).slice(0, 12).map(w => text(w, 300)).filter(Boolean)
  };
  label.note = !label.name && !label.directions ? (label.problem ? PROBLEMS[label.problem] : 'We couldn’t read this label. Take another photo of the side with the directions.')
    : label.problem ? PROBLEMS[label.problem] : !label.directions ? 'We couldn’t read the directions. Turn the bottle and add a photo of that side.' : '';
  return label;
}

/* Papers vs. bottle, one row per fact. match is true (same), false (different: call before giving it) or null (one side is
   missing or the wording can't be compared safely: the family checks it themselves). Only clear differences are flagged:
   a different medication word, a different strength, or different numbers or frequency in the directions. */
const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9.\s]/g, ' ').replace(/\s+/g, ' ').trim();
const strengthOf = s => { const m = words(s).replace(/(\d)\s+(mg|mcg|g|ml|units?)\b/g, '$1$2').match(/\d+(\.\d+)?(mg|mcg|g|ml|units?)/g); return m ? m.sort().join(' ') : ''; };
const FREQUENCIES = [
  ['4', /\b(four times (a|per|each) day|4 times (a|per|each) day|qid)\b/],
  ['3', /\b(three times (a|per|each) day|3 times (a|per|each) day|tid)\b/],
  ['2', /\b(twice (a|per|each) day|two times (a|per|each) day|2 times (a|per|each) day|every 12 hours|bid)\b/],
  ['1', /\b(once (a|per|each) day|every day|each day|daily|one time (a|per|each) day|every (morning|evening|night)|at bedtime|qd)\b/]
];
const NUMBERS = { one: '1', two: '2', three: '3', four: '4', half: '0.5' };
function directionsKey(s) {
  const w = words(s);
  if (!w) return null;
  const asNeeded = /\b(as needed|prn|if needed)\b/.test(w);
  const every = w.match(/every (\d+) hours?/);
  const freq = every ? ({ 12: '2', 24: '1' }[every[1]] || 'q' + every[1] + 'h') : (FREQUENCIES.find(([, re]) => re.test(w)) || [null])[0];
  const amount = w.match(/\btake (\d+(\.\d+)?|one|two|three|four|half)\b/);
  return { asNeeded, freq, amount: amount ? (NUMBERS[amount[1]] || amount[1]) : null };
}
function compare(med, label) {
  const rows = [];
  const paperName = words(med.name).replace(/\d.*$/, '').trim().split(' ')[0] || '';
  const bottleName = words(label.name);
  rows.push({ field: 'Medication', papers: med.name || '', bottle: [label.name, label.strength].filter(Boolean).join(' '), match: !paperName || !bottleName ? null : bottleName.includes(paperName) || paperName.includes(bottleName.split(' ')[0]) });
  const ps = strengthOf(med.name), bs = strengthOf(label.strength || label.name);
  rows.push({ field: 'Strength', papers: ps, bottle: bs, match: !ps || !bs ? null : ps === bs });
  const pd = med.instructions || [med.dose, med.route, med.frequency].filter(Boolean).join(' ');
  const a = directionsKey(pd), b = directionsKey(label.directions);
  let match = null;
  if (a && b) {
    if ((a.amount && b.amount && a.amount !== b.amount) || (a.freq && b.freq && a.freq !== b.freq) || a.asNeeded !== b.asNeeded) match = false;
    else if (a.amount && a.amount === b.amount && a.freq && a.freq === b.freq) match = true;
  }
  rows.push({ field: 'Directions', papers: pd, bottle: label.directions, match });
  return rows;
}

function createLabelReader({ apiKey = process.env.ANTHROPIC_API_KEY, client = null, log = console } = {}) {
  if (!client && apiKey) {
    const Anthropic = require('@anthropic-ai/sdk');
    client = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 });
  }
  async function read(photos) {
    if (!client || !photos.length) return null;
    const content = photos.slice(0, MAX_PHOTOS).map(p => ({ type: 'image', source: { type: 'base64', media_type: p.contentType, data: p.body.toString('base64') } }));
    content.push({ type: 'text', text: photos.length > 1 ? `These ${photos.length} photos show one pharmacy label from different sides. Read it.` : 'Read this pharmacy label.' });
    try {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 8000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
        system: SYSTEM,
        messages: [{ role: 'user', content }]
      });
      if (response.usage) log.log(`Bottle label read: ${photos.length} photo(s), ${response.usage.input_tokens} input and ${response.usage.output_tokens} output tokens.`);
      if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
      const answer = response.content.find(b => b.type === 'text');
      return answer ? clean(JSON.parse(answer.text)) : null;
    } catch (err) {
      log.error('Bottle label reading failed:', err.message);
      return null;
    }
  }
  return { read, available: () => !!client };
}

module.exports = { createLabelReader, clean, compare, directionsKey, SCHEMA, MODEL, MAX_PHOTOS };
