/* Discharge-paper reading: the photos or PDF pages of one set of hospital discharge papers go to a vision-capable Claude
   model with structured output, and come back as the draft the Confirm card opens with: each medication with its
   instructions word for word, the doctor who prescribed it, the pharmacy, follow-up appointments and warning signs.
   Anything the model isn't sure about comes back empty, never guessed. Nothing is added that the papers don't say. */
const { scrub, realDate } = require('./receipts');

const MODEL = 'claude-opus-5-5';
const MAX_PAGES = 8;
const MAX_MEDS = 30;

const SYSTEM = `You read hospital discharge papers for a family caregiver app. The family will check every line against the papers and the medication bottles, so an empty field is always better than a guess.
- Copy only what is printed. Never add a medication, dose, time, instruction or warning that isn't on the papers, never work out a dose, and never reword medical instructions.
- Leave a field empty ("" for text, [] for lists, "unknown" or "none" for choices) when you can't read it clearly or it isn't printed.
- The pages are photos or PDF pages of one set of discharge papers, in order. Don't list a medication twice where pages overlap or where the same medication appears in two sections; use the discharge medication list when there is one.
- medications: each medication the patient should take at home, and each one the papers say to stop.
  - name is the medication name as printed (for example "Lisinopril"); strength is the strength as printed ("10 mg").
  - dose is how much to take as printed ("1 tablet"); route is how it's taken as printed ("by mouth").
  - frequency is how often, as printed ("twice a day", "every 8 hours as needed for pain").
  - times: clock times in 24-hour HH:MM only when the papers print exact times (for example "8:00 AM" becomes "08:00"). Never turn "twice a day" into times.
  - instructions is the full instruction line for this medication copied word for word.
  - duration is how long to take it as printed ("for 7 days", "until gone"), or "".
  - status: "new", "changed", "continue" or "stop" only when the papers say so; otherwise "unknown".
  - prescriber_name and prescriber_phone: the doctor or clinician who prescribed it, when printed for this medication or for the discharge as a whole.
  - page: the number of the page (1 for the first page sent) where this medication's instruction line is printed, or 0 if you aren't sure.
- pharmacy: the pharmacy named on the papers (name, address, phone), or empty.
- hospital is the hospital or clinic name; discharge_date is YYYY-MM-DD as printed. If a date could be read two ways (03/04/26), leave it empty.
- appointments: follow-up visits with who, where, date (YYYY-MM-DD), time (HH:MM), phone, and note copied as printed (for example "Call to schedule within 1 week").
- warning_signs: each "call your doctor if" or "go to the emergency room / call 911 if" line, copied word for word. urgent is true for emergency or 911 lines.
- contacts: phone numbers printed for questions (name or role, and phone).
- Never write insurance numbers, medical record numbers, account numbers or card numbers anywhere.
- problem: "blurry", "dark", "cropped" (part of a page is cut off) or "not_discharge" (these aren't discharge papers) when that stops you reading something; otherwise "none".`;

const str = { type: 'string' };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const STATUSES = ['new', 'changed', 'continue', 'stop', 'unknown'];
const SCHEMA = obj({
  problem: { type: 'string', enum: ['none', 'blurry', 'dark', 'cropped', 'not_discharge'] },
  hospital: str,
  discharge_date: str,
  medications: { type: 'array', items: obj({ name: str, strength: str, dose: str, route: str, frequency: str, times: { type: 'array', items: str }, instructions: str, duration: str, status: { type: 'string', enum: STATUSES }, prescriber_name: str, prescriber_phone: str, page: { type: 'integer' } }) },
  pharmacy: obj({ name: str, address: str, phone: str }),
  appointments: { type: 'array', items: obj({ with: str, place: str, date: str, time: str, phone: str, note: str }) },
  warning_signs: { type: 'array', items: obj({ text: str, urgent: { type: 'boolean' } }) },
  contacts: { type: 'array', items: obj({ name: str, phone: str }) }
});

