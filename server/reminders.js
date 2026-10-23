/* Daily reminders: one rule picks the day's reminder (every return due, grouped, most urgent first, respecting snoozeUntil,
   "Gentle" and quiet hours; the words come from nudge.js), and each user gets it once a day at their reminder time: by Web
   Push, by email when push isn't set up on any device, or by the open app's own notification. Whichever claims the day first
   sends it, so the user never gets two. A pushed reminder that isn't opened 3 days before a deadline is followed by email.
   Everything is sent per family, to the people on that family's care team, and names the patient ("Rose · 8:00 AM: …"):
   a caregiver on three families gets each family's reminders, and tapping one opens that family. Dose and task reminders go
   to the people with My Tasks; incidents straight away, missed doses and the end-of-day report to everyone. Each person picks
   quiet hours and which of these they get (alert_prefs), except incidents, which always arrive. */
const C = require('../core.js');
const N = require('../nudge.js');
const { normPhone } = require('./sms');

const DEFAULT_TIME = '09:00';
// Push services that browsers subscribe with. The server only ever sends to these hosts.
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];
// How long after a pushed reminder an unopened one is followed by email (on the day an item has 3 days left).
const FOLLOW_UP_MS = 4 * 60 * 60 * 1000;
const daysLabel = N.daysLabel;

/* What a push message carries: the notification's words, the item it opens and its action buttons. */
const notification = r => ({ title: r.title, body: r.body, itemId: r.itemId, url: r.url, actions: r.actions, ...(r.tag ? { tag: r.tag } : {}) });

/* The day's reminder for these items on `today` (the user's local date), or null when nothing needs one. */
function pick(items, today, settings = {}) {
  return N.compose(items, today, { gentle: !!(settings && settings.gentle) });
}

