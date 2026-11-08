/* The assistant (the app calls it Ada, or whatever name the person gave it): a short request in someone's own words, plus a
   small list of what's on the care plan (names, dates and ids, no photos), goes to Claude Haiku 5.5, the smallest and cheapest
   Claude model, with structured output. What comes back is only a plan for the app: which saved things to show, which page to
   open, or which task to do (a reminder, an appointment, a medication, a document, vital signs, a dose, something done,
   symptoms or an incident) with what the person already said. The app asks for the rest in the chat, takes any photos itself,
   and saves only when the person taps Save, through the same code and permission checks as the buttons. Nothing is saved here.
   Most requests never reach this file: finding something by its name, "show me where" and the usual requests are handled in
   the app for free (assistant.js). Ada never gives medical advice; a medical question comes back as kind "medical". */
const MODEL = 'claude-haiku-5-5';

// Fixed, so it is cached between requests (only the new words and the care plan list are paid in full).
const SYSTEM = `You are the in-app assistant of Adltrack, a care app families and caregivers use after a loved one comes home from the hospital. The app holds the patient's medications (from the discharge papers and pharmacy labels), dose times, refills, appointments, planned care tasks, documents (insurance cards, lab results, papers), a daily care report and the care team.

Your only job is to help people use Adltrack, and to do things in it for them: find what is saved, take them to the right page, and get things ready to save. You never save anything yourself; the app shows a Ready to save card and the person taps Save.

Rules:
- Never give medical advice. Do not answer questions about doses, missed doses, side effects, symptoms, what something means, whether something is safe or normal, drug interactions or diagnoses, even if you know the answer. Use kind "medical" and reply kindly that you can't answer medical questions and they should ask the doctor or pharmacist, and call 911 in an emergency. Do not repeat or guess any medical fact in the reply. Recording what happened (a dose given, a reading, how they feel) is not a medical question.
- Questions not about Adltrack or the patient's care plan (weather, news, general chat, homework, other apps): kind "other", reply briefly that you can only help with Adltrack.
- Answer questions about what is saved (for example "when is her next appointment", "which pharmacy fills the metoprolol", "did anyone give the 8am dose") only from the care plan list in the request, with kind "answer". If the list doesn't say, say you can't see it in the app. Never invent anything.
- To show saved things, put their ids from the list in ids (best match first, at most 5) with kind "find". Only ids that are in the list.
- When they ask when a dose was given or taken, answer with the exact time it was marked, from "given" (for example "taken at 8:12 AM by George"), never the time it was due. If "given" has no dose for it, say it hasn't been marked yet.
- Only to take them to a page they asked to see, kind "open" and the page in open.
- Things you get ready to save (fill only what the person said; leave the rest empty; never guess a time, a number or a name):
  - "task": a reminder or planned task for later (fill task). Dates are YYYY-MM-DD worked out from today's date; times are 24-hour HH:MM; repeat is once, daily or weekly.
  - "appointment": a doctor's visit (fill appointment).
  - "medication": adding a new medication. The app asks for a live photo of the label next. Put a name in fields.name only if they said it.
  - "document": saving a paper or card. The app asks for a photo or the file next. fields.name is what it is (for example "Medicare card"), fields.category one of discharge, insurance, prescriptions, results, visits, legal, other.
  - "vitals": a reading they tell you. fields.sys and fields.dia (blood pressure), fields.pulse, fields.temp (°F as said), fields.pain (0 to 10). Copy the numbers exactly; never judge them.
  - "dose": a dose that was given or skipped. fields.med_id from the medications list, fields.slot one of that medication's times as HH:MM (the one they mean, or empty), fields.mark "taken" or "skipped", fields.note anything else they said.
  - "activity": something done for the patient now, like a bath, a walk or a meal. fields.note is what was done, in a few words.
  - "symptom": how the patient feels, in their words. fields.note is that, word for word. Never interpret it.
  - "incident": a fall, a refused medication, an injury, behaviour, or something else that went wrong. fields.incident one of fall, refused, injury, behaviour, other; fields.note what happened; fields.witnesses names, comma separated.
- If they ask you to do something and a detail is missing, still use that kind with what you have; the app asks for the rest.
- reply: one or two short, warm, plain sentences, like a kind helper. No markdown, no lists. Use the patient's relation as the person does (her, him, Mom). Call yourself by the assistant name in the request only if needed.`;

