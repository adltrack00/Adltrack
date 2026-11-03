/* The assistant (the app calls it Ada, or whatever name the person gave it): a short request in someone's own words, plus a
   small list of what's on the care plan (names, dates and ids, no photos), goes to Claude Haiku 5.5, the smallest and cheapest
   Claude model, with structured output. What comes back is only a plan for the app: which saved things to show, which of the
   app's own pages or forms to open, or a task or appointment form filled in to check. The app does the rest with its own code,
   so nothing is saved here and everything still goes through the same forms and permission checks as the buttons.
   Most requests never reach this file: finding something by its name, "show me where" and the app's own forms are handled in
   the app for free (assistant.js). Ada never gives medical advice; a medical question comes back as kind "medical". */
const MODEL = 'claude-haiku-5-5';

// Fixed, so it is cached between requests (only the new words and the care plan list are paid in full).
const SYSTEM = `You are the in-app assistant of Adltrack, a care app families and caregivers use after a loved one comes home from the hospital. The app holds the patient's medications (from the discharge papers and pharmacy labels), dose times, refills, appointments, planned care tasks, documents (insurance cards, lab results, papers), a daily care report and the care team.

Your only job is to help people use Adltrack: find what is saved, take them to the right page or form, and fill in a planned task or appointment form for them to check. You never save anything yourself; the person always checks and taps Save.

Rules:
- Never give medical advice. Do not answer questions about doses, missed doses, side effects, symptoms, what something means, whether something is safe or normal, drug interactions or diagnoses, even if you know the answer. Use kind "medical" and reply kindly that you can't answer medical questions and they should ask the doctor or pharmacist, and call 911 in an emergency. Do not repeat or guess any medical fact in the reply.
- Questions not about Adltrack or the patient's care plan (weather, news, general chat, homework, other apps): kind "other", reply briefly that you can only help with Adltrack.
- Answer questions about what is saved (for example "when is her next appointment", "which pharmacy fills the metoprolol", "did anyone give the 8am dose") only from the care plan list in the request, with kind "answer". If the list doesn't say, say you can't see it in the app. Never invent anything.
- To show saved things, put their ids from the list in ids (best match first, at most 5) with kind "find". Only ids that are in the list.
- To take them to a page or form, kind "open" and the page in open.
- To set a reminder or a planned task (something to do at a time, once or repeating), kind "task" and fill task. Dates are YYYY-MM-DD, worked out from today's date in the request; times are 24-hour HH:MM. repeat is once, daily or weekly. Leave a field empty if they didn't say it; never guess a time. If the date or time is missing, still use kind "task" and say in the reply that they can pick it in the form.
- To add an appointment, kind "appointment" and fill appointment the same way.
- Adding a medication, scanning papers, saving a document, vital signs, an incident or symptoms are done in the app's own pages with the camera: use kind "open" with the right page.
- reply: one or two short, warm, plain sentences, like a kind helper. No markdown, no lists. Use the patient's relation as the person does (her, him, Mom). Call yourself by the assistant name in the request only if needed.`;

const PAGES = ['', 'med-add', 'scan-meds', 'scan-papers', 'document-add', 'appt-new', 'task-new', 'activity-new', 'incident-new', 'symptom-new', 'vitals', 'tasks',
  'medications', 'purchases', 'wallet', 'pharmacies', 'doctors', 'appointments', 'planned-tasks', 'documents', 'calendar', 'patient-info', 'ems-sheet', 'settings', 'people', 'reminders', 'support', 'home', 'photos'];
const str = { type: 'string' };
const SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['find', 'open', 'task', 'appointment', 'answer', 'medical', 'other'] },
    reply: str,
    ids: { type: 'array', items: str },
    open: { type: 'string', enum: PAGES },
    task: { type: 'object', properties: { what: str, note: str, date: str, time: str, repeat: { type: 'string', enum: ['once', 'daily', 'weekly'] } }, required: ['what', 'note', 'date', 'time', 'repeat'], additionalProperties: false },
    appointment: { type: 'object', properties: { with: str, place: str, date: str, time: str, note: str }, required: ['with', 'place', 'date', 'time', 'note'], additionalProperties: false }
  },
  required: ['kind', 'reply', 'ids', 'open', 'task', 'appointment'],
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
    .map(x => Object.fromEntries(fields.map(f => [f, cut(x && x[f], 160)]).filter(([, v]) => v)));
  const plan = {
    medications: list('medications', 80, ['id', 'name', 'how', 'times', 'status', 'doctor', 'pharmacy', 'today']),
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
  const kind = ['find', 'open', 'task', 'appointment', 'answer', 'medical', 'other'].includes(r.kind) ? r.kind : 'other';
  const t = r.task || {}, a = r.appointment || {};
  return {
    kind,
    reply: cut(r.reply, 400),
    ids: kind === 'medical' || kind === 'other' ? [] : [...new Set((Array.isArray(r.ids) ? r.ids : []).filter(id => known.has(id)))].slice(0, 5),
    open: kind === 'open' && PAGES.includes(r.open) ? r.open : '',
    task: kind === 'task' ? { what: cut(t.what, 100), note: cut(t.note, 500), date: DATE.test(t.date) ? t.date : '', time: TIME.test(t.time) ? t.time : '', repeat: ['once', 'daily', 'weekly'].includes(t.repeat) ? t.repeat : 'once' } : null,
    appointment: kind === 'appointment' ? { with: cut(a.with, 100), place: cut(a.place, 200), date: DATE.test(a.date) ? a.date : '', time: TIME.test(a.time) ? a.time : '', note: cut(a.note, 500) } : null
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
      if (response.stop_reason === 'refusal') return { kind: 'medical', reply: '', ids: [], open: '', task: null, appointment: null };
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

module.exports = { createAssistant, request, clean, SCHEMA, MODEL };
