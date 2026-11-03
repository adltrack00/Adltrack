/* The assistant ("Ada" until the person renames her). It opens from the round chat button at the bottom right that every
   section already has (help.js), in the same pop-up frame, and the section's own help stays one tap away ("How this page works").
   Ada does things for people right in the chat: adds a medication from a live photo of its label (then asks the times), saves a
   document from live photos or its file, sets reminders and planned tasks, adds appointments, writes down vital signs (typed or
   read from a photo of the monitor), marks doses, and adds what was done, symptoms and incidents to the daily report. She asks
   what's missing one question at a time, then shows a Ready to save card; nothing is saved until the person taps Save, and then
   it's saved the same way the app's own forms save it, with the same permissions (checked on the server too).
   Cheapest first: finding things by name, "Show me where", the usual requests and every medical question are worked out here in
   the app, free. Only what that can't understand goes to /api/assistant (Claude Haiku 5.5, a fraction of a cent), which says
   which task it is and what was said; no photos are sent to it. Ada never gives medical advice: she points to the doctor, the
   pharmacy and 911. Her name and look are each person's own (profile.assistant), picked by tapping her picture. */
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
const ADA_MEDICAL = /\b(should (i|we|she|he|they)\b(?!.*\b(add|save|scan|set|remind|book)\b)|is (it|this|that) (safe|ok|okay|normal|bad|serious|dangerous)|safe to|can (i|we|she|he) (take|give|have|mix|stop|skip|double|crush|split|drink)|side effects?|interact|overdose|double (the |a |her |his )?dose|missed (a |her |his |the )?(\d+\s*(am|pm) )?dose\b.*(\?|\b(what|should|can|now)\b)|how (much|many) (should|can|do|to)|what (does|do|could) .{1,40} mean|diagnos|is (she|he) (dying|ok|okay)|why (is|does|do) (she|he|my|her|his)|treat(ment)? for|cure|what (medicine|medication|drug) (should|for|to))/i;
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
  const gave = s.match(/\b(gave|given|took|taken|skipped|skip|missed)\b/i);
  if (gave && !/\?\s*$/.test(s)) { const m = adaFind(s, list).find(t => t.kind === 'med'); if (m) return { kind: 'dose', med_id: m.id, mark: /skip|missed/i.test(gave[1]) ? 'skipped' : 'taken', slot: adaTimes(s).find(t => (m.item.times || []).includes(t)) || '' }; }
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
/* ---- Small readers for what people type while Ada does a task for them (free, in the app) ---- */
/* Times in plain words: "8am and 8pm", "8:30 and 20:00", "morning and bedtime" → ['08:00', '20:00']. A bare hour is read the way
   people mean it at home: 7 to 11 in the morning, 1 to 6 in the afternoon. */
function adaTimes(text) {
  const s = String(text || '').toLowerCase().replace(/\b(\d+)\s*(times?|x|hours?|hrs?|mg|ml|days?|pills?|tablets?|capsules?|puffs?|drops?|weeks?)\b/g, ' ');
  const out = [], add = (h, m) => { if (h >= 0 && h < 24 && m >= 0 && m < 60) out.push(String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0')); };
  for (const x of s.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|o.?clock)?(?![\d/.])/g)) {
    let h = Number(x[1]); const m = Number(x[2] || 0), ap = (x[3] || '')[0];
    if (h > 23 || (ap && ap !== 'o' && (h < 1 || h > 12))) continue;
    if (ap === 'p' && h < 12) h += 12; else if (ap === 'a' && h === 12) h = 0; else if ((!ap || ap === 'o') && !x[2] && h >= 1 && h <= 6) h += 12;
    add(h, m);
  }
  for (const [re, t] of [[/\bmorning|breakfast\b/, '08:00'], [/\bnoon|lunch\b/, '12:00'], [/\bafternoon\b/, '14:00'], [/\bevening|dinner|supper\b/, '18:00'], [/\b(bed ?time|night)\b/, '21:00']]) if (re.test(s)) out.push(t);
  return [...new Set(out)].sort();
}
/* The usual times for "twice a day" and the like, offered as one tap. */
const adaSuggestTimes = n => ({ 1: ['08:00'], 2: ['08:00', '20:00'], 3: ['08:00', '14:00', '20:00'], 4: ['08:00', '12:00', '16:00', '20:00'] })[n] || [];
/* Which Documents category a paper's name points to, or '' to ask. */
function adaDocCategory(name) {
  const s = String(name || '').toLowerCase();
  for (const [k, re] of [['discharge', /discharge/], ['insurance', /insurance|medicare|medicaid|\bhmo\b|\bppo\b|policy|member|benefit|\bcard\b/], ['prescriptions', /prescription|\brx\b|pharmacy|refill/], ['results', /result|\blab|blood ?work|x-?ray|\bmri\b|\bct\b|scan|test|ekg|ecg|biopsy/], ['visits', /visit|doctor|summary|referral|after ?care|appointment|clinic/], ['legal', /\bid\b|licen[cs]e|passport|power of attorney|\bpoa\b|\bdnr\b|polst|will\b|advance directive|social security|birth/]]) if (re.test(s)) return k;
  return '';
}
/* Vital signs from what someone says: "BP 128 over 82, pulse 70, temp 99.1, pain 3". Only numbers a monitor could show. */
function adaVitalsFrom(text) {
  const s = String(text || '').toLowerCase(), v = {}, inR = (x, lo, hi) => Number.isFinite(x) && x >= lo && x <= hi;
  const bp = s.match(/\b(\d{2,3})\s*(?:\/|over)\s*(\d{2,3})\b/);
  if (bp && inR(+bp[1], 50, 300) && inR(+bp[2], 20, 200)) { v.sys = String(+bp[1]); v.dia = String(+bp[2]); }
  const pulse = s.match(/\b(?:pulse|heart ?rate|heart|hr|bpm)\D{0,12}(\d{2,3})\b|\b(\d{2,3})\s*bpm\b/);
  if (pulse && inR(+(pulse[1] || pulse[2]), 20, 250)) v.pulse = String(+(pulse[1] || pulse[2]));
  const temp = s.match(/\b(?:temp(?:erature)?|fever)\D{0,12}(\d{2,3}(?:\.\d+)?)|\b(\d{2,3}\.\d)\s*(?:°|degrees|f\b)/);
  if (temp && inR(+(temp[1] || temp[2]), 86, 113)) v.temp = String(Math.round(+(temp[1] || temp[2]) * 10) / 10);
  const pain = s.match(/\bpain\D{0,12}(\d{1,2})\b|\b(\d{1,2})\s*(?:\/|out of)\s*10\b/);
  if (pain && inR(+(pain[1] || pain[2]), 0, 10)) v.pain = String(+(pain[1] || pain[2]));
  return v;
}
if (typeof module !== 'undefined') module.exports = { ADA_LOOKS, adaFace, adaWords, adaFind, adaLocal, adaPlan, adaThings, ADA_PLACES, ADA_MEDICAL, adaTimes, adaSuggestTimes, adaDocCategory, adaVitalsFrom };

