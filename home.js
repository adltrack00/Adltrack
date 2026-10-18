/* Home: Your medications. Today's checklist and the care radar sit between the profile and the medication cards, and today's
   totals sit in the menu where refunds and store credit were. Everything shown is what the papers or the label say; a skipped
   dose is only recorded, never moved or doubled, and Need help points to the doctor, the pharmacist and 911. */
const galleryBeforeHome=gallery;
let homeHelp='';
const hmNow=(now=new Date())=>String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
const dayOf=d=>d.day||String(d.at||'').slice(0,10);
const activeMed=i=>i.med&&i.status==='deciding';
const markOf=(i,day,key)=>(i.marks||[]).find(m=>m.day===day&&m.key===key);
const refillWho=i=>i.refills>0?(i.pharmacy&&i.pharmacy.name||'the pharmacy'):(i.prescriber&&i.prescriber.name||'the doctor');

/* Follow-up appointments as printed on the papers, once each, with the medication that carries them. */
function appointments(list=items){const seen=new Set(),out=[];for(const i of list)for(const a of (i.discharge&&i.discharge.appointments)||[]){const key='appt:'+[a.date,a.time,a.with,a.place].join('|');if(seen.has(key))continue;seen.add(key);out.push({...a,key,item:i})}return out}

/* Every dose, pick-up, refill step and appointment due today, in time order; untimed steps last. */
function todayTasks(list=items,day=today()){const tasks=[];
for(const i of list.filter(activeMed)){const doses=(i.doses||[]).filter(d=>dayOf(d)===day);
if(i.pickup||markOf(i,day,'pickup')){const m=markOf(i,day,'pickup');tasks.push({item:i,key:'pickup',time:'',title:'Pick up '+i.name,sub:i.pharmacy&&i.pharmacy.name?'From '+i.pharmacy.name:'From the pharmacy',state:m?m.kind:''})}
else if(!i.asNeeded)for(const t of i.times||[]){const d=doses.find(x=>x.slot===t);tasks.push({item:i,key:'dose:'+t,slot:t,time:t,title:i.name,sub:howText(i),state:d?(d.kind==='taken'?'done':'skipped'):''})}
for(const step of ['call','ready']){const m=markOf(i,day,'refill:'+step);if(!m&&!(i.refill&&i.refill.step===step))continue;tasks.push({item:i,key:'refill:'+step,time:'',title:step==='call'?`Call ${refillWho(i)} to refill ${i.name}`:`Pick up the refill of ${i.name}`,sub:step==='call'?(i.refills>0?`${i.refills} refill${i.refills>1?'s':''} left on the label`:'For a new prescription'):i.pharmacy&&i.pharmacy.name||'',state:m?m.kind:''})}}
for(const a of appointments(list))if(a.date===day){const m=markOf(a.item,day,a.key);tasks.push({item:a.item,key:a.key,time:a.time||'',title:'Follow-up visit'+(a.with?' with '+a.with:''),sub:a.place||a.note||'',phone:a.phone,state:m?m.kind:''})}
return tasks.sort((a,b)=>(a.time||'99')<(b.time||'99')?-1:(a.time||'99')>(b.time||'99')?1:0)}

/* The totals in the menu. Doses given "as needed" count as taken; skipped doses are not left. */
function homeTotals(list=items,day=today()){const t=todayTasks(list,day).filter(x=>x.slot),asNeeded=list.filter(i=>activeMed(i)&&i.asNeeded).reduce((n,i)=>n+(i.doses||[]).filter(d=>dayOf(d)===day&&d.kind==='taken').length,0);
return {taken:t.filter(x=>x.state==='done').length+asNeeded,left:t.filter(x=>!x.state).length,refills:list.filter(i=>activeMed(i)&&i.refill&&i.refill.step).length}}

const dayLabel=(date,day=today())=>{const n=C.days(date,day);return n===0?'Today':n===1?'Tomorrow':n>1&&n<7?C.parseDate(date).toLocaleDateString('en-US',{weekday:'long'}):C.parseDate(date).toLocaleDateString('en-US',{month:'short',day:'numeric'})};

