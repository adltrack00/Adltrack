/* Daily reminders: one rule picks the day's reminder (the most urgent item plus "Plus N other return windows", respecting
   snoozeUntil), and each user gets it once a day at their reminder time, by Web Push when the app is closed or by the open
   app's own notification. Whichever claims the day first sends it, so the user never gets both. */
const C = require('../core.js');

const statusNames = { deciding: 'Deciding', started: 'Return started', shipped: 'Returned · awaiting outcome', received: 'Received', kept: 'Keeping it' };
const DEFAULT_TIME = '09:00';
// Push services that browsers subscribe with. The server only ever sends to these hosts.
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];

/* Same words as the app's countdown badge (daysLabel in app.js). */
function daysLabel(i, today) {
  const n = C.days(C.due(i), today);
  if (['kept', 'received'].includes(i.status)) return statusNames[i.status];
  if (i.status === 'shipped') return 'Awaiting ' + (i.outcome === 'credit' ? 'credit' : 'outcome');
  if (i.outcome === 'final') return 'Not returnable';
  if (n === null && i.window === null && i.confirmed) return 'No fixed window';
  if (n === null) return 'Awaiting delivery';
  if (n < 0) return 'Window ended';
  if (!i.confirmed && !i.dateSet && i.status !== 'started') return 'Date unconfirmed';
  return n === 0 ? 'Due today' : n === 1 ? 'Due tomorrow' : `${n} days left`;
}

/* The day's reminder for these items on `today` (the user's local date), or null when nothing needs one: items being returned
   or with a confirmed window, not sent back, kept or received, not examples, with a deadline, and not snoozed past today. */
function pick(items, today) {
  const days = i => { const n = C.days(C.due(i), today); return n === null ? Infinity : n; };
  const list = (items || []).filter(i => i && C.active(i, today) && !i.demo
    && (i.status === 'started' || (i.confirmed && i.status !== 'shipped' && i.requirement !== 'unknown'))
    && C.due(i) && (!i.snoozeUntil || i.snoozeUntil <= today))
    .sort((a, b) => days(a) - days(b));
  if (!list.length) return null;
  const first = list[0], clip = (s, n) => String(s || '').slice(0, n);
  return {
    title: 'Returnly · ' + daysLabel(first, today),
    body: (clip(first.name, 120) + '. ' + clip(first.next, 200)).trim() + (list.length > 1 ? ` Plus ${list.length - 1} other return windows.` : ''),
    itemId: first.id,
    url: 'app.html?remind=' + encodeURIComponent(first.id)
  };
}

const validTimeZone = tz => { if (typeof tz !== 'string' || !tz || tz.length > 64) return false; try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };
/* The local date (YYYY-MM-DD) and time (HH:MM) at `now` in a time zone. */
function localParts(now, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: validTimeZone(tz) ? tz : 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
const reminderTime = settings => typeof settings?.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(settings.time) ? settings.time : DEFAULT_TIME;

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
    async deliver(sub, message) {
      const payload = JSON.stringify(message);
      // TTL: a reminder older than 12 hours isn't worth showing. Topic: a newer reminder replaces one not yet delivered.
      try { await sender({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 12 * 60 * 60, urgency: 'normal', topic: 'daily' }); return 'sent'; }
      catch (err) { return [404, 410].includes(err && err.statusCode) ? 'gone' : 'failed'; }
    }
  };
}

function createReminders({ store, push, now = () => new Date(), log = console }) {
  /* Claims the user's reminder for `date` (their local date) once; returns the reminder to show, or null when the day was
     already claimed or nothing is due. A day with nothing due is claimed too, so it's checked once. */
  async function claim(userId, date, by) {
    const c = await store.claimReminderDay(userId, date, by);
    if (!c.claimed) return { claimed: false, reminder: null };
    return { claimed: true, previous: c.previous, reminder: pick(await store.listItems(userId), date) };
  }

  async function sendTo(userId, subs, message) {
    let sent = 0, failed = 0;
    for (const sub of subs) {
      const r = await push.deliver(sub, message);
      if (r === 'sent') sent++;
      else if (r === 'gone') await store.deletePushSubscription(sub.endpoint, userId);
      else failed++;
    }
    return { sent, failed };
  }

  /* Every minute: queue a send for each user with a push subscription whose reminder time has come today. */
  async function dispatch() {
    if (!push.available()) return 0;
    let queued = 0;
    for (const c of await store.reminderCandidates()) {
      if (c.settings && c.settings.daily === false) continue;
      const local = localParts(now(), c.timeZone);
      if (local.time < reminderTime(c.settings) || c.lastDate === local.date) continue;
      queued++;
      await store.enqueueJob({ name: 'reminders.send', payload: { userId: c.userId, date: local.date }, runAt: new Date(), uniqueKey: `reminder:${c.userId}:${local.date}`, maxAttempts: 4 });
    }
    return queued;
  }

  async function send({ userId, date }) {
    const subs = await store.listPushSubscriptions(userId);
    if (!subs.length) return;
    const c = await claim(userId, date, 'push');
    if (!c.claimed || !c.reminder) return;
    const { sent, failed } = await sendTo(userId, subs, c.reminder);
    if (!sent && failed) {
      // Nothing reached any device: give the day back so the retry (or the open app) can still send it.
      await store.releaseReminderDay(userId, date, c.previous);
      throw new Error(`Push failed for all ${failed} device${failed === 1 ? '' : 's'}.`);
    }
    if (failed) log.error(`Reminder push failed for ${failed} of ${subs.length} devices.`);
  }

  return { claim, dispatch, send, sendTo };
}

module.exports = { pick, daysLabel, localParts, validTimeZone, reminderTime, cleanSubscription, vapidConfig, createPush, createReminders, PUSH_HOSTS };