if (typeof document !== 'undefined') {
/* ---- The pop-up ---- */
let ada = { open: false, log: [], busy: false, edit: false, listening: false };
const adaFirst = () => (typeof myName === 'function' ? String(myName() || '').split(' ')[0] : '');
const ADA_SUGGEST = [['Add a medication', 'I’ll read the label from a live photo and ask the times.', 'Add a medication'], ['Save a document', '“Save her insurance card.” Take the photo right here.', 'Save a document'], ['Set a reminder', '“Remind me Friday at 10 to call the doctor.”', 'Set a reminder'], ['Write down vitals', '“BP 128 over 82, pulse 70.”', 'Write down vitals'], ['Find something', '“Show me her insurance card.” “Where are the refills?”', 'Where are the refills?']];
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
  if (c.type === 'place' && c.done) { const p = ADA_PLACES[c.open];
    return `<div class="ada-box ada-done-where"><span class="ada-tag">${esc(p.path)}</span><div class="ada-btns"><button class="ada-btn ada-btn-dark" data-ada-where-place="${esc(c.open)}">Show me where</button><button class="ada-btn" data-ada-go="${esc(c.open)}">Open it</button></div></div>`; }
  if (c.type === 'buttons') { const used = adaJobs[c.n] && adaJobs[c.n].used;
    return `<div class="ada-chips">${c.buttons.map(([l, a, dark]) => `<button class="ada-chip${dark ? ' ada-chip-dark' : ''}" data-ada-act="${esc(a)}" data-ada-taps="${c.n}"${used ? ' disabled' : ''}>${esc(l)}</button>`).join('')}</div>`; }
  if (c.type === 'ready') { const j = adaJobs[c.n]; if (!j) return ''; const v = x => typeof x === 'function' ? x() : x, photos = (v(j.photos) || []), pages = v(j.pages) || 0, rows = v(j.rows).filter(([, d]) => d);
    const state = { ready: 'Ready to save', busy: 'Saving…', done: 'Saved', stale: 'Not saved' }[j.state];
    return `<div class="ada-box ada-ready is-${j.state}"><span class="ada-tag">${esc(j.tag)} · ${state}</span>${photos.length || pages ? `<div class="ada-shots">${(photos.length ? photos : Array(pages).fill('')).map(src => src ? `<img src="${esc(src)}" alt="">` : '<span class="ada-doc ada-doc-pdf">PDF</span>').join('')}</div>` : ''}<b>${esc(v(j.title) || '')}</b>${rows.length ? `<dl>${rows.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join('')}</dl>` : ''}${j.state === 'ready' ? `<div class="ada-btns"><button class="ada-btn ada-btn-dark" data-ada-save="${c.n}">Save</button>${j.change ? `<button class="ada-btn" data-ada-change="${c.n}">Change</button>` : ''}${(j.more || []).map(([l, a]) => `<button class="ada-btn" data-ada-act="${esc(a)}">${esc(l)}</button>`).join('')}</div><button class="ada-link ada-cancel-job" data-ada-drop="${c.n}">Don’t save</button>` : j.state === 'busy' ? '<p class="ada-dots"><span></span><span></span><span></span></p>' : j.state === 'done' ? '<p class="ada-saved">✓ Saved for everyone on the care team</p>' : ''}</div>`; }
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
    return `<h2 class="ada-hi">Hi${adaFirst() ? ' ' + esc(adaFirst()) : ''}, I’m ${esc(adaName())}.</h2><p class="ada-intro">What can I do for you? Tell me in your own words, or talk. I can add medications and documents, set reminders, write down vitals and what happened, find things and show you where they are. You check it and tap Save.</p><ol class="ada-suggest">${ADA_SUGGEST.map(([h, p, say], n) => `<li><button data-ada-say="${esc(say)}"><i>${String(n + 1).padStart(2, '0')}</i><strong>${esc(h)}</strong><span>${esc(p)}</span></button></li>`).join('')}</ol><p class="ada-note">${esc(adaName())} doesn’t give medical advice. For that, call the doctor or the pharmacist. In an emergency, call 911.</p>${help ? `<button class="ada-link" data-ada-help>How this page works</button>` : ''}`; }
  return ada.log.map(m => m.who === 'me' ? (m.photo ? `<div class="ada-me ada-me-shot"><img src="${esc(m.photo)}" alt="Your photo"></div>` : `<div class="ada-me">${esc(m.text)}</div>`) : `<div class="ada-ai">${m.text ? `<div class="ada-who">${esc(adaName())}</div><p>${esc(m.text)}</p>` : ''}${(m.cards || []).map(adaCard).join('')}</div>`).join('') + (ada.busy ? `<div class="ada-ai"><div class="ada-who">${esc(adaName())}</div><p class="ada-dots"><span></span><span></span><span></span></p></div>` : '');
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
  const intro = { 'med-add': 'Sure. Add it here with a live photo of the bottle or the pharmacy paper. I’ll take you there.', 'scan-meds': 'Sure. Scan the bottle label or the pharmacy paper here.', 'scan-papers': 'Sure. Lay each page flat and take its picture here. They’re read and filed in Documents, and the medications on them are read for you to check.', 'document-add': 'Sure. Take a photo of each page, or pick the file, here.', 'appt-new': 'Sure. Fill in the doctor, the date and the time here.', 'task-new': 'Sure. Tell me what and when, like “every Monday at 9”, or fill it in here.', 'incident-new': 'I’m sorry. Report it here, with what happened and live photos. Everyone on the care team is told. If anyone is hurt badly, call 911.', 'symptom-new': 'Write down how they feel here, with photos if they help. For anything worrying, call the doctor.', vitals: 'Vital signs are in My Tasks. Tap one, then take a photo of the monitor or type the numbers.' }[open];
  adaSay(say || intro || 'Here it is.', [{ type: 'place', open }]);
}
function adaShowThings(things, say) {
  const base = ada.log.reduce((n, m) => n + (m.cards || []).length, 0);
  ada.things = ada.things || {};
  const cards = things.map((t, k) => { ada.things[base + k] = t; return { type: 'thing', t, n: base + k }; });
  adaSay(say || (things.length === 1 ? 'Here it is.' : 'I found these.'), cards);
}
/* The full form, filled in, for when someone wants to change more than Ada asked (repeating days, reminders, a photo). */
function adaForm(form, draft, say) {
  if (form === 'task-new' ? !mayAddTask() : !mayDo('meds')) return adaSay(ADA_NOT_ALLOWED);
  ada.forms = ada.forms || []; const n = ada.forms.push({ form, draft }) - 1;
  adaSay(say || 'I filled it in. Check it and tap Save.', [{ type: 'form', form, draft, n }]);
}
function adaMedical(say) { adaSay(say || `I can’t answer medical questions, so please ask the doctor or the pharmacist. In an emergency, call 911.`, [{ type: 'call' }]); }

