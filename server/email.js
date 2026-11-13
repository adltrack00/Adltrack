/* Transactional email through Resend: the reminder email backup and password reset links.
   Why Resend: sign-up needs no company email address and there's no manual account approval, so it's quick to set up; it
   delivers through Amazon SES with DKIM and SPF on your own domain; its plain JSON HTTP API needs no extra library; and it
   passes our own List-Unsubscribe headers through, so mail apps can offer one-click unsubscribe (RFC 8058).
   Links in emails carry signed tokens (HMAC-SHA256 with EMAIL_TOKEN_SECRET), so actions and unsubscribes work without signing in,
   but only for the one account, item and action they were made for. */
const crypto = require('node:crypto');

const API_URL = 'https://api.resend.com/emails';
const KINDS = ['daily', 'unopened'];
const KIND_NAMES = { daily: 'daily reminder emails', unopened: 'emails when a reminder wasn’t opened 3 days before a deadline' };
const ACTIONS = ['snooze', 'sent', 'keep'];
const ACTION_DAYS = 14;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Email settings from the environment, or null when email isn't set up. */
function emailConfig(env) {
  const key = env.RESEND_API_KEY || '', from = env.EMAIL_FROM || '', appUrl = (env.APP_URL || '').replace(/\/+$/, '');
  if (!key || !from || !/^https?:\/\//.test(appUrl)) return null;
  return { key, from, appUrl, replyTo: env.SUPPORT_EMAIL || '' };
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
<div style="max-width:520px;margin:0 auto;padding:32px 22px"><p style="font-size:20px;font-weight:bold;margin:0 0 24px">Adltrack.</p>${inner}
<p style="font-size:11px;line-height:1.6;color:#777;margin-top:32px">${footer}</p></div></body></html>`;
const button = (href, label, dark) => `<a href="${esc(href)}" style="display:inline-block;margin:0 8px 10px 0;padding:11px 16px;border-radius:999px;font-size:13px;text-decoration:none;${dark ? 'background:#222220;color:#fff' : 'border:1px solid #222220;color:#222220'}">${esc(label)}</a>`;

/* The reminder email: the same title and words as the notification, its actions as links, and one-click unsubscribe for this type. */
function reminderEmail(reminder, { kind, links }) {
  const actionLinks = reminder.actions.map(a => button(links[a.action], a.title, a.action === 'show-qr'));
  const other = KINDS.find(k => k !== kind);
  const html = page(`<p style="font-size:22px;line-height:1.3;margin:0 0 12px">${esc(reminder.title.replace(/^Adltrack · /, ''))}</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 22px">${esc(reminder.body)}</p>
${button(links.open, 'Open in Adltrack', true)}<div style="margin-top:6px">${actionLinks.join('')}</div>`,
    `You get this because daily reminders are on in Adltrack${String(reminder.tag || '').startsWith('appt ') ? '' : kind === 'daily' ? ' and push notifications aren’t set up on a device' : ' and the last reminder wasn’t opened'}. <a href="${esc(links.unsubscribe)}" style="color:#777">Unsubscribe from ${esc(KIND_NAMES[kind])}</a> · <a href="${esc(links.unsubscribeOther)}" style="color:#777">Unsubscribe from ${esc(KIND_NAMES[other])}</a>`);
  const text = `${reminder.title}\n\n${reminder.body}\n\nOpen in Adltrack: ${links.open}\n${reminder.actions.map(a => `${a.title}: ${links[a.action]}`).join('\n')}\n\nUnsubscribe from ${KIND_NAMES[kind]}: ${links.unsubscribe}\nUnsubscribe from ${KIND_NAMES[other]}: ${links.unsubscribeOther}\n`;
  return { subject: reminder.title.replace(/^Adltrack · /, 'Adltrack: '), html, text };
}

function resetEmail(link) {
  const html = page(`<p style="font-size:22px;line-height:1.3;margin:0 0 12px">Reset your password.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 22px">Tap the button to choose a new password. The link works once, for one hour.</p>${button(link, 'Choose a new password', true)}`,
    'If you didn’t ask for this, ignore this email. Your password stays the same.');
  return { subject: 'Reset your Adltrack password', html, text: `Reset your Adltrack password\n\nChoose a new password (the link works once, for one hour):\n${link}\n\nIf you didn't ask for this, ignore this email. Your password stays the same.\n` };
}

