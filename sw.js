/* Returnly service worker: keeps the app shell for offline starts, shows daily reminders sent by Web Push while the app is
   closed, and opens the item's Return step when one is tapped. Account data (/api/) is never cached here. */
const SHELL = 'returnly-shell-v1';
const SHELL_FILES = ['app.html', 'index.html', 'signin.html', 'signup.html', 'style.css', 'on.css', 'klarna.css', 'precision.css', 'guided.css', 'menu.css', 'mobile.css', 'landing.css',
  'core.js', 'account.js', 'auth.js', 'app.js', 'features.js', 'klarna.js', 'precision.js', 'guided.js', 'menu.js', 'push.js', 'landing.js', 'oracle.woff2', 'assets/roboto-serif-light.woff2',
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
  event.waitUntil(self.registration.showNotification(msg.title || 'Returnly', {
    body: msg.body || '',
    icon: 'assets/icon-192.png',
    tag: 'returnly-daily',
    data: { url: msg.url || 'app.html', itemId: msg.itemId || null }
  }));
});

// Tapping a reminder opens that item's Return step: in an open Returnly window if there is one, otherwise in a new one.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const { url = 'app.html', itemId = null } = event.notification.data || {};
  const target = new URL(url, self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find(w => new URL(w.url).pathname.endsWith('/app.html'));
    if (open) {
      await open.focus();
      if (itemId) open.postMessage({ type: 'returnly-open-item', itemId });
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