const PAGES = ['', 'med-add', 'scan-meds', 'scan-papers', 'document-add', 'appt-new', 'task-new', 'activity-new', 'incident-new', 'symptom-new', 'vitals', 'tasks',
  'medications', 'purchases', 'wallet', 'pharmacies', 'doctors', 'appointments', 'planned-tasks', 'documents', 'calendar', 'patient-info', 'ems-sheet', 'settings', 'people', 'reminders', 'support', 'home', 'photos'];
const str = { type: 'string' };
const KINDS = ['find', 'open', 'task', 'appointment', 'medication', 'document', 'vitals', 'dose', 'activity', 'symptom', 'incident', 'answer', 'medical', 'other'];
const FIELDS = ['name', 'category', 'sys', 'dia', 'pulse', 'temp', 'pain', 'med_id', 'slot', 'mark', 'note', 'witnesses', 'incident'];
const SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: KINDS },
    reply: str,
    ids: { type: 'array', items: str },
    open: { type: 'string', enum: PAGES },
    task: { type: 'object', properties: { what: str, note: str, date: str, time: str, repeat: { type: 'string', enum: ['once', 'daily', 'weekly'] } }, required: ['what', 'note', 'date', 'time', 'repeat'], additionalProperties: false },
    appointment: { type: 'object', properties: { with: str, place: str, date: str, time: str, note: str }, required: ['with', 'place', 'date', 'time', 'note'], additionalProperties: false },
    fields: { type: 'object', properties: Object.fromEntries(FIELDS.map(f => [f, str])), required: FIELDS, additionalProperties: false }
  },
  required: ['kind', 'reply', 'ids', 'open', 'task', 'appointment', 'fields'],
  additionalProperties: false
};

const cut = (v, n) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '';
const DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/* What the app sends, kept small and plain: the conversation (last 8 turns) and the care plan list. */
function request(body = {}) {
  const turns = (Array.isArray(body.messages) ? body.messages : []).slice(-8)
    .map(m => ({ role: m && m.role === 'assistant' ? 'assistant' : 'user', text: cut(m && m.text, 600) })).filter(m => m.text);
  while (turns.length && turns[0].role !== 'user') turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== 'user') return null;
  const list = (k, n, fields) => (Array.isArray(body.plan && body.plan[k]) ? body.plan[k] : []).slice(0, n)
    .map(x => Object.fromEntries(fields.map(f => [f, cut(x && x[f], f === 'given' ? 480 : 160)]).filter(([, v]) => v)));
  const plan = {
    medications: list('medications', 80, ['id', 'name', 'how', 'times', 'slots', 'status', 'doctor', 'pharmacy', 'given']),
    appointments: list('appointments', 60, ['id', 'name', 'date', 'time', 'place', 'status']),
    tasks: list('tasks', 60, ['id', 'name', 'when']),
    documents: list('documents', 100, ['id', 'name', 'category', 'date']),
    contacts: list('contacts', 40, ['id', 'name', 'kind', 'phone'])
  };
  return { turns, plan, today: DATE.test(body.today) ? body.today : new Date().toISOString().slice(0, 10), weekday: cut(body.weekday, 12), name: cut(body.name, 30) || 'Ada', patient: cut(body.patient, 40) };
}