/* ---- Doing it for them: Ada asks what's missing, one question at a time, takes the live photos right here, then shows a
   Ready to save card. Nothing is saved until the person taps Save, and it's saved exactly as the app's own forms save it
   (same records, same photo uploads, same permission checks on the server), so it shows in My Tasks, the report and Photos. */
let adaN = 0; const adaJobs = {};
const adaKeep = x => { const n = ++adaN; adaJobs[n] = x; return n; };
/* Taps to answer with: [label, what it does, dark?]. A set of taps works once. */
const adaTaps = (buttons) => ({ type: 'buttons', n: adaKeep({ used: false }), buttons });
const adaReady = job => ({ type: 'ready', n: adaKeep({ state: 'ready', ...job }) });
const adaClock = t => typeof clockText === 'function' ? clockText(t) : t;
const adaTimesText = ts => ts.length ? ts.map(adaClock).join(' and ') : '';
const adaNowParts = () => { const d = new Date(); return { date: today(), time: String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }; };
function adaAskNext(text, buttons) { adaSay(text, buttons && buttons.length ? [adaTaps(buttons)] : []); }
function adaStop(say) { ada.flow = null; adaSay(say || 'Okay, I stopped. Nothing was saved.'); }

/* Which task, from the app's own words or the AI's kind. */
function adaStart(kind, f = {}, say, text = '') {
  f = f || {};
  if (kind === 'medication') return adaStartMed(f, say);
  if (kind === 'document') return adaStartDoc(f, say, text);
  if (kind === 'vitals') return adaStartVitals(f, say);
  if (kind === 'dose') return adaStartDose(f, say);
  if (kind === 'activity' || kind === 'symptom' || kind === 'incident') return adaStartCare(kind, f, say);
  adaSay(say || 'I can help with that.');
}

/* A medication: a live photo of the label is read (the same reader as Scan), then Ada asks the times. Or typed in. */
function adaStartMed(f, say) {
  if (!mayDo('meds')) return adaSay(ADA_NOT_ALLOWED);
  ada.flow = { type: 'med', step: 'photo', p: { ...blankProduct(), ...(f.name ? { name: f.name } : {}) } };
  adaAskNext(say && !/\b(open|form|page|there)\b/i.test(say) ? say + ' Take a live photo of the label on the bottle and I’ll read it.' : 'Sure, I’ll add it. Take a live photo of the label on the bottle, the side with the directions, and I’ll read it.', [['Take a photo of the label', 'photo:med', true], ['Type it instead', 'med-typed']]);
}
async function adaMedPhoto(src) {
  const fl = ada.flow; if (!fl || fl.type !== 'med') return;
  if (fl.step === 'bottle') { fl.p.photo = src; fl.p.labelPhotos = [src]; return adaMedReady(); }
  ada.busy = true; adaPaint();
  let r = {}; try { r = await Account.api('POST', '/api/label/read', { photos: [src], med: null }); } catch (err) { r = { error: err.message }; }
  ada.busy = false; if (ada.flow !== fl) return;
  if (!r.label) return adaAskNext(r.error || (typeof LABEL_FAILED === 'object' && LABEL_FAILED[r.reason]) || 'I couldn’t read this label.' + ' Try another photo with the label flat and in good light, or type it in.', [['Take another photo', 'photo:med', true], ['Type it instead', 'med-typed']]);
  const p = { ...fl.p, labelPhotos: [src], photo: src }; applyLabel(p, r.label, []); p.scanned = !!(p.name || p.instructions); fl.p = p;
  if (!p.name) { fl.step = 'name'; return adaAskNext('I couldn’t read the name. What is it called, with the strength, as on the label?'); }
  if (!howText(p)) { fl.step = 'how'; return adaAskNext(`I read ${p.name}, but not how it’s taken. Type it as the label says, like “Take 1 tablet twice a day”.`); }
  adaMedTimes(`I read it: ${p.name}. “${howText(p)}”.`);
}
function adaMedTimes(lead) {
  const fl = ada.flow, n = dosesPerDay(fl.p);
  if (n === 0) { fl.p.slots = []; return adaMedReady(lead); }
  fl.step = 'times';
  const said = adaTimes(howText(fl.p)), sug = said.length && (n == null || said.length === n) ? said : adaSuggestTimes(n), taps = [];
  if (sug.length) taps.push([adaTimesText(sug), 'times:' + sug.join(','), true]);
  taps.push(['Only when needed', 'times:asneeded']);
  adaAskNext(`${lead ? lead + ' ' : ''}What time${n === 1 ? '' : 's'} should it be given? Tell me, like “${n === 1 ? '9 pm' : '8 am and 8 pm'}”${sug.length ? `, or tap ${said.length ? 'the time on the label' : 'the usual time' + (sug.length > 1 ? 's' : '')}` : ''}.`, taps);
}
function adaMedSetTimes(ts, asNeeded) {
  const fl = ada.flow; if (!fl || fl.type !== 'med') return;
  fl.p.slots = asNeeded ? [] : ts; fl.asNeeded = !!asNeeded;
  if (!fl.p.photo) { fl.step = 'bottle'; return adaAskNext('Last thing: a live photo of the bottle, so everyone knows it’s the right one.', [['Take a photo of the bottle', 'photo:med', true], ['No bottle yet', 'med-nobottle']]); }
  adaMedReady();
}
function adaMedReady(lead) {
  const fl = ada.flow, p = fl.p, times = pickedTimes(p);
  fl.step = 'ready';
  adaSay(lead ? lead + ' Check it against the bottle and tap Save.' : 'Here it is. Check it against the bottle and tap Save.', [adaReady({
    tag: 'Medication', title: p.name, photos: () => p.photo ? [p.photo] : [],
    rows: () => [['How', howText(p)], ['Times', fl.asNeeded || dosesPerDay(p) === 0 ? 'Only when needed' : adaTimesText(times) || 'No times yet'], ['Pharmacy', p.pharmacy && p.pharmacy.name], ['Doctor', p.prescriber && p.prescriber.name], ['Refills', p.refills != null && p.refills !== '' ? String(p.refills) : '']],
    place: 'purchases',
    save: async () => {
      const { labelReading, labelNote, scanned, fixing, ...i } = p, day = today();
      const med = { ...i, med: true, id: crypto.randomUUID(), purchaseId: crypto.randomUUID(), name: p.name.trim(), times, asNeeded: !!fl.asNeeded || dosesPerDay(p) === 0, pickup: !!p.noBottle, price: 0, retailer: '', purchased: day, delivered: '', channel: 'store', basis: 'purchase', window: 30, outcome: 'unknown', requirement: 'unknown', confirmed: !!p.photo, url: '', next: 'Take it as written on the bottle label.', status: 'deciding', intent: 'return', doses: [], policySource: p.label ? 'From the bottle label' : 'Entered by you' };
      items.push(med); settings.daily = true;
      return { say: `${med.name} is saved.${times.length ? ` It’s in My Tasks at ${adaTimesText(times)}.` : ''}`, place: 'purchases' };
    }
  })]);
}

