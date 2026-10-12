/* Accounts: sign-in gate for the app, and background sync of this browser's copy to the signed-in account.
   The browser keeps the full copy; changes upload one item at a time, plus settings and profile. */
const Account = (() => {
  const ACCOUNT_KEY = 'returnly-account-v1', SYNCED_KEY = 'returnly-synced-at', DIRTY_KEY = 'returnly-unsynced';
  // What the account last confirmed: a fingerprint of each item by id, and of settings plus profile.
  const ITEMS_KEY = 'returnly-synced-items', SETTINGS_KEY = 'returnly-synced-settings';
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

  // Short fingerprint of a JSON value, to spot which items changed since the last upload.
  const fingerprint = v => { const s = JSON.stringify(v) || ''; let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return s.length + ':' + (h >>> 0).toString(36); };
  const settingsPrint = d => fingerprint({ settings: d.settings || {}, profile: d.profile || {} });
  function markSynced(data, updatedAt = data.updatedAt) {
    set(ITEMS_KEY, JSON.stringify(Object.fromEntries((data.purchases || []).filter(i => i && typeof i.id === 'string').map(i => [i.id, fingerprint(i)]))));
    set(SETTINGS_KEY, settingsPrint(data));
    set(SYNCED_KEY, updatedAt || '');
  }
  function writeLocal(data) {
    if (!data) return;
    set(DATA_KEYS.purchases, JSON.stringify(data.purchases || []));
    set(DATA_KEYS.settings, JSON.stringify(data.settings || {}));
    set(DATA_KEYS.profile, JSON.stringify(data.profile || {}));
    markSynced(data);
    del(DIRTY_KEY);
  }
  function clearLocal() { [...Object.values(DATA_KEYS), 'back-last-nudge', 'returnly-push-endpoint', ACCOUNT_KEY, SYNCED_KEY, DIRTY_KEY, ITEMS_KEY, SETTINGS_KEY].forEach(del); }
  function remember(u) { set(ACCOUNT_KEY, JSON.stringify({ email: u.email, name: u.name, ...(u.admin ? { admin: true } : {}) })); }

  /* The account stores photos as files and sends back their private URLs; swap them into this browser's copy
     (in memory too, so the next save doesn't upload the photo again). */
  let appSave = null, appSaveProfile = null;
  const withPhoto = (o, photo) => { const out = { ...o }; if (photo) out.photo = photo; else delete out.photo; return out; };
  function adoptItem(saved) {
    const list = typeof items !== 'undefined' && Array.isArray(items) ? items : null;
    const local = list ? list.find(i => i && i.id === saved.id) : null;
    if (local && local.photo !== saved.photo) {
      if (saved.photo) local.photo = saved.photo; else delete local.photo;
      if (appSave) appSave();
    }
    if (!appSave) { const all = parse(DATA_KEYS.purchases, []), i = all.findIndex(x => x && x.id === saved.id); if (i >= 0 && all[i].photo !== saved.photo) { all[i] = withPhoto(all[i], saved.photo); set(DATA_KEYS.purchases, JSON.stringify(all)); } }
  }
  function adoptProfile(saved) {
    const p = typeof profile !== 'undefined' && profile && typeof profile === 'object' ? profile : null;
    if (!p || p.photo === saved.photo) return;
    if (saved.photo) p.photo = saved.photo; else delete p.photo;
    if (appSaveProfile) appSaveProfile(); else set(DATA_KEYS.profile, JSON.stringify(p));
  }

  /* Debounced upload of what changed: one call per created, updated or deleted item (last write wins). */
  let timer = null, inflight = false, again = false, warned = false;
  function queue() { set(DIRTY_KEY, '1'); clearTimeout(timer); timer = setTimeout(flush, 800); }
  async function upload() {
    const snap = snapshot();
    let synced = parse(ITEMS_KEY, null), latest = null;
    // First upload from this browser: learn what the account already has, so local deletions reach it too.
    if (!synced) { const r = await api('GET', '/api/items'); synced = Object.fromEntries(r.items.map(i => [i.id, ''])); }
    const done = () => set(ITEMS_KEY, JSON.stringify(synced));
    const present = new Set();
    for (const item of snap.purchases) {
      if (!item || typeof item.id !== 'string' || present.has(item.id)) continue;
      present.add(item.id);
      if (synced[item.id] === fingerprint(item)) continue;
      const path = '/api/items/' + encodeURIComponent(item.id);
      let r;
      if (item.id in synced) r = await api('PUT', path, item);
      else { try { r = await api('POST', '/api/items', item); } catch (err) { if (err.status !== 409) throw err; r = await api('PUT', path, item); } }
      adoptItem(r.item);
      // Fingerprint what was sent (with the account's photo URL), so edits made during the upload still go up next time.
      synced[item.id] = fingerprint(withPhoto(item, r.item.photo)); latest = r.updatedAt; done();
    }
    for (const id of Object.keys(synced)) {
      if (present.has(id)) continue;
      try { latest = (await api('DELETE', '/api/items/' + encodeURIComponent(id), {})).updatedAt; } catch (err) { if (err.status !== 404) throw err; }
      delete synced[id]; done();
    }
    if (get(SETTINGS_KEY) !== settingsPrint(snap)) {
      const r = await api('PUT', '/api/settings', { settings: snap.settings, profile: snap.profile });
      adoptProfile(r.profile);
      set(SETTINGS_KEY, settingsPrint({ settings: snap.settings, profile: withPhoto(snap.profile, r.profile.photo) }));
      latest = r.updatedAt;
    }
    if (latest) set(SYNCED_KEY, latest);
  }
  async function flush() {
    clearTimeout(timer); timer = null;
    if (!user()) return;
    if (inflight) { again = true; return; }
    inflight = true;
    try {
      await upload();
      del(DIRTY_KEY); warned = false;
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
    set(ITEMS_KEY, '{}'); del(SETTINGS_KEY);
    remember(r.user);
    return r.user;
  }
  async function signIn({ email, password }) {
    const r = await api('POST', '/api/login', { email, password });
    if (r.data) writeLocal(r.data); else { if (!hasRealPurchases()) [DATA_KEYS.purchases, DATA_KEYS.profile].forEach(del); set(ITEMS_KEY, '{}'); del(SETTINGS_KEY); }
    remember(r.user);
    if (!r.data) { const p = parse(DATA_KEYS.profile, {}); if (!p.name) set(DATA_KEYS.profile, JSON.stringify({ ...p, name: r.user.name })); }
    return r.user;
  }
  // A slow or sleeping server must never leave the user stuck signed in.
  const within = (promise, ms) => Promise.race([promise.catch(() => {}), new Promise(r => setTimeout(r, ms))]);

  async function signOut() {
    if (get(DIRTY_KEY)) await within(flush(), 8000);
    if (typeof Push !== 'undefined') await within(Push.forget(), 4000);
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
    // Keeps the stored account up to date, for example when it's made an admin.
    api('GET', '/api/me').then(r => remember(r.user)).catch(() => {});
    try {
      const { data } = await api('GET', '/api/data');
      if (get(DIRTY_KEY)) return flush();
      if (data && !get(ITEMS_KEY) && data.updatedAt === get(SYNCED_KEY)) {
        // First visit since sync went per item: nothing changed elsewhere, so only reload if photos moved to files.
        const local = snapshot(), plain = list => JSON.stringify(list.map(i => { const { purchaseId, ...rest } = i || {}; return rest; }));
        if (plain(data.purchases) === plain(local.purchases) && settingsPrint(data) === settingsPrint(local)) return markSynced(local, data.updatedAt);
        writeLocal(data); location.reload(); return;
      }
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
        if (typeof save === 'function') { const s = appSave = save; save = function () { const out = s.apply(this, arguments); queue(); return out; }; }
        if (typeof saveProfile === 'function') { const s = appSaveProfile = saveProfile; saveProfile = function () { const out = s.apply(this, arguments); if (out !== false) queue(); return out; }; }
      });
      document.addEventListener('visibilitychange', () => { if (document.hidden && get(DIRTY_KEY)) flush(); });
    }
  }

  return { api, user, queue, flush, signUp, signIn, signOut, deleteAccount, clearLocal };
})();
