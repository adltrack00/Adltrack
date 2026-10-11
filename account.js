/* Accounts: sign-in gate for the app, and background sync of this browser's copy to the signed-in account. */
const Account = (() => {
  const ACCOUNT_KEY = 'returnly-account-v1', SYNCED_KEY = 'returnly-synced-at', DIRTY_KEY = 'returnly-unsynced';
  const DATA_KEYS = { purchases: 'back-purchases-v1', settings: 'back-reminders-v1', profile: 'returnly-profile-v1' };
  const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const del = k => { try { localStorage.removeItem(k); } catch {} };
  const parse = (k, fallback) => { try { const s = get(k); return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

  async function api(method, url, body) {
    const res = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json.error || 'Something went wrong. Please try again.'), { status: res.status });
    return json;
  }

  const user = () => parse(ACCOUNT_KEY, null);
  const snapshot = () => ({ purchases: parse(DATA_KEYS.purchases, []) || [], settings: parse(DATA_KEYS.settings, {}), profile: parse(DATA_KEYS.profile, {}) });
  const hasRealPurchases = () => (parse(DATA_KEYS.purchases, []) || []).some(i => !i.demo);

  function writeLocal(data) {
    if (!data) return;
    set(DATA_KEYS.purchases, JSON.stringify(data.purchases || []));
    set(DATA_KEYS.settings, JSON.stringify(data.settings || {}));
    set(DATA_KEYS.profile, JSON.stringify(data.profile || {}));
    set(SYNCED_KEY, data.updatedAt || '');
    del(DIRTY_KEY);
  }
  function clearLocal() { [...Object.values(DATA_KEYS), 'back-last-nudge', ACCOUNT_KEY, SYNCED_KEY, DIRTY_KEY].forEach(del); }
  function remember(u) { set(ACCOUNT_KEY, JSON.stringify({ email: u.email, name: u.name })); }

  /* Debounced upload of the whole local copy (last write wins). */
  let timer = null, inflight = false, again = false, warned = false;
  function queue() { set(DIRTY_KEY, '1'); clearTimeout(timer); timer = setTimeout(flush, 800); }
  async function flush() {
    clearTimeout(timer); timer = null;
    if (!user()) return;
    if (inflight) { again = true; return; }
    inflight = true;
    try {
      const r = await api('PUT', '/api/data', snapshot());
      set(SYNCED_KEY, r.updatedAt); del(DIRTY_KEY); warned = false;
    } catch (err) {
      if (err.status === 401) return expired();
      if (!warned && typeof toast === 'function') { toast(err.status === 413 ? err.message : 'Couldn’t save to your account. We’ll keep trying.'); warned = true; }
      setTimeout(queue, 15000);
    } finally {
      inflight = false;
      if (again) { again = false; queue(); }
    }
  }
  function expired() { clearLocal(); location.replace('signin.html'); }

  async function signUp({ name, email, password }) {
    const r = await api('POST', '/api/signup', { name, email, password });
    // Purchases saved on this browser before accounts existed move into the new account.
    const keep = hasRealPurchases();
    if (!keep) [DATA_KEYS.purchases, DATA_KEYS.profile].forEach(del);
    set(DATA_KEYS.profile, JSON.stringify({ ...(keep ? parse(DATA_KEYS.profile, {}) : {}), name: r.user.name }));
    remember(r.user);
    return r.user;
  }
  async function signIn({ email, password }) {
    const r = await api('POST', '/api/login', { email, password });
    if (r.data) writeLocal(r.data); else if (!hasRealPurchases()) [DATA_KEYS.purchases, DATA_KEYS.profile].forEach(del);
    remember(r.user);
    if (!r.data) { const p = parse(DATA_KEYS.profile, {}); if (!p.name) set(DATA_KEYS.profile, JSON.stringify({ ...p, name: r.user.name })); }
    return r.user;
  }
  // A slow or sleeping server must never leave the user stuck signed in.
  const within = (promise, ms) => Promise.race([promise.catch(() => {}), new Promise(r => setTimeout(r, ms))]);

  async function signOut() {
    if (get(DIRTY_KEY)) await within(flush(), 8000);
    await within(api('POST', '/api/logout', {}), 8000);
    clearLocal();
    location.href = 'index.html';
  }
  async function deleteAccount(password) {
    await api('DELETE', '/api/account', { password });
    clearLocal();
    location.href = 'index.html';
  }

  /* On the app: require an account, then pull changes made on other devices. */
  async function checkApp() {
    try {
      const { data } = await api('GET', '/api/data');
      if (get(DIRTY_KEY)) return flush();
      if (data && data.updatedAt !== get(SYNCED_KEY)) { writeLocal(data); location.reload(); return; }
      if (!data) flush();
    } catch (err) { if (err.status === 401) expired(); }
  }

  const onAuthPage = document.body.classList.contains('local-auth');
  if (!onAuthPage) {
    if (!user()) location.replace('signin.html');
    else {
      checkApp();
      // Wrap the app's own save functions once every script has loaded.
      document.addEventListener('DOMContentLoaded', () => {
        if (typeof save === 'function') { const s = save; save = function () { const out = s.apply(this, arguments); queue(); return out; }; }
        if (typeof saveProfile === 'function') { const s = saveProfile; saveProfile = function () { const out = s.apply(this, arguments); if (out !== false) queue(); return out; }; }
      });
      document.addEventListener('visibilitychange', () => { if (document.hidden && get(DIRTY_KEY)) flush(); });
    }
  }

  return { api, user, queue, flush, signUp, signIn, signOut, deleteAccount, clearLocal };
})();
