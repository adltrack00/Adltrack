/* Reminders when the app is closed: registers the service worker (installable app, offline start) and subscribes this device
   to Web Push at the existing permission moments ("Enable browser notifications" and "Start return"). The daily reminder
   itself is chosen and sent by the server; tapping it opens the item's Return step. */
const Push = (() => {
  const ENDPOINT_KEY = 'returnly-push-endpoint';
  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const granted = () => 'Notification' in window && Notification.permission === 'granted';
  const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch {} };
  const ready = () => 'serviceWorker' in navigator ? navigator.serviceWorker.ready : Promise.reject(new Error('No service worker'));
  const bytes = b64 => { const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - b64.length % 4) % 4)); return Uint8Array.from(s, c => c.charCodeAt(0)); };
  const sameKey = (buffer, key) => { if (!buffer) return false; const a = new Uint8Array(buffer); return a.length === key.length && a.every((x, i) => x === key[i]); };

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  let keyRequest = null;
  const publicKey = () => keyRequest || (keyRequest = Account.api('GET', '/api/push/key').then(r => r.key).catch(() => { keyRequest = null; return null; }));

  /* Subscribes this device (or refreshes its subscription and time zone). Returns true when push reminders are on. */
  async function subscribe() {
    if (!supported() || !granted()) return false;
    try {
      const key = await publicKey();
      if (!key) return false;
      const reg = await ready(), appKey = bytes(key);
      let sub = await reg.pushManager.getSubscription();
      if (sub && !sameKey(sub.options && sub.options.applicationServerKey, appKey)) { await sub.unsubscribe(); sub = null; }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
      await Account.api('POST', '/api/push/subscribe', { subscription: sub.toJSON(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      set(ENDPOINT_KEY, sub.endpoint);
      return true;
    } catch { set(ENDPOINT_KEY, ''); return false; }
  }
  /* True when this device gets the daily reminder by push, so the open app doesn't show it a second time. */
  const active = () => granted() && !!get(ENDPOINT_KEY);

  /* "Send a test notification" through the push service. Returns false when this device isn't subscribed. */
  async function test() {
    if (!(await subscribe())) return false;
    try { return (await Account.api('POST', '/api/push/test', { endpoint: get(ENDPOINT_KEY) })).sent; } catch { return false; }
  }

  /* Signing out: this device stops getting the account's reminders. */
  async function forget() {
    const endpoint = get(ENDPOINT_KEY);
    set(ENDPOINT_KEY, '');
    try { if (endpoint) await Account.api('POST', '/api/push/unsubscribe', { endpoint }); } catch {}
    try { const sub = await (await ready()).pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch {}
  }

  /* Shows the open app's daily notification; through the service worker when possible (required on Android). */
  async function show(reminder) {
    try { await (await ready()).showNotification(reminder.title, { body: reminder.body, icon: 'assets/icon-192.png', tag: reminder.tag || 'returnly-daily', actions: (reminder.actions || []).slice(0, 4), data: { url: reminder.url, itemId: reminder.itemId } }); return; } catch {}
    try { const n = new Notification(reminder.title, { body: reminder.body }); n.onclick = () => { window.focus(); openItem(reminder.itemId); }; } catch {}
  }

  /* Opens an item's Return step, as when its reminder is tapped. */
  function openItem(id) {
    if (typeof find !== 'function' || !find(id)) return false;
    const i = find(id);
    showDetail(id);
    planTab = { id: i.id, status: i.status, tab: 'return' };
    render();
    window.scrollTo(0, 0);
    return true;
  }

  /* A notification from another family than the one on screen opens that family first (a caregiver on several families). */
  const otherPatient = id => !!id && Account.patients().some(p => p.id === id) && Account.patient()?.id !== id;

  if (!document.body.classList.contains('local-auth')) {
    document.addEventListener('DOMContentLoaded', () => {
      const params = new URLSearchParams(location.search), id = params.get('remind'), patient = params.get('patient');
      if (otherPatient(patient)) { Account.switchPatient(patient).catch(() => {}); return; }
      if (patient && Account.patients().some(p => p.id === patient)) Account.pick(patient);
      if (id) openItem(id);
      if (id || patient) history.replaceState(null, '', location.pathname);
      // Keeps this device's subscription and time zone current on the account.
      if (Account.user() && typeof settings !== 'undefined' && settings.notifications) subscribe();
    });
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => {
      if (!e.data || e.data.type !== 'returnly-open-item') return;
      if (otherPatient(e.data.patient)) { history.replaceState(null, '', location.pathname + (e.data.itemId ? '?remind=' + encodeURIComponent(e.data.itemId) : '')); Account.switchPatient(e.data.patient).catch(() => {}); return; }
      if (e.data.itemId) openItem(e.data.itemId);
    });
  }

  return { supported, subscribe, active, test, forget, show, openItem };
})();
