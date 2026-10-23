/* Background jobs, queued in Postgres (or the local file store) and run inside the Node server.
   Several server instances can share the queue: each job is claimed by one runner at a time (FOR UPDATE SKIP LOCKED),
   failures are retried with backoff, and a job whose runner died is picked up again after `staleMs`. */
const HOUR = 60 * 60 * 1000;

function createJobs({ store, intervalMs = 5000, staleMs = 10 * 60 * 1000, log = console }) {
  const handlers = new Map(), recurring = new Map(), finished = new Map();
  let timer = null, running = null, stopped = true;

  /* handler(payload, job) does the work; throwing retries it. */
  function define(name, handler, { every = null } = {}) {
    handlers.set(name, handler);
    if (every) recurring.set(name, every);
  }
  const enqueue = (name, payload = {}, { runAt = new Date(), uniqueKey = null, maxAttempts = 5 } = {}) => {
    if (!handlers.has(name)) throw new Error(`Unknown job: ${name}`);
    return store.enqueueJob({ name, payload, runAt, uniqueKey, maxAttempts });
  };
  // One queued run of each recurring job at a time, however many servers are running.
  const scheduleNext = (name, runAt) => store.enqueueJob({ name, payload: {}, runAt, uniqueKey: `every:${name}`, maxAttempts: 3 });
  const backoff = attempts => Math.min(30_000 * 2 ** (attempts - 1), 6 * HOUR);

  /* Runs one due job. Returns false when nothing was due. */
  async function runOnce() {
    const job = await store.claimJob(staleMs);
    if (!job) return false;
    const handler = handlers.get(job.name);
    try {
      if (!handler) throw new Error(`Unknown job: ${job.name}`);
      await handler(job.payload, job);
      await store.completeJob(job.id);
      finished.set(job.name, Date.now());
    } catch (err) {
      const message = String(err && err.message || err).slice(0, 500);
      if (job.attempts < job.maxAttempts && handler) await store.retryJob(job.id, message, new Date(Date.now() + backoff(job.attempts)));
      else { await store.failJob(job.id, message); log.error(`Job ${job.name} (${job.id}) failed: ${message}`); }
    }
    if (recurring.has(job.name) && job.uniqueKey === `every:${job.name}`) {
      const latest = await store.getJob(job.id);
      if (latest && latest.status !== 'queued') await scheduleNext(job.name, new Date(Date.now() + recurring.get(job.name)));
    }
    return true;
  }
  /* Runs due jobs until none are left (used by tests and at each tick). */
  async function drain(limit = 100) { let n = 0; while (n < limit && await runOnce()) n++; return n; }

  async function tick() {
    if (stopped) return;
    try { running = drain(); await running; } catch (err) { log.error('Job runner error:', err.message); }
    finally { running = null; if (!stopped) { timer = setTimeout(tick, intervalMs); if (timer.unref) timer.unref(); } }
  }
  async function start() {
    stopped = false;
    for (const name of recurring.keys()) await scheduleNext(name, new Date());
    timer = setTimeout(tick, 0);
    if (timer.unref) timer.unref();
  }
  async function stop() { stopped = true; clearTimeout(timer); if (running) await running.catch(() => {}); }

  // When a job last finished without an error on this server (for the health check), or null.
  const lastRun = name => finished.get(name) || null;

  return { define, enqueue, runOnce, drain, start, stop, lastRun };
}

/* The jobs this server runs. */
function defineJobs(jobs, { store, storage, data = null, reminders = null }) {
  // Example recurring job: clears expired sign-in sessions and old finished jobs.
  jobs.define('maintenance.cleanup', async () => {
    await store.deleteExpiredSessions();
    await store.deleteExpiredPasswordResets();
    await store.deleteOldSignIns(new Date(Date.now() - 90 * 24 * HOUR));
    await store.deleteFinishedJobs(new Date(Date.now() - 30 * 24 * HOUR));
    // Cached drop-off places (ids and coordinates) are kept for at most 30 days, as the places provider's terms require.
    await store.deleteOldPlaceCache(new Date(Date.now() - 30 * 24 * HOUR));
    // Sign-in and inbox-connect requests that were never finished.
    if (store.deleteExpiredOAuthStates) await store.deleteExpiredOAuthStates();
  }, { every: 6 * HOUR });
  // Scanned receipts whose items were never saved (the scan was abandoned) are deleted after two days.
  if (data) jobs.define('receipts.cleanup', async () => { await data.cleanupReceipts(new Date(Date.now() - 48 * HOUR)); }, { every: 6 * HOUR });
  // Daily reminders by Web Push or email: every minute, queue a send for each user whose reminder time has come in their
  // time zone; an unopened push reminder 3 days before a deadline is followed by email.
  if (reminders) {
    jobs.define('reminders.dispatch', () => reminders.dispatch(), { every: 60 * 1000 });
    jobs.define('reminders.send', payload => reminders.send(payload));
    jobs.define('reminders.followup', payload => reminders.followup(payload));
    // A medication's dose time: one push per dose time, queued by the same every-minute dispatch.
    jobs.define('reminders.dose', payload => reminders.sendDose(payload));
    // A follow-up appointment: the day before and 2 hours before.
    jobs.define('reminders.appointment', payload => reminders.sendAppointment(payload));
    // A task from the + on My Tasks, at its time.
    jobs.define('reminders.task', payload => reminders.sendTask(payload));
    // Alerts to everyone on a family's care team: a missed dose, each person's end-of-day report, and an incident.
    jobs.define('alerts.missed', payload => reminders.sendMissed(payload));
    jobs.define('alerts.endOfDay', payload => reminders.sendEndOfDay(payload));
    jobs.define('alerts.incident', payload => reminders.sendIncident(payload));
  }
  // Retries deleting stored files that couldn't be removed straight away (for example, after "Delete my account").
  jobs.define('files.delete', async ({ keys }) => {
    for (const key of keys || []) await storage.remove(key);
  });
}

/* Any store, always current: web lookups for stores we don't have, and the weekly check of every checked retailer's sources. */
function defineReviewJobs(jobs, review) {
  jobs.define('stores.lookup', payload => review.runLookup(payload));
  jobs.define('policies.freshness', () => review.freshness(), { every: 7 * 24 * HOUR });
}

/* Purchases from email: a connected inbox is checked for new shopping mail every 15 minutes (and straight away when Outlook
   says something arrived); each message is read on its own, and forwarded mail is fetched from Resend by id when its job runs. */
function defineInboxJobs(jobs, inbox) {
  jobs.define('inbox.poll', () => inbox.poll(), { every: 15 * 60 * 1000 });
  jobs.define('inbox.sync', payload => inbox.sync(payload));
  jobs.define('inbox.message', payload => inbox.readMessage(payload));
  jobs.define('inbox.forwarded', payload => inbox.readForwarded(payload));
}

module.exports = { createJobs, defineJobs, defineReviewJobs, defineInboxJobs };
