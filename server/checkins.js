/* Ada's check-ins (George 2026-11-06). When someone logs symptoms, or a blood pressure reading that is high or low, Ada checks
   in on them every 30 minutes ("Hi George, checking in on “stomach pain”. Are you still having it?"): Yes or No, then how bad
   it is from 1 to 10. A score of 7 or more reminds them to go to the ER. The check-ins keep coming until they log "I went to the
   ER" or "I didn't go to the ER". "It's really bad, I can't get to the ER" tells everyone else on the care team straight away
   (push, and a text to the phone the admin entered), quiet hours or not; whoever answers "I'm on my way" is named back to them,
   and if nobody has said they're coming after 10 minutes, the team is asked again.
   Each family's check-ins are kept in its settings (`settings.checkins`). Only this file writes them: the app's own settings
   saves keep what's saved here (data.putSettings). Ada never says what a symptom means: the ER reminder at 7 or more is the
   rule George set, and every message points to 911 in an emergency. */
const crypto = require('node:crypto');
const { normPhone } = require('./sms');

const EVERY_MIN = 30, HELP_WAIT_MIN = 10, GIVE_UP_HOURS = 24, HIGH = 7, KEEP = 40;
const MIN = 60 * 1000;
const first = name => String(name || '').trim().split(/\s+/)[0] || '';
const clean = (s, n) => typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '';
const BP = /^(\d{2,3})\/(\d{2,3})$/;

/* A blood pressure reading that starts check-ins: high (140 or more over anything, or anything over 90 or more) or low (under
   90 over anything, or anything under 60). These are the usual published lines, not advice; George can change them. */
function bpOutOfRange(bp) {
  const m = BP.exec(String(bp || '').trim());
  if (!m) return '';
  const sys = Number(m[1]), dia = Number(m[2]);
  if (sys >= 140 || dia >= 90) return 'high';
  if (sys < 90 || dia < 60) return 'low';
  return '';
}

const lastAnswer = c => (c.answers || [])[(c.answers || []).length - 1] || null;
const active = c => !!c && !c.end;
/* The question, for the person it's for: themselves, or the patient they look after. */
function question(c) {
  const who = c.self ? 'you' : c.patient || 'they';
  if (c.kind === 'bp') return `${c.self ? 'Are you' : `Is ${who}`} still feeling unwell after the ${c.bp} blood pressure reading?`;
  return `${c.self ? 'Are you' : `Is ${who}`} still having it?`;
}
function askNotification(c, ownerId) {
  const hi = first(c.name) ? `Hi ${first(c.name)}, ` : '';
  const title = c.kind === 'bp' ? `${hi}checking in on the blood pressure` : `${hi}checking in on “${c.about.slice(0, 60)}”`;
  return { title: title.slice(0, 200), body: `${question(c)} Tap to answer.`.slice(0, 500), itemId: null, url: `app.html?patient=${encodeURIComponent(ownerId)}&checkin=${encodeURIComponent(c.id)}`, actions: [], tag: 'checkin ' + c.id };
}
function helpNotification(c, ownerId, again = false) {
  const score = c.help && c.help.score ? ` (${c.help.score} out of 10)` : '';
  const who = c.self ? first(c.name) || 'Someone' : c.patient || first(c.name) || 'Someone';
  const what = c.kind === 'bp' ? `blood pressure ${c.bp}` : `“${c.about.slice(0, 60)}”`;
  // Ten minutes and nobody is coming (George 2026-11-06): everyone is asked to call 911 for them.
  if (again) return {
    title: `No one is coming for ${who}: please call 911`.slice(0, 200),
    body: `${first(c.name) || 'They'} says it’s really bad${score} and can’t get to the ER: ${what}. No one has said they’re on the way. If you can’t go, please call 911 for ${c.self ? 'them' : who}. Tap to answer.`.slice(0, 500),
    itemId: null, url: `app.html?patient=${encodeURIComponent(ownerId)}&checkin=${encodeURIComponent(c.id)}`, actions: [], tag: 'checkin-help ' + c.id
  };
  return {
    title: `${who} needs help getting to the ER`.slice(0, 200),
    body: `${first(c.name) || 'They'} says it’s really bad${score} and can’t get to the ER: ${what}. Can you take ${c.self ? 'them' : who}? Tap to answer.`.slice(0, 500),
    itemId: null, url: `app.html?patient=${encodeURIComponent(ownerId)}&checkin=${encodeURIComponent(c.id)}`, actions: [], tag: 'checkin-help ' + c.id
  };
}

