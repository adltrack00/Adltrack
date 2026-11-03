/* The assistant ("Ada" until the person renames her). It opens from the round chat button at the bottom right that every
   section already has (help.js), in the same pop-up frame, and the section's own help stays one tap away ("How this page works").
   Cheapest first: finding something by its name ("show me her insurance card"), "Show me where", the app's own forms and every
   medical question are worked out here in the app, free. Only what that can't understand goes to /api/assistant (Claude Haiku
   5.5, a fraction of a cent), which answers with a plan: what to show, which page to open, or a task or appointment form filled
   in. Nothing is saved by Ada: a filled-in form opens for the person to check and tap Save, so the forms, the live-photo rule and
   the permission checks stay exactly as they are. Ada never gives medical advice: it points to the doctor, the pharmacy and 911.
   Her name and look are each person's own (profile.assistant), picked by tapping her picture. */
const ADA_LOOKS = {
  sage: { label: 'Sage', hat: '#8fb486', band: '#6d9366', skin: '#ffe3cf', skin2: '#f4c4a4', heart: '#e9866f', bg: '#f3ead9' },
  rose: { label: 'Rose', hat: '#e8a3a8', band: '#cf7f86', skin: '#f9dcc4', skin2: '#eebd9a', heart: '#fff4ec', bg: '#f7e6e3' },
  sky: { label: 'Sky', hat: '#8fb0d6', band: '#6e91bb', skin: '#e9c09b', skin2: '#d7a67c', heart: '#ffd27a', bg: '#e6edf4' },
  sun: { label: 'Sunny', hat: '#f1c45c', band: '#d9a63a', skin: '#c99271', skin2: '#b27b5b', heart: '#e9866f', bg: '#f6ecd3' },
  lilac: { label: 'Lilac', hat: '#b9a3d6', band: '#9a83bd', skin: '#ffe3cf', skin2: '#f4c4a4', heart: '#ffd27a', bg: '#ece6f3' },
  cocoa: { label: 'Cocoa', hat: '#d9a07a', band: '#b9805b', skin: '#8d5a3f', skin2: '#76482f', heart: '#fff4ec', bg: '#f1e4d8' }
};
const ADA_DEFAULT = 'Ada';
const adaPrefs = () => (typeof profile === 'object' && profile && profile.assistant) || {};
const adaName = () => String(adaPrefs().name || '').trim().slice(0, 20) || ADA_DEFAULT;
const adaDay = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? new Date(d + 'T12:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '';
const adaLookKey = () => ADA_LOOKS[adaPrefs().look] ? adaPrefs().look : 'sage';

/* Ada's face: an original round character in a knit hat with a little heart. Colours come from her look. */
function adaFace(key = adaLookKey()) {
  const c = ADA_LOOKS[key] || ADA_LOOKS.sage, g = 'ada-' + key;
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="${g}-f" cx="45%" cy="40%"><stop offset="0" stop-color="${c.skin}"/><stop offset="1" stop-color="${c.skin2}"/></radialGradient></defs>
<rect width="100" height="100" fill="${c.bg}"/><ellipse cx="50" cy="106" rx="40" ry="26" fill="${c.hat}"/><circle cx="50" cy="60" r="30" fill="url(#${g}-f)"/>
<path d="M18 52c0-20 14-32 32-32s32 12 32 32c-10-6-20-8-32-8s-22 2-32 8z" fill="${c.hat}"/><path d="M19 52c10-6 20-8 31-8s21 2 31 8" stroke="${c.band}" stroke-width="5" fill="none" stroke-linecap="round"/>
<g stroke="#ffffff59" stroke-width="1.4" fill="none"><path d="M30 28v14M40 23v19M50 21v21M60 23v19M70 28v14"/></g><circle cx="50" cy="18" r="7" fill="#f8f4ec"/>
<path d="M50 36.5c-2.4-3-6.5-1-5 2 1 2 5 4.5 5 4.5s4-2.5 5-4.5c1.5-3-2.6-5-5-2z" fill="${c.heart}"/>
<ellipse cx="40" cy="62" rx="3" ry="3.6" fill="#2a2420"/><ellipse cx="60" cy="62" rx="3" ry="3.6" fill="#2a2420"/><circle cx="41" cy="60.8" r="1" fill="#fff"/><circle cx="61" cy="60.8" r="1" fill="#fff"/>
<ellipse cx="33" cy="70" rx="5" ry="3" fill="#f29c8c" opacity=".5"/><ellipse cx="67" cy="70" rx="5" ry="3" fill="#f29c8c" opacity=".5"/><path d="M45 71q5 5 10 0" stroke="#2a2420" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`;
}

/* ---- Understanding a request, in the app, free ---- */
const ADA_STOP = new Set('a an and are at be can could do does find for from get give go her here him his i in is it its me mom dad my of on open or our please pull see show tell that the their them this to up us want we what when where which who will with you your look looking need'.split(' '));
const adaWords = s => String(s || '').toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter(w => w.length > 1 && !ADA_STOP.has(w));
/* Medical questions: caught here before anything is sent, and answered only with who to call. */
const ADA_MEDICAL = /\b(should (i|we|she|he|they)\b(?!.*\b(add|save|scan|set|remind|book)\b)|is (it|this|that) (safe|ok|okay|normal|bad|serious|dangerous)|safe to|can (i|we|she|he) (take|give|have|mix|stop|skip|double|crush|split|drink)|side effects?|interact|overdose|double (the |a |her |his )?dose|missed (a |her |his |the )?(\d+\s*(am|pm) )?dose|how (much|many) (should|can|do|to)|what (does|do|could) .{1,40} mean|diagnos|is (she|he) (dying|ok|okay)|why (is|does|do) (she|he|my|her|his)|treat(ment)? for|cure|what (medicine|medication|drug) (should|for|to))/i;
const ADA_ACTIONS = [
  ['scan-papers', /\bdischarge\b/i],
  ['med-add', /\b(add|new|scan|upload|put in|enter|save)\b.*\b(meds?|medications?|medicines?|pills?|prescriptions?|bottles?|tablets?|capsules?|inhaler|label)\b/i],
  ['document-add', /\b(add|save|upload|scan|keep|file|store|take a photo of|photo of)\b.*\b(documents?|cards?|papers?|insurance|results?|letters?|forms?|id|licen[cs]e|poa|power of attorney|dnr|polst|will|bill|report)\b/i],
  ['incident-new', /\b(fell|fall(en)?|incident|accident|injur(y|ed)|hurt (her|him|them)self|bruise|cut (her|him)self)\b/i],
  ['symptom-new', /\b(symptoms?|feels? (sick|dizzy|tired|weak|unwell)|nause|vomit|fever|cough|rash|swelling|short of breath)\b/i],
  ['vitals', /\b(blood pressure|bp|pulse|heart rate|temperature|temp|vitals?|pain (level|score))\b/i],
  ['appt-new', /\b(add|new|book|make|set( up)?|schedule)\b.*\b(appointments?|visits?|check ?ups?|follow ?ups?)\b/i],
  ['task-new', /\b(remind( me)?|reminder|planned task|add (a )?task|new task|set (a )?(task|reminder))\b/i]
];
/* "Show me where", with its words for the tip and the button it points at. */
const ADA_PLACES = {
  'med-add': { view: 'medications', el: '[data-menu-go="med-add"]', path: 'Menu › Medications › Add a medication', title: 'Add a medication', sub: 'Scan the pharmacy paper or the bottle with the camera, or type it in.', may: () => mayDo('meds') },
  'scan-meds': { view: 'scan', el: '#flow-bottles', path: 'Menu › Scan › Scan medications', title: 'Scan medications', sub: 'A live photo of the pharmacy paper or the bottle label.', may: () => mayDo('meds') },
  'scan-papers': { view: 'scan', el: '[data-add]', path: 'Menu › Scan › Scan discharge papers', title: 'Scan discharge papers', sub: 'Page by page with the camera. They’re filed in Documents too.', may: () => mayDo('meds') },
  'document-add': { view: 'documents', el: '[data-menu-go="document-add"]', path: 'Menu › Documents › Add a document', title: 'Add a document', sub: 'A photo of each page, or a PDF, with a name and a category.', may: () => mayDo('meds') },
  'appt-new': { view: 'appointments', el: '[data-menu-go="appt-new"]', path: 'Menu › Appointments › Add an appointment', title: 'Add an appointment', sub: 'The doctor, the date and the time.', may: () => mayDo('meds') },
  'task-new': { view: 'planned-tasks', el: '[data-menu-go="task-new"]', path: 'Menu › Planned tasks › Add a planned task', title: 'Add a planned task', sub: 'What to do, when, and how often. It reminds the care team.', may: () => mayAddTask() },
  'activity-new': { tasks: true, el: '#tasks-plus', path: 'Home › My Tasks › + › New task', title: 'New task', sub: 'Something done now, with a note and live photos.', may: () => mayReport() },
  'incident-new': { tasks: true, el: '#tasks-plus', path: 'Home › My Tasks › + › Report an incident', title: 'Report an incident', sub: 'What happened, who saw it, and live photos. Everyone is told.', may: () => mayReport() },
  'symptom-new': { tasks: true, el: '#tasks-plus', path: 'Home › My Tasks › + › Symptoms', title: 'Symptoms', sub: 'How they feel, with live photos if they help.', may: () => mayReport() },
  vitals: { tasks: true, el: '.vitals', path: 'Home › My Tasks › Vital signs', title: 'Vital signs', sub: 'Tap Blood pressure, Heart, Temp or Pain. A photo of the monitor fills in the numbers.', may: () => mayDo('tasks') },
  tasks: { tasks: true, el: '#tasks-sheet', path: 'Home › My Tasks', title: 'My Tasks', sub: 'Everything due today.', may: () => true },
  home: { view: 'overview', el: '', path: 'Home', title: 'Today’s report', sub: 'Everything done today.', may: () => true },
  photos: { view: 'overview', el: '', photos: true, path: 'Home › Photos', title: 'Photos', sub: 'Every photo taken with a task today.', may: () => true },
  medications: { view: 'medications', el: '', path: 'Menu › Medications', title: 'Medications', sub: 'All medications, refills and pharmacies.', may: () => true },
  purchases: { view: 'purchases', el: '', path: 'Menu › Medications › All medications', title: 'All medications', sub: 'Every medication on the care plan.', may: () => true },
  wallet: { view: 'wallet', el: '', path: 'Menu › Medications › Your refills', title: 'Your refills', sub: 'What needs a refill, step by step.', may: () => true },
  pharmacies: { view: 'pharmacies', el: '', path: 'Menu › Medications › My pharmacies', title: 'My pharmacies', sub: 'Every pharmacy with its medications.', may: () => true },
  doctors: { view: 'doctors', el: '', path: 'Menu › Appointments › My doctors', title: 'My doctors', sub: 'Every doctor with their phone number.', may: () => true },
  appointments: { view: 'appointments', el: '', path: 'Menu › Appointments', title: 'Appointments', sub: 'Every doctor’s visit.', may: () => true },
  'planned-tasks': { view: 'planned-tasks', el: '', path: 'Menu › Planned tasks', title: 'Planned tasks', sub: 'Tasks set for a day and time.', may: () => true },
  documents: { view: 'documents', el: '', path: 'Menu › Documents', title: 'Documents', sub: 'Every paper, sorted by category.', may: () => true },
  calendar: { view: 'calendar', el: '', path: 'Menu › Your schedule', title: 'Your schedule', sub: 'The month at a glance.', may: () => true },
  'patient-info': { view: 'patient-info', el: '', path: 'Tap the patient’s photo on Home', title: 'Patient information', sub: 'Allergies, conditions, who to call.', may: () => true },
  'ems-sheet': { view: 'ems-sheet', el: '', path: 'Patient’s photo › For EMS', title: 'For EMS', sub: 'A one-page sheet for paramedics.', may: () => true },
  settings: { view: 'settings', el: '', path: 'Menu › Settings', title: 'Settings', sub: 'People, plan, profile and reminders.', may: () => true },
  people: { view: 'people', el: '', path: 'Menu › Settings › People', title: 'People', sub: 'Everyone on the care team.', may: () => true },
  reminders: { view: 'reminders', el: '', path: 'Menu › Settings › Reminders', title: 'Reminders', sub: 'When reminders come.', may: () => true },
  support: { view: 'support', el: '', path: 'Menu › Settings › Support', title: 'Support', sub: 'How Adltrack works and when to call.', may: () => true }
};

/* Everything that can be found by name: medications, documents, appointments, planned tasks, doctors and pharmacies. */
function adaThings(list = items) {
  const out = [], meds = list.filter(i => i && i.med && !i.demo);
  for (const i of meds) out.push({ kind: 'med', id: i.id, item: i, name: i.name, words: [i.name, i.instructions, i.pharmacy && i.pharmacy.name, i.prescriber && i.prescriber.name, 'medication medicine pill'].join(' '), path: 'Menu › Medications › All medications', view: 'purchases', el: `[data-open="${i.id}"]` });
  if (typeof docList === 'function') for (const d of docList(list)) out.push({ kind: 'doc', id: d.id, doc: d, name: d.name, words: [d.name, typeof docCategoryName === 'function' ? docCategoryName(d.category) : d.category, d.category, d.note, 'document paper card'].join(' '), path: 'Menu › Documents › ' + (typeof docCategoryName === 'function' ? docCategoryName(d.category) : 'Documents'), view: 'documents', el: `[data-doc-open="${d.id}"]` });
  for (const a of list.filter(i => i && i.appt && !i.demo)) out.push({ kind: 'appt', id: a.id, item: a, name: a.name, words: [a.name, a.with, a.place, 'appointment visit doctor'].join(' '), path: 'Menu › Appointments', view: 'appointments', el: `[data-plan-appt="${a.id}"]` });
  for (const t of list.filter(i => i && i.task && !i.demo)) out.push({ kind: 'task', id: t.id, item: t, name: t.name, words: [t.name, t.note, 'task reminder'].join(' '), path: 'Menu › Planned tasks', view: 'planned-tasks', el: `[data-planned-open="${t.id}"]` });
  if (typeof careContacts === 'function') { const c = careContacts(list.filter(i => !i.demo)); for (const [field, kind, view, path] of [['doctors', 'doctor', 'doctors', 'Menu › Appointments › My doctors'], ['pharmacies', 'pharmacy', 'pharmacies', 'Menu › Medications › My pharmacies']]) for (const x of c[field]) out.push({ kind, id: kind + ':' + x.key, contact: x, name: x.name, words: [x.name, kind, x.meds.join(' ')].join(' '), path, view, el: '' }); }
  return out;
}
/* Best matches for the words of a request: every word of a name counts, and a word that's only in the details counts less. */
function adaFind(text, list = items) {
  const want = adaWords(text).map(w => w.replace(/s$/, ''));
  if (!want.length) return [];
  return adaThings(list).map(t => {
    const name = adaWords(t.name).map(w => w.replace(/s$/, '')), more = adaWords(t.words).map(w => w.replace(/s$/, ''));
    let score = 0;
    for (const w of want) { if (name.some(n => n === w || (w.length > 4 && n.startsWith(w)))) score += 3; else if (more.some(n => n === w || (w.length > 4 && n.startsWith(w)))) score += 1; }
    return { t, score };
  }).filter(x => x.score >= 2).sort((a, b) => b.score - a.score).filter((x, n, all) => x.score >= all[0].score - 1).slice(0, 3).map(x => x.t);
}
const ADA_LOOKUP = /\b(where|find|show|open|pull|see|look|view|get me|bring up|need (her|his|the|my)|what is|whats|which)\b/i;
/* What the app can tell without the AI: a medical question, something to find, or one of the app's own forms. Null = ask the AI. */
function adaLocal(text, list = items) {
  const s = String(text || '').trim();
  if (!s) return null;
  if (ADA_MEDICAL.test(s)) return { kind: 'medical' };
  if (/\bnext (appointment|visit)\b/i.test(s)) { const day = today(), next = list.filter(i => i.appt && !i.demo && i.status !== 'received' && i.date && i.date >= day).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))[0]; return next ? { kind: 'find', things: adaThings(list).filter(t => t.id === next.id), say: 'Here’s the next one.' } : { kind: 'say', say: 'There’s no appointment coming up in the app.', open: 'appointments' }; }
  const dated = /\b\d{1,2}(:\d{2})?\s*(am|pm)\b|\b(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|evening|noon|night|every|daily|weekly|next week|on the \d|\d{1,2}(st|nd|rd|th))\b/i.test(s);
  if (ADA_LOOKUP.test(s) || adaWords(s).length <= 3) {
    const found = adaFind(s, list);
    if (found.length && !(/\b(add|new|save|upload|scan|remind|book|schedule)\b/i.test(s))) return { kind: 'find', things: found };
  }
  for (const [act, re] of ADA_ACTIONS) if (re.test(s)) {
    if ((act === 'task-new' || act === 'appt-new') && dated) return null;
    return { kind: 'open', open: act };
  }
  const where = s.match(/\b(medications?|meds|refills?|pharmac(y|ies)|doctors?|appointments?|planned tasks?|documents?|schedule|calendar|settings|people|care team|reminders|support|photos|my tasks|patient info(rmation)?|ems)\b/i);
  if (where && ADA_LOOKUP.test(s)) {
    const k = where[1].toLowerCase(), map = { med: 'purchases', meds: 'purchases', medication: 'purchases', medications: 'purchases', refill: 'wallet', refills: 'wallet', pharmacy: 'pharmacies', pharmacies: 'pharmacies', doctor: 'doctors', doctors: 'doctors', appointment: 'appointments', appointments: 'appointments', document: 'documents', documents: 'documents', schedule: 'calendar', calendar: 'calendar', settings: 'settings', people: 'people', 'care team': 'people', reminders: 'reminders', support: 'support', photos: 'photos', 'my tasks': 'tasks', ems: 'ems-sheet' };
    const open = map[k] || (/planned/.test(k) ? 'planned-tasks' : /patient/.test(k) ? 'patient-info' : '');
    if (open) return { kind: 'open', open };
  }
  return null;
}

/* The small list of the care plan the AI may answer from: names, dates and ids only, never photos or record numbers. */
function adaPlan(list = items) {
  const day = today(), shortTime = t => typeof clockText === 'function' ? clockText(t) : t;
  return {
    medications: list.filter(i => i.med && !i.demo).map(i => ({ id: i.id, name: i.name, how: i.instructions || '', times: (i.times || []).map(shortTime).join(', '), status: i.status === 'received' ? 'finished' : i.refill ? 'needs refill' : 'open', doctor: i.prescriber && i.prescriber.name || '', pharmacy: i.pharmacy && i.pharmacy.name || '', today: (i.doses || []).filter(d => String(d.at || '').startsWith(day)).map(d => `${d.slot ? shortTime(d.slot) + ' ' : ''}${d.kind}${d.by ? ' by ' + d.by : ''}`).join('; ') })),
    appointments: list.filter(i => i.appt && !i.demo).map(a => ({ id: a.id, name: a.name, date: a.date || '', time: a.time || '', place: a.place || '', status: a.status === 'received' ? 'went' : '' })),
    tasks: list.filter(i => i.task && !i.demo).map(t => ({ id: t.id, name: t.name, when: typeof repeatText === 'function' ? repeatText(t) : '' })),
    documents: (typeof docList === 'function' ? docList(list) : []).map(d => ({ id: d.id, name: d.name, category: typeof docCategoryName === 'function' ? docCategoryName(d.category) : d.category, date: d.date || '' })),
    contacts: adaThings(list).filter(t => t.contact).map(t => ({ id: t.id, name: t.name, kind: t.kind, phone: t.contact.phone || '' }))
  };
}
if (typeof module !== 'undefined') module.exports = { ADA_LOOKS, adaFace, adaWords, adaFind, adaLocal, adaPlan, adaThings, ADA_PLACES, ADA_MEDICAL };

if (typeof document !== 'undefined') {
/* ---- The pop-up ---- */
let ada = { open: false, log: [], busy: false, edit: false, listening: false };
const adaFirst = () => (typeof myName === 'function' ? String(myName() || '').split(' ')[0] : '');
const ADA_SUGGEST = [['Add a medication', 'Take a live photo of the bottle or the pharmacy paper.', 'Add a medication'], ['Set a reminder or task', '“Remind me Friday at 10 to call the doctor.”', 'Set a reminder'], ['Find a document', '“Show me her insurance card.”', 'Show me the documents'], ['Show me where things are', '“Where are her refills?”', 'Where are the refills?']];
const adaIcon = { cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>', mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>', send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>' };

function adaThumb(t) {
  if (t.kind === 'med') return typeof medPhoto === 'function' ? medPhoto(t.item) : '';
  if (t.kind === 'appt') return typeof apptPhoto === 'function' ? apptPhoto(t.item) : '';
  if (t.kind === 'task') return typeof taskPhoto === 'function' ? taskPhoto(t.item, null) : '';
  if (t.kind === 'doc') { const f = t.doc.files[0]; return f && !/pdf/i.test(f.type || '') && !/\.pdf$|^data:application\/pdf/i.test(f.data || f.url || '') ? `<span class="ada-doc" style="background-image:url('${esc(f.data || f.url)}')"></span>` : `<span class="ada-doc ada-doc-pdf">${f ? 'PDF' : 'Doc'}</span>`; }
  return `<span class="ada-doc ada-doc-pdf">${t.kind === 'doctor' ? 'Dr' : 'Rx'}</span>`;
}
function adaDetail(t) {
  if (t.kind === 'med') { const i = t.item; return [i.instructions, (i.times || []).length && typeof clockText === 'function' ? 'At ' + i.times.map(clockText).join(' and ') : '', i.pharmacy && i.pharmacy.name, i.prescriber && i.prescriber.name].filter(Boolean); }
  if (t.kind === 'doc') return [typeof docCategoryName === 'function' ? docCategoryName(t.doc.category) : '', adaDay(t.doc.date), t.doc.files.length ? (t.doc.files.length === 1 ? '1 page' : t.doc.files.length + ' pages') : ''].filter(Boolean);
  if (t.kind === 'appt') { const a = t.item; return [typeof apptState === 'function' ? apptState(a) : a.date, a.place].filter(Boolean); }
  if (t.kind === 'task') return [typeof repeatText === 'function' ? repeatText(t.item) : ''].filter(Boolean);
  return [t.contact.phone ? 'Phone ' + t.contact.phone : 'No phone number saved', 'For ' + t.contact.meds.join(', ')];
}
const adaCall = (label, phone) => phone ? `<a class="ada-btn ada-btn-dark" href="tel:${esc(String(phone).replace(/[^\d+]/g, ''))}">${esc(label)}</a>` : '';
function adaCard(c) {
  if (c.type === 'thing') { const t = c.t, n = c.n;
    return `<div class="ada-box ada-thing"><button class="ada-thing-top" data-ada-open="${n}" aria-label="Open ${esc(t.name)}"><span class="ada-thumb">${adaThumb(t)}</span><span><span class="ada-tag">${{ med: 'Medication', doc: 'Document', appt: 'Appointment', task: 'Planned task', doctor: 'Doctor', pharmacy: 'Pharmacy' }[t.kind]}</span><b>${esc(t.name)}</b>${adaDetail(t).map(x => `<small>${esc(x)}</small>`).join('')}</span></button><div class="ada-btns">${t.kind === 'doctor' || t.kind === 'pharmacy' ? adaCall('Call', t.contact.phone) || `<button class="ada-btn ada-btn-dark" data-ada-open="${n}">Open</button>` : `<button class="ada-btn ada-btn-dark" data-ada-open="${n}">Open</button>`}<button class="ada-btn" data-ada-where="${n}">Show me where</button></div></div>`; }
  if (c.type === 'place') { const p = ADA_PLACES[c.open];
    return `<div class="ada-box"><span class="ada-tag">${esc(p.path)}</span><b>${esc(p.title)}</b><small>${esc(p.sub)}</small><div class="ada-btns"><button class="ada-btn ada-btn-dark" data-ada-go="${esc(c.open)}">Open it</button><button class="ada-btn" data-ada-where-place="${esc(c.open)}">Show me where</button></div></div>`; }
  if (c.type === 'form') { const d = c.draft, task = c.form === 'task-new', when = [adaDay(d.date), d.time && typeof clockText === 'function' ? clockText(d.time) : d.time].filter(Boolean).join(' at ') || 'Pick the day and time in the form';
    return `<div class="ada-box"><span class="ada-tag">${task ? 'Planned task' : 'Appointment'} · ready to check</span><b>${esc(task ? d.what || 'New task' : d.with || 'New appointment')}</b><dl><dt>When</dt><dd>${esc(when)}</dd>${task ? `<dt>Repeats</dt><dd>${esc({ once: 'Once', daily: 'Every day', weekly: 'Every week' }[d.repeat] || 'Once')}</dd>` : d.place ? `<dt>Where</dt><dd>${esc(d.place)}</dd>` : ''}${d.note ? `<dt>Note</dt><dd>${esc(d.note)}</dd>` : ''}</dl><div class="ada-btns"><button class="ada-btn ada-btn-dark" data-ada-form="${c.n}">Check and save</button><button class="ada-btn" data-ada-where-place="${esc(c.form)}">Show me where</button></div></div>`; }
  if (c.type === 'call') { const groups = typeof whenToCall === 'function' ? whenToCall() : [], g = groups.find(x => !x.urgent) || groups[0], docs = typeof careContacts === 'function' ? careContacts() : { doctors: [], pharmacies: [] }, d = docs.doctors.find(x => x.phone), p = docs.pharmacies.find(x => x.phone);
    return `${g && g.signs.length ? `<div class="ada-quote"><span class="ada-tag">What the papers say · ${esc(g.head)}</span>${g.signs.slice(0, 4).map(x => `<p>“${esc(x)}”</p>`).join('')}</div>` : ''}<div class="ada-box"><b>Who to call</b><div class="ada-btns">${d ? adaCall('Call ' + d.name, d.phone) : ''}${p ? adaCall('Call ' + p.name, p.phone) : ''}${!d && !p ? '<button class="ada-btn" data-ada-go="doctors">My doctors</button>' : ''}</div><small>In an emergency, call <a href="tel:911">911</a>.</small></div>`; }
  return '';
}
function adaBody() {
  if (ada.edit) { const p = adaPrefs();
    return `<div class="ada-edit"><h2>Make ${esc(adaName())} yours</h2><p class="ada-intro">Give your assistant a name and pick a look. Only you see it this way.</p><label class="ada-label">Name<input id="ada-name" maxlength="20" autocomplete="off" value="${esc(p.name || '')}" placeholder="${ADA_DEFAULT}"></label><div class="ada-looks" role="radiogroup" aria-label="Look">${Object.entries(ADA_LOOKS).map(([k, l]) => `<button role="radio" aria-checked="${k === adaLookKey()}" class="ada-look${k === adaLookKey() ? ' on' : ''}" data-ada-look="${k}"><span class="ada-av">${adaFace(k)}</span><small>${l.label}</small></button>`).join('')}</div><button class="primary ada-save">Save</button><button class="ada-link" data-ada-cancel>Cancel</button></div>`; }
  if (!ada.log.length) { const help = typeof helpTopics !== 'undefined' && helpTopics[helpKey()];
    return `<h2 class="ada-hi">Hi${adaFirst() ? ' ' + esc(adaFirst()) : ''}, I’m ${esc(adaName())}.</h2><p class="ada-intro">What can I do for you? Tell me in your own words, or talk. I find things, show you where they are, and fill in the forms for you to check.</p><ol class="ada-suggest">${ADA_SUGGEST.map(([h, p, say], n) => `<li><button data-ada-say="${esc(say)}"><i>${String(n + 1).padStart(2, '0')}</i><strong>${esc(h)}</strong><span>${esc(p)}</span></button></li>`).join('')}</ol><p class="ada-note">${esc(adaName())} doesn’t give medical advice. For that, call the doctor or the pharmacist. In an emergency, call 911.</p>${help ? `<button class="ada-link" data-ada-help>How this page works</button>` : ''}`; }
  return ada.log.map(m => m.who === 'me' ? `<div class="ada-me">${esc(m.text)}</div>` : `<div class="ada-ai">${m.text ? `<div class="ada-who">${esc(adaName())}</div><p>${esc(m.text)}</p>` : ''}${(m.cards || []).map(adaCard).join('')}</div>`).join('') + (ada.busy ? `<div class="ada-ai"><div class="ada-who">${esc(adaName())}</div><p class="ada-dots"><span></span><span></span><span></span></p></div>` : '');
}
function adaHTML() {
  return `<div class="ada-card" tabindex="-1"><button class="med-zoom-x ada-x" aria-label="Close">×</button><header class="ada-head"><button class="ada-av ada-av-big" data-ada-me aria-label="Change ${esc(adaName())}’s name and look">${adaFace()}</button><span class="ada-name" id="ada-title">${esc(adaName())}</span><span class="ada-status">Here to help</span></header><div class="ada-body" id="ada-body">${adaBody()}</div>${ada.edit ? '' : `<form class="ada-compose" id="ada-form"><button type="button" class="ada-round" data-ada-camera aria-label="Take a photo">${adaIcon.cam}</button><input id="ada-input" autocomplete="off" enterkeyhint="send" maxlength="600" placeholder="${ada.listening ? 'Listening…' : 'Type or talk…'}" aria-label="Message ${esc(adaName())}"><button type="button" class="ada-round ada-dark${ada.listening ? ' on' : ''}" data-ada-mic aria-label="${ada.listening ? 'Stop listening' : 'Talk'}">${adaIcon.mic}</button><button class="ada-round ada-dark ada-send" aria-label="Send" hidden>${adaIcon.send}</button></form>`}</div>`;
}
function adaPaint(keepInput) {
  const box = document.querySelector('.ada-pop'); if (!box) return;
  const input = document.getElementById('ada-input'), typed = keepInput && input ? input.value : '';
  box.innerHTML = adaHTML();
  const body = document.getElementById('ada-body'); if (body && ada.log.length && !ada.edit) body.scrollTop = body.scrollHeight;
  const next = document.getElementById('ada-input'); if (next && typed) { next.value = typed; adaSendShown(); }
}
const adaSendShown = () => { const i = document.getElementById('ada-input'), s = document.querySelector('.ada-send'), m = document.querySelector('[data-ada-mic]'); if (!i || !s) return; const has = !!i.value.trim(); s.hidden = !has; if (m) m.hidden = has; };
function openAda() {
  closeAda(true); if (typeof closeHelp === 'function') closeHelp();
  const box = document.createElement('div'); box.className = 'ada-pop'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'ada-title');
  document.body.appendChild(box); document.body.classList.add('help-open', 'ada-open'); ada.open = true; adaPaint();
  box.querySelector('.ada-card').focus(); if (typeof placeHelp === 'function') placeHelp();
}
function closeAda(quiet) {
  const p = document.querySelector('.ada-pop'); adaStopMic(); ada.edit = false; if (!p) return;
  p.remove(); ada.open = false; document.body.classList.remove('help-open', 'ada-open');
  if (!quiet) { if (typeof placeHelp === 'function') placeHelp(); document.getElementById('help-fab')?.focus({ preventScroll: true }); }
}

/* ---- Answering ---- */
const adaSay = (text, cards = []) => { ada.log.push({ who: 'ada', text, cards }); adaPaint(true); };
const ADA_NOT_ALLOWED = 'You can see this, but an admin hasn’t given you permission to change it. Ask an admin on the care team.';
function adaPlace(open, say) {
  const p = ADA_PLACES[open]; if (!p) return adaSay(say || 'I’m not sure where that is. Try asking in other words.');
  if (!p.may()) return adaSay(ADA_NOT_ALLOWED, [{ type: 'place', open: p.tasks ? 'tasks' : (p.view && ADA_PLACES[p.view] ? p.view : 'home') }].filter(c => ADA_PLACES[c.open]));
  const intro = { 'med-add': 'Sure. Add it here with a live photo of the bottle or the pharmacy paper. I’ll take you there.', 'scan-meds': 'Sure. Scan the bottle label or the pharmacy paper here.', 'scan-papers': 'Sure. Lay each page flat and take its picture here. They’re read and filed in Documents.', 'document-add': 'Sure. Take a photo of each page, or pick the file, here.', 'appt-new': 'Sure. Fill in the doctor, the date and the time here.', 'task-new': 'Sure. Tell me what and when, like “every Monday at 9”, or fill it in here.', 'incident-new': 'I’m sorry. Report it here, with what happened and live photos. Everyone on the care team is told. If anyone is hurt badly, call 911.', 'symptom-new': 'Write down how they feel here, with photos if they help. For anything worrying, call the doctor.', vitals: 'Vital signs are in My Tasks. Tap one, then take a photo of the monitor or type the numbers.' }[open];
  adaSay(say || intro || 'Here it is.', [{ type: 'place', open }]);
}
function adaShowThings(things, say) {
  const base = ada.log.reduce((n, m) => n + (m.cards || []).length, 0);
  ada.things = ada.things || {};
  const cards = things.map((t, k) => { ada.things[base + k] = t; return { type: 'thing', t, n: base + k }; });
  adaSay(say || (things.length === 1 ? 'Here it is.' : 'I found these.'), cards);
}
function adaForm(form, draft, say) {
  if (form === 'task-new' ? !mayAddTask() : !mayDo('meds')) return adaSay(ADA_NOT_ALLOWED);
  ada.forms = ada.forms || []; const n = ada.forms.push({ form, draft }) - 1;
  adaSay(say || 'I filled it in. Check it and tap Save.', [{ type: 'form', form, draft, n }]);
}
function adaMedical(say) { adaSay(say || `I can’t answer medical questions, so please ask the doctor or the pharmacist. In an emergency, call 911.`, [{ type: 'call' }]); }
async function adaAsk(text) {
  const s = String(text || '').trim(); if (!s || ada.busy) return;
  ada.log.push({ who: 'me', text: s }); adaPaint();
  const local = adaLocal(s);
  if (local) {
    if (local.kind === 'medical') return adaMedical();
    if (local.kind === 'find') return adaShowThings(local.things, local.say);
    if (local.kind === 'open') return adaPlace(local.open);
    if (local.kind === 'say') return adaSay(local.say, local.open ? [{ type: 'place', open: local.open }] : []);
  }
  ada.busy = true; adaPaint();
  let r = null;
  try {
    const turns = ada.log.filter(m => m.text).slice(-8).map(m => ({ role: m.who === 'me' ? 'user' : 'assistant', text: m.text }));
    const d = new Date();
    const res = await Account.api('POST', '/api/assistant', { messages: turns, plan: adaPlan(), today: today(), weekday: d.toLocaleDateString('en-US', { weekday: 'long' }), name: adaName() });
    r = res && res.answer;
  } catch { r = null; }
  ada.busy = false;
  if (!ada.open) return;
  if (!r) { const found = adaFind(s); return found.length ? adaShowThings(found, 'Is it one of these?') : adaSay('Sorry, I didn’t catch that. You can ask me to find something, take you somewhere in the app, or set a reminder.'); }
  if (r.kind === 'medical') return adaMedical(r.reply);
  if (r.kind === 'task' && r.task) return adaForm('task-new', { ...blankTaskDraft(), what: r.task.what, note: r.task.note, date: r.task.date || today(), time: r.task.time, repeat: r.task.repeat }, r.reply);
  if (r.kind === 'appointment' && r.appointment) return adaForm('appt-new', { ...blankApptDraft(), with: r.appointment.with, place: r.appointment.place, date: r.appointment.date, time: r.appointment.time, note: r.appointment.note }, r.reply);
  if (r.kind === 'open' && r.open) return adaPlace(r.open === 'scan-meds' && !mayDo('meds') ? 'scan-meds' : r.open, r.reply);
  const things = adaThings().filter(t => r.ids.includes(t.id)).sort((a, b) => r.ids.indexOf(a.id) - r.ids.indexOf(b.id));
  if (things.length) return adaShowThings(things, r.reply);
  adaSay(r.reply || 'I can only help with Adltrack.');
}

/* ---- Open it, and Show me where ---- */
function adaOpen(t) {
  closeAda(true);
  if (t.kind === 'med') { showDetail(t.id); return; }
  go(t.view);
  setTimeout(() => { const b = t.el && document.querySelector(t.el); if (b) b.click(); else adaWhere(t); }, 60);
}
function adaGoPlace(open) {
  const p = ADA_PLACES[open]; if (!p) return; closeAda(true);
  if (['activity-new', 'incident-new', 'symptom-new', 'med-add', 'document-add', 'appt-new', 'task-new'].includes(open)) { go(open); return; }
  if (p.tasks || open === 'photos') { go('overview'); setTimeout(() => { if (open === 'photos') reportTab = 'photos'; else if (typeof setTasksOpen === 'function') setTasksOpen(true); if (open === 'photos') render(); }, 60); return; }
  go(p.view);
  if (p.el && (open === 'scan-meds' || open === 'scan-papers')) setTimeout(() => document.querySelector(p.el)?.click(), 60);
}
/* Goes to the page the thing is on, softly lights up its row and says how to get there next time. */
function adaWhere(t) {
  closeAda(true);
  if (t.photos) { go('overview'); reportTab = 'photos'; render(); setTimeout(() => adaTip('', t.path), 80); return; }
  if (t.tasks) { go('overview'); setTimeout(() => { if (typeof setTasksOpen === 'function') setTasksOpen(true); setTimeout(() => adaTip(t.el, t.path), 380); }, 40); return; }
  go(t.view);
  setTimeout(() => adaTip(t.el, t.path, t.contact && t.contact.name), 80);
}
function adaTip(selector, path, text) {
  document.querySelector('.ada-tip')?.remove(); document.querySelectorAll('.ada-glow').forEach(n => n.classList.remove('ada-glow'));
  let el = null;
  try { el = selector ? [...document.querySelectorAll(selector)].find(n => n.offsetParent) : null; } catch { el = null; }
  if (!el && text) el = [...document.querySelectorAll('.people-list summary,.doc-list strong')].find(n => n.textContent.trim().toLowerCase() === String(text).toLowerCase());
  if (el) { const row = el.closest('li,details,.settings-row,.plus-row') || el; row.classList.add('ada-glow'); row.scrollIntoView({ block: 'center', behavior: 'smooth' }); setTimeout(() => row.classList.remove('ada-glow'), 6000); }
  const tip = document.createElement('div'); tip.className = 'ada-tip'; tip.setAttribute('role', 'status');
  tip.innerHTML = `<span class="ada-av">${adaFace()}</span><span><b>${el ? 'Here it is.' : 'It’s on this page.'}</b> Next time: ${esc(path)}.</span><button aria-label="Close">×</button>`;
  document.body.appendChild(tip); setTimeout(() => tip.classList.add('in'), 20);
  const bye = () => { tip.classList.remove('in'); setTimeout(() => tip.remove(), 300); };
  tip.querySelector('button').onclick = bye; setTimeout(bye, 7000);
}

/* ---- The mic: the phone's own speech-to-text, free. Where the browser has none, the keyboard's mic works the same. ---- */
let adaRec = null;
function adaStopMic() { if (adaRec) { try { adaRec.stop(); } catch {} } adaRec = null; ada.listening = false; }
function adaMic() {
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (ada.listening) { adaStopMic(); adaPaint(true); return; }
  if (!R) { document.getElementById('ada-input')?.focus(); toast('Tap the microphone on your keyboard to talk.'); return; }
  const rec = new R(); adaRec = rec; rec.lang = navigator.language || 'en-US'; rec.interimResults = true; rec.maxAlternatives = 1;
  let said = '';
  rec.onresult = e => { said = [...e.results].map(x => x[0].transcript).join(' '); const i = document.getElementById('ada-input'); if (i) { i.value = said; adaSendShown(); } };
  rec.onend = () => { const was = ada.listening; ada.listening = false; adaRec = null; if (!ada.open) return; adaPaint(true); if (was && said.trim()) { const i = document.getElementById('ada-input'); if (i) i.value = ''; adaAsk(said); } };
  rec.onerror = () => { ada.listening = false; adaRec = null; if (ada.open) adaPaint(true); };
  try { rec.start(); ada.listening = true; adaPaint(true); } catch { ada.listening = false; toast('Tap the microphone on your keyboard to talk.'); }
}
/* The camera: every photo in Adltrack is live and taken in its own screen, so Ada asks what it's of and opens that screen. */
function adaCamera() {
  const opts = [['scan-meds', 'A medication bottle or pharmacy paper'], ['scan-papers', 'Discharge papers'], ['document-add', 'A document or card'], ['vitals', 'A blood pressure or temperature reading'], ['activity-new', 'Something done for the patient']].filter(([k]) => ADA_PLACES[k].may());
  ada.log.push({ who: 'ada', text: 'What’s the photo of? I’ll open the right camera.', cards: [], picks: opts });
  ada.log[ada.log.length - 1].cards = opts.map(([open]) => ({ type: 'place', open }));
  adaPaint();
}

/* ---- Taps ---- */
window.addEventListener('click', e => {
  if (e.target.closest('#help-fab')) { e.stopImmediatePropagation(); e.preventDefault(); openAda(); }
}, true);
document.addEventListener('click', e => {
  const pop = document.querySelector('.ada-pop'); if (!pop || !pop.contains(e.target)) return;
  if (e.target === pop || e.target.closest('.ada-x')) { closeAda(); return; }
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.adaSay) { adaAsk(b.dataset.adaSay); return; }
  if (b.hasAttribute('data-ada-help')) { closeAda(true); openHelp(); return; }
  if (b.hasAttribute('data-ada-me')) { ada.edit = !ada.edit; ada.look = adaLookKey(); adaPaint(); return; }
  if (b.dataset.adaLook) { pop.querySelectorAll('.ada-look').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); }); ada.look = b.dataset.adaLook; pop.querySelector('.ada-av-big').innerHTML = adaFace(ada.look); return; }
  if (b.classList.contains('ada-save')) { const name = (document.getElementById('ada-name')?.value || '').trim().slice(0, 20); profile.assistant = { name: name && name !== ADA_DEFAULT ? name : '', look: ada.look || adaLookKey() }; if (typeof saveProfile === 'function' && !saveProfile()) toast('Browser storage is unavailable.'); ada.edit = false; adaPaint(); if (typeof placeHelp === 'function') placeHelp(); toast(`Saved. Say hi to ${adaName()}.`); return; }
  if (b.hasAttribute('data-ada-cancel')) { ada.edit = false; adaPaint(); return; }
  if (b.hasAttribute('data-ada-mic')) { adaMic(); return; }
  if (b.hasAttribute('data-ada-camera')) { adaCamera(); return; }
  if (b.dataset.adaOpen !== undefined && ada.things && ada.things[b.dataset.adaOpen]) { adaOpen(ada.things[b.dataset.adaOpen]); return; }
  if (b.dataset.adaWhere !== undefined && ada.things && ada.things[b.dataset.adaWhere]) { adaWhere(ada.things[b.dataset.adaWhere]); return; }
  if (b.dataset.adaGo) { adaGoPlace(b.dataset.adaGo); return; }
  if (b.dataset.adaWherePlace) { const p = ADA_PLACES[b.dataset.adaWherePlace]; if (p) adaWhere(p); return; }
  if (b.dataset.adaForm !== undefined && ada.forms && ada.forms[b.dataset.adaForm]) { const f = ada.forms[b.dataset.adaForm]; closeAda(true); plusDraft = { ...f.draft, photos: [], busy: false }; go(f.form); return; }
});
document.addEventListener('submit', e => { if (e.target.id !== 'ada-form') return; e.preventDefault(); const i = document.getElementById('ada-input'); const v = i.value; i.value = ''; adaSendShown(); adaAsk(v); });
document.addEventListener('input', e => { if (e.target.id === 'ada-input') adaSendShown(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.querySelector('.ada-pop')) closeAda(); }, true);

/* The round button (its look unchanged) now says who it opens, and hides while Ada is open. */
if (typeof placeHelp === 'function') {
  const placeHelpBeforeAda = placeHelp;
  placeHelp = function () { placeHelpBeforeAda(); const b = document.getElementById('help-fab'); if (!b) return; if (document.querySelector('.ada-pop')) b.hidden = true; if (!b.hidden) b.setAttribute('aria-label', `Talk to ${adaName()}`); };
  placeHelp();
}
}