/* A document: live photos of each page, or the file, then its name; the category is guessed from the name or asked. */
function adaStartDoc(f, say, text) {
  if (!mayDo('meds')) return adaSay(ADA_NOT_ALLOWED);
  const guess = f.category || adaDocCategory(f.name || text);
  ada.flow = { type: 'doc', step: 'pages', name: f.name || '', category: guess, files: [] };
  adaAskNext(`Sure, I’ll save it in Documents. Take a live photo of ${f.name ? 'the ' + f.name.toLowerCase() : 'it'}, one page at a time, or choose the file.`, [['Take a photo', 'photo:doc', true], ['Choose a file', 'file:doc']]);
}
function adaDocPage(file) {
  const fl = ada.flow; if (!fl || fl.type !== 'doc') return;
  if (fl.files.length >= DOC_PAGES) return adaSay(`That’s the most for one document (${DOC_PAGES} pages).`);
  fl.files.push(file);
  if (fl.step === 'ready') { adaPaint(true); return; }
  adaDocNext();
}
function adaDocNext() {
  const fl = ada.flow;
  if (!fl.name) { fl.step = 'name'; return adaAskNext(`Got it${fl.files.length > 1 ? `, ${fl.files.length} pages` : ''}. What is it? For example: “Medicare card”.`, [['Add another page', 'photo:doc']]); }
  if (!fl.category) { fl.step = 'category'; return adaAskNext('Which part of Documents should it go in?', DOC_CATEGORIES.map(([k, l]) => [l, 'cat:' + k])); }
  fl.step = 'ready';
  adaSay('Ready. Tap Save and I’ll file it.', [adaReady({
    tag: 'Document', title: () => fl.name, photos: () => fl.files.map(x => /^image\//.test(x.type) ? x.data : ''), pages: () => fl.files.length,
    rows: () => [['Goes in', docCategoryName(fl.category)], ['Pages', String(fl.files.length)]],
    more: [['Add another page', 'photo:doc']], place: 'documents',
    save: async () => {
      const files = await Promise.all(fl.files.map(x => Account.api('POST', '/api/files/document', { data: x.data })));
      const doc = { id: crypto.randomUUID(), doc: true, name: fl.name.trim(), category: docCategory(fl.category), files: files.map(r => ({ url: r.url, type: r.type })), addedAt: new Date().toISOString() };
      items.push(doc); docFilter = 'all';
      return { say: `Saved “${doc.name}” in ${docCategoryName(doc.category)}.`, place: 'documents' };
    }
  })]);
}

/* A planned task or reminder, and an appointment: saved straight from the chat. "Change" opens the full form, filled in. */
function adaTaskReady(t, say) {
  if (!mayAddTask()) return adaSay(ADA_NOT_ALLOWED);
  const d = { ...blankTaskDraft(), what: t.what || '', note: t.note || '', date: t.date || today(), time: t.time || '', repeat: t.repeat || 'once' };
  if (!d.what.trim()) { ada.flow = { type: 'task', step: 'what', d }; return adaAskNext('What should the reminder say?'); }
  if (!d.time) { ada.flow = { type: 'task', step: 'time', d }; return adaAskNext(`What time should I remind the care team to ${d.what.charAt(0).toLowerCase() + d.what.slice(1)}?`); }
  const problem = taskProblem(d);
  if (problem) return adaForm('task-new', d, problem + ' I filled in the rest for you.');
  ada.flow = null;
  adaSay(say && !/\b(check|form)\b/i.test(say) ? say : 'Here it is. Tap Save and it goes in My Tasks.', [adaReady({
    tag: 'Planned task', title: d.what, rows: () => [['When', repeatText(d)], ['Note', d.note]], change: { form: 'task-new', draft: d }, place: 'planned-tasks',
    save: async () => {
      const by = markedBy(), task = { id: crypto.randomUUID(), task: true, name: d.what.trim(), ...(d.note.trim() ? { note: d.note.trim() } : {}), date: d.date, time: d.time, repeat: d.repeat, ...(d.repeat !== 'once' ? { until: d.until } : {}), ...(by ? { by } : {}), addedAt: new Date().toISOString(), marks: [] };
      items.push(task);
      return { say: `Added to My Tasks: ${repeatText(task)}.`, place: 'planned-tasks' };
    }
  })]);
}
function adaApptReady(a, say) {
  if (!mayDo('meds')) return adaSay(ADA_NOT_ALLOWED);
  const d = { ...blankApptDraft(), with: a.with || '', place: a.place || '', date: a.date || '', time: a.time || '', note: a.note || '' };
  if (!d.with.trim()) { ada.flow = { type: 'appt', step: 'with', d }; return adaAskNext('Who is the appointment with?'); }
  const problem = apptProblem(d);
  if (problem) return adaForm('appt-new', d, problem + ' I filled in the rest for you.');
  ada.flow = null;
  const when = [adaDay(d.date), d.time && adaClock(d.time)].filter(Boolean).join(' at ');
  adaSay(say && !/\b(check|form)\b/i.test(say) ? say : 'Here it is. Tap Save and it goes in Appointments.', [adaReady({
    tag: 'Appointment', title: 'Follow-up visit with ' + d.with, rows: () => [['When', when], ['Where', d.place], ['Note', d.note]], change: { form: 'appt-new', draft: d }, place: 'appointments',
    save: async () => {
      const appt = { ...newAppt({ with: d.with.trim(), place: d.place.trim(), date: d.date, time: d.time, phone: '', note: d.note.trim() }), status: 'deciding', confirmed: true };
      items.push(appt);
      return { say: `Appointment added for ${apptDay(appt)}.` + apptReminds(appt), place: 'appointments' };
    }
  })]);
}

/* Vital signs: the numbers as said, or a live photo of the monitor read for them. Each one is saved on its own, as in My Tasks. */
const ADA_VITALS = [['bp', 'Blood pressure', v => v.sys && v.dia ? v.sys + '/' + v.dia : ''], ['heart', 'Heart rate', v => v.pulse || ''], ['temp', 'Temperature', v => v.temp ? v.temp + '°' : ''], ['pain', 'Pain level', v => v.pain ? v.pain + '/10' : '']];
function adaStartVitals(f, say) {
  if (!mayDo('tasks')) return adaSay(ADA_NOT_ALLOWED);
  const v = Object.fromEntries(['sys', 'dia', 'pulse', 'temp', 'pain'].filter(k => f[k]).map(k => [k, String(f[k])]));
  ada.flow = { type: 'vitals', step: 'numbers', v, photos: [] };
  if (ADA_VITALS.some(([, , show]) => show(v))) return adaVitalsReady();
  adaAskNext('Tell me the numbers, like “BP 128 over 82, pulse 70”, or take a photo of the monitor and I’ll read it.', [['Take a photo of the monitor', 'photo:vitals', true]]);
}
async function adaVitalsPhoto(src) {
  const fl = ada.flow; if (!fl || fl.type !== 'vitals') return;
  fl.photos.push(src); ada.busy = true; adaPaint();
  let r = null; try { r = await Account.api('POST', '/api/vitals/read', { photo: src }); } catch {}
  ada.busy = false; if (ada.flow !== fl) return;
  const got = r && r.reading || {};
  for (const k of ['sys', 'dia', 'pulse', 'temp']) if (got[k]) fl.v[k] = String(got[k]);
  if (fl.step === 'ready') { adaPaint(true); return; }
  if (ADA_VITALS.some(([, , show]) => show(fl.v))) return adaVitalsReady('I read the numbers on the photo.');
  adaAskNext(((typeof VITALS_UNREAD === 'object' && VITALS_UNREAD[got.problem]) || 'I couldn’t read the numbers on the photo.').replace(/ Type the numbers in.*$/, '') + ' Tell me the numbers instead, like “BP 128 over 82”.');
}
function adaVitalsReady(lead) {
  const fl = ada.flow; fl.step = 'ready';
  adaSay((lead ? lead + ' ' : '') + 'Check the numbers and tap Save.', [adaReady({
    tag: 'Vital signs', title: 'Vital signs', photos: () => fl.photos, more: [['Add a photo', 'photo:vitals']], place: 'vitals',
    rows: () => ADA_VITALS.map(([, name, show]) => [name, show(fl.v)]),
    save: async () => {
      const photos = (await Promise.all(fl.photos.map(saveProof))).filter(Boolean), by = markedBy(), at = new Date().toISOString(), log = [];
      const saved = ADA_VITALS.filter(([, , show]) => show(fl.v));
      saved.forEach(([k], n) => { const val = k === 'bp' ? fl.v.sys + '/' + fl.v.dia : fl.v[k === 'heart' ? 'pulse' : k]; settings.vitals = { ...(settings.vitals || {}), [k]: val, at }; log.push({ [k]: val, at, ...(n === 0 && photos.length ? { photos } : {}), ...(by ? { by } : {}) }); });
      settings.vitalsLog = [...(settings.vitalsLog || []), ...log].slice(-60);
      return { say: `${saved.map(([, name]) => name).join(', ').replace(/, ([^,]*)$/, ' and $1')} saved.`, place: 'vitals' };
    }
  })]);
}

/* A dose given or skipped: which medication, which time, taken or skipped. */
const adaTodayMeds = () => items.filter(i => i.med && !i.demo && i.status !== 'received');
function adaStartDose(f, say) {
  if (!mayDo('tasks')) return adaSay(ADA_NOT_ALLOWED);
  ada.flow = { type: 'dose', step: 'med', med: f.med_id || '', slot: f.slot || '', mark: f.mark || '', note: f.note || '' };
  adaDoseNext(say);
}
function adaDoseNext(say) {
  const fl = ada.flow, med = fl.med && find(fl.med);
  if (!med) { const meds = adaTodayMeds(); if (!meds.length) return adaStop('There are no medications in the app yet.'); fl.step = 'med'; return adaAskNext('Which medication?', meds.slice(0, 8).map(m => [m.name, 'dose-med:' + m.id])); }
  const times = med.times || [];
  if (!fl.slot && times.length === 1) fl.slot = times[0];
  if (!fl.slot && times.length > 1) { fl.step = 'slot'; return adaAskNext(`Which dose of ${med.name}?`, times.map(t => [adaClock(t), 'dose-slot:' + t])); }
  if (!fl.mark) { fl.step = 'mark'; return adaAskNext(`Was the ${fl.slot ? adaClock(fl.slot) + ' ' : ''}dose of ${med.name} taken or skipped?`, [['Taken', 'dose-mark:taken', true], ['Skipped', 'dose-mark:skipped']]); }
  const day = today(), done = (med.doses || []).find(d => (d.day || String(d.at || '').slice(0, 10)) === day && (d.slot || '') === (fl.slot || '') && fl.slot);
  if (done) return adaStop(`The ${adaClock(fl.slot)} dose of ${med.name} is already marked ${done.kind} today${done.by ? ' by ' + done.by : ''}.`);
  fl.step = 'ready';
  adaSay(say && !/\b(check|form|open)\b/i.test(say) ? say : 'Tap Save and I’ll mark it.', [adaReady({
    tag: 'Dose', title: med.name, photos: () => med.photo ? [med.photo] : [], rows: () => [['Time', fl.slot ? adaClock(fl.slot) : 'Now'], ['Marked', fl.mark === 'taken' ? 'Taken' : 'Skipped'], ['Note', fl.note]], place: 'tasks',
    save: async () => {
      const m = find(med.id); if (!m) throw Error('That medication isn’t in the app anymore.');
      m.doses = [...(m.doses || []), { at: new Date().toISOString(), day: today(), kind: fl.mark, ...(fl.slot ? { slot: fl.slot } : {}), ...(markedBy() ? { by: markedBy() } : {}), ...(fl.note.trim() ? { note: fl.note.trim() } : {}) }].slice(-200);
      return { say: fl.mark === 'taken' ? `Marked taken: ${med.name}.` : `Marked skipped: ${med.name}. Don’t give an extra dose to make up for it unless the papers or the pharmacist say so.`, place: 'tasks' };
    }
  })]);
}

/* Something done now, symptoms, or an incident: what happened in their words, optional live photos, then into the report. */
const ADA_CARE = {
  activity: { ask: 'What was done? For example: “a bath and fresh clothes”.', tag: 'Something done now', place: 'home', photoFor: 'activity' },
  symptom: { ask: 'How are they feeling? Write it in their words.', tag: 'Symptoms', place: 'home', photoFor: 'symptom' },
  incident: { ask: 'What happened, in a few words?', tag: 'Incident', place: 'home', photoFor: 'incident' }
};
function adaIncidentKind(s) { s = String(s || '').toLowerCase(); return /\b(fell|fall|fallen|slipped|tripped)\b/.test(s) ? 'fall' : /\b(refused?|won.?t take|wouldn.?t take|spat)\b/.test(s) ? 'refused' : /\b(injur|hurt|bruise|cut|bleed|burn)/.test(s) ? 'injury' : /\b(agitated|angry|aggressive|confused|wander|yell|hit)/.test(s) ? 'behaviour' : ''; }
function adaStartCare(kind, f, say) {
  if (!mayReport()) return adaSay(ADA_NOT_ALLOWED);
  ada.flow = { type: kind, step: 'note', note: f.note || '', incident: f.incident || '', witnesses: f.witnesses || '', photos: f.photos || [], ...adaNowParts() };
  adaCareNext(kind === 'incident' ? 'I’m sorry. I’ll report it, and everyone on the care team is told. If anyone is hurt badly, call 911.' : '');
}
function adaCareNext(lead) {
  const fl = ada.flow, c = ADA_CARE[fl.type];
  if (fl.type === 'incident' && !fl.incident) { fl.step = 'kind'; return adaAskNext((lead ? lead + ' ' : '') + 'What happened?', INCIDENTS.map(([k, l]) => [l, 'incident:' + k])); }
  if (!fl.note.trim() && fl.type !== 'incident') { fl.step = 'note'; return adaAskNext((lead ? lead + ' ' : '') + c.ask); }
  if (!fl.note.trim() && !fl.askedNote) { fl.askedNote = true; fl.step = 'note'; return adaAskNext((lead ? lead + ' ' : '') + c.ask, [['Skip', 'care-skip']]); }
  fl.step = 'ready';
  const kindName = () => (INCIDENTS.find(([k]) => k === fl.incident) || [])[1];
  adaSay((lead ? lead + ' ' : '') + 'Add a live photo if it helps, then tap Save. It goes in today’s report.', [adaReady({
    tag: c.tag, title: () => fl.type === 'incident' ? kindName() : fl.type === 'symptom' ? 'Symptoms' : fl.note, photos: () => fl.photos,
    rows: () => [['When', 'Today at ' + adaClock(fl.time)], [fl.type === 'activity' ? 'Note' : 'What happened', fl.type === 'activity' ? '' : fl.note], ['Witnesses', fl.witnesses]],
    more: fl.photos.length < PLUS_PHOTOS ? [['Add a photo', 'photo:care']] : [], place: 'home',
    save: async () => {
      const photos = (await uploadPlus(fl.photos, fl.type)).filter(Boolean), by = markedBy(), at = new Date(fl.date + 'T' + fl.time).toISOString(), added = new Date().toISOString(), base = { id: crypto.randomUUID(), at, ...(photos.length ? { photos } : {}), ...(by ? { by } : {}), addedAt: added };
      if (fl.type === 'activity') items.push({ ...base, activity: true, name: fl.note.trim() });
      if (fl.type === 'symptom') items.push({ ...base, symptom: true, name: 'Symptoms', note: fl.note.trim() });
      if (fl.type === 'incident') items.push({ ...base, incident: true, kind: fl.incident, name: kindName(), ...(fl.note.trim() ? { note: fl.note.trim() } : {}), ...(fl.witnesses.trim() ? { witnesses: fl.witnesses.split(',').map(w => w.trim()).filter(Boolean).join(', ') } : {}) });
      reportTab = 'today';
      return { say: fl.type === 'incident' ? 'Incident reported. Everyone on the care team is told, and it’s in today’s report.' : fl.type === 'symptom' ? 'Symptoms added to today’s report.' : 'Added to today’s report.', place: 'home' };
    }
  })]);
}

/* What someone types while Ada is waiting on an answer. True when it was the answer. */
function adaFlowText(s) {
  const fl = ada.flow; if (!fl) return false;
  if (/^(cancel|stop|never ?mind|no thanks|forget it|don.?t save)\b/i.test(s)) { adaStop(); return true; }
  if (fl.type === 'med') {
    if (fl.step === 'name') { fl.p.name = s.slice(0, 100); if (!howText(fl.p)) { fl.step = 'how'; adaAskNext('How is it taken? Type it as the label says, like “Take 1 tablet twice a day”.'); } else adaMedTimes(); return true; }
    if (fl.step === 'how') { fl.p.instructions = s.slice(0, 600); adaMedTimes(); return true; }
    if (fl.step === 'times') { if (/\b(as needed|when needed|if needed|prn|only when)\b/i.test(s)) { adaMedSetTimes([], true); return true; } const ts = adaTimes(s); if (!ts.length) { adaAskNext('I didn’t catch a time. Try like “8 am and 8 pm”.'); return true; } adaMedSetTimes(ts); return true; }
    if (fl.step === 'ready' && /^(yes|save|ok|okay|looks good|correct)\b/i.test(s)) { adaAskNext('Tap Save on the card above and I’ll save it.'); return true; }
  }
  if (fl.type === 'doc') {
    if (fl.step === 'name') { fl.name = s.slice(0, 120); fl.category = fl.category || adaDocCategory(s); adaDocNext(); return true; }
    if (fl.step === 'category') { const k = DOC_CATEGORIES.find(([, l]) => l.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(l.toLowerCase().split(' ')[0]))?.[0] || adaDocCategory(s); if (!k) { adaAskNext('Tap the part of Documents it goes in.', DOC_CATEGORIES.map(([k2, l]) => [l, 'cat:' + k2])); return true; } fl.category = k; adaDocNext(); return true; }
  }
  if (fl.type === 'task') {
    if (fl.step === 'what') { fl.d.what = s.slice(0, 100); adaTaskReady(fl.d); return true; }
    if (fl.step === 'time') { const ts = adaTimes(s); if (!ts.length) { adaAskNext('I didn’t catch the time. Try like “10 am”.'); return true; } fl.d.time = ts[0]; if (/\btomorrow\b/i.test(s)) fl.d.date = C.shift(today(), 1); if (/\bevery ?day|daily\b/i.test(s)) fl.d.repeat = 'daily'; adaTaskReady(fl.d); return true; }
  }
  if (fl.type === 'appt' && fl.step === 'with') { fl.d.with = s.slice(0, 100); adaApptReady(fl.d); return true; }
  if (fl.type === 'vitals' && fl.step !== 'ready') { const v = adaVitalsFrom(s); if (!Object.keys(v).length) { adaAskNext('I didn’t catch a number. Try like “BP 128 over 82” or “temp 99.1”.', [['Take a photo of the monitor', 'photo:vitals', true]]); return true; } Object.assign(fl.v, v); adaVitalsReady(); return true; }
  if (ADA_CARE[fl.type] && fl.step === 'note') { fl.note = s.slice(0, 500); if (fl.type === 'incident' && !fl.incident) fl.incident = adaIncidentKind(s); adaCareNext(); return true; }
  return false;
}

async function adaAsk(text) {
  const s = String(text || '').trim(); if (!s || ada.busy) return;
  ada.log.push({ who: 'me', text: s }); adaPaint();
  if (adaFlowText(s)) return;
  ada.flow = null; for (const j of Object.values(adaJobs)) if (j.state === 'ready') j.state = 'stale';
  const local = adaLocal(s);
  if (local) {
    if (local.kind === 'medical') return adaMedical();
    if (local.kind === 'find') return adaShowThings(local.things, local.say);
    if (local.kind === 'dose') return adaStartDose(local);
    if (local.kind === 'open') {
      if (local.open === 'med-add') return adaStartMed({});
      if (local.open === 'document-add') return adaStartDoc({}, '', s);
      if (local.open === 'vitals') return adaStartVitals(adaVitalsFrom(s));
      if (local.open === 'incident-new' || local.open === 'symptom-new') { const asked = adaWords(s).length <= 4 && /\b(add|log|record|report|write|new|incident|symptoms?)\b/i.test(s); return adaStartCare(local.open === 'incident-new' ? 'incident' : 'symptom', { note: asked ? '' : s, incident: adaIncidentKind(s) }); }
      return adaPlace(local.open);
    }
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
  if (!r) {
    const found = adaFind(s); return found.length ? adaShowThings(found, 'Is it one of these?') : adaSay('Sorry, I didn’t catch that. You can ask me to add a medication, save a document, set a reminder, find something or show you where it is.');
  }
  if (r.kind === 'medical') return adaMedical(r.reply);
  if (r.kind === 'task' && r.task) return adaTaskReady(r.task, r.reply);
  if (r.kind === 'appointment' && r.appointment) return adaApptReady(r.appointment, r.reply);
  if (['medication', 'document', 'vitals', 'dose', 'activity', 'symptom', 'incident'].includes(r.kind)) return adaStart(r.kind, r.fields || {}, r.reply, s);
  if (r.kind === 'open' && r.open) return adaPlace(r.open, r.reply);
  const things = adaThings().filter(t => r.ids.includes(t.id)).sort((a, b) => r.ids.indexOf(a.id) - r.ids.indexOf(b.id));
  if (things.length) return adaShowThings(things, r.reply);
  adaSay(r.reply || 'I can only help with Adltrack.');
}

/* Save on a Ready card: saved like the app's own forms, then the page underneath shows it and Ada offers to show where. */
async function adaSaveJob(n) {
  const job = adaJobs[n]; if (!job || job.state !== 'ready') return;
  job.state = 'busy'; adaPaint(true);
  let r;
  try { r = await job.save(); } catch (err) { job.state = 'ready'; adaSay((err && err.message) || 'I couldn’t save it. Try again.'); return; }
  job.state = 'done'; if (ada.flow && ada.flow.step === 'ready') ada.flow = null;
  save(); render(); if (typeof placeHelp === 'function') placeHelp();
  adaSay(r.say, r.place && ADA_PLACES[r.place] ? [{ type: 'place', open: r.place, done: true }] : []);
}
function adaAct(a) {
  const [what, arg = ''] = a.split(/:(.*)/s), fl = ada.flow;
  if (what === 'photo' || what === 'file') {
    if (!fl || { med: 'med', doc: 'doc', vitals: 'vitals', activity: 'activity', care: fl.type }[arg] !== fl.type) {
      if (arg === 'med') adaStartMed({}); else if (arg === 'doc') adaStartDoc({}); else if (arg === 'vitals') adaStartVitals({}); else if (arg === 'activity') { if (!mayReport()) return adaSay(ADA_NOT_ALLOWED); ada.flow = { type: 'activity', step: 'photo', note: '', incident: '', witnesses: '', photos: [], ...adaNowParts() }; }
      if (!ada.flow) return;
    }
    ada.want = ada.flow.type; document.getElementById(what === 'file' ? 'ada-doc-file' : 'ada-camera')?.click(); return;
  }
  if (what === 'med-typed') { if (!fl || fl.type !== 'med') adaStartMed({}); ada.flow.step = 'name'; ada.flow.p.photo = ''; adaAskNext('What is it called? Type the name and strength as on the label, like “Metoprolol tartrate 25 mg”.'); return; }
  if (what === 'med-nobottle' && fl && fl.type === 'med') { fl.p.noBottle = true; adaMedReady('Okay, it’s marked to pick up from the pharmacy. Add the bottle photo from its card when you have it.'); return; }
  if (what === 'times' && fl && fl.type === 'med') { adaMedSetTimes(arg === 'asneeded' ? [] : arg.split(','), arg === 'asneeded'); return; }
  if (what === 'cat' && fl && fl.type === 'doc') { fl.category = arg; adaDocNext(); return; }
  if (what === 'dose-med' && fl && fl.type === 'dose') { fl.med = arg; fl.slot = ''; adaDoseNext(); return; }
  if (what === 'dose-slot' && fl && fl.type === 'dose') { fl.slot = arg; adaDoseNext(); return; }
  if (what === 'dose-mark' && fl && fl.type === 'dose') { fl.mark = arg; adaDoseNext(); return; }
  if (what === 'incident' && fl && fl.type === 'incident') { fl.incident = arg; adaCareNext(); return; }
  if (what === 'care-skip' && fl && ADA_CARE[fl.type]) { adaCareNext(); return; }
  if (what === 'go') { adaGoPlace(arg); return; }
}
/* A live photo (or, for a document, a file) taken from the chat, shown as the person's own message, then used by the task. */
async function adaGotFile(input) {
  const file = input.files && input.files[0], want = ada.want; input.value = ''; ada.want = '';
  if (!file || !ada.open || !ada.flow || ada.flow.type !== want) return;
  try {
    if (want === 'doc') {
      if (file.size > 10000000) throw Error('Choose a file smaller than 10 MB.');
      if (!/^image\/|^application\/pdf$/.test(file.type)) throw Error('Use a photo or a PDF.');
      const page = { data: await readingCopy(file), type: /^image\//.test(file.type) ? 'image/jpeg' : file.type };
      ada.log.push(page.type === 'application/pdf' ? { who: 'me', text: '📄 ' + (file.name || 'PDF') } : { who: 'me', photo: page.data }); adaPaint();
      return adaDocPage(page);
    }
    const src = want === 'med' ? await readingCopy(file) : await readPhoto(file);
    ada.log.push({ who: 'me', photo: src }); adaPaint();
    if (want === 'med') return adaMedPhoto(src);
    if (want === 'vitals') return adaVitalsPhoto(src);
    if (ADA_CARE[want]) { const fl = ada.flow; fl.photos = [...fl.photos, src].slice(0, PLUS_PHOTOS); if (fl.step === 'ready') return adaPaint(true); if (fl.step === 'photo') return adaCareNext('Got the photo.'); return; }
  } catch (err) { adaSay((err && err.message) || 'I couldn’t open that photo. Try again.'); }
}
/* The camera button: what's the photo of? Each choice starts that task here, with the live camera. */
function adaCamera() {
  const opts = [['A medication bottle', 'photo:med', mayDo('meds')], ['A document or card', 'photo:doc', mayDo('meds')], ['A blood pressure or temperature reading', 'photo:vitals', mayDo('tasks')], ['Something done for the patient', 'photo:activity', mayReport()], ['Discharge papers', 'go:scan-papers', mayDo('meds')]].filter(o => o[2]).map(([l, a]) => [l, a]);
  if (!opts.length) return adaSay(ADA_NOT_ALLOWED);
  ada.flow = null; adaAskNext('What’s the photo of?', opts);
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
/* ---- Taps ---- */
window.addEventListener('click', e => {
  if (e.target.closest('#help-fab')) { e.stopImmediatePropagation(); e.preventDefault(); openAda(); }
}, true);
document.addEventListener('click', e => {
  const pop = document.querySelector('.ada-pop'); if (!pop || !pop.contains(e.target)) return;
  if (e.target === pop || e.target.closest('.ada-x')) { closeAda(); return; }
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.adaSay) { adaAsk(b.dataset.adaSay); return; }
  if (b.dataset.adaAct) { if (ada.busy) return; if (b.dataset.adaTaps && adaJobs[b.dataset.adaTaps] && !/^(photo|file):/.test(b.dataset.adaAct)) { adaJobs[b.dataset.adaTaps].used = true; ada.log.push({ who: 'me', text: b.textContent }); } adaAct(b.dataset.adaAct); if (/^(photo|file):/.test(b.dataset.adaAct)) adaPaint(true); return; }
  if (b.dataset.adaSave) { adaSaveJob(b.dataset.adaSave); return; }
  if (b.dataset.adaChange && adaJobs[b.dataset.adaChange]) { const j = adaJobs[b.dataset.adaChange]; j.state = 'stale'; ada.flow = null; closeAda(true); plusDraft = { ...j.change.draft, photos: [], busy: false }; go(j.change.form); return; }
  if (b.dataset.adaDrop && adaJobs[b.dataset.adaDrop]) { adaJobs[b.dataset.adaDrop].state = 'stale'; adaStop(); return; }
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
/* The chat's own camera (live, one photo at a time, like every photo in the app) and, for documents only, a file picker. They sit
   outside the pop-up so repainting the conversation never drops a photo being taken. */
document.body.insertAdjacentHTML('beforeend', '<input type="file" id="ada-camera" accept="image/*" capture="environment" hidden><input type="file" id="ada-doc-file" accept="image/*,application/pdf" hidden>');
document.addEventListener('change', e => { if (e.target.id === 'ada-camera' || e.target.id === 'ada-doc-file') adaGotFile(e.target); });

/* The round button (its look unchanged) now says who it opens, and hides while Ada is open. */
if (typeof placeHelp === 'function') {
  const placeHelpBeforeAda = placeHelp;
  placeHelp = function () { placeHelpBeforeAda(); const b = document.getElementById('help-fab'); if (!b) return; if (document.querySelector('.ada-pop')) b.hidden = true; if (!b.hidden) b.setAttribute('aria-label', `Talk to ${adaName()}`); };
  placeHelp();
}
}
