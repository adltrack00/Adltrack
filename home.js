/* Home: Your medications. Today's task cards sit under the profile; the medication cards and their tabs are on All medications
   (today.js), and today's totals sit in the menu where refunds and store credit were. Everything shown is what the papers or the
   label say; a skipped dose is only recorded, never moved or doubled, and Need help points to the doctor, the pharmacist and 911. */
const galleryBeforeHome=gallery;
const hmNow=(now=new Date())=>String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
const dayOf=d=>d.day||String(d.at||'').slice(0,10);
const activeMed=i=>i.med&&i.status==='deciding';
const markOf=(i,day,key)=>(i.marks||[]).find(m=>m.day===day&&m.key===key);
const refillWho=(i,day=today())=>C.refillFrom(i,day)==='pharmacy'?(i.pharmacy&&i.pharmacy.name||'the pharmacy'):(i.prescriber&&i.prescriber.name||'the doctor');

/* Follow-up appointments the family confirmed (still to go, or went). Each is its own card: see "Follow-up appointments" below. */
const appointments=(list=items)=>list.filter(i=>i.appt&&['deciding','received'].includes(i.status));

/* Every dose, pick-up, refill step and appointment due today, in time order; untimed steps last. */
function todayTasks(list=items,day=today()){const tasks=[];
for(const i of list.filter(activeMed)){const doses=(i.doses||[]).filter(d=>dayOf(d)===day);
if(i.pickup||markOf(i,day,'pickup')){const m=markOf(i,day,'pickup');tasks.push({item:i,key:'pickup',time:'',title:'Pick up '+i.name,sub:i.pharmacy&&i.pharmacy.name?'From '+i.pharmacy.name:'From the pharmacy',state:m?m.kind:''})}
else if(!i.asNeeded)for(const t of i.times||[]){const d=doses.find(x=>x.slot===t);tasks.push({item:i,key:'dose:'+t,slot:t,time:t,title:i.name,sub:howText(i),state:d?(d.kind==='taken'?'done':'skipped'):''})}
for(const step of ['call','ready']){const m=markOf(i,day,'refill:'+step);if(!m&&!(i.refill&&(i.refill.step===step||step==='ready'&&i.refill.step==='called')))continue;tasks.push({item:i,key:'refill:'+step,time:'',title:step==='call'?`Call ${refillWho(i,day)} to refill ${i.name}`:`Pick up the refill of ${i.name}`,sub:step==='call'?(C.refillFrom(i,day)==='doctor'?'For a new prescription':i.refills>0?`${i.refills} refill${i.refills>1?'s':''} left on the label`:'Ask how many refills are left'):i.pharmacy&&i.pharmacy.name||'',state:m?m.kind:''})}}
for(const a of appointments(list))if(a.date===day){const m=markOf(a,day,'appt');tasks.push({item:a,key:'appt',time:a.time||'',title:a.name,sub:a.place||a.note||'',phone:a.phone,state:a.status==='received'?'done':m?m.kind:''})}
return tasks.sort((a,b)=>(a.time||'99')<(b.time||'99')?-1:(a.time||'99')>(b.time||'99')?1:0)}

/* The totals in the menu. Doses given "as needed" count as taken; skipped doses are not left. */
function homeTotals(list=items,day=today()){const t=todayTasks(list,day).filter(x=>x.slot),asNeeded=list.filter(i=>activeMed(i)&&i.asNeeded).reduce((n,i)=>n+(i.doses||[]).filter(d=>dayOf(d)===day&&d.kind==='taken').length,0);
return {taken:t.filter(x=>x.state==='done').length+asNeeded,left:t.filter(x=>!x.state).length,refills:list.filter(i=>activeMed(i)&&i.refill&&i.refill.step).length}}

const dayLabel=(date,day=today())=>{const n=C.days(date,day);return n===0?'Today':n===1?'Tomorrow':n>1&&n<7?C.parseDate(date).toLocaleDateString('en-US',{weekday:'long'}):C.parseDate(date).toLocaleDateString('en-US',{month:'short',day:'numeric'})};

