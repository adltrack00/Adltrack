/* Daily reminders: one rule picks the day's reminder (every return due, grouped, most urgent first, respecting snoozeUntil,
   "Gentle" and quiet hours; the words come from nudge.js), and each user gets it once a day at their reminder time: by Web
   Push, by email when push isn't set up on any device, or by the open app's own notification. Whichever claims the day first
   sends it, so the user never gets two. A pushed reminder that isn't opened 3 days before a deadline is followed by email. */
const C = require('../core.js');
const N = require('../nudge.js');

const DEFAULT_TIME = '09:00';
// Push services that browsers subscribe with. The server only ever sends to these hosts.
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];
// How long after a pushed reminder an unopened one is followed by email (on the day an item has 3 days left).
const FOLLOW_UP_MS = 4 * 60 * 60 * 1000;
const daysLabel = N.daysLabel;

/* What a push message carries: the notification's words, the item it opens and its action buttons. */
const notification = r => ({ title: r.title, body: r.body, itemId: r.itemId, url: r.url, actions: r.actions });

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
const minutes = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
function dosesDue(items, date, time) {
  const at = minutes(time), due = {};
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
function doseNotification({ time, items }) {
  const how = i => i.instructions || [i.dose, i.route, i.frequency].filter(Boolean).join(' ');
  const lines = items.slice(0, 4).map(i => i.name + (how(i) ? ': ' + how(i) : ''));
  if (items.length > 4) lines.push(`Plus ${items.length - 4} more.`);
  return { title: `Adltrack · ${clock12(time)} medication${items.length > 1 ? 's' : ''}`, body: lines.join(' · ').slice(0, 500), itemId: items[0].id, url: 'app.html?remind=' + encodeURIComponent(items[0].id), actions: [] };
}

/* Follow-up appointment reminders: the day before (from the user's reminder time, outside quiet hours) and 2 hours before
   (when the time is known), one push each. Only appointments the family confirmed, with a date, that they haven't marked
   Went; never examples. Moving the date reminds again for the new date. */
const SOON_MIN = 120;
function appointmentsDue(items, date, time, settings = {}) {
  const at = minutes(time), out = [];
  for (const i of items || []) {
    if (!i || !i.appt || i.demo || i.status !== 'deciding' || !C.parseDate(i.date) || (i.steps && i.steps.went)) continue;
    if (C.days(i.date, date) === 1 && isDue(settings, time)) out.push({ item: i, kind: 'day' });
    else if (i.date === date && validTime(i.time) && at >= minutes(i.time) - SOON_MIN && at < minutes(i.time)) out.push({ item: i, kind: 'soon' });
  }
  return out;
}
function appointmentNotification({ item: i, kind }) {
  const when = kind === 'day' ? 'tomorrow' : 'today';
  const what = 'Follow-up visit' + (i.with ? ' with ' + i.with : '');
  const body = [[validTime(i.time) ? clock12(i.time) : '', i.place].filter(Boolean).join(' · '), i.phone ? 'Call ' + i.phone + ' to change it.' : ''].filter(Boolean).join('. ');
  return { title: `Adltrack · ${what} ${when}`.slice(0, 120), body: body.slice(0, 500), itemId: i.id, url: 'app.html?remind=' + encodeURIComponent(i.id), actions: [] };
}
const appointmentSlot = (i, kind) => `${i.date} appt ${kind} ${String(i.id).slice(0, 100)}`;

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

function createReminders({ store, push, email = null, data = null, now = () => new Date(), log = console }) {
  const settingsOf = async userId => ((await store.getRawData(userId))?.payload?.settings) || {};
  const timeZoneOf = async (userId, settings) => {
    const subs = await store.listPushSubscriptions(userId);
    return subs[0]?.timeZone || (validTimeZone(settings.timeZone) ? settings.timeZone : 'UTC');
  };
  const emailOn = async (userId, kind) => !!(email && email.available()) && !(await store.emailOptouts(userId)).includes(kind);

  /* Claims the user's reminder for `date` (their local date) once; returns the reminder to show, or null when the day was
     already claimed or nothing is due. A day with nothing due is claimed too, so it's checked once. */
  async function claim(userId, date, by, settings = null) {
    const c = await store.claimReminderDay(userId, date, by);
    if (!c.claimed) return { claimed: false, reminder: null };
    return { claimed: true, previous: c.previous, reminder: pick(await store.listItems(userId), date, settings || await settingsOf(userId)) };
  }

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

  async function mail(userId, reminder, kind, date) {
    const user = await store.findUserById(userId);
    if (!user) return false;
    await email.sendReminder(user.email, userId, reminder, { kind, date });
    return true;
  }

  /* Every minute: queue a send for each user whose reminder time has come today in their time zone (outside quiet hours),
     and who can be reached: a device for push, or email when push isn't set up. */
  async function dispatch() {
    const canPush = push.available(), canEmail = !!(email && email.available());
    if (!canPush && !canEmail) return 0;
    let queued = 0;
    const candidates = await store.reminderCandidates();
    if (canPush) queued += await dispatchDoses(candidates);
    for (const c of candidates) {
      const settings = c.settings || {};
      if (settings.daily === false) continue;
      const tz = c.timeZone || (validTimeZone(settings.timeZone) ? settings.timeZone : null);
      if (!tz && !(canPush && c.hasPush)) continue;
      const local = localParts(now(), tz);
      if (!isDue(settings, local.time) || c.lastDate === local.date) continue;
      if (!(canPush && c.hasPush) && !(await emailOn(c.userId, 'daily'))) continue;
      queued++;
      await store.enqueueJob({ name: 'reminders.send', payload: { userId: c.userId, date: local.date }, runAt: new Date(), uniqueKey: `reminder:${c.userId}:${local.date}`, maxAttempts: 4 });
    }
    return queued;
  }

  /* Every minute, for each user with a device: claim each dose that has come due (once per dose) and queue its push. The
     items are read only for users push can reach, since dose reminders go by push alone (an email per dose would be noise). */
  async function dispatchDoses(candidates) {
    let queued = 0;
    for (const c of candidates) {
      if (!c.hasPush || (c.settings || {}).daily === false) continue;
      const local = localParts(now(), c.timeZone), items = await store.listItems(c.userId);
      for (const d of dosesDue(items, local.date, local.time)) {
        const slot = `${local.date} ${d.time}`;
        if (!(await store.claimDoseReminder(c.userId, slot))) continue;
        queued++;
        await store.enqueueJob({ name: 'reminders.dose', payload: { userId: c.userId, date: local.date, time: d.time }, runAt: new Date(), uniqueKey: `dose:${c.userId}:${slot}`, maxAttempts: 4 });
      }
      // Follow-up appointments, claimed the same way so each one is reminded once the day before and once 2 hours before.
      for (const a of appointmentsDue(items, local.date, local.time, c.settings || {})) {
        const slot = appointmentSlot(a.item, a.kind);
        if (!(await store.claimDoseReminder(c.userId, slot))) continue;
        queued++;
        await store.enqueueJob({ name: 'reminders.appointment', payload: { userId: c.userId, id: a.item.id, kind: a.kind, slot }, runAt: new Date(), uniqueKey: `appt:${c.userId}:${slot}`, maxAttempts: 4 });
      }
    }
    return queued;
  }

  /* One dose time's push: the medications still due at that time (one marked taken since is left out). */
  async function sendDose({ userId, date, time }) {
    const slot = `${date} ${time}`;
    const due = dosesDue(await store.listItems(userId), date, time).find(d => d.time === time);
    const subs = push.available() ? await store.listPushSubscriptions(userId) : [];
    if (!due || !subs.length) return;
    const { sent, failed } = await sendTo(userId, subs, doseNotification(due), { topic: 'dose', ttl: DOSE_WINDOW_MIN * 60, urgency: 'high' });
    if (!sent && failed) { await store.releaseDoseReminder(userId, slot); throw new Error(`Dose push failed for all ${failed} device${failed === 1 ? '' : 's'}.`); }
  }

  /* One appointment's push, if it's still due (not marked Went or moved since it was queued). */
  async function sendAppointment({ userId, id, kind, slot }) {
    const settings = await settingsOf(userId), local = localParts(now(), await timeZoneOf(userId, settings));
    const due = appointmentsDue(await store.listItems(userId), local.date, local.time, settings).find(a => a.item.id === id && a.kind === kind && appointmentSlot(a.item, kind) === slot);
    const subs = push.available() ? await store.listPushSubscriptions(userId) : [];
    if (!due || !subs.length) return;
    const { sent, failed } = await sendTo(userId, subs, appointmentNotification(due), { topic: 'appointment', ttl: SOON_MIN * 60, urgency: 'high' });
    if (!sent && failed) { await store.releaseDoseReminder(userId, slot); throw new Error(`Appointment push failed for all ${failed} device${failed === 1 ? '' : 's'}.`); }
  }

  async function send({ userId, date }) {
    const settings = await settingsOf(userId);
    let subs = push.available() ? await store.listPushSubscriptions(userId) : [];
    const daily = await emailOn(userId, 'daily');
    if (!subs.length && !daily) return;
    const c = await claim(userId, date, subs.length ? 'push' : 'email', settings);
    if (!c.claimed || !c.reminder) return;
    if (subs.length) {
      const { sent, failed } = await sendTo(userId, subs, notification(c.reminder));
      if (sent) {
        if (failed) log.error(`Reminder push failed for ${failed} of ${subs.length} devices.`);
        // An item with 3 days left: if this reminder isn't opened, follow it up by email.
        if (c.reminder.items.some(id => c.reminder.days[id] === 3) && await emailOn(userId, 'unopened'))
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
    // No device could be reached by push: the same reminder by email.
    if (daily) {
      try { await mail(userId, c.reminder, 'daily', date); }
      catch (err) { await store.releaseReminderDay(userId, date, c.previous); throw err; }
    }
  }

  /* A few hours after a pushed reminder with an item at 3 days left: email it when it still hasn't been opened. */
  async function followup({ userId, date }) {
    const day = await store.reminderDay(userId);
    if (!day || day.lastDate !== date || day.openedDate === date || !(await emailOn(userId, 'unopened'))) return;
    const settings = await settingsOf(userId);
    if (settings.daily === false) return;
    const tz = await timeZoneOf(userId, settings), local = localParts(now(), tz);
    if (local.date !== date) return;
    if (quiet(settings, local.time)) {
      await store.enqueueJob({ name: 'reminders.followup', payload: { userId, date }, runAt: new Date(now().getTime() + 30 * 60 * 1000), uniqueKey: `followup:${userId}:${date}:${local.time}`, maxAttempts: 4 });
      return;
    }
    const reminder = pick(await store.listItems(userId), date, settings);
    if (reminder && reminder.items.some(id => reminder.days[id] === 3)) await mail(userId, reminder, 'unopened', date);
  }

  /* A reminder was opened (tapped, an action used, or an email link followed). */
  const opened = userId => store.markReminderOpened(userId);

  /* "Snooze until tomorrow", "I sent it back" and "I'm keeping it", from a notification or an email, without opening the app.
     `today` is the user's local date. */
  async function act(userId, itemId, action, today) {
    const found = typeof itemId === 'string' && itemId.length <= 200 ? await store.getItem(userId, itemId) : null;
    if (!found) return null;
    const item = { ...found.item };
    delete item.label;
    if (action === 'snooze') item.snoozeUntil = C.shift(today, 1);
    else if (action === 'sent') { if (!['received', 'kept'].includes(item.status)) { item.status = 'shipped'; item.returnedOn = today; } }
    else if (action === 'keep') { item.status = 'kept'; item.intent = 'keep'; }
    else return null;
    await opened(userId);
    return (await data.saveItem(userId, item)).item;
  }

  /* The user's local date and time now. */
  const localNow = async userId => localParts(now(), await timeZoneOf(userId, await settingsOf(userId)));

  return { claim, dispatch, send, sendDose, sendAppointment, sendTo, followup, opened, act, localNow, settingsOf };
}

module.exports = { pick, notification, dosesDue, doseNotification, appointmentsDue, appointmentNotification, daysLabel, localParts, validTimeZone, reminderTime, quiet, sendTime, isDue, cleanSubscription, vapidConfig, createPush, createReminders, PUSH_HOSTS };