/* What one person sees of a check-in: no user ids, and whether it's theirs to answer. */
function view(c, userId) {
  return {
    id: c.id, kind: c.kind, about: c.about, bp: c.bp || '', symptomId: c.symptomId || null, name: c.name, patient: c.patient || '', self: !!c.self,
    mine: c.userId === userId, startedAt: c.startedAt, next: c.next || null, askedAt: c.askedAt || null,
    answers: (c.answers || []).map(a => ({ at: a.at, still: a.still, ...(a.score ? { score: a.score } : {}) })),
    help: c.help ? { at: c.help.at, score: c.help.score || null, again: c.help.again || null, replies: (c.help.replies || []).map(r => ({ name: r.name, coming: r.coming, at: r.at, mine: r.userId === userId })) } : null,
    end: c.end || null
  };
}

class CheckinError extends Error { constructor(status, message) { super(message); this.status = status; } }

function createCheckins({ store, data, reminders = null, sms = null, now = () => new Date(), log = console }) {
  const listIn = raw => { const s = raw?.payload?.settings || {}; return Array.isArray(s.checkins) ? s.checkins : []; };
  const list = async ownerId => listIn(await store.getRawData(ownerId));
  /* Changes the family's check-ins and saves them (the rest of the settings and the profile as they are). */
  async function change(ownerId, fn) {
    const raw = await store.getRawData(ownerId);
    const settings = { ...(raw?.payload?.settings || {}) }, all = listIn(raw).map(c => JSON.parse(JSON.stringify(c)));
    const out = fn(all);
    settings.checkins = all.slice(-KEEP);
    await data.putSettings(ownerId, { settings, profile: raw?.payload?.profile || {} }, { checkins: true });
    return out;
  }
  const at = () => now().toISOString();
  const after = m => new Date(now().getTime() + m * MIN).toISOString();

  async function patientName(ownerId) {
    const profile = (await store.getRawData(ownerId))?.payload?.profile || {};
    // The patient's own name from Patient information (what they go by first), else the Home profile's name.
    const info = profile.info && typeof profile.info === 'object' ? profile.info : {};
    const pick = v => typeof v === 'string' ? v.trim() : '';
    const n = pick(info.preferred) || pick(info.name).split(/\s+/)[0] || pick(profile.name);
    return n && n.toLowerCase() !== 'you' ? n.slice(0, 40) : '';
  }

  /* Symptoms or a blood pressure reading were logged: the first check-in is in 30 minutes, to the person who logged it. A
     newer one about the same symptoms replaces the old one. */
  async function start(ownerId, user, body = {}) {
    const kind = body.kind === 'bp' ? 'bp' : 'symptom';
    const bp = kind === 'bp' ? clean(body.bp, 9) : '';
    if (kind === 'bp' && !bpOutOfRange(bp)) throw new CheckinError(400, 'That blood pressure doesn’t start check-ins.');
    const about = kind === 'bp' ? `Blood pressure ${bp}` : clean(body.about, 200);
    if (!about) throw new CheckinError(400, 'Say what the symptoms are.');
    const symptomId = typeof body.symptomId === 'string' ? body.symptomId.slice(0, 200) : null;
    const patient = await patientName(ownerId);
    // Logged for themselves when the patient on Home is them (or no patient name is set); otherwise they look after someone.
    const self = !patient || first(patient).toLowerCase() === first(user.name).toLowerCase();
    const c = { id: crypto.randomUUID(), kind, about, ...(bp ? { bp } : {}), ...(symptomId ? { symptomId } : {}), userId: user.id, name: clean(user.name, 60), patient, self, startedAt: at(), next: after(EVERY_MIN), answers: [] };
    await change(ownerId, all => {
      for (const o of all) if (active(o) && o.userId === user.id && (symptomId && o.symptomId === symptomId || o.about === about)) o.end = { at: at(), er: 'replaced' };
      all.push(c);
    });
    return view(c, user.id);
  }

  async function mine(ownerId, userId) { return (await list(ownerId)).map(c => view(c, userId)); }

  /* An answer from the person it's for: still having it (and how bad, 1 to 10), better, went to the ER or didn't, or
     "It's really bad, I can't get to the ER". */
  async function answer(ownerId, user, id, body = {}) {
    let help = false;
    const c = await change(ownerId, all => {
      const c = all.find(x => x.id === id);
      if (!c) throw new CheckinError(404, 'Not found.');
      if (c.userId !== user.id) throw new CheckinError(403, 'Only the person this check-in is for can answer it.');
      if (c.end) return c;
      if (['went', 'not'].includes(body.end)) { c.end = { at: at(), er: body.end }; delete c.next; return c; }
      if (body.help === true) {
        const a = lastAnswer(c);
        c.help = { at: at(), score: a && a.score || null, replies: [] };
        c.next = after(EVERY_MIN); help = true; return c;
      }
      if (typeof body.still !== 'boolean') throw new CheckinError(400, 'Answer yes or no.');
      const score = Number(body.score);
      if (body.still && !(Number.isInteger(score) && score >= 1 && score <= 10)) throw new CheckinError(400, 'Pick how bad it is, from 1 to 10.');
      c.answers = [...(c.answers || []), { at: at(), still: body.still, ...(body.still ? { score } : {}) }].slice(-100);
      c.next = after(EVERY_MIN);
      return c;
    });
    if (help) await helpAsked(ownerId, c);
    return view(c, user.id);
  }

  /* Someone else on the care team answers a request for help: "I'm on my way" or "I can't right now". */
  async function reply(ownerId, user, id, body = {}) {
    if (typeof body.coming !== 'boolean') throw new CheckinError(400, 'Say if you can come.');
    let tell = false;
    const c = await change(ownerId, all => {
      const c = all.find(x => x.id === id);
      if (!c || !c.help) throw new CheckinError(404, 'Not found.');
      if (c.userId === user.id) throw new CheckinError(400, 'This is your own request for help.');
      const was = (c.help.replies || []).find(r => r.userId === user.id);
      c.help.replies = [...(c.help.replies || []).filter(r => r.userId !== user.id), { userId: user.id, name: clean(user.name, 60) || 'Someone', coming: body.coming, at: at() }];
      tell = body.coming && !(was && was.coming);
      return c;
    });
    if (tell && reminders && reminders.deliverTo) {
      const who = clean(user.name, 60) || 'Someone on the care team';
      await reminders.deliverTo([{ userId: c.userId }], { title: `${who} is on the way`.slice(0, 200), body: `${first(who)} answered your request for help getting to the ER.`, itemId: null, url: `app.html?patient=${encodeURIComponent(ownerId)}&checkin=${encodeURIComponent(c.id)}`, actions: [], tag: 'checkin-coming ' + c.id }, { topic: 'checkin', ttl: 6 * 60 * 60, urgency: 'high' }, { always: true }).catch(err => log.error(err));
    }
    return view(c, user.id);
  }

  async function helpAsked(ownerId, c) {
    if (!store.enqueueJob) return;
    // Asked again 10 minutes on by the every-minute dispatch, if nobody has said they're coming.
    await store.enqueueJob({ name: 'checkins.help', payload: { ownerId, id: c.id, at: c.help.at }, runAt: new Date(), uniqueKey: `checkin-help:${ownerId}:${c.id}:${c.help.at}`, maxAttempts: 4 });
  }

  /* Everyone else on the care team, by push and by text, quiet hours or not. */
  async function tellTeam(ownerId, c, again) {
    const team = (await reminders.teamOf(ownerId)).filter(p => p.userId !== c.userId);
    const message = helpNotification(c, ownerId, again);
    await reminders.deliverTo(team, message, { topic: 'checkin', ttl: 6 * 60 * 60, urgency: 'high' }, { always: true });
    if (sms && sms.available()) for (const p of team) {
      const to = normPhone(p.phone);
      if (to) await sms.sendText(to, `Adltrack: ${message.title}. ${message.body.replace(/ Tap to answer\.$/, '')} Open Adltrack to answer.`.slice(0, 320)).catch(err => log.error(err));
    }
  }
  async function sendHelp({ ownerId, id, at: when }) {
    const c = (await list(ownerId)).find(x => x.id === id);
    if (!c || !c.help || c.help.at !== when || c.end || !reminders) return;
    await tellTeam(ownerId, c, false);
  }
  /* Ten minutes on and nobody has said they're coming: the team is asked to call 911 for them (push and text), and the person
     gets a one-tap Call 911 button in Ada. Nothing dials 911 by itself. */
  async function sendHelpAgain({ ownerId, id, at: when }) {
    const c = (await list(ownerId)).find(x => x.id === id);
    if (!c || !c.help || c.help.at !== when || c.end || c.help.again || (c.help.replies || []).some(r => r.coming) || !reminders) return;
    // The team is told first: if that fails the job runs again, as "again" isn't saved yet.
    await tellTeam(ownerId, c, true);
    await change(ownerId, all => { const x = all.find(y => y.id === id); if (x && x.help) x.help.again = at(); });
    await reminders.deliverTo([{ userId: c.userId }], { title: 'No one has answered yet', body: 'I asked the care team to call 911 for you. Tap to call 911 yourself.', itemId: null, url: `app.html?patient=${encodeURIComponent(ownerId)}&checkin=${encodeURIComponent(c.id)}`, actions: [], tag: 'checkin-again ' + c.id }, { topic: 'checkin', ttl: 6 * 60 * 60, urgency: 'high' }, { always: true });
  }

  /* Every minute: each check-in whose time has come is sent once to the person it's for (outside their quiet hours), and the
     next one is set 30 minutes on. One nobody has answered for a day stops. */
  async function dispatch() {
    let queued = 0;
    for (const { ownerId, settings } of await store.carePlans()) {
      const waiting = (settings && Array.isArray(settings.checkins) ? settings.checkins : []).filter(c => active(c) && c.help && !c.help.again && !(c.help.replies || []).some(r => r.coming) && now().getTime() - Date.parse(c.help.at) >= HELP_WAIT_MIN * MIN);
      for (const c of waiting) {
        if (!(await store.claimDoseReminder(ownerId, `checkin-again ${c.id} ${c.help.at}`))) continue;
        queued++;
        await store.enqueueJob({ name: 'checkins.helpAgain', payload: { ownerId, id: c.id, at: c.help.at }, runAt: new Date(), uniqueKey: `checkin-again:${ownerId}:${c.id}:${c.help.at}`, maxAttempts: 4 });
      }
      const due = (settings && Array.isArray(settings.checkins) ? settings.checkins : []).filter(c => active(c) && c.next && Date.parse(c.next) <= now().getTime());
      for (const c of due) {
        const last = Math.max(Date.parse(c.startedAt) || 0, ...(c.answers || []).map(a => Date.parse(a.at) || 0), c.help ? Date.parse(c.help.at) || 0 : 0);
        if (now().getTime() - last > GIVE_UP_HOURS * 60 * MIN) { await change(ownerId, all => { const x = all.find(y => y.id === c.id); if (x && !x.end) { x.end = { at: at(), er: 'quiet' }; delete x.next; } }); continue; }
        const slot = `checkin ${c.id} ${c.next}`;
        if (!(await store.claimDoseReminder(ownerId, slot))) continue;
        queued++;
        await store.enqueueJob({ name: 'checkins.ask', payload: { ownerId, id: c.id, next: c.next }, runAt: new Date(), uniqueKey: `checkin:${ownerId}:${c.id}:${c.next}`, maxAttempts: 3 });
      }
    }
    return queued;
  }
  async function sendAsk({ ownerId, id, next }) {
    const c = (await list(ownerId)).find(x => x.id === id);
    if (!c || c.end || c.next !== next) return;
    await change(ownerId, all => { const x = all.find(y => y.id === id); if (x && !x.end) { x.askedAt = at(); x.next = after(EVERY_MIN); } });
    if (reminders && reminders.deliverTo) await reminders.deliverTo([{ userId: c.userId }], askNotification(c, ownerId), { topic: 'checkin', ttl: EVERY_MIN * 60, urgency: 'high' });
  }

  return { start, mine, answer, reply, dispatch, sendAsk, sendHelp, sendHelpAgain };
}

module.exports = { createCheckins, CheckinError, bpOutOfRange, question, askNotification, helpNotification, view, EVERY_MIN, HELP_WAIT_MIN, HIGH };
