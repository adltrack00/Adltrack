(function(root){
const dayMs=86400000;
function parseDate(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return null;const [y,m,d]=s.split('-').map(Number);const t=new Date(y,m-1,d,12);return t.getFullYear()===y&&t.getMonth()===m-1&&t.getDate()===d?t:null}
function iso(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function shift(s,n){const d=parseDate(s);if(!d)return null;d.setDate(d.getDate()+Number(n));return iso(d)}
function ordinal(s){const d=parseDate(s);return d?Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/dayMs:null}
function days(s,today){const a=ordinal(s),b=ordinal(today);return a===null||b===null?null:a-b}
function due(item){if(item.window===null||item.window===undefined||item.window==='')return null;return shift(item.basis==='purchase'?item.purchased:item.delivered,item.window)}
function active(item,today){const n=days(due(item),today);return !['kept','received'].includes(item.status)&&item.outcome!=='final'&&(item.status==='shipped'||n===null||n>=0)}
function eligible(item,today){return active(item,today)&&item.confirmed&&item.requirement!=='unknown'&&['credit','refund'].includes(item.outcome)&&!!due(item)}
function escape(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function icsEscape(s){return String(s).replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;')}
function calendar(item,today,time){const deadline=due(item);if(item.status==='shipped'||!deadline||!active(item,today)||!item.confirmed||item.requirement==='unknown')return null;const count=days(deadline,today);const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Adltrack//Return reminders//EN','CALSCALE:GREGORIAN'];for(let n=0;n<=Math.min(count,365);n++){const date=shift(today,n),d=parseDate(date);const [h,m]=(time||'09:00').split(':').map(Number);d.setHours(h,m,0,0);const stamp=d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');const end=new Date(d.getTime()+15*60000).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');const remain=count-n;const text=remain===0?'Return deadline today':remain===1?'Return deadline tomorrow':`${remain} days left to return`;lines.push('BEGIN:VEVENT',`UID:back-${item.id}-${date}@local`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}`,`DTSTART:${stamp}`,`DTEND:${end}`,`SUMMARY:${icsEscape(text+': '+item.name)}`,`DESCRIPTION:${icsEscape('Deadline requires: '+item.requirement+'. Next step: '+(item.next||'Review the return instructions')+'. Confirm the retailer cutoff time and allow for shipping. '+(item.url||''))}`,'BEGIN:VALARM','TRIGGER:-PT0M','ACTION:DISPLAY',`DESCRIPTION:${icsEscape(text+': '+item.name)}`,'END:VALARM','END:VEVENT')}lines.push('END:VCALENDAR');return lines.join('\r\n')+'\r\n'}
/* Refills: when the bottle runs out, from the label's quantity, how many the directions say to take each time and the
   confirmed dose times. Counted from the last refill, the label's fill date or the day it was confirmed. A blank is better
   than a guess: no quantity, no dose times, "as needed", a range ("1 to 2 tablets") or a liquid gives no date. */
const WORD_COUNT={one:1,two:2,three:3,four:4,half:.5,'1/2':.5};
function perDose(item){const how=[item.instructions,item.dose].filter(Boolean).join(' ');if(/\d\s*(?:to|-|or)\s*\d/i.test(how))return null;const m=/\b(\d+(?:\.\d+)?|one|two|three|four|half|1\/2)\s+(?:tablet|capsule|pill|caplet)s?\b/i.exec(how);if(!m)return null;const n=WORD_COUNT[m[1].toLowerCase()]||Number(m[1]);return n>0?n:null}
function runsOut(item){const q=Number(item.quantity),per=perDose(item),n=(item.times||[]).length,from=item.refilledOn||item.filled||item.purchased;if(!item.med||item.asNeeded||!(q>0)||!n||!per||!parseDate(from))return null;return shift(from,Math.floor(q/(per*n)))}
/* A week before it runs out the refill steps start. The pharmacy refills it while the label has refills left and the
   refill-by date hasn't passed; otherwise the doctor writes a new prescription. Unknown refills: ask the pharmacy. */
function refillDue(item,today){const d=days(runsOut(item),today);return d!==null&&d<=7}
function refillFrom(item,today){return item.refills===0||(parseDate(item.refillBy)&&item.refillBy<today)?'doctor':'pharmacy'}
/* "This bottle expires on …": the label's discard-after date, a week before. */
function expiresSoon(item,today){const d=days(item.discardAfter,today);return d!==null&&d>=0&&d<=7}
const api={runsOut,perDose,refillDue,refillFrom,expiresSoon,parseDate,iso,shift,days,due,active,eligible,escape,calendar};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BackCore=api;
})(typeof window!=='undefined'?window:globalThis);
