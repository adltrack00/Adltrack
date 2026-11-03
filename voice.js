/* Talk instead of typing (George 2026-11-03): every box where people write a note, what happened, how they feel or what was
   done gets a small round mic in its corner. Tap it and talk: the words show in the box as they're said, then stay there to
   check and change before saving. Tap again (or stop talking) to stop. It uses the phone's own speech-to-text, so it's free and
   no sound is kept by Adltrack. Where the browser has none, the mic opens the keyboard so its own mic can be used. Ada's chat
   has its own mic (assistant.js). The boxes and their forms are unchanged; the mic only sits on top. */
const VOICE_FIELDS = ['textarea', '.plus-form input[name="what"]', '.plus-form input[name="done"]', '.plus-form input[name="witnesses"]', '.plus-form input[name="told"]', '.plus-form input[name="with"]', '.plus-form input[name="place"]'].join(',');
const VOICE_SKIP = '.ada-pop, #import-dialog, [readonly], [disabled], [type="hidden"]';
const VOICE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>';
/* Joins what was there with what's being said: a space between, a capital letter to start a sentence. */
function voiceJoin(before, said) {
  const s = String(said || '').replace(/\s+/g, ' ').trim(); if (!s) return before;
  const b = String(before || ''), start = !b.trim() || /[.!?]\s*$/.test(b);
  return b + (b && !/\s$/.test(b) ? ' ' : '') + (start ? s.charAt(0).toUpperCase() + s.slice(1) : s);
}
if (typeof module !== 'undefined') module.exports = { voiceJoin, VOICE_FIELDS };

if (typeof document !== 'undefined') {
let voice = null;
const VoiceRec = window.SpeechRecognition || window.webkitSpeechRecognition;
function voiceAdd() {
  for (const f of document.querySelectorAll(VOICE_FIELDS)) {
    if (f.dataset.voice || f.matches(VOICE_SKIP) || f.closest(VOICE_SKIP)) continue;
    f.dataset.voice = '1';
    const wrap = document.createElement('span'); wrap.className = 'voice-field' + (f.tagName === 'TEXTAREA' ? ' is-area' : '');
    f.parentNode.insertBefore(wrap, f); wrap.appendChild(f);
    const b = document.createElement('button'); b.type = 'button'; b.className = 'voice-mic'; b.setAttribute('aria-label', 'Talk instead of typing'); b.innerHTML = VOICE_ICON;
    wrap.appendChild(b);
  }
}
function voiceStop() { const v = voice; voice = null; if (!v) return; try { v.rec.stop(); } catch {} v.btn.classList.remove('on'); v.btn.setAttribute('aria-label', 'Talk instead of typing'); if (v.field.isConnected) { v.field.placeholder = v.placeholder; v.field.dispatchEvent(new Event('change', { bubbles: true })); } }
function voiceStart(field, btn) {
  if (voice && voice.field === field) return voiceStop();
  voiceStop();
  if (!VoiceRec) { field.focus(); if (typeof toast === 'function') toast('Tap the microphone on your keyboard to talk.'); return; }
  const rec = new VoiceRec(), before = field.value, max = Number(field.getAttribute('maxlength')) || 2000;
  rec.lang = navigator.language || 'en-US'; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 1;
  voice = { rec, field, btn, placeholder: field.placeholder };
  rec.onresult = e => {
    if (!field.isConnected) return voiceStop();
    field.value = voiceJoin(before, [...e.results].map(r => r[0].transcript).join(' ')).slice(0, max);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    if (field.tagName === 'TEXTAREA') field.scrollTop = field.scrollHeight;
  };
  rec.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { if (typeof toast === 'function') toast('Allow the microphone for Adltrack in your phone’s settings to talk.'); } else if (e.error === 'no-speech') { if (typeof toast === 'function') toast('I didn’t hear anything. Tap the mic and talk again.'); } };
  rec.onend = () => { if (voice && voice.rec === rec) voiceStop(); };
  try { rec.start(); btn.classList.add('on'); btn.setAttribute('aria-label', 'Stop talking'); field.placeholder = 'Listening… talk now'; }
  catch { voice = null; field.focus(); if (typeof toast === 'function') toast('Tap the microphone on your keyboard to talk.'); }
}
document.addEventListener('click', e => { const b = e.target.closest('.voice-mic'); if (!b) return; e.preventDefault(); const f = b.parentNode.querySelector('textarea,input'); if (f) voiceStart(f, b); });
/* A form saved or a page changed while talking: stop listening. */
document.addEventListener('submit', () => voiceStop(), true);
let voiceQueued = false;
new MutationObserver(() => { if (voice && !voice.field.isConnected) voiceStop(); if (voiceQueued) return; voiceQueued = true; requestAnimationFrame(() => { voiceQueued = false; voiceAdd(); }); }).observe(document.body, { childList: true, subtree: true });
voiceAdd();
}
