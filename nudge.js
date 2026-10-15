/* The daily reminder's content, shared by the server (push and email) and the app (the Reminders preview), so they always
   say the same thing. One reminder a day groups the user's returns; the wording gets more urgent as the deadline nears
   ("Every day" → "The day before" → "Deadline day"), and each one carries the single next step from the item's return guide,
   the money at stake, the days left and the nearest drop-off when it's known. */
(function (root) {
const C = typeof module !== 'undefined' && module.exports ? require('./core.js') : root.BackCore;
const statusNames = { deciding: 'Deciding', started: 'Return started', shipped: 'Returned · awaiting outcome', received: 'Received', kept: 'Keeping it' };
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const money = n => '$' + (Number.isInteger(n) ? String(n) : n.toFixed(2));
const sentence = s => { s = clip(s, 160).replace(/[.!\s]+$/, ''); return s ? s + '.' : ''; };

/* Same words as the app's countdown badge (daysLabel in app.js). */
function daysLabel(i, today) {
  const n = C.days(C.due(i), today);
  if (['kept', 'received'].includes(i.status)) return statusNames[i.status];
  if (i.status === 'shipped') return 'Awaiting ' + (i.outcome === 'credit' ? 'credit' : 'outcome');
  if (i.outcome === 'final') return 'Not returnable';
  if (n === null && i.window === null && i.confirmed) return 'No fixed window';
  if (n === null) return 'Awaiting delivery';
  if (n < 0) return 'Window ended';
  if (!i.confirmed && !i.dateSet && i.status !== 'started') return 'Date unconfirmed';
  return n === 0 ? 'Due today' : n === 1 ? 'Due tomorrow' : `${n} days left`;
}

/* Items that get reminders: being returned, or with a confirmed window; not sent back, kept or received; not examples
   (unless asked, for the preview); with a deadline; and not snoozed past today. Most urgent first. */
function due(items, today, { examples = false } = {}) {
  const left = i => { const n = C.days(C.due(i), today); return n === null ? Infinity : n; };
  return (items || []).filter(i => i && C.active(i, today) && (examples || !i.demo)
    && (i.status === 'started' || (i.confirmed && i.status !== 'shipped' && i.requirement !== 'unknown'))
    && C.due(i) && (!i.snoozeUntil || i.snoozeUntil <= today))
    .sort((a, b) => left(a) - left(b));
}

/* "Gentle": only at the halfway point of the window and 7, 3 and 1 days before the deadline. */
function gentleDay(i, today) {
  const n = C.days(C.due(i), today);
  if ([7, 3, 1].includes(n)) return true;
  return Number.isInteger(i.window) && i.window >= 4 && n === Math.floor(i.window / 2);
}

/* The way of returning the user picked on the Return card (or the easiest one), from the session 5 guide. */
function chosenWay(i) {
  const g = i.returnGuide;
  if (!g || !Array.isArray(g.methods) || !g.methods.length || (i.policyStore && i.policyStore !== i.retailer)) return null;
  return g.methods.find(m => m.label === i.returnMethod) || g.methods[0];
}
const acceptsInStore = i => { const g = i.returnGuide; return !!(g && Array.isArray(g.methods) && g.methods.some(m => m.type === 'store')); };

/* The single next step: the saved QR code or label when there is one, otherwise the first step of the chosen way. */
function nextStep(i) {
  const way = chosenWay(i);
  if (i.label) return way && way.type === 'mail' ? 'Tap for your return label.' : 'Tap for your QR code.';
  if (way && way.steps && way.steps[0]) return sentence(way.steps[0]);
  return sentence(i.next) || 'Open Adltrack for your next step.';
}

/* The money at stake: what comes back, as a refund or store credit, when the price is known. */
function stake(i) {
  const p = Number(i.price);
  if (!(p > 0)) return '';
  return money(Math.round(p * 100) / 100) + (i.outcome === 'credit' ? ' in store credit' : i.outcome === 'refund' ? ' back' : ' at stake');
}

/* Today's closing time from a place's opening hours ("Monday: 8:00 AM – 10:00 PM") on a local date, as "10pm";
   "open 24 hours"; or null when it's closed today or the hours aren't known. */
function closesToday(hours, date) {
  const d = C.parseDate(date);
  if (!d || !Array.isArray(hours)) return null;
  const line = hours.find(h => typeof h === 'string' && h.startsWith(WEEKDAYS[d.getDay()] + ':'));
  if (!line) return null;
  if (/open 24 hours/i.test(line)) return 'open 24 hours';
  if (/closed/i.test(line)) return null;
  const m = /(\d{1,2})(?::(\d{2}))?\s*([AP])\.?M\.?\s*$/i.exec(line);
  return m ? `${Number(m[1])}${m[2] && m[2] !== '00' ? ':' + m[2] : ''}${m[3].toLowerCase()}m` : null;
}

/* The nearest drop-off the user looked up on the Return card (`dropoff`: name, partner, miles, hours, type), when known. */
function dropoffLine(i, n, today) {
  const d = i.dropoff && typeof i.dropoff === 'object' && Number.isFinite(i.dropoff.miles) ? i.dropoff : null;
  const name = d ? clip(d.partner || d.name, 60) : '';
  if (n === 0 && acceptsInStore(i)) {
    // Deadline day: say so when it can still be done in a store today.
    const store = clip(i.returnGuide.store || i.retailer, 60);
    if (d && d.type === 'store') {
      const t = closesToday(d.hours, today);
      if (t === 'open 24 hours') return `Still possible today: ${name} is open 24 hours, ${d.miles} mi away.`;
      if (t) return `Still possible today: ${name} closes at ${t}, ${d.miles} mi away.`;
      return '';
    }
    return `Still possible today: ${store} takes returns in store.`;
  }
  return d ? `Nearest drop-off: ${name}, ${d.miles} mi.` : '';
}

/* The day's reminder for these items on `today` (the user's local date), or null when nothing needs one.
   options: gentle (only on gentle days), examples (include example items, for the preview). */
function compose(items, today, { gentle = false, examples = false } = {}) {
  let list = due(items, today, { examples });
  if (gentle) list = list.filter(i => gentleDay(i, today));
  if (!list.length) return null;
  const first = list[0], n = C.days(C.due(first), today);
  const week = list.filter(i => C.days(C.due(i), today) <= 7);
  const total = Math.round(week.reduce((s, i) => s + (Number(i.price) > 0 ? Number(i.price) : 0), 0) * 100) / 100;
  // Every day → the day before → deadline day.
  const stage = n === 0 ? 'today' : n === 1 ? 'tomorrow' : n <= 3 ? 'soon' : 'daily';
  const urgent = { today: 'Deadline today', tomorrow: 'Deadline tomorrow', soon: `Only ${n} days left` }[stage] || daysLabel(first, today);
  const title = week.length > 1 && n > 1 ? `${week.length} returns due this week${total > 0 ? `: ${money(total)} total` : ''}` : 'Adltrack · ' + urgent;
  const when = n === 0 ? 'due today' : n === 1 ? 'due tomorrow' : `${n} days left`;
  const parts = [[clip(first.name, 120), stake(first), when].filter(Boolean).join(' · ') + '.', nextStep(first)];
  const place = dropoffLine(first, n, today);
  if (place) parts.push(place);
  else if (n === 0) parts.push('Check the exact cutoff time.');
  const others = list.length - 1;
  if (others) parts.push(`Plus ${others} other return window${others === 1 ? '' : 's'}${week.length > 1 && n <= 1 && total > 0 ? ` (${money(total)} due this week)` : ''}.`);
  const url = 'app.html?remind=' + encodeURIComponent(first.id);
  const actions = [
    ...(first.label ? [{ action: 'show-qr', title: 'Show QR code' }] : []),
    { action: 'snooze', title: 'Snooze until tomorrow' },
    { action: 'sent', title: 'I sent it back' },
    { action: 'keep', title: 'I’m keeping it' }
  ];
  return { title, body: parts.join(' '), itemId: first.id, url, stage, items: list.map(i => i.id), days: Object.fromEntries(list.map(i => [i.id, C.days(C.due(i), today)])), actions };
}

const api = { compose, due, gentleDay, nextStep, stake, closesToday, daysLabel, money };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ReturnlyNudge = api;
})(typeof window !== 'undefined' ? window : globalThis);
