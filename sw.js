/* Adltrack service worker: keeps the app shell for offline starts, shows daily reminders sent by Web Push while the app is
   closed with their action buttons, and opens the item's Return step when one is tapped. Account data (/api/) is never cached here. */
const SHELL = 'returnly-shell-v40';
const SHELL_FILES = ['app.html', 'index.html', 'signin.html', 'signup.html', 'forgot.html', 'reset.html', 'email.html', 'join.html', 'style.css', 'on.css', 'klarna.css', 'precision.css', 'guided.css', 'home.css', 'menu.css', 'mobile.css', 'type.css', 'dashboard.css',
  'core.js', 'nudge.js', 'account.js', 'auth.js', 'app.js', 'features.js', 'klarna.js', 'precision.js', 'guided.js', 'scan.js', 'scan.css', 'home.js', 'schedule.js', 'refills.js', 'menu.js', 'push.js', 'remind.js', 'today.js', 'report.js', 'team.js', 'plan.js', 'patients.js', 'plus.js', 'can.js', 'info.js', 'info.css', 'documents.js', 'documents.css', 'planner.js', 'meds.js', 'meds.css', 'pastday.js', 'assets/qrcode.js', 'oracle.woff2', 'assets/roboto-serif-light.woff2', 'assets/inter-var.woff2', 'assets/caveat-var.woff2', 'assets/newsreader-var.woff2', 'assets/fragment-mono.woff2',
  'manifest.webmanifest', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Network first, so a new version shows straight away; the cached copy is used only when the network can't be reached.
self.addEventListener('fetch', event => {
  const req = event.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(req).then(res => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(SHELL).then(cache => cache.put(req, copy)); }
    return res;
  }).catch(async () => (await caches.match(req, { ignoreSearch: req.mode === 'navigate' })) || (req.mode === 'navigate' ? caches.match('app.html') : Response.error())));
});

self.addEventListener('push', event => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch { msg = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(msg.title || 'Adltrack', {
    body: msg.body || '',
    icon: 'assets/icon-192.png',
    // Each reminder and alert has its own tag, so an incident never replaces a dose reminder still on screen.
    tag: typeof msg.tag === 'string' && msg.tag ? msg.tag.slice(0, 200) : 'returnly-daily',
    actions: (Array.isArray(msg.actions) ? msg.actions : []).slice(0, 4).map(a => ({ action: a.action, title: a.title })),
    data: { url: msg.url || 'app.html', itemId: msg.itemId || null, dose: msg.dose || null }
  }));
});

const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// `patient`: the family the notification came from, so the mark goes on that family's plan.
const post = (url, body, patient = null) => fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(patient ? { 'X-Patient': patient } : {}) }, body: JSON.stringify(body) });
const patientOf = url => { try { return new URL(url, self.registration.scope).searchParams.get('patient'); } catch { return null; } };
const DOSE_DONE = { taken: ['Marked taken', 'Saved for everyone on the care team.'], skipped: ['Marked skipped', 'Only recorded. Check the instructions or call your pharmacist about a missed dose.'], snooze15: ['Snoozed 15 minutes', 'We’ll remind you again in 15 minutes.'] };
const ACTION_DONE = { snooze: ['Snoozed until tomorrow', 'Nothing else changes.'], sent: ['Marked as sent back', 'We’ll stop reminding you about it.'], keep: ['Keeping it', 'We’ll stop reminding you about it.'] };

// Tapping a reminder opens that family's Home (and the item it's about): in an open Adltrack window if there is one,
// otherwise in a new one.
// "Snooze until tomorrow", "I sent it back" and "I'm keeping it" are saved straight away, without opening the app;
// "Show QR code" opens the item's QR code or label. On a dose reminder, "Taken", "Skipped" and "Snooze 15 minutes" are saved the same way.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const { url = 'app.html', itemId = null, dose = null } = event.notification.data || {};
  const action = event.action || '', tag = event.notification.tag || 'returnly-daily', patient = patientOf(url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find(w => new URL(w.url).pathname.endsWith('/app.html'));
    if (dose && DOSE_DONE[action]) {
      const { patient: from = null, ...mark } = dose;
      const r = await post('/api/reminders/dose', { action, ...mark }, from).catch(() => null);
      if (r && r.ok) {
        const { items = [] } = await r.json().catch(() => ({}));
        for (const w of windows) w.postMessage({ type: 'returnly-dose-action', action, items });
        await self.registration.showNotification(DOSE_DONE[action][0], { body: DOSE_DONE[action][1], icon: 'assets/icon-192.png', tag });
        return;
      }
      // Not signed in on this device any more (or offline): open the medication instead, where the dose can be marked.
    } else if (itemId && ACTION_DONE[action]) {
      const r = await post('/api/reminders/action', { itemId, action, today: localDate() }).catch(() => null);
      if (r && r.ok) {
        const { item = null } = await r.json().catch(() => ({}));
        for (const w of windows) w.postMessage({ type: 'returnly-item-action', itemId, action, item });
        await self.registration.showNotification(ACTION_DONE[action][0], { body: ACTION_DONE[action][1], icon: 'assets/icon-192.png', tag });
        return;
      }
      // Not signed in on this device any more (or offline): open the item instead, where the same choice can be made.
    } else post('/api/reminders/opened', {}).catch(() => {});
    const target = new URL(url + (action === 'show-qr' ? '&show=label' : ''), self.registration.scope).href;
    if (open) {
      await open.focus();
      if (itemId || patient) open.postMessage({ type: 'returnly-open-item', itemId, patient, show: action === 'show-qr' ? 'label' : '' });
      return;
    }
    await self.clients.openWindow(target);
  })());
});

// The browser replaced the subscription (keys rotated or expired): subscribe again and tell the account.
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    let key = event.oldSubscription && event.oldSubscription.options.applicationServerKey;
    if (!key) {
      const r = await fetch('/api/push/key', { credentials: 'same-origin' });
      const { key: publicKey } = await r.json();
      if (!publicKey) return;
      const raw = atob(publicKey.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - publicKey.length % 4) % 4));
      key = Uint8Array.from(raw, c => c.charCodeAt(0));
    }
    const sub = event.newSubscription || await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await fetch('/api/push/subscribe', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
  })());
});