/* The care radar: the next things to do, most urgent first. No longer shown on Home (the Today cards carry it). */
function careRadar(list=items,day=today(),now=hmNow()){const out=[],meds=list.filter(activeMed),times=new Map();
for(const x of todayTasks(list,day))if(x.slot&&!x.state){if(!times.has(x.slot))times.set(x.slot,[]);times.get(x.slot).push(x.item.name)}
for(const [t,names] of times)out.push({title:`${slotName(t)||'Medication'}${slotName(t)?' medication':''} at ${clockText(t)}`,sub:(t<now?'Not marked yet · ':'')+names.join(', ')});
for(const i of meds.filter(i=>i.pickup))out.push({title:'Pick up '+i.name,sub:i.pharmacy&&i.pharmacy.name||'From the pharmacy'});
for(const i of meds.filter(i=>i.refill&&i.refill.step)){const s=i.refill.step;out.push({title:s==='call'?(i.refills>0&&C.refillFrom(i,day)==='pharmacy'?`${i.name}: ${i.refills} refill${i.refills>1?'s':''} left, call ${refillWho(i,day)}`:`${i.name}: call ${refillWho(i,day)} for a refill`):s==='called'?`${i.name}: waiting on ${i.pharmacy&&i.pharmacy.name||'the pharmacy'}`:`Pick up the refill of ${i.name}`,sub:'Needs refill'})}
for(const i of meds.filter(i=>C.expiresSoon(i,day)))out.push({title:`This bottle of ${i.name} expires on ${C.parseDate(i.discardAfter).toLocaleDateString('en-US',{month:'long',day:'numeric'})}`,sub:'Ask the pharmacy about a new one'});
const coming=appointments(list).filter(a=>a.status==='deciding');
for(const a of coming.filter(a=>a.date&&a.date>=day).sort((a,b)=>(a.date+(a.time||'')).localeCompare(b.date+(b.time||''))))out.push({title:`Follow-up visit ${dayLabel(a.date,day)}${a.time?' '+clockText(a.time):''}`,sub:[a.with,a.place].filter(Boolean).join(' · ')});
for(const a of coming.filter(a=>!a.date))out.push({title:'Book the follow-up visit'+(a.with?' with '+a.with:''),sub:a.note||'Call to book it'});
for(const a of list.filter(i=>i.appt&&i.status==='kept'))out.push({title:'Confirm the follow-up visit'+(a.with?' with '+a.with:''),sub:a.printed?'From the discharge papers':'Added by you'});
return out.slice(0,5)}

function helpNote(i,phone){const doc=i.prescriber||{},ph=i.pharmacy||{};return `<div class="today-help"><p>Not sure what to do? Call the doctor or the pharmacist. In an emergency, call 911.</p><p>${[telLink('Doctor:',doc.phone),telLink('Pharmacy:',ph.phone),telLink('Clinic:',phone),call911].filter(Boolean).join(' ')}</p>${helpSigns()}</div>`}
/* When to call, under the care radar: the papers' warning signs as printed, or the one line for when there are none. */
function whenToCallHTML(){const groups=whenToCall();return `<h2 class="call-head">When to call</h2>${groups.length?`<ol class="radar-list call-list">${groups.map(g=>`<li><strong>${esc(g.head)}</strong>${g.signs.map(t=>`<small>${esc(t)}</small>`).join('')}<small>${callLinks(g)}</small></li>`).join('')}</ol>`:`<p class="today-empty">${esc(NO_SIGNS)}</p><ol class="radar-list call-list"><li><small>${call911}</small></li></ol>`}`}
/* One card per row, like a list of locks: the bottle's photo, the medication and its dose, and Start at the end. The whole card
   opens the Take page (today.js); a visit opens its own card. Refill steps and pick-ups live on Your refills, not here. */
function todayThumb(x){if(x.item.appt)return apptPhoto(x.item);if(x.key==='task'||x.key==='incident')return taskPhoto(x.item,x.key==='task'?markOf(x.item,today(),'task'):null);return x.slot||x.key==='pickup'||x.key.startsWith('refill:')?medPhoto(x.item):`<div class="product-photo today-icon">${icon('clock')}</div>`}
/* No Start button: a blue arrow at the end, like a list of rows. A marked dose says so on its second line. */
const TODAY_ARROW='<svg class="today-arrow" viewBox="0 0 10 18" aria-hidden="true"><path d="m1.5 1.5 7 7.5-7 7.5"/></svg>';
function todayRow(x){const mark=x.state==='done'?'✓ Done':x.state==='skipped'?'Skipped':'',line=[x.slot?x.item.dose:'',x.time?clockText(x.time):'',mark].filter(Boolean).join(' · ');
return `<li class="today-row${x.state?' is-'+x.state:''}"><button class="today-card" data-today-start="${esc(x.item.id+'|'+x.key)}"><span class="today-thumb">${todayThumb(x)}</span><span class="today-what"><strong>${esc(x.title)}</strong>${line?`<small>${esc(line)}</small>`:''}</span>${TODAY_ARROW}</button></li>`}
/* My Tasks: doses, visits, tasks, incidents, and a refill from the day it's time to call (7 days before it runs out), each day
   until it's done: call, then pick it up. */
