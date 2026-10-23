/* Text messages through Twilio: care team invites and appointment reminders. Why Twilio: one plain HTTPS call with no extra library, a US number
   in minutes, and delivery to every US carrier. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM (the Twilio
   number, as +15551234567). Without them invites go by email only, and the admin can copy the link. */

/* Text settings from the environment, or null when texts aren't set up. */
function smsConfig(env) {
  const sid = env.TWILIO_ACCOUNT_SID || '', token = env.TWILIO_AUTH_TOKEN || '', from = env.TWILIO_FROM || '';
  if (!/^AC[0-9a-f]{32}$/i.test(sid) || !token || !/^\+[1-9]\d{6,14}$/.test(from)) return null;
  return { sid, token, from };
}

/* A phone number as typed → E.164 (+15551234567), or null. Ten digits are taken as a US number. */
function normPhone(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return /^[1-9]\d{6,14}$/.test(digits) ? '+' + digits : null;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  return null;
}

/* Sends texts. `send({ to, body })` is the Twilio call (tests pass a fake). */
function createSms({ config = null, send = null, fetch: fetchImpl = globalThis.fetch } = {}) {
  const sender = send || (config ? async ({ to, body }) => {
    const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${config.sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${config.sid}:${config.token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: config.from, Body: body }).toString(),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`Text failed (${res.status})`);
  } : null);
  return {
    available: () => !!sender,
    async sendText(to, body) {
      await sender({ to, body });
    },
    async sendInvite(to, { inviter, role, link }) {
      await sender({ to, body: `${inviter} added you to their care team on Adltrack as ${role}. Join here: ${link}` });
    }
  };
}

module.exports = { createSms, smsConfig, normPhone };
