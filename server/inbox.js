/* Purchases from email. Three ways in: a private forwarding address (the email provider's inbound webhook), a connected
   Gmail inbox (read-only) and a connected Outlook inbox (Graph, Mail.Read). Every email is read on the server by a job, and
   only what it says about an order is kept, with the message id: never the email itself.
   - A new order becomes a card on Your purchases ("From email"). Tapping it opens the Item card filled in; nothing becomes
     a return until the user taps.
   - A delivery notice sets `delivered` on that order's items and recomputes their deadline.
   - A return notice moves items the user is returning to `started` or `shipped`; a refund notice records the amount and
     date and marks the item received, like "Return complete". Matching is by store and order number. */
const crypto = require('node:crypto');
const { evaluate } = require('./engine');
const C = require('../core.js');
const { knownSender, isShoppingEmail, gmailQuery, bodyText, forwardedFrom, address, orderKey, RECENT_DAYS } = require('./mail');
const { seal, unseal } = require('./oauth');

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const MAX_FIRST_IMPORT = 300, MAX_PER_SYNC = 100, DAY = 864e5;
// Graph mail subscriptions last at most a few days; they are renewed when less than a day is left.
const SUBSCRIPTION_DAYS = 3;
const ACTIVE = ['deciding', 'started', 'shipped'];
// Seconds a token lasts, as the provider says (an hour when it doesn't).
const lifetime = s => (s === undefined || s === null || !Number.isFinite(Number(s)) ? 3600 : Number(s)) * 1000;
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const isoDate = v => { const d = new Date(v || Date.now()); return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10); };
const fmt = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const money = n => '$' + Number(n).toFixed(2);
// Item names on receipts and in emails are worded differently ("SONY WH1000XM5 HDPHN" / "Sony WH-1000XM5 Headphones").
const words = s => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 3));
function sameName(a, b) {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return false;
  let n = 0; for (const w of x) if (y.has(w)) n++;
  return n >= Math.max(1, Math.ceil(Math.min(x.size, y.size) / 2));
}
class InboxError extends Error { constructor(status, message) { super(message); this.status = status; } }
const header = (headers, name) => { const h = (headers || []).find(x => String(x.Name || x.name).toLowerCase() === name.toLowerCase()); return h ? String(h.Value ?? h.value ?? '') : ''; };