function inviteEmail({ inviter, name, role, link }) {
  const html = page(`<p style="font-size:22px;line-height:1.3;margin:0 0 12px">${esc(inviter)} added you to their care team.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 22px">Hi ${esc(name)}, you’re on Adltrack as ${esc(role)}. Adltrack keeps the family and caregivers on the same page: the medications, the daily care report and photos, refills and visits. Create your account or sign in to join. The link works for 14 days.</p>${button(link, 'Join the care team', true)}`,
    'If you weren’t expecting this, ignore this email. Nothing happens unless you join.');
  return { subject: `${inviter} added you to their care team on Adltrack`, html, text: `${inviter} added you to their care team on Adltrack\n\nHi ${name}, you're on Adltrack as ${role}. Join the care team (the link works for 14 days):\n${link}\n\nIf you weren't expecting this, ignore this email.\n` };
}

/* To whoever runs Adltrack (ALERT_EMAIL): reminders stopped sending, or started again. */
function healthEmail({ stopped, since, appUrl }) {
  const head = stopped ? 'Adltrack reminders have stopped sending.' : 'Adltrack reminders are sending again.';
  const body = stopped ? `The reminder check hasn’t run since ${since}. Dose reminders and alerts aren’t going out. Open Render, check the adltrack service’s logs and restart it if it’s stuck.` : 'The reminder check is running again. Nothing else to do.';
  return { subject: head, html: page(`<p style="font-size:22px;line-height:1.3;margin:0 0 12px">${esc(head)}</p><p style="font-size:14px;line-height:1.6;margin:0 0 22px">${esc(body)}</p>${button(appUrl + '/api/health', 'See the health check', true)}`, 'Sent by Adltrack’s health check.'), text: `${head}\n\n${body}\n\n${appUrl}/api/health\n` };
}

/* Sends email. `send(message)` is the Resend call (tests pass a fake). */
function createEmail({ config = null, secret = '', send = null, fetch: fetchImpl = globalThis.fetch } = {}) {
  const tokens = createTokens(secret);
  const sender = send || (config ? async m => {
    const res = await fetchImpl(API_URL, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}` }, body: JSON.stringify(m), signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Email failed (${res.status})`);
  } : null);
  const appUrl = config ? config.appUrl : 'http://localhost';
  // Resend's email fields. Open and click tracking are per domain in Resend and stay off (its default).
  const message = (to, { subject, html, text }, tag, headers = {}) => ({ from: config ? config.from : 'Adltrack <test@example.com>', to: [to], subject, html, text, tags: [{ name: 'type', value: tag }], headers, ...(config && config.replyTo ? { reply_to: config.replyTo } : {}) });

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
      await sender(message(to, reminderEmail(reminder, { kind, links }), 'reminder-' + kind, {
        'List-Unsubscribe': `<${links.oneClick}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
      }));
    },
    async sendReset(to, token) {
      await sender(message(to, resetEmail(`${appUrl}/reset.html#token=${token}`), 'password-reset'));
    },
    async sendInvite(to, invite) {
      await sender(message(to, inviteEmail(invite), 'team-invite'));
    },
    async sendHealth(to, status) {
      await sender(message(to, healthEmail({ ...status, appUrl }), 'health'));
    }
  };
}

module.exports = { createEmail, emailConfig, createTokens, reminderEmail, resetEmail, inviteEmail, healthEmail, KINDS, ACTIONS };