const validTimeZone = tz => { if (typeof tz !== 'string' || !tz || tz.length > 64) return false; try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };
/* The local date (YYYY-MM-DD) and time (HH:MM) at `now` in a time zone. */
function localParts(now, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: validTimeZone(tz) ? tz : 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
const validTime = t => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const reminderTime = settings => validTime(settings?.time) ? settings.time : DEFAULT_TIME;
/* Quiet hours (settings.quietStart / quietEnd, HH:MM, may span midnight): no reminder is sent inside them. */
function quiet(settings, time) {
  const a = settings?.quietStart, b = settings?.quietEnd;
  if (!validTime(a) || !validTime(b) || a === b) return false;
  return a < b ? time >= a && time < b : time >= a || time < b;
}
/* When the day's reminder goes: the reminder time, or the end of quiet hours when the reminder time falls inside them. */
const sendTime = settings => quiet(settings, reminderTime(settings)) ? settings.quietEnd : reminderTime(settings);
/* True when the day's reminder is due at local time `time`. */
const isDue = (settings, time) => time >= sendTime(settings) && !quiet(settings, time);

/* A browser's PushSubscription (as JSON) → what we store, or null if it isn't one from a known push service. */
function cleanSubscription(sub) {
  if (!sub || typeof sub !== 'object') return null;
  const { endpoint, keys } = sub;
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return null;
  let url; try { url = new URL(endpoint); } catch { return null; }
  if (url.protocol !== 'https:' || url.port || !PUSH_HOSTS.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) return null;
  const b64 = (v, min, max) => typeof v === 'string' && /^[A-Za-z0-9_-]+={0,2}$/.test(v) && v.length >= min && v.length <= max;
  if (!keys || !b64(keys.p256dh, 80, 100) || !b64(keys.auth, 16, 32)) return null;
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

/* Dose reminders: at each dose time the family picked on the Confirm card (or the papers printed), one push for every
   medication due then, sent from that time until an hour after it unless the dose is already marked taken or skipped.
   Only confirmed medications that are in the house (not waiting at the pharmacy) and not finished; "as needed" ones never
   get one. The words are the instructions as printed: the app never tells anyone how much to take. */
const DOSE_WINDOW_MIN = 60;
// Not marked an hour after its time: the people with My Tasks are reminded again, and 15 minutes later everyone is alerted.
const MISSED_MIN = 60, ALERT_MIN = MISSED_MIN + 15;
const minutes = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
/* The doses due at `time`: from their time until an hour after, or that window `after` minutes later (for a missed dose). */
function dosesDue(items, date, time, after = 0) {
  const at = minutes(time) - after, due = {};
  for (const i of items || []) {
    if (!i || !i.med || i.demo || i.status !== 'deciding' || i.pickup || i.asNeeded || !Array.isArray(i.times)) continue;
    for (const t of new Set(i.times)) {
      if (!validTime(t) || at < minutes(t) || at >= minutes(t) + DOSE_WINDOW_MIN) continue;
      if ((i.doses || []).some(d => d && d.slot === t && (d.day || String(d.at || '').slice(0, 10)) === date)) continue;
      (due[t] = due[t] || []).push(i);
    }
  }
  return Object.keys(due).sort().map(t => ({ time: t, items: due[t] }));
}
const clock12 = t => { const h = Number(t.slice(0, 2)); return `${h % 12 || 12}:${t.slice(3)} ${h < 12 ? 'AM' : 'PM'}`; };
/* The buttons on a dose reminder. They mark the dose (or bring the reminder back in 15 minutes) without opening the app. */
const DOSE_ACTIONS = [{ action: 'taken', title: 'Taken' }, { action: 'snooze15', title: 'Snooze 15 minutes' }, { action: 'skipped', title: 'Skipped' }];
const SNOOZE_MIN = 15;
/* "8:00 PM: Lisinopril 10 mg, 1 tablet": the name and the amount as printed, then the instructions word for word. */
const doseLine = i => i.name + (i.dose ? ', ' + i.dose : '');
const doseHow = i => i.instructions || [i.dose, i.route, i.frequency].filter(Boolean).join(' ');
/* Who the notification is about, and the link that opens their family: "Rose · " and "app.html?patient=…&". */
const about = patient => patient && patient.name ? patient.name + ' · ' : '';
const opens = (patient, rest = '') => 'app.html' + ((q => q ? '?' + q : '')([patient && patient.id ? 'patient=' + encodeURIComponent(patient.id) : '', rest].filter(Boolean).join('&')));
function doseNotification({ time, items }, date = '', { patient = null, again = false } = {}) {
  const one = items.length === 1;
  const lines = one ? [doseHow(items[0])].filter(Boolean) : items.slice(0, 4).map(i => doseLine(i) + (doseHow(i) ? ': ' + doseHow(i) : ''));
  if (items.length > 4) lines.push(`Plus ${items.length - 4} more.`);
  if (again) lines.unshift('Not marked yet.');
  return { title: `${about(patient)}${clock12(time)}: ${one ? doseLine(items[0]) : items.length + ' medications'}`.slice(0, 200), body: lines.join(' · ').slice(0, 500), itemId: items[0].id, url: opens(patient, 'remind=' + encodeURIComponent(items[0].id)), actions: DOSE_ACTIONS, dose: { date, time, ids: items.map(i => i.id), ...(patient && patient.id ? { patient: patient.id } : {}) }, tag: `dose ${patient && patient.id || ''} ${date} ${time}` };
}
/* The medications among `ids` whose dose at `time` on `date` isn't marked yet (for a snoozed or tested reminder, which may
   come after the hour a dose reminder is normally sent in). */
function unmarked(items, date, time, ids) {
  return (items || []).filter(i => i && i.med && ids.includes(i.id) && i.status === 'deciding' && !i.pickup && Array.isArray(i.times) && i.times.includes(time)
    && !(i.doses || []).some(d => d && d.slot === time && (d.day || String(d.at || '').slice(0, 10)) === date));
}

/* Follow-up appointment reminders: the day before (from the user's reminder time, outside quiet hours) and 2 hours before
   (when the time is known), one each. Earlier ones the family chose on the appointment (`remind`): a week before, 2 days
   before, and every day until then, also at the reminder time; these are only messages, never My Tasks. Only appointments
   the family confirmed, with a date, that they haven't marked Went; never examples. Moving the date reminds again for the
   new date. */
const SOON_MIN = 120;
function appointmentsDue(items, date, time, settings = {}) {
  const at = minutes(time), out = [];
  for (const i of items || []) {
    if (!i || !i.appt || i.demo || i.status !== 'deciding' || !C.parseDate(i.date) || (i.steps && i.steps.went)) continue;
    const days = C.days(i.date, date), remind = Array.isArray(i.remind) ? i.remind : [];
    if (days === 1 && isDue(settings, time)) out.push({ item: i, kind: 'day', days });
    else if (days >= 2 && isDue(settings, time)) {
      const kind = days === 7 && remind.includes('week') ? 'week' : days === 2 && remind.includes('two') ? 'two' : remind.includes('daily') ? 'daily' : '';
      if (kind) out.push({ item: i, kind, days });
    } else if (i.date === date && validTime(i.time) && at >= minutes(i.time) - SOON_MIN && at < minutes(i.time)) out.push({ item: i, kind: 'soon', days });
  }
  return out;
}
function appointmentNotification({ item: i, kind, days }, patient = null) {
  const when = kind === 'day' ? 'tomorrow' : kind === 'soon' ? 'today' : days === 7 ? 'in a week' : `in ${days} days`;
  const what = 'Follow-up visit' + (i.with ? ' with ' + i.with : '');
  const body = [[validTime(i.time) ? clock12(i.time) : '', i.place].filter(Boolean).join(' · '), i.phone ? 'Call ' + i.phone + ' to change it.' : ''].filter(Boolean).join('. ');
  return { title: `${about(patient) || 'Adltrack · '}${what} ${when}`.slice(0, 120), body: body.slice(0, 500), itemId: i.id, url: opens(patient, 'remind=' + encodeURIComponent(i.id)), actions: [], tag: 'appt ' + i.id };
}

/* Tasks added with the + on My Tasks: due on their days (once, every day, chosen weekdays or every week, until their last
   day), reminded at their time until an hour after, unless already marked done or skipped. */
const weekday = day => C.parseDate(day).getDay();
function taskOn(t, day) {
  if (!t || !t.task || t.incident || !C.parseDate(t.date) || day < t.date) return false;
  if (!t.repeat || t.repeat === 'once') return day === t.date;
  if (t.until && day > t.until) return false;
  return t.repeat === 'daily' || t.repeat === 'weekly' && weekday(day) === weekday(t.date) || t.repeat === 'days' && (t.days || []).includes(weekday(day));
}
const taskMarked = (t, day) => (t.marks || []).some(m => m && m.key === 'task' && m.day === day);
function tasksDue(items, date, time) {
  const at = minutes(time);
  return (items || []).filter(t => taskOn(t, date) && !t.demo && validTime(t.time) && at >= minutes(t.time) && at < minutes(t.time) + DOSE_WINDOW_MIN && !taskMarked(t, date));
}
function taskNotification(t, date, patient = null) {
  return { title: `${about(patient)}${clock12(t.time)}: ${t.name}`.slice(0, 200), body: (t.note || 'Mark it done or skipped in My Tasks.').slice(0, 500), itemId: t.id, url: opens(patient), actions: [], tag: `task ${t.id} ${date}` };
}

/* The medications whose dose at `time` on `date` nobody marked taken or skipped. */
const missedAt = (items, date, time) => (items || []).filter(i => i && i.med && !i.demo && i.status === 'deciding' && !i.pickup && !i.asNeeded && Array.isArray(i.times) && i.times.includes(time)
  && !(i.doses || []).some(d => d && d.slot === time && (d.day || String(d.at || '').slice(0, 10)) === date));
function missedNotification(time, list, date, patient = null) {
  const names = list.slice(0, 4).map(doseLine).join(', ') + (list.length > 4 ? ` and ${list.length - 4} more` : '');
  return { title: `${about(patient)}Missed dose at ${clock12(time)}`.slice(0, 200), body: `${names} ${list.length === 1 ? 'wasn’t' : 'weren’t'} marked taken or skipped. About a missed dose, check the instructions or call the pharmacist.`.slice(0, 500), itemId: list[0].id, url: opens(patient), actions: [], tag: `missed ${patient && patient.id || ''} ${date} ${time}` };
}

/* An incident from the + on My Tasks, sent to everyone straight away. Like the report, it doesn't say who reported it. */
function incidentNotification(i, time, patient = null) {
  return { title: `${about(patient)}Incident: ${i.name || 'Other'}`.slice(0, 200), body: [time ? clock12(time) : '', i.note || ''].filter(Boolean).join(' · ').slice(0, 500) || 'Open the daily care report to see it.', itemId: i.id, url: opens(patient), actions: [], tag: 'incident ' + i.id };
}

/* The end-of-day report: the day's doses, tasks and incidents in one line, with the report a tap away. `dayOf` turns an
   incident's time into a local date. */
function daySummary(items, date, dayOf = at => String(at || '').slice(0, 10)) {
  let doses = 0, taken = 0, skipped = 0, tasks = 0, done = 0, incidents = 0;
  for (const i of items || []) {
    if (!i || i.demo) continue;
    if (i.med && i.status === 'deciding' && !i.pickup && !i.asNeeded && Array.isArray(i.times)) for (const t of new Set(i.times.filter(validTime))) {
      doses++;
      const d = (i.doses || []).find(d => d && d.slot === t && (d.day || String(d.at || '').slice(0, 10)) === date);
      if (d && d.kind === 'taken') taken++; else if (d && d.kind === 'skipped') skipped++;
    }
    if (taskOn(i, date)) { tasks++; if ((i.marks || []).some(m => m && m.key === 'task' && m.day === date && m.kind === 'done')) done++; }
    if (i.incident && dayOf(i.at) === date) incidents++;
  }
  return { doses, taken, skipped, tasks, done, incidents };
}
function endOfDayNotification(s, date, patient = null) {
  const parts = [];
  if (s.doses) parts.push(`${s.taken} of ${s.doses} dose${s.doses === 1 ? '' : 's'} taken${s.skipped ? `, ${s.skipped} skipped` : ''}`);
  if (s.tasks) parts.push(`${s.done} of ${s.tasks} task${s.tasks === 1 ? '' : 's'} done`);
  if (s.incidents) parts.push(`${s.incidents} incident${s.incidents === 1 ? '' : 's'}`);
  return { title: `${about(patient)}Today’s care report`.slice(0, 200), body: `${parts.length ? parts.join(' · ') + '.' : 'Nothing was due today.'} Tap to see the daily care report.`.slice(0, 500), itemId: null, url: opens(patient), actions: [], tag: `day ${patient && patient.id || ''} ${date}` };
}
// Every day until the visit is one reminder a day, so its slot carries the day it's sent.
const appointmentSlot = (i, kind, date) => `${i.date} appt ${kind}${kind === 'daily' ? ' ' + date : ''} ${String(i.id).slice(0, 100)}`;

/* VAPID settings from the environment, or null when push isn't set up. */
function vapidConfig(env) {
  const publicKey = env.VAPID_PUBLIC_KEY || '', privateKey = env.VAPID_PRIVATE_KEY || '';
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: env.VAPID_SUBJECT || 'mailto:support@returnly.app' };
}

/* Sends Web Push messages. `send` is web-push's sendNotification (tests pass a fake push service). */
function createPush({ vapid = null, send = null } = {}) {
  let sender = send;
  if (vapid && !sender) {
    const webpush = require('web-push');
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
    sender = (sub, payload, options) => webpush.sendNotification(sub, payload, options);
  }
  return {
    available: () => !!(vapid && sender),
    publicKey: () => vapid ? vapid.publicKey : null,
    /* → 'sent', 'gone' (the subscription expired or was revoked: delete it) or 'failed' (try again later). */
    async deliver(sub, message, { topic = 'daily', ttl = 12 * 60 * 60, urgency = 'normal' } = {}) {
      const payload = JSON.stringify(message);
      // TTL: a reminder older than 12 hours isn't worth showing. Topic: a newer reminder replaces one not yet delivered.
      try { await sender({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: ttl, urgency, topic }); return 'sent'; }
      catch (err) { return [404, 410].includes(err && err.statusCode) ? 'gone' : 'failed'; }
    }
  };
}


/* Each person's own choices on Reminders: which reminders and alerts they get, the time of their end-of-day report and their
   quiet hours. Incidents ignore all of these. */
const ALERT_KINDS = ['doses', 'missed', 'endOfDay'];
const END_OF_DAY = '20:00';
function cleanPrefs(body = {}) {
  const out = {};
  for (const k of ALERT_KINDS) if (typeof body[k] === 'boolean') out[k] = body[k];
  if (validTime(body.endOfDayTime)) out.endOfDayTime = body.endOfDayTime;
  for (const k of ['quietStart', 'quietEnd']) if (validTime(body[k]) || body[k] === '') out[k] = body[k];
  return out;
}

function createReminders({ store, push, email = null, sms = null, data = null, now = () => new Date(), log = console }) {
  const { permsFor } = require('./team');
  const settingsOf = async userId => ((await store.getRawData(userId))?.payload?.settings) || {};
  const timeZoneOf = async (userId, settings) => {
    const subs = await store.listPushSubscriptions(userId);
    return subs[0]?.timeZone || (validTimeZone(settings.timeZone) ? settings.timeZone : 'UTC');
  };
  const emailOn = async (userId, kind) => !!(email && email.available()) && !(await store.emailOptouts(userId)).includes(kind);

  /* A person's choices, with quiet hours they set before choices were per person (on their own plan) kept. */
  async function prefsOf(userId) {
    const own = await settingsOf(userId), saved = (await store.alertPrefs(userId)) || {};
    const p = { doses: true, missed: true, endOfDay: true, endOfDayTime: END_OF_DAY, ...(validTime(own.quietStart) && validTime(own.quietEnd) ? { quietStart: own.quietStart, quietEnd: own.quietEnd } : {}), ...saved };
    if (!validTime(p.quietStart) || !validTime(p.quietEnd)) { delete p.quietStart; delete p.quietEnd; }
    return p;
  }

  /* Everyone on a family's care team who has joined, with what they may do. A plan with no team is its owner's alone (unless
     its owner now only cares for other families, whose plans they see instead). */
  async function teamOf(ownerId) {
    const members = (await store.listMembers(ownerId)).filter(m => m.userId);
    if (members.length) return members.map(m => ({ userId: m.userId, role: m.role, perms: permsFor(m.role, m.perms), phone: m.phone || '' }));
    if ((await store.membershipsOf(ownerId)).length) return [];
    return [{ userId: ownerId, role: 'admin', perms: { tasks: true, addTasks: true, meds: true } }];
  }
  const withTasks = p => p.role !== 'viewer' && !!p.perms.tasks;
  /* The families this person is on, each with what they may do there (their own plan when they're on none). */
  async function plansOf(userId) {
    const list = await store.membershipsOf(userId);
    if (!list.length) return [{ ownerId: userId, role: 'admin', perms: { tasks: true, addTasks: true, meds: true } }];
    return list.map(m => ({ ownerId: m.ownerId, role: m.role, perms: permsFor(m.role, m.perms) }));
  }
  /* The patient a notification is about: the name on the family's Home profile, or the name of whoever set the plan up. */
  async function patientOf(ownerId) {
    const profile = (await store.getRawData(ownerId))?.payload?.profile || {};
    const name = typeof profile.name === 'string' && profile.name.trim() && profile.name.trim().toLowerCase() !== 'you' ? profile.name.trim().slice(0, 40) : (await store.findUserById(ownerId))?.name || '';
    return { id: ownerId, name };
  }
  /* Dose times belong to the patient's home: the family's own time zone, else that of a device on the team. */
  const planZone = (settings, people) => validTimeZone(settings && settings.timeZone) ? settings.timeZone : (people.find(p => p.timeZone) || {}).timeZone || 'UTC';

  async function sendTo(userId, subs, message, options) {
    let sent = 0, failed = 0;
    for (const sub of subs) {
      const r = await push.deliver(sub, message, options);
      if (r === 'sent') sent++;
      else if (r === 'gone') await store.deletePushSubscription(sub.endpoint, userId);
      else failed++;
    }
    return { sent, failed };
  }

  /* Sends one message to each of these people's devices, if they want this kind (`kind`, one of ALERT_KINDS) and it isn't
     their quiet hours where their device is. `always` (incidents) skips both checks. */
  async function deliver(people, message, options, { kind = null, always = false } = {}) {
    let sent = 0, failed = 0;
    for (const p of people) {
      const subs = await store.listPushSubscriptions(p.userId);
      if (!subs.length) continue;
      if (!always) {
        const prefs = await prefsOf(p.userId);
        if (kind && prefs[kind] === false) continue;
        if (quiet(prefs, localParts(now(), subs[0].timeZone).time)) continue;
      }
      const r = await sendTo(p.userId, subs, message, options);
      sent += r.sent; failed += r.failed;
    }
    return { sent, failed };
  }

  /* The day's refill and visit reminder, for each family this person does the tasks for: [{ ownerId, reminder }]. */
  async function dailyFor(userId, date) {
    const out = [];
    for (const plan of await plansOf(userId)) {
      if (!withTasks(plan)) continue;
      const settings = await settingsOf(plan.ownerId);
      if (settings.daily === false) continue;
      const r = pick(await store.listItems(plan.ownerId), date, settings);
      if (!r) continue;
      const patient = await patientOf(plan.ownerId);
      out.push({ ownerId: plan.ownerId, reminder: { ...r, title: r.title.replace(/^Adltrack · /, about(patient) || 'Adltrack · '), url: opens(patient, 'remind=' + encodeURIComponent(r.itemId)), tag: 'daily ' + plan.ownerId } });
    }
    return out;
  }

  /* Claims the user's reminder for `date` (their local date) once; returns the reminders to show (one per family), or none
     when the day was already claimed or nothing is due. A day with nothing due is claimed too, so it's checked once. */
  async function claim(userId, date, by) {
    const c = await store.claimReminderDay(userId, date, by);
    if (!c.claimed) return { claimed: false, reminder: null, reminders: [] };
    const reminders = (await dailyFor(userId, date)).map(d => d.reminder);
    return { claimed: true, previous: c.previous, reminder: reminders[0] || null, reminders };
  }

  async function mail(userId, reminder, kind, date) {
    const user = await store.findUserById(userId);
    if (!user) return false;
    await email.sendReminder(user.email, userId, reminder, { kind, date });
    return true;
  }

  /* Every minute: each family's dose, task and visit reminders, missed doses and end-of-day reports (by push), then each
     user's daily refill and visit reminder at their reminder time (outside their quiet hours), for those who can be reached:
     a device for push, or email when push isn't set up. */
  async function dispatch() {
    const canPush = push.available(), canEmail = !!(email && email.available()), canText = !!(sms && sms.available());
    if (!canPush && !canEmail && !canText) return 0;
    let queued = 0;
    for (const plan of await store.carePlans()) queued += await dispatchPlan(plan, { canPush, canMessage: canEmail || canText });
    for (const c of await store.reminderCandidates()) {
      const settings = c.settings || {};
      if (settings.daily === false) continue;
      const tz = c.timeZone || (validTimeZone(settings.timeZone) ? settings.timeZone : null);
      if (!tz && !(canPush && c.hasPush)) continue;
      const local = localParts(now(), tz), prefs = await prefsOf(c.userId);
      if (!isDue({ time: settings.time, quietStart: prefs.quietStart, quietEnd: prefs.quietEnd }, local.time) || c.lastDate === local.date) continue;
      if (!(canPush && c.hasPush) && !(await emailOn(c.userId, 'daily'))) continue;
      queued++;
      await store.enqueueJob({ name: 'reminders.send', payload: { userId: c.userId, date: local.date }, runAt: new Date(), uniqueKey: `reminder:${c.userId}:${local.date}`, maxAttempts: 4 });
    }
    return queued;
  }

  /* One family, each minute: whatever has come due is claimed once for the family (so each is sent once, however many people
     are on the team) and queued. Only families with someone push can reach are read, or, for appointments, families whose
     time zone is known when email or texts are set up. */
  async function dispatchPlan({ ownerId, settings }, { canPush = true, canMessage = false } = {}) {
    settings = settings || {};
    const team = await teamOf(ownerId), people = [];
    if (canPush) for (const p of team) { const subs = await store.listPushSubscriptions(p.userId); if (subs.length) people.push({ ...p, timeZone: subs[0].timeZone }); }
    if (!people.length && !(canMessage && validTimeZone(settings.timeZone) && team.some(withTasks))) return 0;
    const local = localParts(now(), planZone(settings, people)), { date, time } = local, items = await store.listItems(ownerId);
    let queued = 0;
    const queue = async (slot, name, payload, claimFor = ownerId) => {
      if (!(await store.claimDoseReminder(claimFor, slot))) return;
      queued++;
      await store.enqueueJob({ name, payload, runAt: new Date(), uniqueKey: `${name}:${claimFor}:${slot}`, maxAttempts: 4 });
    };
    // Follow-up appointments, claimed the same way so each one is reminded once each time it's due, by push, email and text.
    if (settings.daily !== false && team.some(withTasks))
      for (const a of appointmentsDue(items, date, time, settings)) await queue(appointmentSlot(a.item, a.kind, date), 'reminders.appointment', { ownerId, id: a.item.id, kind: a.kind, slot: appointmentSlot(a.item, a.kind, date) });
    if (!people.length) return queued;
    if (settings.daily !== false && people.some(withTasks)) {
      for (const d of dosesDue(items, date, time)) await queue(`${date} ${d.time}`, 'reminders.dose', { ownerId, date, time: d.time });
      // Still not marked an hour later: the people with My Tasks are reminded again.
      for (const d of dosesDue(items, date, time, MISSED_MIN)) await queue(`${date} ${d.time} again`, 'reminders.dose', { ownerId, date, time: d.time, again: true });
      for (const t of tasksDue(items, date, time)) await queue(`${date} task ${String(t.id).slice(0, 100)} ${t.time}`, 'reminders.task', { ownerId, date, id: t.id });
    }
    // And 15 minutes after that, everyone on the team is told the dose was missed.
    for (const d of dosesDue(items, date, time, ALERT_MIN)) await queue(`${date} ${d.time} missed`, 'alerts.missed', { ownerId, date, time: d.time });
    // The end-of-day report, at each person's own time where they are.
    for (const p of people) {
      const prefs = await prefsOf(p.userId), mine = localParts(now(), p.timeZone);
      if (prefs.endOfDay === false || minutes(mine.time) < minutes(prefs.endOfDayTime) || minutes(mine.time) >= minutes(prefs.endOfDayTime) + DOSE_WINDOW_MIN || quiet(prefs, mine.time)) continue;
      await queue(`${mine.date} day ${ownerId}`, 'alerts.endOfDay', { ownerId, userId: p.userId, date: mine.date }, p.userId);
    }
    return queued;
  }

  /* One dose time's push to the people with My Tasks: the medications still due at that time (one marked since is left out).
     A snoozed one goes again, to the person who snoozed it, for the medications it was about if their dose still isn't
     marked; `again` is the reminder an hour after. Jobs queued before reminders went per family carry only userId. */
  async function sendDose({ ownerId, userId, date, time, ids = null, again = false, only = null }) {
    ownerId = ownerId || userId;
    const slot = `${date} ${time}${again ? ' again' : ''}`, list = await store.listItems(ownerId);
    const left = Array.isArray(ids) ? unmarked(list, date, time, ids) : again ? missedAt(list, date, time) : [];
    const due = Array.isArray(ids) || again ? (left.length ? { time, items: left } : null) : dosesDue(list, date, time).find(d => d.time === time);
    if (!due || !push.available()) return;
    const people = (await teamOf(ownerId)).filter(p => withTasks(p) && (!only || p.userId === only));
    const { sent, failed } = await deliver(people, doseNotification(due, date, { patient: await patientOf(ownerId), again }), { topic: 'dose', ttl: DOSE_WINDOW_MIN * 60, urgency: 'high' }, { kind: 'doses' });
    if (!sent && failed) { if (!ids) await store.releaseDoseReminder(ownerId, slot); throw new Error(`Dose push failed for all ${failed} device${failed === 1 ? '' : 's'}.`); }
  }

  /* A task from the + at its time, to the people with My Tasks, if it still isn't marked. */
  async function sendTask({ ownerId, date, id }) {
    const t = (await store.listItems(ownerId)).find(i => i.id === id);
    if (!t || !taskOn(t, date) || taskMarked(t, date) || !push.available()) return;
    const people = (await teamOf(ownerId)).filter(withTasks);
    await deliver(people, taskNotification(t, date, await patientOf(ownerId)), { topic: 'task', ttl: DOSE_WINDOW_MIN * 60, urgency: 'high' }, { kind: 'doses' });
  }

  /* One appointment's reminder, if it's still due (not marked Went or moved since it was queued): a push to each device, an
     email (unless they unsubscribed) and a text to the phone the admin entered, for everyone with My Tasks. */
  async function sendAppointment({ ownerId, userId, id, kind, slot }) {
    ownerId = ownerId || userId;
    const settings = await settingsOf(ownerId), team = await teamOf(ownerId), people = [];
    for (const p of team) { const subs = await store.listPushSubscriptions(p.userId); if (subs.length) people.push({ ...p, timeZone: subs[0].timeZone }); }
    const local = localParts(now(), planZone(settings, people));
    const due = appointmentsDue(await store.listItems(ownerId), local.date, local.time, settings).find(a => a.item.id === id && a.kind === kind && appointmentSlot(a.item, kind, local.date) === slot);
    const doers = team.filter(withTasks);
    if (!due || !doers.length) return;
    const message = appointmentNotification(due, await patientOf(ownerId));
    let { sent, failed } = await deliver(people.filter(withTasks), message, { topic: 'appointment', ttl: SOON_MIN * 60, urgency: 'high' }, { kind: 'doses' });
    for (const p of doers) {
      try { if (await emailOn(p.userId, 'daily') && await mail(p.userId, message, 'daily', local.date)) sent++; } catch (err) { failed++; log.error(err); }
      const to = normPhone(p.phone);
      try { if (to && sms && sms.available()) { await sms.sendText(to, `${message.title}. ${message.body}`.slice(0, 320)); sent++; } } catch (err) { failed++; log.error(err); }
    }
    if (!sent && failed) { await store.releaseDoseReminder(ownerId, slot); throw new Error(`Appointment reminder failed for all ${failed} way${failed === 1 ? '' : 's'} of reaching the team.`); }
  }

  /* A dose nobody marked an hour and a quarter after its time: everyone on the team is told. */
  async function sendMissed({ ownerId, date, time }) {
    const list = missedAt(await store.listItems(ownerId), date, time);
    if (!list.length || !push.available()) return;
    await deliver(await teamOf(ownerId), missedNotification(time, list, date, await patientOf(ownerId)), { topic: 'missed', ttl: 6 * 60 * 60, urgency: 'high' }, { kind: 'missed' });
  }

  /* One person's end-of-day report for one family. */
  async function sendEndOfDay({ ownerId, userId, date }) {
    if (!push.available() || !(await teamOf(ownerId)).some(p => p.userId === userId)) return;
    const subs = await store.listPushSubscriptions(userId), tz = subs[0]?.timeZone || 'UTC';
    const summary = daySummary(await store.listItems(ownerId), date, at => at ? localParts(new Date(at), tz).date : '');
    await deliver([{ userId }], endOfDayNotification(summary, date, await patientOf(ownerId)), { topic: 'day', ttl: 12 * 60 * 60 }, { kind: 'endOfDay' });
  }

  /* An incident was reported: everyone on the team hears straight away (but the person who reported it), quiet hours or not. */
  async function incidentReported(ownerId, item, byUserId = null) {
    if (!push.available() || !item || !item.incident) return;
    await store.enqueueJob({ name: 'alerts.incident', payload: { ownerId, id: item.id, by: byUserId }, runAt: new Date(), uniqueKey: `incident:${ownerId}:${String(item.id).slice(0, 100)}`, maxAttempts: 4 });
  }
  async function sendIncident({ ownerId, id, by = null }) {
    const i = (await store.listItems(ownerId)).find(x => x.id === id);
    if (!i || !i.incident || !push.available()) return;
    const people = (await teamOf(ownerId)).filter(p => p.userId !== by), settings = await settingsOf(ownerId);
    const tz = validTimeZone(settings.timeZone) ? settings.timeZone : 'UTC';
    const time = i.at && !Number.isNaN(Date.parse(i.at)) ? localParts(new Date(i.at), tz).time : '';
    await deliver(people, incidentNotification(i, time, await patientOf(ownerId)), { topic: 'incident', ttl: 24 * 60 * 60, urgency: 'high' }, { always: true });
  }

  async function send({ userId, date }) {
    let subs = push.available() ? await store.listPushSubscriptions(userId) : [];
    const daily = await emailOn(userId, 'daily');
    if (!subs.length && !daily) return;
    const c = await claim(userId, date, subs.length ? 'push' : 'email');
    if (!c.claimed || !c.reminders.length) return;
    if (subs.length && (await prefsOf(userId)).doses === false) return;
    if (subs.length) {
      let sent = 0, failed = 0;
      for (const r of c.reminders) { const x = await sendTo(userId, subs, notification(r)); sent += x.sent; failed += x.failed; }
      if (sent) {
        if (failed) log.error(`Reminder push failed for ${failed} of ${subs.length * c.reminders.length} sends.`);
        // An item with 3 days left: if this reminder isn't opened, follow it up by email.
        if (c.reminders.some(r => r.items.some(id => r.days[id] === 3)) && await emailOn(userId, 'unopened'))
          await store.enqueueJob({ name: 'reminders.followup', payload: { userId, date }, runAt: new Date(now().getTime() + FOLLOW_UP_MS), uniqueKey: `followup:${userId}:${date}`, maxAttempts: 4 });
        return;
      }
      if (failed && !daily) {
        // Nothing reached any device: give the day back so the retry (or the open app) can still send it.
        await store.releaseReminderDay(userId, date, c.previous);
        throw new Error(`Push failed for all ${failed} device${failed === 1 ? '' : 's'}.`);
      }
      subs = [];
    }
    // No device could be reached by push: the same reminders by email.
    if (daily) {
      try { for (const r of c.reminders) await mail(userId, r, 'daily', date); }
      catch (err) { await store.releaseReminderDay(userId, date, c.previous); throw err; }
    }
  }

  /* A few hours after a pushed reminder with an item at 3 days left: email it when it still hasn't been opened. */
  async function followup({ userId, date }) {
    const day = await store.reminderDay(userId);
    if (!day || day.lastDate !== date || day.openedDate === date || !(await emailOn(userId, 'unopened'))) return;
    const settings = await settingsOf(userId), prefs = await prefsOf(userId);
    const tz = await timeZoneOf(userId, settings), local = localParts(now(), tz);
    if (local.date !== date) return;
    if (quiet(prefs, local.time)) {
      await store.enqueueJob({ name: 'reminders.followup', payload: { userId, date }, runAt: new Date(now().getTime() + 30 * 60 * 1000), uniqueKey: `followup:${userId}:${date}:${local.time}`, maxAttempts: 4 });
      return;
    }
    for (const { reminder } of await dailyFor(userId, date)) if (reminder.items.some(id => reminder.days[id] === 3)) await mail(userId, reminder, 'unopened', date);
  }

  /* A reminder was opened (tapped, an action used, or an email link followed). */
  const opened = userId => store.markReminderOpened(userId);

  /* "Snooze until tomorrow", "I sent it back" and "I'm keeping it", from a notification or an email, without opening the app,
     on whichever family's plan the item is on, when this person does the care there. `today` is the user's local date. */
  async function act(userId, itemId, action, today) {
    if (typeof itemId !== 'string' || itemId.length > 200) return null;
    let found = null, ownerId = null;
    for (const plan of await plansOf(userId)) {
      if (plan.role === 'viewer' || !(plan.perms.tasks || plan.perms.meds)) continue;
      if ((found = await store.getItem(plan.ownerId, itemId))) { ownerId = plan.ownerId; break; }
    }
    if (!found) return null;
    const item = { ...found.item };
    delete item.label;
    if (action === 'snooze') item.snoozeUntil = C.shift(today, 1);
    else if (action === 'sent') { if (!['received', 'kept'].includes(item.status)) { item.status = 'shipped'; item.returnedOn = today; } }
    else if (action === 'keep') { item.status = 'kept'; item.intent = 'keep'; }
    else return null;
    await opened(userId);
    return (await data.saveItem(ownerId, item)).item;
  }

  /* "Taken", "Skipped" and "Snooze 15 minutes" on a dose reminder, without opening the app, on the family's plan the reminder
     came from (`ownerId`). Taken and Skipped record the dose for each medication the reminder was about (one already marked
     keeps its mark), with the name of the person who tapped it; a skipped dose is only recorded, never moved. Snooze sends
     the same reminder again in 15 minutes, to that person. Returns the saved medications, or null. */
  async function actDose(ownerId, { action, date, time, ids }, { by = '', userId = null } = {}) {
    if (!['taken', 'skipped', 'snooze15'].includes(action) || !validTime(time) || !/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Array.isArray(ids) || !ids.length || ids.length > 20 || !ids.every(id => typeof id === 'string' && id.length <= 200)) return null;
    const list = unmarked(await store.listItems(ownerId), date, time, ids);
    if (userId) await opened(userId);
    if (action === 'snooze15') {
      if (list.length) await store.enqueueJob({ name: 'reminders.dose', payload: { ownerId, date, time, ids: list.map(i => i.id), ...(userId ? { only: userId } : {}) }, runAt: new Date(now().getTime() + SNOOZE_MIN * 60 * 1000), uniqueKey: `dose-snooze:${ownerId}:${userId}:${date} ${time}:${now().getTime()}`, maxAttempts: 4 });
      return [];
    }
    by = String(by || '').trim().slice(0, 60);
    const saved = [];
    for (const i of list) {
      const item = { ...i };
      delete item.label;
      item.doses = [...(i.doses || []), { at: now().toISOString(), day: date, kind: action, slot: time, ...(by && by.toLowerCase() !== 'you' ? { by } : {}) }].slice(-200);
      saved.push((await data.saveItem(ownerId, item)).item);
    }
    return saved;
  }

  /* The test notification: the next dose of the first confirmed medication with dose times on the family's plan (examples
     included, so it can be tried on day one), with the same three buttons, which mark that dose. Null when there's none. */
  async function testDose(ownerId, userId = ownerId) {
    const local = localParts(now(), await timeZoneOf(userId, await settingsOf(ownerId))), list = await store.listItems(ownerId);
    for (const i of list) {
      if (!i || !i.med || i.status !== 'deciding' || i.pickup || i.asNeeded || !Array.isArray(i.times)) continue;
      const times = [...new Set(i.times.filter(validTime))].sort();
      const open = times.filter(t => unmarked([i], local.date, t, [i.id]).length);
      const time = open.find(t => t >= local.time) || open[open.length - 1];
      if (time) return doseNotification({ time, items: [i] }, local.date, { patient: await patientOf(ownerId) });
    }
    return null;
  }

  /* The user's local date and time now. */
  const localNow = async userId => localParts(now(), await timeZoneOf(userId, await settingsOf(userId)));

  /* Reminders: this person's choices, saved as they change them. */
  const savePrefs = async (userId, body) => { await store.setAlertPrefs(userId, { ...((await store.alertPrefs(userId)) || {}), ...cleanPrefs(body) }); return prefsOf(userId); };

  return { claim, dispatch, send, sendDose, sendTask, sendAppointment, sendMissed, sendEndOfDay, incidentReported, sendIncident, sendTo, followup, opened, act, actDose, testDose, localNow, settingsOf, prefsOf, savePrefs, teamOf };
}

module.exports = { pick, notification, dosesDue, doseNotification, unmarked, DOSE_ACTIONS, appointmentsDue, appointmentNotification, taskOn, tasksDue, taskNotification, missedAt, missedNotification, incidentNotification, daySummary, endOfDayNotification, MISSED_MIN, ALERT_MIN, cleanPrefs, daysLabel, localParts, validTimeZone, reminderTime, quiet, sendTime, isDue, cleanSubscription, vapidConfig, createPush, createReminders, PUSH_HOSTS };