const homeTasks=(day=today())=>todayTasks(items,day).filter(x=>x.slot||['appt','task','incident'].includes(x.key)||x.key.startsWith('refill:'));
/* Vital signs on Home, in four colored tiles: blood pressure, heart rate, temperature and pain. Tapping one opens a small form
   under them for that vital sign only: blood pressure has systolic and diastolic (the cuff's pulse is the heart rate), heart
   rate the pulse, temperature the reading and pain its 0 to 10. The last reading is kept with the reminder settings, so it
   follows the account. */
let vitalsOpen='',vitalsShots=[],vitalsTyped=null,vitalsBusy=false,vitalsReading=false;const VITALS_PHOTOS=3;
const VITALS=[['bp','BP','vital-pink','<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" fill="currentColor" stroke="none"/>','',''],
['heart','Heart','vital-orange','<path d="M3 12h4l2-5 4 10 2-5h6"/>','',''],
['temp','Temp','vital-blue','<path d="M10 4a2 2 0 0 1 4 0v10a4 4 0 1 1-4 0Z"/><path d="M12 9v7"/>','','°'],
['pain','Pain','vital-purple','<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6"/><path d="M10 11h.01M14 11h.01M10 15.5c1.2-1 2.8-1 4 0"/>','','/10']];
/* Each vital sign's full name, its boxes (name, label, example), and whether a photo can be read for it. Pain can't be. */
const VITAL_FORMS={bp:['Blood pressure',[['sys','Systolic','120'],['dia','Diastolic','76']],true],heart:['Heart rate',[['pulse','Pulse','72']],true],
temp:['Temperature',[['temp','Temperature','98.6']],true],pain:['Pain level',[['pain','Pain','0 to 10']],false]};
/* The boxes as last saved: blood pressure is kept as "120/76". */
const vitalBoxes=(k,v=settings.vitals||{})=>k==='bp'?(([sys='',dia='']=String(v.bp||'').split('/'))=>({sys,dia}))():{[VITAL_FORMS[k][1][0][0]]:v[k]||''};
const vitalLast=k=>{const l=(settings.vitalsLog||[]).filter(x=>x[k]).pop();return l?new Date(l.at):null};
function vitalsHTML(){const v=settings.vitals||{};
const tiles=VITALS.map(([k,label,tone,path,,unit])=>`<button class="vital-tile ${tone}" data-vitals="${k}" aria-pressed="${vitalsOpen===k}" aria-label="${esc(label)}: ${v[k]?esc(v[k]+unit):'add'}"><span class="vital-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg></span><strong>${v[k]?esc(v[k]+unit):'—'}</strong><small>${esc(label)}</small></button>`).join('');
if(!vitalsOpen)return `<div class="vitals">${tiles}</div>`;
const k=vitalsOpen,[name,boxes,photo]=VITAL_FORMS[k],val={...vitalBoxes(k),...(vitalsTyped||{})},at=vitalLast(k);
const form=`<form class="vitals-form ${boxes.length>1?'is-two':'is-one'}" id="vitals-form" data-vital="${k}">${boxes.map(([b,label,ph])=>`<label><span>${esc(label)}</span><input id="vital-${b}" name="${b}" value="${esc(val[b]||'')}" placeholder="${esc(ph)}" inputmode="decimal" maxlength="5" autocomplete="off"></label>`).join('')}<div class="vitals-actions"><button class="today-pill" id="vitals-save" type="submit">Save</button><button class="today-pill is-light" type="button" data-vitals="">Cancel</button>${photo&&vitalsShots.length<VITALS_PHOTOS?`<label class="take-add vitals-photo" for="vitals-photo" aria-label="Take or add a photo of the ${esc(name.toLowerCase())} reading"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5h3.2l1.8-2.5h6l1.8 2.5H20V19H4Z"/><circle cx="12" cy="13.2" r="3.4"/></svg></label>`:''}${photo?'<input type="file" id="vitals-photo" accept="image/*" hidden>':''}</div>${vitalsShots.length?`<div class="take-shots">${vitalsShots.map((src,n)=>`<div class="take-shot">${proofImg(src)}<button class="take-shot-x" type="button" data-vitals-remove="${n}" aria-label="Remove photo ${n+1}">×</button></div>`).join('')}</div>`:''}${vitalsReading?'<p class="today-empty">Reading the numbers on the photo…</p>':at?`<p class="today-empty">${esc(name)} last saved ${esc(at.toLocaleDateString('en-US',{month:'short',day:'numeric'}))} at ${esc(at.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}))}.</p>`:''}</form>`;
return `<div class="vitals">${tiles}</div>${form}`}
/* The camera on the far right of Save and Cancel takes or picks a photo of the reading (the cuff's screen, the thermometer).
   The numbers on it are read and fill the boxes, for this vital sign only; they can still be typed or changed by hand. The
   photos (up to 3) are saved with the reading and show in Photos, like a dose's. */
const vitalsKeep=()=>{const f=$('#vitals-form');if(f)vitalsTyped=Object.fromEntries([...new FormData(f)].map(([b,x])=>[b,String(x)]))};
const vitalsClear=()=>{vitalsShots=[];vitalsTyped=null;vitalsReading=false};
const VITALS_UNREAD={blurry:'The photo is too blurry to read. Type the numbers in, or take another.',dark:'The photo is too dark to read. Type the numbers in, or take another.',glare:'The screen has a glare. Type the numbers in, or take another.',not_device:'No reading found on the photo. Type the numbers in.'};
async function readVitalsPhoto(k,src){vitalsReading=true;render();let r=null;try{r=await Account.api('POST','/api/vitals/read',{photo:src})}catch{}vitalsReading=false;
if(vitalsOpen!==k){render();return}const got=r&&r.reading,want=VITAL_FORMS[k][1].map(([b])=>b),fill=got?Object.fromEntries(want.filter(b=>got[b]).map(b=>[b,got[b]])):{};
if(Object.keys(fill).length===want.length){vitalsKeep();vitalsTyped={...(vitalsTyped||{}),...fill};render();toast(`${VITAL_FORMS[k][0]} filled in from the photo.`);return}
render();toast(got&&VITALS_UNREAD[got.problem]||'Couldn’t read the numbers on the photo. Type them in.')}
document.addEventListener('click',e=>{const r=e.target.closest('[data-vitals-remove]');if(r){vitalsKeep();vitalsShots.splice(Number(r.dataset.vitalsRemove),1);render();return}
const b=e.target.closest('[data-vitals]');if(!b)return;const k=b.dataset.vitals;vitalsOpen=k&&k!==vitalsOpen?k:'';vitalsClear();render();if(vitalsOpen){const f=$('#vitals-form input');if(f)f.focus()}});
document.addEventListener('change',async e=>{if(e.target.id!=='vitals-photo')return;const k=vitalsOpen,f=e.target.files[0];if(!f||!k)return;vitalsKeep();let src;
try{src=await readPhoto(f)}catch(err){toast(err.message);return}vitalsShots.push(src);readVitalsPhoto(k,src)});
document.addEventListener('submit',async e=>{if(e.target.id!=='vitals-form')return;e.preventDefault();if(vitalsBusy)return;const k=e.target.dataset.vital,d=new FormData(e.target),x=b=>String(d.get(b)||'').trim().slice(0,5);
const val=k==='bp'?(x('sys')||x('dia')?(x('sys')&&x('dia')?x('sys')+'/'+x('dia'):null):''):x(VITAL_FORMS[k][1][0][0]);if(val===null){toast('Enter both blood pressure numbers.');return}
vitalsBusy=true;const photos=(await Promise.all(vitalsShots.map(saveProof))).filter(Boolean);vitalsBusy=false;const at=new Date().toISOString(),{[k]:_,...rest}=settings.vitals||{};
settings.vitals={...rest,...(val?{[k]:val}:{}),at};if(val||photos.length)settings.vitalsLog=[...(settings.vitalsLog||[]),{...(val?{[k]:val}:{}),at,...(photos.length?{photos}:{})}].slice(-60);
vitalsOpen='';vitalsClear();save();render();toast(`${VITAL_FORMS[k][0]} saved.`)});

/* Home: the profile picture on top, the vital signs, how many of today's tasks are done as a line, then the task cards. */
function todayHTML(){const has=items.some(i=>(i.med||i.appt)&&i.status!=='received');if(!has)return `<section class="home-today">${vitalsHTML()}</section>`;const day=today(),tasks=homeTasks(day),done=tasks.filter(x=>x.state==='done').length,pct=tasks.length?Math.round(done/tasks.length*100):0;
return `<section class="home-today">${vitalsHTML()}${tasks.length?`<div class="today-progress"><span>${done}/${tasks.length}</span><div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${tasks.length}" aria-valuenow="${done}" aria-label="${done} of ${tasks.length} done today"><i style="width:${pct}%"></i></div></div>`:''}${tasks.length?`<ul class="today-list">${tasks.map(todayRow).join('')}</ul>`:'<p class="today-empty">Nothing due today.</p>'}</section>`}

gallery=function(){const el=document.createElement('div');el.innerHTML=galleryBeforeHome();const hero=el.querySelector('.profile-hero');if(hero){const t=hero.querySelector('h1');if(t)t.remove();hero.insertAdjacentHTML('afterend',todayHTML())}el.querySelectorAll('.utility-links #import-purchases').forEach(n=>n.remove());return el.innerHTML};

/* Follow-up appointments: each visit on the papers becomes its own card to confirm, like a medication: who, where, date, time
   and phone as printed. Until it's confirmed it shows nowhere else and gets no reminder; then it shows on Today on its day, on
   the care radar and on Your schedule, and is reminded the day before and 2 hours before (server/reminders.js). A visit the
   papers only describe ("See Dr. Patel in 1 week") has no date: the card asks the family to book it. Went finishes it. */
const APPT_STEPS=[['ride','Ride arranged'],['papers','Papers ready','Bring the discharge papers and your list of medications.'],['went','Went']];
const apptKey=a=>[a.date,a.time,a.with,a.place,a.note].join('|');
function newAppt(a={},from={}){return {id:crypto.randomUUID(),appt:true,apptKey:apptKey(a),name:'Follow-up visit'+(a.with?' with '+a.with:''),with:a.with||'',place:a.place||'',date:a.date||'',time:a.time||'',phone:a.phone||'',note:a.note||'',printed:!!from.printed,steps:{},status:'kept',intent:'keep',confirmed:false,demo:!!from.demo,window:null,retailer:'',price:0,category:'box',channel:'store',purchased:from.purchased||today(),delivered:'',...(from.purchaseId?{purchaseId:from.purchaseId}:{}),...(from.papers?{papers:from.papers}:{})}}
/* The papers' appointments become cards once, the first time the medications that carry them are seen. */
function syncAppointments(){let changed=false;const have=new Set(items.filter(i=>i.appt).map(i=>i.apptKey));
for(const m of items.filter(i=>i.med&&!i.apptMade&&i.discharge&&(i.discharge.appointments||[]).length)){for(const a of m.discharge.appointments){const k=apptKey(a);if(have.has(k))continue;have.add(k);items.push(newAppt(a,{printed:true,demo:m.demo,purchaseId:m.purchaseId,purchased:m.purchased,papers:m.papers}))}m.apptMade=true;changed=true}
return changed}
/* What the reminders will be: the day before, when that's still to come, and 2 hours before when the time is known. */
const apptReminds=i=>{const n=C.days(i.date,today()),r=i.remind||[],when=[r.includes('daily')&&n>=2&&'every day until then',r.includes('week')&&n>=7&&'a week before',r.includes('two')&&n>=2&&'2 days before',n>=2&&'the day before',i.time&&'2 hours before'].filter(Boolean);return when.length?` We’ll remind you ${when.length>1?when.slice(0,-1).join(', ')+' and '+when.at(-1):when[0]}.`:''};
const apptDay=i=>{const d=C.parseDate(i.date);return d?d.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})+(i.time?' · '+clockText(i.time):''):''};
/* Its photo: a drawn calendar page with the visit's month and day, or "Book" when there's no date yet. */
function apptPhoto(i){const d=C.parseDate(i.date);return `<div class="product-photo medication" role="img" aria-label="${esc((i.demo?'Illustrative example: ':'')+i.name)}"><svg viewBox="0 0 100 100" class="bottle-svg" aria-hidden="true"><rect x="12" y="18" width="76" height="70" rx="8" fill="#fff" stroke="#bbb"/><path d="M12 26a8 8 0 0 1 8-8h60a8 8 0 0 1 8 8v12H12Z" fill="#1c1c1c"/><rect x="29" y="10" width="7" height="16" rx="3.5" fill="#888"/><rect x="64" y="10" width="7" height="16" rx="3.5" fill="#888"/><text x="50" y="33" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">${d?d.toLocaleDateString('en-US',{month:'short'}).toUpperCase():'BOOK'}</text><text x="50" y="73" text-anchor="middle" font-size="30" font-weight="700" fill="#1c1c1c">${d?d.getDate():'?'}</text></svg></div>`}
const photoBeforeAppt=photo;photo=i=>i&&i.appt?apptPhoto(i):photoBeforeAppt(i);
/* Its label: not confirmed, book it, when it is, or went. */
function apptState(i,day=today()){if(i.status==='kept')return 'Not confirmed yet';if(i.status==='received')return 'Went';if(!i.date)return 'Book it';const n=C.days(i.date,day);return n<0?'Did you go?':dayLabel(i.date,day)+(i.time?' '+clockText(i.time):'')}
const apptCard=i=>`<article class="visual-card"><button class="media-link" data-open="${esc(i.id)}" aria-label="Open ${esc(i.name)}">${apptPhoto(i)}</button><h3>${esc(i.name)}</h3><p class="product-meta">${esc(i.place||i.note||'Follow-up visit')}</p><div class="card-bottom"><span class="card-label">${esc(apptState(i))}${i.demo?' · Example':''}</span><button data-open="${esc(i.id)}">${i.status==='kept'?'Confirm':'Open'} ↗</button></div></article>`;
const visualCardBeforeAppt=visualCard;visualCard=i=>i.appt?apptCard(i):visualCardBeforeAppt(i);
/* The Confirm card (to check it) and the Take card's layout (to show it). */
const apptLine=(label,v)=>`<p class="pick-price plan-when"><span>${label}</span>${esc(v)}</p>`;
const apptInput=(label,name,v,type='text',extra='')=>`<label class="pick-price plan-when"><span>${label}</span><input name="${name}" type="${type}" value="${esc(v||'')}"${extra}></label>`;
function bookRows(i,open){return `<details class="pick-edit"${open?' open':''}><summary>${i.date?'Change the date or time':'Book it'}</summary>${i.date?'':`<p class="pick-price">Call ${esc(i.with||'the clinic')} to book the visit, then add the date here.</p>${telLink('Call',i.phone)}`}${apptInput('Date','appt-date',i.date,'date',' id="appt-date"')}${apptInput('Time','appt-time',i.time,'time',' id="appt-time"')}<button type="button" class="pick-toggle" data-appt-book>Save the date</button></details>`}
function apptPage(i){const s=i.steps||{},top=`<li class="pick-card"><div class="pick-photo">${apptPhoto(i)}</div><p class="pick-name">${esc(i.name)}</p>`;
if(i.status==='kept')return flowShell('','',`<form id="appt-form" class="guided-form pick-form" novalidate><ul class="pick-grid single">${top}${i.printed?'<p class="flow-note">From the discharge papers. Check each line against the papers.</p>':''}${apptInput('With','with',i.with,'text',' maxlength="100" placeholder="Doctor or clinic"')}${apptInput('Where','place',i.place,'text',' maxlength="160" placeholder="Clinic and address"')}${apptInput('Date','date',i.date,'date')}${apptInput('Time','time',i.time,'time')}${apptInput('Phone','phone',i.phone,'tel',' maxlength="30" placeholder="To book or change it"')}${i.note?apptLine('As printed',i.note):''}${i.date?'':`<div class="flow-note"><p><b>No date yet.</b> Call to book it, then add the date.</p>${telLink('Call',i.phone)}</div>`}<label class="packing-row"><input type="checkbox" name="checked">${i.printed?'I checked this against the papers.':'I checked this with the clinic.'}</label><button class="pick-toggle">Confirm</button><button type="button" class="flow-text-link" data-appt-remove>Remove this appointment</button></li></ul></form>`,2);
const went=i.status==='received',steps=`<label class="packing-row"><input type="checkbox" disabled${i.date?' checked':''}>Booked</label>${APPT_STEPS.map(([k,label,sub])=>`<label class="packing-row"><input type="checkbox" data-appt-step="${k}"${s[k]?' checked':''}>${label}${sub?` · ${esc(sub)}`:''}</label>`).join('')}`;
return flowShell('','',`<div class="guided-form pick-form"><ul class="pick-grid single">${top}${apptLine('When',apptDay(i)||'Not booked yet')}${i.date?'':`<div class="flow-note"><p><b>Book it.</b> Call to book the visit, then add the date below.</p>${telLink('Call',i.phone)}</div>`}${apptLine('Where',i.place||'Not on the papers')}${i.place?`<a class="flow-text-link" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(i.place)}" target="_blank" rel="noopener">Directions ↗</a>`:''}${i.phone?`${apptLine('Phone',i.phone)}${telLink('Call',i.phone)}`:''}${i.note?apptLine('As printed',i.note):''}${papersRow({...i,discharge:i.printed||null,page:0})}${went?`<p class="flow-note">Went${s.went?' on '+esc(C.parseDate(s.went).toLocaleDateString('en-US',{month:'long',day:'numeric'})):''}. No more reminders for this visit.</p>`:bookRows(i,!i.date)}${steps}<button type="button" class="flow-text-link" data-appt-remove>Remove this appointment</button></li></ul></div>`,3)}
const planBeforeAppt=planPage;planPage=function(){const i=find(selected);return i&&i.appt?apptPage(i):planBeforeAppt()};
const apptDayOk=d=>!d||!!C.parseDate(d),apptClockOk=t=>!t||/^([01]\d|2[0-3]):[0-5]\d$/.test(t);
document.addEventListener('submit',e=>{if(e.target.id!=='appt-form')return;e.preventDefault();const i=find(selected);if(!i)return;const f=e.target.elements,v=k=>f[k].value.trim();
const problem=!f.checked.checked?(i.printed?'Check it against the papers, then tick the box.':'Check it with the clinic, then tick the box.'):!v('with')&&!v('place')?'Add who the visit is with.':!apptDayOk(v('date'))||!apptClockOk(v('time'))?'Check the date and time.':'';
if(problem){journey.error=problem;render();return}journey.error='';Object.assign(i,{with:v('with'),place:v('place'),date:v('date'),time:v('time'),phone:v('phone'),status:'deciding',confirmed:true});i.name='Follow-up visit'+(i.with?' with '+i.with:'');save();render();window.scrollTo(0,0);toast(i.date?'Confirmed.'+apptReminds(i):'Confirmed. Call to book it, then add the date.')});
document.addEventListener('change',e=>{const k=e.target.dataset?.apptStep;if(!k||view!=='plan')return;const i=find(selected);if(!i||!i.appt)return;i.steps={...i.steps,[k]:e.target.checked?today():''};if(k==='went'){i.status=e.target.checked?'received':'deciding';i.returnedOn=e.target.checked?today():''}save();render();if(k==='went'&&e.target.checked)toast('Went. No more reminders for this visit.')});
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
if(b.id==='add-appointment'){const a=newAppt();items.push(a);save();selected=a.id;journey.error='';view='plan';render();window.scrollTo(0,0);return}
if(view!=='plan')return;const i=find(selected);if(!i||!i.appt)return;
if(b.hasAttribute('data-appt-book')){const d=$('#appt-date').value,t=$('#appt-time').value;if(!d||!apptDayOk(d)||!apptClockOk(t)){journey.error='Pick the date of the visit.';render();return}journey.error='';i.date=d;i.time=t;save();render();toast(`Booked for ${apptDay(i)}.`+apptReminds(i))}
if(b.hasAttribute('data-appt-remove')){items=items.filter(x=>x.id!==i.id);selected=null;journey.error='';view='overview';save();render();window.scrollTo(0,0);toast('Appointment removed.')}});
/* "Add an appointment +" by hand, next to the home shortcuts; visits also show on Your schedule. */
const galleryBeforeAppt=gallery;gallery=function(){const el=document.createElement('div');el.innerHTML=galleryBeforeAppt();el.querySelector('.utility-links')?.insertAdjacentHTML('afterbegin','<button id="add-appointment">Add an appointment +</button>');return el.innerHTML};
const calendarBeforeAppt=calendarPage;calendarPage=function(){const el=document.createElement('div');el.innerHTML=calendarBeforeAppt();const visits=appointments().filter(a=>a.date).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
el.querySelectorAll('.calendar-cell[data-date]').forEach(c=>{const n=visits.filter(a=>a.date===c.dataset.date).length;if(n)c.querySelector('span').insertAdjacentHTML('afterend',`<small>${n>1?n+' visits':'Follow-up visit'}</small>`)});
const month=C.iso(calendarMonth).slice(0,7),shown=visits.filter(a=>calendarDay?a.date===calendarDay:a.date.slice(0,7)===month),h=el.querySelector('.section-heading');
if(h&&shown.length)h.insertAdjacentHTML('beforebegin',`<div class="section-heading"><h2>Follow-up visits</h2></div><ul class="today-list">${shown.map(a=>`<li class="today-row${a.status==='received'?' is-done':''}"><div class="today-thumb">${apptPhoto(a)}</div><div class="today-what"><strong>${esc(a.name)}</strong><small>${esc([apptDay(a),a.place].filter(Boolean).join(' · '))}</small></div><button class="today-pill" data-open="${esc(a.id)}">Open</button></li>`).join('')}</ul>`);return el.innerHTML};
/* Only someone who may change the plan makes the cards; everyone else gets them from the account. */
if(mayDo('meds')&&syncAppointments())save();
const renderBeforeAppt=render;render=function(){if(mayDo('meds')&&syncAppointments())save();renderBeforeAppt()};

