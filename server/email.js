/* Transactional email through Postmark: the reminder email backup and password reset links.
   Why Postmark: it only sends transactional mail (no marketing lists sharing its sending reputation), so reminders and reset
   links land in the inbox and arrive in seconds; its plain JSON HTTP API needs no extra library; and it passes our own
   List-Unsubscribe headers through, so mail apps can offer one-click unsubscribe (RFC 8058).
   Links in emails carry signed tokens (HMAC-SHA256 with EMAIL_TOKEN_SECRET), so actions and unsubscribes work without signing in,
   but only for the one account, item and action they were made for. */
const crypto = require('node:crypto');

const API_URL = 'https://api.postmarkapp.com/email';
const KINDS = ['daily', 'unopened'];
const KIND_NAMES = { daily: 'daily reminder emails', unopened: 'emails when a reminder wasn’t opened 3 days before a deadline' };
const ACTIONS = ['snooze', 'sent', 'keep'];
const ACTION_DAYS = 14;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Email settings from the environment, or null when email isn't set up. */
function emailConfig(env) {
  const token = env.POSTMARK_SERVER_TOKEN || '', from = env.EMAIL_FROM || '', appUrl = (env.APP_URL || '').replace(/\/+$/, '');
  if (!token || !from || !/^https?:\/\//.test(appUrl)) return null;
  return { token, from, appUrl, stream: env.POSTMARK_STREAM || 'outbound' };
}

/* Signed tokens: base64url(JSON) + '.' + base64url(HMAC). */
function createTokens(secret) {
  const key = secret || crypto.randomBytes(32).toString('hex');
  const mac = body => crypto.createHmac('sha256', key).update(body).digest('base64url');
  return {
    sign: payload => { const body = Buffer.from(JSON.stringify(payload)).toString('base64url'); return body + '.' + mac(body); },
    verify(token) {
      if (typeof token !== 'string' || token.length > 600) return null;
      const [body, sig] = token.split('.');
      if (!body || !sig) return null;
      const a = Buffer.from(sig), b = Buffer.from(mac(body));
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
      let p; try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
      if (!p || typeof p !== 'object' || (p.exp && p.exp < Date.now())) return null;
      return p;
    }
  };
}

const page = (inner, footer = '') => `<!doctype html><html><body style="margin:0;background:#f6f6f3;font-family:Arial,Helvetica,sans-serif;color:#222220">
<div style="max-width:520px;margin:0 auto;padding:32px 22px"><p style="font-size:20px;font-weight:bold;margin:0 0 24px">Returnly.</p>${inner}
<p style="font-size:11px;line-height:1.6;color:#777;margin-top:32px">${footer}</p></div></body></html>`;
const button = (href, label, dark) => `<a href="${esc(href)}" style="display:inline-block;margin:0 8px 10px 0;padding:11px 16px;border-radius:999px;font-size:13px;text-decoration:none;${dark ? 'background:#222220;color:#fff' : 'border:1px solid #222220;color:#222220'}">${esc(label)}</a>`;

/* The reminder email: the same title and words as the notification, its actions as links, and one-click unsubscribe for this type. */
function reminderEmail(reminder, { kind, links }) {
  const actionLinks = reminder.actions.map(a => button(links[a.action], a.title, a.action === 'show-qr'));
  const other = KINDS.find(k => k !== kind);
  const html = page(`<p style="font-size:22px;line-height:1.3;margin:0 0 12px">${esc(reminder.title.replace(/^Returnly · /, ''))}</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 22px">${esc(reminder.body)}</p>
${button(links.open, 'Open in Returnly', true)}<div style="margin-top:6px">${actionLinks.join('')}</div>`,
    `You get this because daily reminders are on in Returnly${kind === 'daily' ? ' and push notifications aren’t set up on a device' : ' and the last reminder wasn’t opened'}. <a href="${esc(links.unsubscribe)}" style="color:#777">Unsubscribe from ${esc(KIND_NAMES[kind])}</a> · <a href="${esc(links.unsubscribeOther)}" style="color:#777">Unsubscribe from ${esc(KIND_NAMES[other])}</a>`);
  const text = `${reminder.title}\n\n${reminder.body}\n\nOpen in Returnly: ${links.open}\n${reminder.actions.map(a => `${a.title}: ${links[a.action]}`).join('\n')}\n\nUnsubscribe from ${KIND_NAMES[kind]}: ${links.unsubscribe}\nUnsubscribe from ${KIND_NAMES[other]}: ${links.unsubscribeOther}\n`;
  return { subject: reminder.title.replace(/^Returnly · /, 'Returnly: '), html, text };
}

function resetEmail(link) {
  const html = page(`<p style="font-size:22px;line-height:1.3;margin:0 0 12px">Reset your password.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 22px">Tap the button to choose a new password. The link works once, for one hour.</p>${button(link, 'Choose a new password', true)}`,
    'If you didn’t ask for this, ignore this email. Your password stays the same.');
  return { subject: 'Reset your Returnly password', html, text: `Reset your Returnly password\n\nChoose a new password (the link works once, for one hour):\n${link}\n\nIf you didn't ask for this, ignore this email. Your password stays the same.\n` };
}

/* Sends email. `send(message)` is the Postmark call (tests pass a fake). */
function createEmail({ config = null, secret = '', send = null, fetch: fetchImpl = globalThis.fetch } = {}) {
  const tokens = createTokens(secret);
  const sender = send || (config ? async m => {
    const res = await fetchImpl(API_URL, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': config.token }, body: JSON.stringify(m), signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Email failed (${res.status})`);
  } : null);
  const appUrl = config ? config.appUrl : 'http://localhost';
  const message = (to, { subject, html, text }, tag, headers = []) => ({ From: config ? config.from : 'Returnly <test@example.com>', To: to, Subject: subject, HtmlBody: html, TextBody: text, Tag: tag, MessageStream: config ? config.stream : 'outbound', TrackOpens: false, TrackLinks: 'None', Headers: headers });

  /* Links for one reminder: open the item, each action, and unsubscribe from each type. */
  function reminderLinks(userId, reminder, kind, date) {
    const exp = Date.now() + ACTION_DAYS * 864e5;
    const act = action => `${appUrl}/email.html#a=${action}&t=${tokens.sign({ t: 'act', u: userId, i: reminder.itemId, a: action, d: date, exp })}`;
    const unsub = k => `${appUrl}/email.html#u=${k}&t=${tokens.sign({ t: 'unsub', u: userId, k })}`;
    return {
      open: `${appUrl}/${reminder.url}`,
      'show-qr': `${appUrl}/${reminder.url}&show=label`,
      snooze: act('snooze'), sent: act('sent'), keep: act('keep'),
      unsubscribe: unsub(kind), unsubscribeOther: unsub(KINDS.find(k => k !== kind)),
      oneClick: `${appUrl}/api/email/unsubscribe?t=${tokens.sign({ t: 'unsub', u: userId, k: kind })}`
    };
  }

  return {
    available: () => !!sender,
    tokens,
    async sendReminder(to, userId, reminder, { kind, date }) {
      const links = reminderLinks(userId, reminder, kind, date);
      await sender(message(to, reminderEmail(reminder, { kind, links }), 'reminder-' + kind, [
        { Name: 'List-Unsubscribe', Value: `<${links.oneClick}>` },
        { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' }
      ]));
    },
    async sendReset(to, token) {
      await sender(message(to, resetEmail(`${appUrl}/reset.html#token=${token}`), 'password-reset'));
    }
  };
}

module.exports = { createEmail, emailConfig, createTokens, reminderEmail, resetEmail, KINDS, ACTIONS };
