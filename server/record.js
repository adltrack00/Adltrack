/* The doctor record: one private, read-only link to the home care record that any doctor, hospital or EMS crew opens by
   scanning the For EMS code, with no app, account or particular hospital network. The family admin turns it on (optionally
   with a PIN the family gives the doctor), can make a new code at any time, which stops the old one working, and can turn it
   off. Each opening is logged for the family to see.
   What it shows: the patient information, the medications still being taken (with pharmacy and prescriber and how many doses
   were taken in the last 30 days), the last 30 days of vital signs, symptoms and incidents, and only the documents the family
   marked "Visible to doctor" (settings.recordDocs, by document id, as on the Documents page). */
const crypto = require('node:crypto');
const { fileIdFromUrl } = require('./items');
const { INFO_CARDS, infoMeds, infoValue, ageOn } = require('../info.js');
const { docList } = require('../documents.js');

class RecordError extends Error { constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); } }

const DAYS = 30, VIEWS_KEPT = 100;
const INFO_KEYS = new Set(['name', 'updatedAt', ...INFO_CARDS.flatMap(c => c.fields.map(f => f[0]))]);
const validToken = t => typeof t === 'string' && /^[A-Za-z0-9_-]{32,64}$/.test(t);
const validPin = p => typeof p === 'string' && /^\d{4,6}$/.test(p);
const within = (at, since) => typeof at === 'string' && at >= since;
const str = v => typeof v === 'string' ? v.slice(0, 2000) : undefined;

