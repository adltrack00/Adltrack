/* Ada's check-ins after symptoms (George 2026-11-06, like Flow's "Are you having cramps today?").
   Symptoms logged (from the + on My Tasks, or by telling Ada), or a blood pressure reading that's high or low, start check-ins:
   30 minutes later Ada asks the person who logged it "Are you still having it?" in her chat, and by notification when the app
   is closed. Yes → how bad, 1 to 10; 7 or more → a reminder to go to the ER. She keeps checking in every 30 minutes until they
   tap "I went to the ER" or "I didn't go to the ER". "It's really bad, I can't get to the ER" tells everyone else on the care
   team, who can answer "I'm on my way". Every answer is in the daily care report. The server keeps the check-ins and sends the
   notifications (server/checkins.js); this file asks and answers in Ada's chat. Ada never says what a symptom means. */
(() => {
if (typeof document === 'undefined' || typeof Account === 'undefined') return;
const B = () => window.adaBridge;
const CK_HIGH = 7;
let ckList = [], ck = { id: '', step: '' };
const ckFirst = n => String(n || '').trim().split(/\s+/)[0] || '';
const ckFind = id => ckList.find(c => c.id === id);
const ckLast = c => Math.max(Date.parse(c.startedAt) || 0, ...(c.answers || []).map(a => Date.parse(a.at) || 0), c.help ? Date.parse(c.help.at) || 0 : 0);
/* Asked by notification since the last answer, or its time has come. */
const ckDue = c => c.mine && !c.end && ((c.askedAt && Date.parse(c.askedAt) > ckLast(c)) || (c.next && Date.parse(c.next) <= Date.now()));
const ckHelpForMe = c => !c.mine && c.help && !c.end && !(c.help.replies || []).some(r => r.mine);
const ckWhat = c => c.kind === 'bp' ? `the ${c.bp} blood pressure reading` : `“${c.about}”`;
const ckWho = c => c.self ? 'you' : c.patient || 'them';
const ckStore = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };

/* The same lines as the server: 140 or more over anything, or anything over 90 or more, is high; under 90, or under 60, low. */
function checkinBpOut(bp) {
  const m = /^(\d{2,3})\/(\d{2,3})$/.exec(String(bp || '').trim()); if (!m) return '';
  const sys = +m[1], dia = +m[2];
  return sys >= 140 || dia >= 90 ? 'high' : sys < 90 || dia < 60 ? 'low' : '';
}
window.checkinBpOut = checkinBpOut;

const signedIn = () => { try { return !!Account.user(); } catch { return false; } };
async function ckLoad(force = '') {
  if (!signedIn() || document.hidden) return;
  const was = JSON.stringify(ckList);
  try { const r = await Account.api('GET', '/api/checkins'); ckList = Array.isArray(r && r.checkins) ? r.checkins : []; } catch { return; }
  // The daily report shows the answers straight away.
  if (JSON.stringify(ckList) !== was && typeof render === 'function' && !(B() && B().ada.open)) render();
  ckTell(); ckMaybeOpen(force);
}
const ckPut = c => { if (c) ckList = [...ckList.filter(x => x.id !== c.id), c]; return c; };

/* Symptoms or a blood pressure reading were saved: the server starts the check-ins (the first is in 30 minutes). */
window.checkinStart = async function (body) {
  if (!signedIn()) return null;
  try { const r = await Account.api('POST', '/api/checkins', body); ckPut(r && r.checkin); ckLoad(); return r && r.checkin; } catch { return null; }
};
/* After a blood pressure reading is saved: check-ins only when it's high or low. */
window.checkinAfterBp = bp => { if (checkinBpOut(bp)) window.checkinStart({ kind: 'bp', bp }); };

/* ---- In Ada's chat ---- */
function ckSay(text, buttons) { const b = B(); b.adaSay(text, buttons && buttons.length ? [b.adaTaps(buttons)] : []); }
function ckOpen() { const b = B(); if (!b.ada.open) b.openAda(); b.ada.flow = null; }
const ckEnds = (c, dark) => [['I went to the ER', 'ck:went|' + c.id], ['I didn’t go to the ER', 'ck:not|' + c.id], ['It’s really bad, I can’t get to the ER', 'ck:help|' + c.id, dark]];

function ckAsk(c) {
  ckOpen(); ck = { id: c.id, step: 'still' };
  const hi = ckFirst(c.name) ? `Hi ${ckFirst(c.name)}, ` : 'Hi, ';
  const q = c.kind === 'bp' ? `${c.self ? 'are you' : `is ${ckWho(c)}`} still feeling unwell after ${ckWhat(c)}?` : `checking in on ${ckWhat(c)}. ${c.self ? 'Are you' : `Is ${ckWho(c)}`} still having it?`;
  ckSay(hi + (c.kind === 'bp' ? 'checking in. ' + q.charAt(0).toUpperCase() + q.slice(1) : q), [['Yes', 'ck:yes|' + c.id, true], ['No', 'ck:no|' + c.id]]);
}
function ckAskHelp(c) {
  ckOpen(); ck = { id: c.id, step: 'help' };
  const who = c.self ? ckFirst(c.name) || 'Someone' : c.patient || ckFirst(c.name) || 'Someone';
  const score = c.help.score ? ` (${c.help.score} out of 10)` : '';
  const b = B(), them = c.self ? 'them' : who, taps = b.adaTaps([['I’m on my way', 'ck:coming|' + c.id, true], ['I can’t right now', 'ck:cant|' + c.id]]);
  if (c.help.again) return b.adaSay(`${who} needs help and no one has said they’re on the way. ${ckFirst(c.name) || 'They'} says it’s really bad${score} and can’t get to the ER: ${ckWhat(c)}. If you can’t go, please call 911 for ${them}.`, [{ type: '911', note: `Opens your phone to call 911 for ${them}.` }, taps]);
  ckSay(`${who} needs help getting to the ER. ${ckFirst(c.name) || 'They'} says it’s really bad${score} and can’t get there: ${ckWhat(c)}. Can you take ${them}? If it’s an emergency, call 911.`, [['I’m on my way', 'ck:coming|' + c.id, true], ['I can’t right now', 'ck:cant|' + c.id]]);
}
async function ckPost(id, body, reply = false) {
  try { const r = await Account.api('POST', `/api/checkins/${id}${reply ? '/reply' : ''}`, body); return ckPut(r && r.checkin); }
  catch (err) { ckSay((err && err.message) || 'I couldn’t save that. Check the connection and try again.'); return null; }
}
const ckReport = () => { if (typeof render === 'function') render(); };

async function ckScore(c, n) {
  ck.step = '';
  if (!(await ckPost(c.id, { still: true, score: n }))) return;
  ckReport();
  if (n >= CK_HIGH) return ckSay(`I’m sorry it’s that bad. Please go to the ER now. If it’s an emergency, call 911. If ${c.self ? 'you can’t' : `${ckWho(c)} can’t`} get there, tap below and I’ll tell the family. I’ll check in again in 30 minutes.`, ckEnds(c, true));
  ckSay(`I’m sorry ${c.self ? 'you’re' : `${ckWho(c)} is`} still feeling it. If it gets worse, go to the ER. I’ll check in again in 30 minutes.`, ckEnds(c, false));
}
window.checkinAct = async function (arg) {
  const [what, id, n] = String(arg).split('|'), c = ckFind(id); if (!c) return;
  if (what === 'yes') { ck = { id, step: 'score' }; return ckSay('On a scale of 1 to 10, how bad is it?', Array.from({ length: 10 }, (_, k) => [String(k + 1), `ck:score|${id}|${k + 1}`])); }
  if (what === 'score') return ckScore(c, Number(n));
  if (what === 'no') { ck.step = ''; if (!(await ckPost(id, { still: false }))) return; ckReport(); return ckSay('I’m glad it’s better. Did you go to the ER?', ckEnds(c).slice(0, 2)); }
  if (what === 'went' || what === 'not') {
    ck.step = ''; if (!(await ckPost(id, { end: what }))) return; ckReport();
    return ckSay(what === 'went' ? 'Thank you for telling me. I wrote it in the daily report and I’ll stop checking in on this. I hope you feel better soon.' : 'Okay. I wrote it in the daily report and I’ll stop checking in on this. If it comes back, add it in Symptoms and I’ll check in again.');
  }
  if (what === 'help') {
    ck.step = ''; if (!(await ckPost(id, { help: true }))) return; ckReport();
    return ckSay('I told everyone on the care team that you need help getting to the ER. I’ll tell you as soon as someone answers. If no one does in 10 minutes, I’ll ask them again. If it’s an emergency, call 911.');
  }
  if (what === 'coming' || what === 'cant') {
    ck.step = ''; if (!(await ckPost(id, { coming: what === 'coming' }, true))) return; ckReport();
    return ckSay(what === 'coming' ? `Thank you. I told ${ckFirst(c.name) || 'them'} you’re on the way.` : 'Okay. The rest of the care team was told too.');
  }
};
/* Typed or said instead of tapped. */
window.checkinText = function (s) {
  const c = ckFind(ck.id); if (!c || !ck.step) return false;
  s = String(s).trim().toLowerCase();
  if (ck.step === 'still') { if (/^(yes|yeah|yep|yup|still|it is|i am|a little)\b/.test(s)) { window.checkinAct('yes|' + c.id); return true; } if (/^(no|nope|not|better|it.?s gone|gone)\b/.test(s)) { window.checkinAct('no|' + c.id); return true; } return false; }
  if (ck.step === 'score') { const m = /^(\d{1,2})(\s*(\/|out of)\s*10)?$/.exec(s); if (m && +m[1] >= 1 && +m[1] <= 10) { ckScore(c, +m[1]); return true; } }
  return false;
};

/* Ten minutes after asking for help and nobody has said they're coming: a big Call 911 button for the person, and the care
   team is asked to call 911 for them (the server sends that). Nothing dials 911 by itself. */
const CK_WAIT_MIN = 10;
const ckNoOne = c => c.mine && c.help && !c.end && !(c.help.replies || []).some(r => r.coming) && (c.help.again || Date.now() - Date.parse(c.help.at) >= CK_WAIT_MIN * 60e3);
function ckCall911(c) {
  ckOpen(); ck = { id: c.id, step: '' };
  const b = B();
  b.adaSay('No one on the care team has said they’re on the way yet. I asked them to call 911 for you. If you can, call 911 now.', [{ type: '911', note: 'Opens your phone to call 911. Tell them where you are.' }, b.adaTaps(ckEnds(c).slice(0, 2))]);
}
/* Opens Ada with a check-in that's due, or a request for help, once each, when nothing else is going on. */
function ckBusy() { const b = B(), a = document.activeElement; return !b || b.ada.busy || (b.ada.open && (b.ada.flow || b.ada.edit)) || (!!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.id !== 'ada-input') || !!document.querySelector('dialog[open]'); }
function ckMaybeOpen(force = '') {
  if (!B()) return;
  for (const c of ckList) {
    if (ckNoOne(c)) {
      const key = 'ck-911-' + c.id + '-' + c.help.at;
      if (c.id === force || (!ckStore(key) && !ckBusy())) { ckStore(key, '1'); return ckCall911(c); }
    }
    const due = ckDue(c), help = ckHelpForMe(c);
    if (!due && !help && c.id !== force) continue;
    const key = 'ck-shown-' + c.id + (help ? '-help-' + c.help.at + (c.help.again ? '-again' : '') : '-' + (c.askedAt || c.next));
    if (c.id !== force && (ckStore(key) || ckBusy())) continue;
    if (c.end) continue;
    ckStore(key, '1');
    return c.mine ? ckAsk(c) : c.help ? ckAskHelp(c) : null;
  }
}
/* Tells the person who asked for help who's coming, once each. */
function ckTell() {
  for (const c of ckList) {
    if (!c.mine || !c.help) continue;
    for (const r of c.help.replies || []) {
      const key = `ck-told-${c.id}-${r.name}-${r.at}`;
      if (!r.coming || ckStore(key)) continue;
      ckStore(key, '1');
      const b = B(), say = `${r.name} is on the way.`;
      if (b && b.ada.open) ckSay(say); else if (typeof toast === 'function') toast(say);
    }
  }
}

/* A tapped notification opens the app with ?checkin=…, or tells the open app. */
const ckParam = new URLSearchParams(location.search).get('checkin');
document.addEventListener('DOMContentLoaded', () => setTimeout(async () => { await ckLoad(ckParam || ''); if (ckParam) history.replaceState(null, '', location.pathname); }, 600));
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => { const d = e.data || {}; if (d.type === 'returnly-open-item' && d.checkin) ckLoad(d.checkin); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) ckLoad(); });
setInterval(ckLoad, 30 * 1000);