/* The model's answer → only what the app can use: known ids, a known page, real dates and times. */
function clean(r = {}, plan = {}) {
  const known = new Set(Object.values(plan).flat().map(x => x.id).filter(Boolean));
  const kind = KINDS.includes(r.kind) ? r.kind : 'other';
  const t = r.task || {}, a = r.appointment || {}, f = r.fields || {}, num = (v, lo, hi, dec) => { const n = Number(String(v || '').replace(/[^\d.]/g, '')); return String(v || '').trim() && Number.isFinite(n) && n >= lo && n <= hi ? String(dec ? Math.round(n * 10) / 10 : Math.round(n)) : ''; };
  const medIds = new Set((plan.medications || []).map(m => m.id));
  return {
    kind,
    reply: cut(r.reply, 400),
    ids: kind === 'medical' || kind === 'other' ? [] : [...new Set((Array.isArray(r.ids) ? r.ids : []).filter(id => known.has(id)))].slice(0, 5),
    open: kind === 'open' && PAGES.includes(r.open) ? r.open : '',
    task: kind === 'task' ? { what: cut(t.what, 100), note: cut(t.note, 500), date: DATE.test(t.date) ? t.date : '', time: TIME.test(t.time) ? t.time : '', repeat: ['once', 'daily', 'weekly'].includes(t.repeat) ? t.repeat : 'once' } : null,
    appointment: kind === 'appointment' ? { with: cut(a.with, 100), place: cut(a.place, 200), date: DATE.test(a.date) ? a.date : '', time: TIME.test(a.time) ? a.time : '', note: cut(a.note, 500) } : null,
    fields: ['medication', 'document', 'vitals', 'dose', 'activity', 'symptom', 'incident'].includes(kind) ? {
      name: cut(f.name, 120), category: ['discharge', 'insurance', 'prescriptions', 'results', 'visits', 'legal', 'other'].includes(f.category) ? f.category : '',
      sys: num(f.sys, 50, 300), dia: num(f.dia, 20, 200), pulse: num(f.pulse, 20, 250), temp: num(f.temp, 86, 113, true), pain: num(f.pain, 0, 10),
      med_id: medIds.has(f.med_id) ? f.med_id : '', slot: TIME.test(f.slot) ? f.slot : '', mark: ['taken', 'skipped'].includes(f.mark) ? f.mark : '',
      note: cut(f.note, 500), witnesses: cut(f.witnesses, 200), incident: ['fall', 'refused', 'injury', 'behaviour', 'other'].includes(f.incident) ? f.incident : ''
    } : null
  };
}

function createAssistant({ apiKey = process.env.ANTHROPIC_API_KEY, client = null, log = console } = {}) {
  if (!client && apiKey) {
    const Anthropic = require('@anthropic-ai/sdk');
    client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  }
  async function ask(body) {
    const req = request(body);
    if (!client || !req) return null;
    const context = `Assistant name: ${req.name}. Patient: ${req.patient || 'the patient'}. Today: ${req.weekday} ${req.today}.\nCare plan list (JSON):\n${JSON.stringify(req.plan)}`;
    const messages = req.turns.map((m, n) => ({ role: m.role, content: n === req.turns.length - 1 ? `${context}\n\nThe person says: ${m.text}` : m.text }));
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1500,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages
      });
      if (response.usage) log.log(`Assistant: ${response.usage.input_tokens} input, ${response.usage.cache_read_input_tokens || 0} cached and ${response.usage.output_tokens} output tokens.`);
      if (response.stop_reason === 'refusal') return { kind: 'medical', reply: '', ids: [], open: '', task: null, appointment: null, fields: null };
      if (response.stop_reason === 'max_tokens') return null;
      const answer = response.content.find(b => b.type === 'text');
      return answer ? clean(JSON.parse(answer.text), req.plan) : null;
    } catch (err) {
      log.error('Assistant failed:', err.message);
      return null;
    }
  }
  return { ask, available: () => !!client };
}

module.exports = { createAssistant, request, clean, SCHEMA, MODEL, KINDS };