/* The care radar: the next things to do, most urgent first. */
function careRadar(list=items,day=today(),now=hmNow()){const out=[],meds=list.filter(activeMed),times=new Map();
for(const x of todayTasks(list,day))if(x.slot&&!x.state){if(!times.has(x.slot))times.set(x.slot,[]);times.get(x.slot).push(x.item.name)}
for(const [t,names] of times)out.push({title:`${slotName(t)||'Medication'}${slotName(t)?' medication':''} at ${clockText(t)}`,sub:(t<now?'Not marked yet · ':'')+names.join(', ')});
for(const i of meds.filter(i=>i.pickup))out.push({title:'Pick up '+i.name,sub:i.pharmacy&&i.pharmacy.name||'From the pharmacy'});
for(const i of meds.filter(i=>i.refill&&i.refill.step)){const s=i.refill.step;out.push({title:s==='call'?(i.refills>0?`${i.name}: ${i.refills} refill${i.refills>1?'s':''} left, call ${refillWho(i)}`:`${i.name}: call ${refillWho(i)} for a refill`):s==='called'?`${i.name}: waiting on ${i.pharmacy&&i.pharmacy.name||'the pharmacy'}`:`Pick up the refill of ${i.name}`,sub:'Needs refill'})}
for(const a of appointments(list).filter(a=>a.date&&a.date>=day).sort((a,b)=>(a.date+(a.time||'')).localeCompare(b.date+(b.time||''))))out.push({title:`Follow-up visit ${dayLabel(a.date,day)}${a.time?' '+clockText(a.time):''}`,sub:[a.with,a.place].filter(Boolean).join(' · ')});
for(const a of appointments(list).filter(a=>!a.date&&a.note))out.push({title:a.with?a.with+': '+a.note:a.note,sub:'Follow-up visit'});
return out.slice(0,5)}

function helpNote(i,phone){const doc=i.prescriber||{},ph=i.pharmacy||{};return `<div class="today-help"><p>Not sure what to do? Call the doctor or the pharmacist. In an emergency, call 911.</p><p>${[telLink('Doctor:',doc.phone),telLink('Pharmacy:',ph.phone),telLink('Clinic:',phone),call911].filter(Boolean).join(' ')}</p>${helpSigns()}</div>`}
/* When to call, under the care radar: the papers' warning signs as printed, or the one line for when there are none. */
function whenToCallHTML(){const groups=whenToCall();return `<h2 class="call-head">When to call</h2>${groups.length?`<ol class="radar-list call-list">${groups.map(g=>`<li><strong>${esc(g.head)}</strong>${g.signs.map(t=>`<small>${esc(t)}</small>`).join('')}<small>${callLinks(g)}</small></li>`).join('')}</ol>`:`<p class="today-empty">${esc(NO_SIGNS)}</p><ol class="radar-list call-list"><li><small>${call911}</small></li></ol>`}`}
/* One card per row, like a list of locks: the bottle's photo, what to do with a short line from the papers, and one button at the end. */
function todayThumb(x){return x.slot||x.key==='pickup'||x.key.startsWith('refill:')?medPhoto(x.item):`<div class="product-photo today-icon">${icon('clock')}</div>`}
function todayRow(x){const id=esc(x.item.id+'|'+x.key),line=[x.time?clockText(x.time):'',x.sub].filter(Boolean).join(' · ');return `<li class="today-row${x.state?' is-'+x.state:''}"><div class="today-thumb">${todayThumb(x)}</div><div class="today-what"><strong>${esc(x.title)}</strong>${line?`<small>${esc(line)}</small>`:''}${x.state?'':`<span class="today-more"><button data-today-skip="${id}">Skipped</button><button data-today-help="${id}">Need help</button></span>`}</div>${x.state?`<span class="today-pill is-marked">${x.state==='done'?'✓ Done':'Skipped'}</span>`:`<button class="today-pill" data-today-done="${id}">Done</button>`}${homeHelp===x.item.id+'|'+x.key?helpNote(x.item,x.phone):''}</li>`}
function todayHTML(){if(!items.some(i=>i.med&&i.status!=='received'))return '';const day=today(),tasks=todayTasks(items,day),done=tasks.filter(x=>x.state==='done').length,d=C.parseDate(day),radar=careRadar(items,day);
const date=d.toLocaleDateString('en-US',{weekday:'long'})+' '+d.toLocaleDateString('en-US',{month:'long',day:'numeric'});
return `<section class="home-today"><div><h2>Today, ${esc(date)} <span>· ${done} of ${tasks.length} done${tasks.some(x=>x.item.demo)?' · Examples':''}</span></h2>${tasks.length?`<ul class="today-list">${tasks.map(todayRow).join('')}</ul>`:'<p class="today-empty">Nothing due today.</p>'}</div><div><h2>Your care radar</h2>${radar.length?`<ol class="radar-list">${radar.map(r=>`<li><strong>${esc(r.title)}</strong>${r.sub?`<small>${esc(r.sub)}</small>`:''}</li>`).join('')}</ol>`:'<p class="today-empty">Nothing coming up.</p>'}${whenToCallHTML()}</div></section>`}

