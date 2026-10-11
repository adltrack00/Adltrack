/* Account data: items and their purchases, settings and profile, and the files behind photos and receipts.
   Photos arrive from the app as data URLs; they are moved to file storage and the item keeps a private /api/files/<id> URL. */
const crypto = require('node:crypto');
const { fileUrl, fileIdFromUrl } = require('./items');

class DataError extends Error { constructor(status, message) { super(message); this.status = status; } }

const DATA_URL = /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([a-z0-9+/]+={0,2})$/i;
const MAX_FILE = 10 * 1024 * 1024;
const KINDS = { item: /^image\//, profile: /^image\//, receipt: /^(image\/|application\/pdf$)/, label: /^(image\/|application\/pdf$)/ };
// Checks the first bytes so a file is what its type says.
const MAGIC = { 'image/jpeg': b => b[0] === 0xff && b[1] === 0xd8, 'image/png': b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/webp': b => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP', 'application/pdf': b => b.subarray(0, 5).toString() === '%PDF-' };
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const validId = id => typeof id === 'string' && id.length >= 1 && id.length <= 100;

function parseDataUrl(value, kind) {
  const m = DATA_URL.exec(value || '');
  if (!m) return null;
  const contentType = m[1].toLowerCase(), body = Buffer.from(m[2], 'base64');
  if (!KINDS[kind].test(contentType) || !MAGIC[contentType](body)) throw new DataError(400, 'That file isn’t a supported photo or PDF.');
  if (body.length > MAX_FILE) throw new DataError(413, 'Choose a file smaller than 10 MB.');
  return { contentType, body };
}

function createData({ store, storage, jobs = null }) {
  /* Files. The storage key never reveals the owner or the file's contents. */
  async function saveFile(userId, kind, { contentType, body }, reuseId = null) {
    const hash = sha256(body);
    if (reuseId) { const old = await store.getFile(userId, reuseId); if (old && old.sha256 === hash) return old.id; }
    const id = crypto.randomUUID(), storageKey = `files/${id}`;
    await storage.put(storageKey, body, contentType);
    await store.createFile({ id, userId, kind, storageKey, contentType, size: body.length, sha256: hash });
    return id;
  }
  async function removeStorage(keys) {
    const left = [];
    for (const key of keys) { try { await storage.remove(key); } catch { left.push(key); } }
    // Storage that's briefly unreachable is retried in the background rather than leaving files behind.
    if (left.length) { if (!jobs) throw new Error('Could not delete stored files.'); await jobs.enqueue('files.delete', { keys: left }); }
  }
  async function deleteFile(userId, id) {
    if (!id) return;
    const f = await store.deleteFile(userId, id);
    if (f) await removeStorage([f.storageKey]);
  }
  async function readFile(userId, id) {
    const f = await store.getFile(userId, id);
    if (!f) return null;
    const stored = await storage.get(f.storageKey);
    return stored && { body: stored.body, contentType: f.contentType, size: f.size };
  }

  /* Photo field → file id. Keeps the current file when the app sends the same photo or its URL back; another file's URL is dropped.
     A photo that isn't a supported image stays in the item as it was, as before, so saving never fails over it. */
  async function photoFile(userId, kind, value, currentId) {
    const fromUrl = fileIdFromUrl(value);
    if (fromUrl) return { fileId: fromUrl === currentId ? currentId : null, keep: false };
    let parsed = null;
    try { parsed = parseDataUrl(value, kind); } catch (err) { if (!(err instanceof DataError)) throw err; }
    if (parsed) return { fileId: await saveFile(userId, kind, parsed, currentId) };
    return { fileId: null, keep: value !== undefined };
  }

  async function cleanupPurchase(userId, purchaseId) {
    const r = await store.deletePurchaseIfEmpty(userId, purchaseId);
    if (r.deleted && r.receiptFileId) await deleteFile(userId, r.receiptFileId);
  }

  /* Items. */
  async function saveItem(userId, input, { position = null, touch = true, mustBeNew = false } = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || !validId(input.id)) throw new DataError(400, 'Invalid item.');
    if (input.purchaseId !== undefined && !validId(input.purchaseId)) throw new DataError(400, 'Invalid item.');
    const existing = await store.getItem(userId, input.id);
    if (mustBeNew && existing) throw new DataError(409, 'This item already exists.');
    const item = { ...input };
    item.purchaseId = input.purchaseId || existing?.item.purchaseId || crypto.randomUUID();
    const { fileId, keep } = await photoFile(userId, 'item', item.photo, existing?.photoFileId);
    if (!keep) delete item.photo;
    await store.savePurchase(userId, { id: item.purchaseId, store: typeof item.retailer === 'string' ? item.retailer : null, channel: typeof item.channel === 'string' ? item.channel : null, purchased: item.purchased, delivered: item.delivered });
    const saved = await store.saveItem(userId, item, { photoFileId: fileId, position });
    if (existing?.photoFileId && existing.photoFileId !== fileId) await deleteFile(userId, existing.photoFileId);
    if (existing && existing.item.purchaseId !== saved.purchaseId) await cleanupPurchase(userId, existing.item.purchaseId);
    return { item: saved, updatedAt: touch ? await store.touch(userId) : null };
  }
  async function deleteItem(userId, id, { touch = true } = {}) {
    const removed = await store.deleteItem(userId, id);
    if (!removed) return { deleted: false, updatedAt: null };
    if (removed.photoFileId) await deleteFile(userId, removed.photoFileId);
    await cleanupPurchase(userId, removed.item.purchaseId);
    return { deleted: true, updatedAt: touch ? await store.touch(userId) : null };
  }
  /* The whole list at once, as older apps send it: same order, and items missing from the list are removed. */
  async function replaceItems(userId, list) {
    const seen = new Set();
    const items = list.map(raw => {
      const item = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : { value: raw };
      // Old payloads may have number ids or none; ids are text from here on.
      item.id = typeof item.id === 'string' && validId(item.id) ? item.id : typeof item.id === 'number' ? String(item.id) : crypto.randomUUID();
      return item;
    }).reverse().filter(i => !seen.has(i.id) && seen.add(i.id)).reverse();
    for (const [position, item] of items.entries()) await saveItem(userId, item, { position, touch: false });
    for (const old of await store.listItems(userId)) if (!seen.has(old.id)) await deleteItem(userId, old.id, { touch: false });
  }

  /* Settings and profile. The profile photo is a file like item photos. */
  async function putSettings(userId, { settings, profile }) {
    const raw = await store.getRawData(userId);
    const current = raw?.payload?.profile || {};
    const nextProfile = { ...(profile || {}) };
    const { fileId, keep } = await photoFile(userId, 'profile', nextProfile.photo, fileIdFromUrl(current.photo));
    if (fileId) nextProfile.photo = fileUrl(fileId); else if (!keep) delete nextProfile.photo;
    const payload = { settings: settings || {}, profile: nextProfile };
    const updatedAt = await store.putSettings(userId, payload);
    const oldId = fileIdFromUrl(current.photo);
    if (oldId && oldId !== fileId) await deleteFile(userId, oldId);
    return { settings: payload.settings, profile: nextProfile, updatedAt };
  }

  /* Moves an account's old single-document payload (purchases with photos inside) into the tables. Safe to run twice. */
  async function migrate(userId) {
    const raw = await store.getRawData(userId);
    if (!raw || !Array.isArray(raw.payload.purchases)) {
      if (raw && raw.payload.purchases !== undefined) await store.putSettings(userId, { settings: raw.payload.settings || {}, profile: raw.payload.profile || {} });
      return false;
    }
    await replaceItems(userId, raw.payload.purchases);
    const { settings = {}, profile = {} } = raw.payload;
    await putSettings(userId, { settings, profile });
    // Keep the old timestamp: nothing changed for the user, so their devices don't need to reload.
    await store.touch(userId, raw.updatedAt);
    return true;
  }
  async function migrateAll() {
    let n = 0;
    for (const userId of await store.usersWithLegacyData()) {
      // One account that can't move yet must not stop the server; it is tried again on its next request.
      try { if (await migrate(userId)) n++; } catch (err) { console.error(`Could not migrate account ${userId}:`, err.message); }
    }
    return n;
  }

  /* The whole account, in the shape /api/data has always returned. null for an account that has never saved anything. */
  async function getData(userId) {
    await migrate(userId);
    const raw = await store.getRawData(userId);
    const purchases = await store.listItems(userId);
    if (!raw && !purchases.length) return null;
    return { purchases, settings: raw?.payload.settings || {}, profile: raw?.payload.profile || {}, updatedAt: raw ? raw.updatedAt : await store.touch(userId) };
  }
  async function putData(userId, { purchases, settings, profile }) {
    // A write from an older app replaces everything, as before. Anything still in the old format is migrated first.
    await migrate(userId);
    await replaceItems(userId, purchases);
    return (await putSettings(userId, { settings, profile })).updatedAt;
  }

  async function listPurchases(userId) {
    return (await store.listPurchases(userId)).map(({ receiptFileId, ...p }) => ({ ...p, receipt: receiptFileId ? fileUrl(receiptFileId) : null }));
  }
  async function attachReceipt(userId, purchaseId, dataUrl) {
    if (!validId(purchaseId) || !(await store.getPurchase(userId, purchaseId))) throw new DataError(404, 'Not found.');
    const parsed = parseDataUrl(dataUrl, 'receipt');
    if (!parsed) throw new DataError(400, 'Use a photo or PDF receipt.');
    const id = await saveFile(userId, 'receipt', parsed);
    const previous = await store.setPurchaseReceipt(userId, purchaseId, id);
    if (previous && previous !== id) await deleteFile(userId, previous);
    return { receipt: fileUrl(id), updatedAt: await store.touch(userId) };
  }

  /* Deletes the account's rows, then its stored files. */
  async function deleteAccount(userId) {
    const files = await store.listFiles(userId);
    await store.deleteUser(userId);
    await removeStorage(files.map(f => f.storageKey));
  }

  return { getData, putData, saveItem, deleteItem, listItems: userId => store.listItems(userId), putSettings, listPurchases, attachReceipt, readFile, deleteAccount, migrate, migrateAll, removeStorage };
}

module.exports = { createData, DataError };