function createInbox({ store, data, policies = null, reader = null, jobs, oauth, key = null, domain = '', publicUrl = '', gmailVerified = false, fetch: http = globalThis.fetch, log = console }) {
  const readLimit = (() => { const hits = new Map(); return userId => { const now = Date.now(), e = hits.get(userId); if (!e || e.reset < now) { hits.set(userId, { n: 1, reset: now + DAY }); return true; } return ++e.n <= 300; }; })();
  const canRead = () => !!(reader && reader.available() && key);
  const available = () => ({
    forwarding: !!domain && canRead(),
    gmail: oauth.available.google && canRead(),
    outlook: oauth.available.microsoft && canRead(),
    gmailTesting: !gmailVerified
  });

  /* --- Forwarding address --- */
  const newToken = () => 'u-' + crypto.randomBytes(8).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  async function addressFor(userId) {
    let a = await store.getInboxAddress(userId);
    if (!a) { await store.setInboxAddress(userId, newToken()); a = await store.getInboxAddress(userId); }
    return a;
  }
  /* "Get a new address": the old one stops working straight away. */
  async function newAddress(userId) { await store.setInboxAddress(userId, newToken()); return status(await store.findUserById(userId)); }
  /* The user accepts mail from the Gmail address that asked to forward here (the request alone never does). */
  async function acceptSender(userId, email) {
    const a = await store.getInboxAddress(userId);
    if (!a || !a.request || a.request.email !== String(email || '').toLowerCase()) throw new InboxError(404, 'That forwarding request has expired.');
    await store.addInboxSender(userId, a.request.email);
    return status(await store.findUserById(userId));
  }
  /* Mail is accepted only when it was sent or forwarded by one of these: the account email, connected inboxes, and Gmail
     addresses that asked (through Google's forwarding confirmation) to forward to this address. */
  async function verifiedSenders(user) {
    const a = await store.getInboxAddress(user.id), conns = await store.listInboxConnections(user.id);
    return [...new Set([user.email, ...conns.map(c => c.email), ...(a ? a.senders : [])].map(e => String(e).toLowerCase()))];
  }

  /* --- What the settings sub-page shows --- */
  async function pendingOrders(userId) {
    const [orders, items] = [await store.listEmailOrders(userId), await store.listItems(userId)];
    const cutoff = isoDate(Date.now() - RECENT_DAYS * DAY);
    return orders.filter(o => !items.some(i => i.purchaseId === o.id || (o.orderNumber && orderKey(i.orderNumber) === orderKey(o.orderNumber) && sameStore(i, o))))
      .filter(o => (o.delivered || o.purchased || isoDate(o.createdAt)) >= cutoff)
      .map(o => ({ id: o.id, store: o.store || '', retailerId: o.retailerId, orderNumber: o.orderNumber || '', purchased: o.purchased || '', delivered: o.delivered || '', products: o.products }));
  }
  async function status(user) {
    const a = await addressFor(user.id);
    const conns = await store.listInboxConnections(user.id);
    return {
      available: available(),
      address: domain ? `${a.token}@${domain}` : null,
      senders: await verifiedSenders(user),
      gmailRequest: a.request && Date.parse(a.request.at) > Date.now() - 7 * DAY ? a.request : null,
      connections: conns.map(c => ({ provider: c.provider, email: c.email, status: c.status, syncedAt: c.syncedAt })),
      orders: await pendingOrders(user.id)
    };
  }

  /* --- Connected inboxes --- */
  async function api(conn, url, { method = 'GET', body = null, headers = {} } = {}) {
    const token = await accessToken(conn);
    const res = await http(url, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 204) return {};
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(`${conn.provider} request failed (${res.status}).`), { status: res.status });
    return json;
  }
  /* A current access token; the refresh token stays encrypted. A revoked grant (or Gmail's 7-day testing limit) marks the
     inbox "expired" so the sub-page asks to reconnect, and stops the job without retrying. */
  async function accessToken(conn) {
    const t = unseal(key, conn.tokens);
    if (t.access && t.expires > Date.now() + 60_000) return t.access;
    let r;
    try { r = await oauth.refresh(conn.provider, t.refresh); }
    catch (err) {
      if (err.code === 'invalid_grant') { await store.updateInboxConnection(conn.id, { status: 'expired' }); throw Object.assign(new Error('Inbox access expired.'), { expired: true }); }
      throw err;
    }
    const next = { refresh: r.refresh_token || t.refresh, access: r.access_token, expires: Date.now() + lifetime(r.expires_in) };
    conn.tokens = seal(key, next);
    await store.updateInboxConnection(conn.id, { tokens: conn.tokens });
    return next.access;
  }

  /* After the provider's consent screen: save the (encrypted) tokens, then look through the last 90 days. */
  async function connect(userId, provider, t) {
    if (!t.refresh_token) throw new InboxError(400, 'We didn’t get lasting access. Please try connecting again.');
    const tokens = seal(key, { refresh: t.refresh_token, access: t.access_token, expires: Date.now() + lifetime(t.expires_in) });
    let email = '';
    if (provider === 'gmail') {
      const res = await http(`${GMAIL}/profile`, { headers: { Authorization: `Bearer ${t.access_token}` } });
      email = res.ok ? String((await res.json()).emailAddress || '') : '';
    } else email = String(t.claims && (t.claims.email || t.claims.preferred_username) || '');
    if (!email) throw new InboxError(400, 'We couldn’t tell which inbox this is. Please try again.');
    const conn = await store.saveInboxConnection({ id: crypto.randomUUID(), userId, provider, email: email.toLowerCase(), tokens });
    await store.updateInboxConnection(conn.id, { syncedAt: null });
    if (provider === 'outlook') await subscribe(await store.getInboxConnection(conn.id)).catch(err => log.error('Outlook subscription failed:', err.message));
    await jobs.enqueue('inbox.sync', { connectionId: conn.id }, { uniqueKey: `inbox-sync:${conn.id}` });
    return conn;
  }

  /* Outlook tells us when mail arrives (Graph subscription); the 15-minute check covers anything missed. Needs a public
     https address for the notification URL. */
  async function subscribe(conn) {
    if (!/^https:\/\//.test(publicUrl) || conn.provider !== 'outlook') return;
    const expires = new Date(Date.now() + SUBSCRIPTION_DAYS * DAY);
    if (conn.subscriptionId) {
      try { await api(conn, `${GRAPH}/subscriptions/${encodeURIComponent(conn.subscriptionId)}`, { method: 'PATCH', body: { expirationDateTime: expires.toISOString() } }); await store.updateInboxConnection(conn.id, { subscriptionExpires: expires }); return; }
      catch (err) { if (err.status !== 404) throw err; }
    }
    const secret = crypto.randomBytes(24).toString('base64url');
    const s = await api(conn, `${GRAPH}/subscriptions`, { method: 'POST', body: { changeType: 'created', notificationUrl: `${publicUrl}/api/inbox/outlook/notify`, resource: "me/mailFolders('inbox')/messages", expirationDateTime: expires.toISOString(), clientState: secret } });
    await store.updateInboxConnection(conn.id, { subscriptionId: s.id, subscriptionSecret: sha256(secret), subscriptionExpires: expires });
  }
  /* Graph's notification: the clientState proves it's ours. Only the message's arrival is used, then the inbox is checked. */
  async function outlookNotify(body) {
    for (const n of Array.isArray(body && body.value) ? body.value.slice(0, 100) : []) {
      const conn = n && typeof n.subscriptionId === 'string' ? await store.findInboxSubscription(n.subscriptionId) : null;
      if (!conn || !conn.subscriptionSecret || conn.subscriptionSecret !== sha256(n.clientState || '') || conn.status !== 'active') continue;
      await jobs.enqueue('inbox.sync', { connectionId: conn.id }, { uniqueKey: `inbox-sync:${conn.id}` });
    }
  }

  /* Every 15 minutes: check each connected inbox, and keep Outlook subscriptions alive. */
  async function poll() {
    for (const conn of await store.activeInboxConnections()) {
      await jobs.enqueue('inbox.sync', { connectionId: conn.id }, { uniqueKey: `inbox-sync:${conn.id}` });
      if (conn.provider === 'outlook' && (!conn.subscriptionExpires || Date.parse(conn.subscriptionExpires) < Date.now() + DAY)) await subscribe(conn).catch(err => log.error('Outlook subscription renewal failed:', err.message));
    }
  }

  /* Lists shopping mail since the last check (the last 90 days the first time) and queues each new message to be read. */
  async function sync({ connectionId }) {
    const conn = await store.getInboxConnection(connectionId);
    if (!conn || conn.status !== 'active') return;
    const started = new Date(), since = conn.syncedAt ? new Date(Date.parse(conn.syncedAt) - DAY) : null;
    const max = since ? MAX_PER_SYNC : MAX_FIRST_IMPORT, ids = [];
    try {
      if (conn.provider === 'gmail') {
        let page = '';
        do {
          const r = await api(conn, `${GMAIL}/messages?${new URLSearchParams({ q: gmailQuery(since), maxResults: '100', ...(page ? { pageToken: page } : {}) })}`);
          ids.push(...(r.messages || []).map(m => m.id));
          page = r.nextPageToken || '';
        } while (page && ids.length < max);
      } else {
        const from = since || new Date(Date.now() - RECENT_DAYS * DAY);
        let url = `${GRAPH}/me/messages?${new URLSearchParams({ $filter: `receivedDateTime ge ${from.toISOString()}`, $orderby: 'receivedDateTime desc', $select: 'id,from,subject,receivedDateTime', $top: '50' })}`;
        for (let pages = 0; url && pages < 20 && ids.length < max; pages++) {
          const r = await api(conn, url);
          // Only the sender and subject are looked at here; other mail is never opened.
          for (const m of r.value || []) if (isShoppingEmail({ from: m.from && m.from.emailAddress && m.from.emailAddress.address, subject: m.subject })) ids.push(m.id);
          url = r['@odata.nextLink'] || '';
        }
      }
    } catch (err) { if (err.expired) return; throw err; }
    for (const id of ids.slice(0, max)) {
      if (await store.hasInboxMessage(conn.userId, `${conn.provider}:${id}`)) continue;
      await jobs.enqueue('inbox.message', { connectionId: conn.id, messageId: id }, { uniqueKey: `inbox-message:${conn.id}:${id}` });
    }
    await store.updateInboxConnection(conn.id, { syncedAt: started });
  }

  /* Fetches one message, reads it, applies it, and keeps only the extracted fields and the message id. */
  async function readMessage({ connectionId, messageId }) {
    const conn = await store.getInboxConnection(connectionId);
    if (!conn || conn.status !== 'active' || typeof messageId !== 'string') return;
    const msgKey = `${conn.provider}:${messageId}`;
    if (await store.hasInboxMessage(conn.userId, msgKey)) return;
    let email;
    try {
      if (conn.provider === 'gmail') {
        const m = await api(conn, `${GMAIL}/messages/${encodeURIComponent(messageId)}?format=full`);
        const parts = { text: '', html: '' };
        (function walk(p) { if (!p) return; if (p.body && p.body.data && (p.mimeType === 'text/plain' || p.mimeType === 'text/html')) parts[p.mimeType === 'text/plain' ? 'text' : 'html'] ||= Buffer.from(p.body.data, 'base64url').toString('utf8'); (p.parts || []).forEach(walk); })(m.payload);
        const hs = (m.payload && m.payload.headers) || [];
        email = { from: header(hs, 'From'), subject: header(hs, 'Subject'), date: header(hs, 'Date') || (m.internalDate ? new Date(Number(m.internalDate)).toUTCString() : ''), text: bodyText(parts) };
      } else {
        const m = await api(conn, `${GRAPH}/me/messages/${encodeURIComponent(messageId)}?$select=subject,from,receivedDateTime,body`, { headers: { Prefer: 'outlook.body-content-type="text"' } });
        email = { from: m.from && m.from.emailAddress ? `${m.from.emailAddress.name || ''} <${m.from.emailAddress.address}>` : '', subject: m.subject || '', date: m.receivedDateTime || '', text: bodyText(m.body && m.body.contentType === 'html' ? { html: m.body.content } : { text: m.body && m.body.content }) };
      }
    } catch (err) { if (err.expired || err.status === 404) return; throw err; }
    // Inbox mail is read only from known stores and shopping services, and only when the subject is about an order.
    if (!isShoppingEmail(email)) return store.saveInboxMessage(conn.userId, { key: msgKey, connectionId: conn.id, kind: 'skipped' });
    await readAndApply(conn.userId, email, { key: msgKey, connectionId: conn.id });
  }

  async function readAndApply(userId, email, { key: msgKey, connectionId = null }) {
    if (!canRead()) return;
    if (!readLimit(userId)) throw new Error('Daily email reading limit reached for this account.');
    const fields = await reader.read(email, { today: isoDate(Date.now() + DAY) });
    if (!fields) return store.saveInboxMessage(userId, { key: msgKey, connectionId, kind: 'unread' });
    const sender = knownSender(email.from);
    const r = await apply(userId, fields, { connectionId, retailerId: sender && sender.retailerId, emailDate: isoDate(email.date) });
    await store.saveInboxMessage(userId, { key: msgKey, connectionId, kind: fields.kind, orderKey: r.orderKey, fields });
    return r;
  }

  /* --- Forwarded mail (the email provider's inbound webhook) --- */
  /* payload: the provider's JSON (Postmark's inbound format: From, FromFull, ToFull, CcFull, OriginalRecipient, Subject,
     MessageID, Date, TextBody, HtmlBody, Headers). Returns what happened; anything not accepted is dropped, not stored. */
  async function inbound(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    if (!domain) return { accepted: false, reason: 'not_set_up' };
    const recipients = [...['ToFull', 'CcFull', 'BccFull'].flatMap(k => Array.isArray(p[k]) ? p[k].map(r => r && r.Email) : []), p.OriginalRecipient, p.To].map(address).filter(e => e.endsWith('@' + domain.toLowerCase()));
    let owner = null;
    for (const r of recipients) { owner = await store.findInboxAddress(r.split('@')[0]); if (owner) break; }
    if (!owner) return { accepted: false, reason: 'unknown_address' };
    const user = await store.findUserById(owner.userId);
    if (!user) return { accepted: false, reason: 'unknown_address' };
    const from = address(p.FromFull && p.FromFull.Email || p.From), hs = p.Headers;
    const body = bodyText({ text: p.TextBody, html: p.HtmlBody });
    // Gmail sends a confirmation code before it auto-forwards. It's shown on the sub-page; nothing else is read from it.
    if (from === 'forwarding-noreply@google.com') {
      const code = /confirmation code:\s*(\d{6,12})/i.exec(body), who = /\b([^\s@]+@[^\s@]+\.[a-z]{2,})\s+has requested/i.exec(body);
      if (code && who) await store.setForwardRequest(owner.userId, { email: who[1].toLowerCase(), code: code[1], at: new Date().toISOString() });
      return { accepted: !!(code && who), reason: 'gmail_confirmation' };
    }
    // The sending server must pass SPF or DKIM where the provider reports it, so a forged From is turned away.
    const spf = header(hs, 'Received-SPF'), auth = header(hs, 'Authentication-Results');
    if (/^\s*(fail|softfail)/i.test(spf) && !/dkim=pass/i.test(auth)) return { accepted: false, reason: 'unauthenticated' };
    const senders = await verifiedSenders(user), forwardedBy = [from, address(header(hs, 'X-Forwarded-For').split(/\s+/)[0]), address(header(hs, 'Resent-From'))].filter(Boolean);
    if (!forwardedBy.some(e => senders.includes(e))) return { accepted: false, reason: 'unverified_sender' };
    const original = forwardedFrom(body) || p.From || '';
    const messageId = String(p.MessageID || header(hs, 'Message-ID') || sha256(body)).slice(0, 300);
    await jobs.enqueue('inbox.forwarded', { sealed: seal(key, { userId: owner.userId, messageId, from: original, subject: String(p.Subject || '').slice(0, 300), date: String(p.Date || ''), text: body }) }, { uniqueKey: `inbox-forwarded:${owner.userId}:${sha256(messageId)}` });
    return { accepted: true };
  }
  async function readForwarded({ sealed }) {
    if (!sealed) return;
    const m = unseal(key, sealed), msgKey = `forward:${sha256(m.messageId)}`;
    if (!(await store.findUserById(m.userId)) || await store.hasInboxMessage(m.userId, msgKey)) return;
    // The user chose to forward it, so any store's email is read.
    await readAndApply(m.userId, m, { key: msgKey });
  }

  /* --- Applying what an email says --- */
  function storeOf(fields, retailerId) {
    const policy = (retailerId && policies && policies.get(retailerId)) || (fields.store && policies && (m => m && policies.get(m.id))(policies.match(fields.store))) || null;
    return { retailerId: policy ? policy.id : null, name: policy ? policy.name : fields.store || '' };
  }
  function sameStore(item, o) {
    if (o.retailerId && item.retailerId) return o.retailerId === item.retailerId;
    const m = policies && item.retailer ? policies.match(item.retailer) : null;
    if (o.retailerId && m) return m.id === o.retailerId;
    return String(item.retailer || '').trim().toLowerCase() === String(o.store || '').trim().toLowerCase();
  }
  // One product per unit, as receipt reading does, so each can be returned on its own.
  const products = list => list.flatMap(l => { const units = l.quantity > 1 && l.quantity <= 10 && l.price !== null ? l.quantity : 1; return Array.from({ length: units }, () => ({ name: l.name, price: l.price === null ? '' : units > 1 ? Math.round(l.price / units * 100) / 100 : l.price })); }).slice(0, 20);
  /* The deadline after a delivery date arrives: the checked policy again (as the Return card does), or for a store without
     one, the same window counted from delivery only if it was already counted from delivery. A date the user set stays. */
  function withDelivery(item, delivered) {
    const next = { ...item, delivered };
    const policy = item.retailerId && policies ? policies.get(item.retailerId) : null;
    if (!policy || item.dateSet) return next;
    const result = evaluate({ item: next, policy, answers: item.conditionAnswers || {}, category: item.policyCategory || null });
    return { ...next, ...result.fields, returnable: result.returnable, returnableReason: result.reason, holidayReturnBy: result.holiday ? result.holiday.returnBy : '', policyFacts: result.facts, policyQuestions: result.questions, policyLine: result.line };
  }

  async function apply(userId, fields, { connectionId = null, retailerId = null, emailDate = isoDate() } = {}) {
    const shop = storeOf(fields, retailerId);
    const ok = fields.orderNumber ? orderKey(fields.orderNumber) : '';
    const storeKey = shop.retailerId || shop.name.trim().toLowerCase();
    if (!storeKey || (!ok && fields.kind !== 'order')) return { applied: false, orderKey: null };
    const oKey = `${storeKey}|${ok || 'nonum:' + sha256([fields.purchased, ...fields.items.map(i => i.name)].join('|')).slice(0, 16)}`;
    const order = await store.findEmailOrder(userId, oKey);
    const all = (await store.listItems(userId)).filter(i => !i.demo);
    const items = all.filter(i => (order && i.purchaseId === order.id) || (ok && orderKey(i.orderNumber) === ok && sameStore(i, { retailerId: shop.retailerId, store: shop.name })));
    const named = list => { const hit = fields.items.length ? list.filter(i => fields.items.some(l => sameName(i.name, l.name))) : []; return hit.length ? hit : list; };
    const notices = [];
    const saveAll = async list => { for (const i of list) await data.saveItem(userId, i); };

    if (fields.kind === 'order' || fields.kind === 'shipped' || fields.kind === 'delivered') {
      const delivered = fields.kind === 'delivered' ? fields.delivered || emailDate : fields.delivered;
      if (!items.length && (order || fields.items.length)) {
        // Not opened yet: the card on Your purchases, with whatever this email adds to it.
        const next = { id: order ? order.id : crypto.randomUUID(), connectionId, orderKey: oKey, retailerId: shop.retailerId, store: shop.name, orderNumber: fields.orderNumber || (order && order.orderNumber), purchased: fields.purchased || (order && order.purchased) || (fields.kind === 'order' ? emailDate : null), delivered: delivered || (order && order.delivered), products: order && order.products.length >= fields.items.length ? order.products : products(fields.items) };
        if (!next.products.length) return { applied: false, orderKey: oKey };
        await store.saveEmailOrder(userId, next);
        await store.savePurchase(userId, { id: next.id, source: 'email', store: next.store, channel: 'online', orderNumber: next.orderNumber, purchased: next.purchased, delivered: next.delivered, retailerId: next.retailerId });
        return { applied: true, orderKey: oKey, order: next.id };
      }
      if (delivered && items.length) {
        const changed = items.filter(i => i.delivered !== delivered && ACTIVE.concat('kept').includes(i.status)).map(i => withDelivery(i, delivered));
        await saveAll(changed);
        const open = changed.filter(i => i.status === 'deciding' && C.due(i));
        if (open.length) notices.push(`Your ${shop.name} order was delivered ${fmt(delivered)}. ${open.length === 1 ? `Return ${open[0].name} by ${fmt(C.due(open[0]))}.` : 'Return dates updated.'}`);
      }
    } else if (fields.kind === 'return_started' || fields.kind === 'return_shipped') {
      // Only items the user is already returning. A kept item never becomes a return from an email.
      const to = fields.kind === 'return_started' ? 'started' : 'shipped', from = to === 'started' ? ['deciding'] : ['deciding', 'started'];
      const changed = named(items.filter(i => from.includes(i.status))).map(i => ({ ...i, status: to, intent: 'return', ...(to === 'shipped' && !i.returnedOn ? { returnedOn: emailDate } : {}) }));
      await saveAll(changed);
      if (changed.length) notices.push(`${shop.name}: ${changed.length === 1 ? changed[0].name : changed.length + ' items'} ${to === 'started' ? 'return started' : 'sent back'}, from your email.`);
    } else if (fields.kind === 'refund' && fields.refund !== null) {
      const open = named(items.filter(i => ACTIVE.includes(i.status)));
      if (open.length === 1) {
        const i = open[0];
        await data.saveItem(userId, { ...i, status: 'received', received: fields.refund, ...(i.returnedOn ? {} : { returnedOn: fields.refundDate || emailDate }) });
        notices.push(`${shop.name} ${fields.refundMethod === 'store_credit' ? 'gave ' + money(fields.refund) + ' store credit' : 'refunded ' + money(fields.refund)} for ${i.name}. Reminders stopped.`);
      } else if (open.length > 1) notices.push(`${shop.name} sent ${money(fields.refund)} back for order ${fields.orderNumber}. Open the item it was for and tap Return complete.`);
    }
    for (const text of notices) await store.addNotice(userId, { text });
    return { applied: notices.length > 0, orderKey: oKey };
  }

  /* --- Disconnect and delete; account deletion --- */
  async function revoke(conn) {
    try {
      if (conn.provider === 'outlook' && conn.subscriptionId) await api(conn, `${GRAPH}/subscriptions/${encodeURIComponent(conn.subscriptionId)}`, { method: 'DELETE' }).catch(() => {});
      await oauth.revoke(conn.provider, unseal(key, conn.tokens).refresh);
    } catch (err) { log.error(`Couldn’t revoke ${conn.provider} access:`, err.message); }
  }
  /* Revokes access, then deletes the tokens, everything read from that inbox and its orders nobody opened yet. Purchases the
     user already added stay. */
  async function disconnect(userId, provider) {
    const conn = (await store.listInboxConnections(userId)).find(c => c.provider === provider);
    if (!conn) throw new InboxError(404, 'That inbox isn’t connected.');
    await revoke(conn);
    const removed = await store.deleteInboxData(userId, conn.id);
    await store.deleteInboxConnection(userId, provider);
    for (const id of removed) await store.deletePurchaseIfEmpty(userId, id);
    return status(await store.findUserById(userId));
  }
  /* "Delete my account": every grant is revoked before the rows go. */
  async function forget(userId) { for (const conn of await store.listInboxConnections(userId)) await revoke(conn); }

  return { available, status, newAddress, acceptSender, connect, sync, readMessage, readForwarded, inbound, outlookNotify, poll, apply, disconnect, forget, pendingOrders };
}

module.exports = { createInbox, InboxError, sameName };