/* ---- The daily care report: every answer, the request for help and who's coming, and went or didn't go to the ER. ---- */
if (typeof reportEntries === 'function') {
  const reportEntriesBeforeCheckins = reportEntries;
  reportEntries = function (list = items, day = today(), vitalsLog) {
    const out = reportEntriesBeforeCheckins(list, day, vitalsLog), all = ckList.length ? ckList : Array.isArray(settings.checkins) ? settings.checkins : [];
    for (const c of all) {
      const what = c.kind === 'bp' ? `Blood pressure ${c.bp}` : `“${c.about}”`, who = reportWhoLine(c.name, '');
      for (const a of c.answers || []) if (onDay(a.at, day)) out.push({ title: 'Check-in', at: a.at, note: `${what}: ${a.still ? `still ${c.kind === 'bp' ? 'feeling unwell' : 'having it'}, ${a.score} out of 10` : 'feeling better'}.`, details: [], name: 'Check-in', photos: [], by: c.name, ...who });
      if (c.help && onDay(c.help.at, day)) out.push({ title: 'Asked the care team for help', at: c.help.at, note: `${what}: really bad${c.help.score ? `, ${c.help.score} out of 10` : ''}, can’t get to the ER.`, details: (c.help.replies || []).map(r => r.coming ? `${r.name} is on the way` : `${r.name} can’t come`), name: 'Asked for help', photos: [], by: c.name, ...who });
      if (c.end && ['went', 'not'].includes(c.end.er) && onDay(c.end.at, day)) out.push({ title: c.end.er === 'went' ? 'Went to the ER' : 'Didn’t go to the ER', at: c.end.at, note: what, details: [], name: 'ER', photos: [], by: c.name, ...who });
    }
    return out.sort((x, y) => new Date(x.at) - new Date(y.at));
  };
}
})();