gallery=function(){const el=document.createElement('div');el.innerHTML=galleryBeforeHome();const hero=el.querySelector('.profile-hero');if(hero)hero.insertAdjacentHTML('afterend',todayHTML());el.querySelectorAll('.utility-links #import-purchases').forEach(n=>n.remove());return el.innerHTML};

/* Marking a row on Today: a dose goes into the same record as the Take card, a pick-up or refill step moves on the same way. */
function markToday(ref,kind){const [id,key]=ref.split('|'),i=find(id);if(!i)return;const day=today(),at=new Date().toISOString();
if(key.startsWith('dose:'))i.doses=[...(i.doses||[]),{at,day,kind:kind==='done'?'taken':'skipped',slot:key.slice(5),...(markedBy()?{by:markedBy()}:{})}].slice(-200);
else{if(kind==='done'){if(key==='pickup')i.pickup=false;if(key==='refill:call')i.refill={...i.refill,step:'called'};if(key==='refill:ready'){i.refill=null;i.refilledOn=day}}i.marks=[...(i.marks||[]),{day,key,kind,at}].slice(-100)}
homeHelp='';save();render();toast(kind==='skipped'?(key.startsWith('dose:')?'Marked skipped. Don’t take an extra dose to make up for it unless the papers or your pharmacist say so.':'Marked skipped.'):key.startsWith('dose:')?'Marked taken.':'Marked done.')}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.todayDone)markToday(b.dataset.todayDone,'done');else if(b.dataset.todaySkip)markToday(b.dataset.todaySkip,'skipped');else if(b.dataset.todayHelp){homeHelp=homeHelp===b.dataset.todayHelp?'':b.dataset.todayHelp;render()}});

/* Example medications on day one, labelled as examples, in place of Returnly's example purchases. */
function exampleMeds(day=today(),now=hmNow()){const base={med:true,demo:true,status:'deciding',intent:'return',confirmed:true,retailer:'',price:0,category:'box',channel:'store',purchased:day,delivered:'',photoKey:'medication',prescriber:EXAMPLE_DOCTOR,pharmacy:EXAMPLE_PHARMACY,doses:[]},given=t=>now>=t?[{at:new Date(day+'T'+t).toISOString(),day,kind:'taken',slot:t}]:[];
return [{...base,id:'demo-lisinopril',name:'Lisinopril 10 mg',instructions:'Take 1 tablet by mouth every morning.',pillLooks:'Pink round tablet',warnings:['May cause dizziness.','Take exactly as directed.'],times:['08:00'],refills:2,doses:given('08:00'),discharge:{...EXAMPLE_SIGNS,appointments:[{with:EXAMPLE_DOCTOR.name,place:'Example Clinic',date:C.shift(day,2),time:'14:00',phone:EXAMPLE_DOCTOR.phone,note:''}]}},
{...base,id:'demo-metoprolol',name:'Metoprolol 25 mg',instructions:'Take 1 tablet by mouth twice a day.',times:['08:00','18:00'],doses:given('08:00')},
{...base,id:'demo-atorvastatin',name:'Atorvastatin 20 mg',instructions:'Take 1 tablet by mouth at bedtime.',times:['21:00'],refills:0,refill:{step:'call',since:day}},
{...base,id:'demo-acetaminophen',name:'Acetaminophen 500 mg',instructions:'Take 2 tablets every 6 hours as needed for pain. Do not take more than 8 tablets in 24 hours.',times:[],asNeeded:true}]}
if(items.some(i=>i.demo&&!i.med))items=[...items.filter(i=>!i.demo),...exampleMeds()];
/* Example medications saved before the example papers had warning signs get them, so When to call can be tried. */
for(const i of items)if(i.id==='demo-lisinopril'&&i.discharge&&!i.discharge.warningSigns)Object.assign(i.discharge,EXAMPLE_SIGNS);