function createRecord({ store, data, hashPassword, verifyPassword }) {
  const linkOf = (base, token) => `${base}/record.html#${token}`;

  /* For the family's own app: whether it is on, its link (the code), whether it asks for a PIN, and when it was opened. */
  async function status(ownerId, base) {
    const l = await store.getRecordLink(ownerId);
    if (!l) return { on: false };
    return { on: true, link: linkOf(base, l.token), pin: !!l.pinHash, createdAt: l.createdAt, views: (l.views || []).slice(-VIEWS_KEPT).reverse() };
  }
  /* Turns it on, or makes a new code: a new token always replaces the old one, so a code that was printed stops working. */
  async function turnOn(ownerId, { pin } = {}, base) {
    if (pin !== undefined && pin !== '' && pin !== null && !validPin(pin)) throw new RecordError(400, 'Use 4 to 6 numbers for the PIN, or leave it empty.');
    const token = crypto.randomBytes(24).toString('base64url');
    await store.setRecordLink(ownerId, { token, pinHash: validPin(pin) ? await hashPassword(pin) : null, createdAt: new Date().toISOString(), views: [] });
    return status(ownerId, base);
  }
  async function turnOff(ownerId) { await store.setRecordLink(ownerId, null); return { on: false }; }

  /* A scan: the link's token, and the PIN when the family set one. Anything wrong gets the same answer as no link at all,
     except a PIN that is needed or wrong, which says so (needPin) so the page can ask for it. */
  async function unlock(token, pin) {
    const l = validToken(token) ? await store.findRecordLink(token) : null;
    if (!l) throw new RecordError(404, 'This code no longer opens a care record. Ask the family for the new one.');
    if (l.pinHash && !(validPin(pin) && await verifyPassword(pin, l.pinHash))) throw new RecordError(401, pin ? 'That PIN isn’t right.' : 'Enter the PIN the family gave you.', { needPin: true });
    return l;
  }

  async function shared(ownerId) {
    const raw = await data.getData(ownerId) || { purchases: [], settings: {}, profile: {} };
    const items = raw.purchases.filter(i => i && !i.demo), settings = raw.settings || {}, profile = raw.profile || {};
    const wanted = new Set(Array.isArray(settings.recordDocs) ? settings.recordDocs : []);
    const docs = docList(items).filter(d => wanted.has(d.id));
    return { items, settings, profile, docs };
  }

  /* The patient information as the EMS sheet shows it: the top line, the two boxes, and each other field with its label. */
  function about(info, now) {
    const fields = INFO_CARDS.flatMap(c => c.fields), v = k => infoValue(info, fields.find(f => f[0] === k)), age = ageOn(info.dob, now.toISOString().slice(0, 10));
    const top = new Set(['name', 'preferred', 'dob', 'sex', 'language', 'code', 'directive', 'allergies']);
    return {
      line: [info.preferred ? `Goes by ${info.preferred}` : '', v('dob') ? `Born ${v('dob')}` + (age !== '' ? ` · ${age} years old` : '') : '', v('sex'), v('language')].filter(Boolean).join(' · '),
      code: v('code') || '', papers: v('directive') || '', allergies: v('allergies'),
      rows: fields.filter(f => !top.has(f[0])).map(f => [f[1], v(f[0])]).map(([label, x]) => ({ label, value: Array.isArray(x) ? x : x ? [x] : [] })).filter(r => r.value.length)
    };
  }

  async function open(token, pin, now = new Date()) {
    const l = await unlock(token, pin);
    const { items, settings, profile, docs } = await shared(l.ownerId);
    const since = new Date(now.getTime() - DAYS * 864e5).toISOString(), sinceDay = since.slice(0, 10);
    const info = Object.fromEntries(Object.entries(profile.info && typeof profile.info === 'object' ? profile.info : {}).filter(([k]) => INFO_KEYS.has(k)));
    const byName = new Map(items.filter(i => i.med).map(i => [i.name, i]));
    const meds = infoMeds(items).map(m => {
      const i = byName.get(m.name) || {}, doses = (Array.isArray(i.doses) ? i.doses : []).filter(d => d && (d.day || String(d.at || '').slice(0, 10)) >= sinceDay);
      return { ...m, pharmacy: str(i.pharmacy && i.pharmacy.name), prescriber: str(i.prescriber && i.prescriber.name), warnings: str(i.warnings), taken: doses.filter(d => d.kind === 'taken').length, skipped: doses.filter(d => d.kind === 'skipped').length };
    });
    const vitals = (Array.isArray(settings.vitalsLog) ? settings.vitalsLog : []).filter(v => v && within(v.at, since))
      .map(v => ({ at: v.at, ...Object.fromEntries(['bp', 'heart', 'temp', 'pain'].filter(k => v[k]).map(k => [k, String(v[k]).slice(0, 20)])) }))
      .filter(v => Object.keys(v).length > 1).sort((a, b) => b.at.localeCompare(a.at));
    const notes = kind => items.filter(i => i[kind] && within(i.at, since)).map(i => ({ at: i.at, name: str(i.name), note: str(i.note) })).sort((a, b) => b.at.localeCompare(a.at));
    const views = [...(l.views || []), now.toISOString()].slice(-VIEWS_KEPT);
    await store.setRecordLink(l.ownerId, { ...l, views });
    return {
      record: {
        name: info.name || (profile.name && profile.name.toLowerCase() !== 'you' ? profile.name : '') || '',
        photo: !!fileIdFromUrl(profile.photo), info, ...about(info, now), meds, vitals, symptoms: notes('symptom'), incidents: notes('incident'),
        documents: docs.map(d => ({ id: d.id, name: d.name, category: d.category, date: d.date || '', pages: d.files.map(f => ({ type: /pdf/i.test(f.type || '') ? 'application/pdf' : 'image' })) })),
        since: sinceDay, at: now.toISOString()
      }
    };
  }

  /* One page of a shared document (by its place in the list), or the patient's photo; nothing else can be read this way. */
  async function file(token, pin, { doc, page, photo } = {}) {
    const l = await unlock(token, pin);
    const { profile, docs } = await shared(l.ownerId);
    let id = null;
    if (photo) id = fileIdFromUrl(profile.photo);
    else { const d = docs.find(x => x.id === doc), f = d && Number.isInteger(page) ? d.files[page] : null; id = f ? fileIdFromUrl(f.url) : null; }
    const found = id && await data.readFile(l.ownerId, id);
    if (!found) throw new RecordError(404, 'Not found.');
    return found;
  }

  return { status, turnOn, turnOff, open, file };
}

module.exports = { createRecord, RecordError };
