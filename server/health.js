/* The health check (/api/health): is the every-minute reminder check still running? When it stops, /api/health answers 503,
   so Render restarts the service and emails its owner, and ALERT_EMAIL gets an email (and another when it's running again). */

// The reminder check runs every minute; it counts as stopped after 5 minutes without a run.
const STALE_MS = 5 * 60 * 1000;

function createHealth({ jobs, remindersOn = false, email = null, alertTo = '', log = console, now = () => Date.now() }) {
  const startedAt = now();
  let alerted = false;

  /* 'sending', 'stopped', or 'off' (push, email and texts aren't set up, so there's nothing to send). */
  function status() {
    if (!remindersOn) return { ok: true, reminders: 'off', lastRun: null };
    const last = jobs.lastRun('reminders.dispatch'), since = last || startedAt;
    const stopped = now() - since > STALE_MS;
    return { ok: !stopped, reminders: stopped ? 'stopped' : 'sending', lastRun: last ? new Date(last).toISOString() : null };
  }

  /* Runs every minute: emails ALERT_EMAIL once when reminders stop, and once when they're back. */
  async function check() {
    const s = status();
    if (s.ok === !alerted) return s;
    alerted = !s.ok;
    if (alerted) log.error('Health check: reminders have stopped sending.');
    else log.log('Health check: reminders are sending again.');
    if (email && email.available() && alertTo) {
      try { await email.sendHealth(alertTo, { stopped: alerted, since: s.lastRun || new Date(startedAt).toISOString() }); }
      catch (err) { log.error('Health alert email failed:', err.message); }
    }
    return s;
  }

  return { status, check };
}

module.exports = { createHealth, STALE_MS };