/* Example medications on day one, labelled as examples, in place of Returnly's example purchases. */
function exampleMeds(day=today(),now=hmNow()){const base={med:true,demo:true,status:'deciding',intent:'return',confirmed:true,retailer:'',price:0,category:'box',channel:'store',purchased:day,delivered:'',photoKey:'medication',prescriber:EXAMPLE_DOCTOR,pharmacy:EXAMPLE_PHARMACY,doses:[]},given=t=>now>=t?[{at:new Date(day+'T'+t).toISOString(),day,kind:'taken',slot:t}]:[];
return [{...base,id:'demo-lisinopril',name:'Lisinopril 10 mg',dose:'1 tablet',instructions:'Take 1 tablet by mouth every morning.',pillLooks:'Pink round tablet',warnings:['May cause dizziness.','Take exactly as directed.'],times:['08:00'],quantity:60,filled:day,refills:2,doses:given('08:00'),discharge:{...EXAMPLE_SIGNS}},
{...base,id:'demo-metoprolol',name:'Metoprolol 25 mg',dose:'1 tablet',instructions:'Take 1 tablet by mouth twice a day.',times:['08:00','18:00'],doses:given('08:00')},
{...base,id:'demo-atorvastatin',name:'Atorvastatin 20 mg',dose:'1 tablet',instructions:'Take 1 tablet by mouth at bedtime.',times:['21:00'],quantity:30,filled:C.shift(day,-24),refills:0,discardAfter:C.shift(day,5),refill:{step:'call',since:day}},
{...base,id:'demo-acetaminophen',name:'Acetaminophen 500 mg',instructions:'Take 2 tablets every 6 hours as needed for pain. Do not take more than 8 tablets in 24 hours.',times:[],asNeeded:true},
{...newAppt({with:EXAMPLE_DOCTOR.name,place:'Example Clinic, 40 Oak Ave',date:C.shift(day,2),time:'14:00',phone:EXAMPLE_DOCTOR.phone},{printed:true,demo:true}),id:'demo-visit',status:'deciding',confirmed:true,purchased:day}]}
if(items.some(i=>i.demo&&!i.med&&!i.appt))items=[...items.filter(i=>!i.demo),...exampleMeds()];
/* Example medications saved before the example papers had warning signs get them, so When to call can be tried. */
for(const i of items)if(i.id==='demo-lisinopril'&&i.discharge&&!i.discharge.warningSigns)Object.assign(i.discharge,EXAMPLE_SIGNS);
// Example medications saved before the amount was added get it, so the reminder preview reads "Lisinopril 10 mg, 1 tablet".
{const ex=Object.fromEntries(exampleMeds().map(i=>[i.id,i]));let added=false;for(const i of items)if(i.demo&&i.med&&!i.dose&&ex[i.id]&&ex[i.id].dose){i.dose=ex[i.id].dose;added=true}if(added&&mayDo('meds'))save()}