// Medical record and insurance numbers never belong on a card, even if the model copies one.
const ID_LINE = /\b(MRN|medical record|member id|policy|insurance|account)\b[#:\s]*[A-Z0-9-]{4,}/gi;
const text = (v, n) => { const s = typeof v === 'string' ? scrub(v).replace(ID_LINE, '').replace(/\s+/g, ' ').trim().slice(0, n) : ''; return s || ''; };
const phone = v => { const s = text(v, 30); return /\d{3}.*\d{4}/.test(s) ? s : ''; };
const clock = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null;
const list = (v, n) => (Array.isArray(v) ? v : []).filter(x => x && typeof x === 'object').slice(0, n);

const PROBLEMS = {
  blurry: 'This photo is too blurry to read. Hold the page flat and try again.',
  dark: 'This photo is too dark to read. Try again in better light.',
  cropped: 'Part of the page is cut off. Try again with the whole page in the frame.',
  not_discharge: 'This doesn’t look like discharge papers. Try another photo.'
};
const PARTLY = {
  blurry: 'Part of this photo is blurry. Check each medication against the papers.',
  dark: 'This photo is dark. Check each medication against the papers.',
  cropped: 'Part of a page is cut off. Check the medications, or go back and scan the rest.'
};

/* The model's answer → what the app needs, with a `notes` list of what couldn't be read so nothing is filled in silently. */
function clean(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const problem = Object.hasOwn(PROBLEMS, r.problem) ? r.problem : null;
  const medications = [];
  for (const m of list(r.medications, MAX_MEDS)) {
    const name = text(m.name, 100);
    if (!name) continue;
    medications.push({
      name,
      strength: text(m.strength, 40),
      dose: text(m.dose, 80),
      route: text(m.route, 60),
      frequency: text(m.frequency, 160),
      times: [...new Set((Array.isArray(m.times) ? m.times : []).slice(0, 8).map(clock).filter(Boolean))].sort(),
      instructions: text(m.instructions, 600),
      duration: text(m.duration, 80),
      status: STATUSES.includes(m.status) ? m.status : 'unknown',
      prescriber: { name: text(m.prescriber_name, 80), phone: phone(m.prescriber_phone) },
      page: Number.isInteger(m.page) && m.page >= 1 && m.page <= MAX_PAGES ? m.page : 0
    });
  }
  const p = r.pharmacy && typeof r.pharmacy === 'object' ? r.pharmacy : {};
  const out = {
    problem,
    hospital: text(r.hospital, 120),
    discharged: realDate(r.discharge_date),
    medications,
    pharmacy: { name: text(p.name, 100), address: text(p.address, 200), phone: phone(p.phone) },
    appointments: list(r.appointments, 10).map(a => ({ with: text(a.with, 100), place: text(a.place, 160), date: realDate(a.date), time: clock(a.time), phone: phone(a.phone), note: text(a.note, 300) })).filter(a => a.with || a.place || a.note || a.date),
    warningSigns: list(r.warning_signs, 20).map(w => ({ text: text(w.text, 300), urgent: w.urgent === true })).filter(w => w.text),
    contacts: list(r.contacts, 10).map(c => ({ name: text(c.name, 80), phone: phone(c.phone) })).filter(c => c.phone)
  };
  out.notes = notes(out);
  return out;
}

/* What the family needs to check, in the words shown under the Confirm card. Empty when everything was read. */
function notes(d) {
  const taking = d.medications.filter(m => m.status !== 'stop');
  if (!taking.length) return [d.problem ? PROBLEMS[d.problem] : 'We couldn’t find any medications on these papers. Try another photo, or add them yourself.'];
  const out = [];
  if (PARTLY[d.problem]) out.push(PARTLY[d.problem]);
  const stopped = d.medications.filter(m => m.status === 'stop').map(m => m.name);
  if (stopped.length) out.push(`The papers say to stop ${stopped.join(', ')}, so ${stopped.length > 1 ? 'they aren’t' : 'it isn’t'} added.`);
  const missing = [];
  if (taking.some(m => !m.dose && !m.instructions)) missing.push('how to take some medications');
  if (taking.some(m => !m.prescriber.name && !m.prescriber.phone)) missing.push('who prescribed some medications');
  if (!d.pharmacy.name) missing.push('the pharmacy');
  if (missing.length) out.push(`We couldn’t read ${missing.join(', ')}. Fill ${missing.length > 1 ? 'them' : 'it'} in from the papers or the bottle.`);
  return out;
}

/* Read papers → the app's draft: one card per medication to take (stopped ones are left out and named in the notes). */
function dischargeDraft(d) {
  const label = m => [m.name, m.strength].filter(Boolean).join(' ');
  const shared = d.pharmacy.name || d.pharmacy.phone ? d.pharmacy : null;
  return {
    products: d.medications.filter(m => m.status !== 'stop').map(m => ({
      name: label(m), dose: m.dose, route: m.route, frequency: m.frequency, times: m.times, instructions: m.instructions,
      duration: m.duration, medStatus: m.status, prescriber: m.prescriber, pharmacy: shared, page: m.page, price: ''
    })),
    discharge: { hospital: d.hospital, discharged: d.discharged, appointments: d.appointments, warningSigns: d.warningSigns, contacts: d.contacts },
    notes: d.notes
  };
}

function createDischargeReader({ apiKey = process.env.ANTHROPIC_API_KEY, client = null, log = console } = {}) {
  if (!client && apiKey) {
    const Anthropic = require('@anthropic-ai/sdk');
    client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 1 });
  }

  /* pages: [{ contentType, body }] of one set of papers. Resolves to the cleaned papers, or null when no answer is
     available (no API key, a refusal, or the call failed), so the app falls back to an empty Confirm card. */
  async function read(pages) {
    if (!client || !pages.length) return null;
    const content = pages.slice(0, MAX_PAGES).map(p => p.contentType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.body.toString('base64') } }
      : { type: 'image', source: { type: 'base64', media_type: p.contentType, data: p.body.toString('base64') } });
    content.push({ type: 'text', text: pages.length > 1 ? `These ${pages.length} pages are one set of discharge papers, in order. Read them.` : 'Read these discharge papers.' });
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
      if (response.usage) log.log(`Discharge papers read: ${pages.length} page(s), ${response.usage.input_tokens} input and ${response.usage.output_tokens} output tokens.`);
      if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
      const answer = response.content.find(b => b.type === 'text');
      return answer ? clean(JSON.parse(answer.text)) : null;
    } catch (err) {
      log.error('Discharge paper reading failed:', err.message);
      return null;
    }
  }
  return { read, available: () => !!client };
}

module.exports = { createDischargeReader, clean, dischargeDraft, SCHEMA, MODEL, MAX_PAGES };
