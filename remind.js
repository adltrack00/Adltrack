/* Reminders that get it done: the Reminders preview shows the real daily reminder (nudge.js, the same words the server sends),
   new rows at the end of the Reminders settings card ("Also email me", quiet hours, "Gentle"), notification actions applied
   to the open app, "Show QR code" from a reminder, and the nearest drop-off kept on the item for the next reminder. */
const remindersPageBeforeNudge=remindersPage,findNearbyBeforeNudge=findNearby,N=ReturnlyNudge;
const remindParams=new URLSearchParams(location.search),remindShow=remindParams.get('show'),remindOpened=remindParams.get('remind');
let emailPrefs={available:false,daily:true,unopened:true};
const validClock=t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t||'');
const nowClock=()=>{const d=new Date();return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')};
function inQuiet(t){const a=settings.quietStart,b=settings.quietEnd;if(!validClock(a)||!validClock(b)||a===b)return false;return a<b?t>=a&&t<b:t>=a||t<b}
const sendClock=()=>inQuiet(settings.time)?settings.quietEnd:settings.time;

/* The device's time zone goes with the settings, so emailed reminders arrive at the chosen time where the user is. */
try{const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;if(tz&&settings.timeZone!==tz){settings.timeZone=tz;save()}}catch{}
if(Account.user())Account.api('GET','/api/email/prefs').then(p=>{emailPrefs=p;if(view==='reminders')render()}).catch(()=>{});

function reminderExtraRows(){const emailOn=emailPrefs.available&&(emailPrefs.daily||emailPrefs.unopened);return `<form id="reminder-extra-form"><label class="check-label"><input type="checkbox" name="email" ${emailOn?'checked':''} ${emailPrefs.available?'':'disabled'}> Also email me${emailPrefs.available?'':' (email isn’t set up yet)'}</label><label>Quiet hours from <input type="time" name="quietStart" value="${esc(validClock(settings.quietStart)?settings.quietStart:'')}"></label><label>Quiet hours until <input type="time" name="quietEnd" value="${esc(validClock(settings.quietEnd)?settings.quietEnd:'')}"></label><label class="check-label"><input type="checkbox" name="gentle" ${settings.gentle?'checked':''}> Gentle: only at the halfway point and 7, 3 and 1 days before</label></form>`}
remindersPage=function(){const el=document.createElement('div');el.innerHTML=remindersPageBeforeNudge();
  // The preview card keeps its layout and shows the reminder the user would get today (examples included while exploring).
  const r=N.compose(items,today(),{gentle:!!settings.gentle,examples:true}),pv=el.querySelector('.notification-preview');
  if(pv&&r){pv.querySelector('strong').textContent=r.title;pv.querySelector('p').textContent=r.body;pv.querySelector('.preview-brand span:last-child').textContent=sendClock()}
  const card=el.querySelector('.settings-card');if(card)card.insertAdjacentHTML('beforeend',reminderExtraRows());return el.innerHTML};

document.addEventListener('change',async e=>{const f=e.target.closest&&e.target.closest('#reminder-extra-form');if(!f)return;const t=e.target;
  if(t.name==='email'){try{emailPrefs=await Account.api('PUT','/api/email/prefs',{daily:t.checked,unopened:t.checked});toast(t.checked?'We’ll also email you when push isn’t set up, or a reminder isn’t opened 3 days before a deadline.':'Reminder emails are off.')}catch(err){t.checked=!t.checked;toast(err.message)}return}
  if(t.name==='gentle'){settings.gentle=t.checked;save();render();toast(t.checked?'Gentle reminders: halfway, then 7, 3 and 1 days before.':'Daily reminders until it’s complete.');return}
  if(t.name==='quietStart'||t.name==='quietEnd'){const a=f.elements.quietStart.value,b=f.elements.quietEnd.value;if(a&&b&&a===b){toast('Pick two different times.');return}if(validClock(a)&&validClock(b)){settings.quietStart=a;settings.quietEnd=b;save();render();toast(`Quiet hours saved: no reminders from ${a} to ${b}.`)}else if(!a&&!b){delete settings.quietStart;delete settings.quietEnd;save();render();toast('Quiet hours are off.')}}});

/* The open app's daily notification, held until quiet hours end. */
reminderTick=function(){if(!settings.daily||!settings.notifications||!('Notification'in window)||Notification.permission!=='granted')return;const time=nowClock();if(time<sendClock()||inQuiet(time))return;const day=today();if(read('back-last-nudge','')===day||reminderTick.busy)return;if(window.Push&&Push.active())return;reminderTick.busy=true;Account.api('POST','/api/reminders/claim',{date:day,time}).then(({reminder,quiet})=>{if(quiet)return;localStorage.setItem('back-last-nudge',JSON.stringify(day));if(reminder)Push.show(reminder)}).catch(()=>{}).finally(()=>{reminderTick.busy=false})};

/* A notification's action was saved by the service worker: show it here too, so this copy doesn't undo it. */
function applyReminderAction(id,action){const i=find(id);if(!i)return;if(action==='snooze')i.snoozeUntil=C.shift(today(),1);if(action==='sent'&&!['received','kept'].includes(i.status)){i.status='shipped';i.returnedOn=today()}if(action==='keep'){i.status='kept';i.intent='keep'}save();render();toast(action==='snooze'?'Daily nudge paused until tomorrow. Deadline stays unchanged.':action==='sent'?'Marked as sent back. Reminders stop for it.':'Keeping it. Reminders stop for it.')}
function showReminderLabel(id){const i=find(id);if(i&&i.label)showLabel(i);else if(i)toast('Add your QR code or label on the Return card first.')}
if('serviceWorker'in navigator)navigator.serviceWorker.addEventListener('message',e=>{const d=e.data||{};if(d.type==='returnly-item-action')applyReminderAction(d.itemId,d.action);if(d.type==='returnly-open-item'&&d.show==='label')setTimeout(()=>showReminderLabel(d.itemId),50)});
document.addEventListener('DOMContentLoaded',()=>{if(!remindOpened)return;if(Account.user())Account.api('POST','/api/reminders/opened',{}).catch(()=>{});if(remindShow==='label')setTimeout(()=>showReminderLabel(remindOpened),50)});

/* "Nearest drop-off": the closest place is kept on the item (name, distance, opening hours; never the user's location),
   so the next reminder can say where to go and, on deadline day, until when. */
findNearby=async function(i,way){await findNearbyBeforeNudge(i,way);const m=i.returnGuide&&i.returnGuide.methods[way],p=nearby.key===i.id+'#'+way&&nearby.state==='done'&&nearby.places[0];const live=find(i.id);if(!m||!p||!live)return;live.dropoff={name:p.name,partner:p.partner||'',miles:p.miles,hours:Array.isArray(p.hours)?p.hours.slice(0,7):[],type:m.type,method:way,checked:today()};save()};
render();
