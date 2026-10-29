/* Your schedule: tapping a day opens it over the whole screen, with the patient's photo on top and the × to close it.
   - A day that has ended (or today so far) shows its daily care report: Home without My Tasks, with that day and Photos, under
     the name of the person who wrote it. When more than one person documented that day (a shift handed on, family helping),
     it first asks whose report to see; the back button goes back to pick the next person.
   - A day still to come shows its My Tasks list as it will be that day: doses, visits and tasks, no vital signs. Nothing can
     be started: tapping one only shows its details. */
let pastDay=null,futureDay=null;
const pastDayLong=day=>C.parseDate(day).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});

/* In the report of a day that has ended, what was due and never marked: a dose not taken, a task missed, a visit not
   attended, a refill not done. They have no one's name: they show in each person's report that day. */
function reportMissed(list=items,day,now=today()){if(!day||day>=now)return [];const out=[],at=t=>new Date(day+'T'+(t||'23:59')).toISOString();
for(const x of todayTasks(list,day)){if(x.state)continue;const i=x.item;
if(x.slot){if(day<schedStart(i)||i.pickup)continue;out.push({title:`${i.name} (${shortClock(x.slot)} dose) not taken`,at:at(x.slot),note:'',details:[i.dose].filter(Boolean),missed:true})}
else if(x.key==='task')out.push({title:`${i.name} (${i.time?shortClock(i.time)+' task':'task'}) missed`,at:at(i.time),note:'',details:[],missed:true,untimed:!i.time})
else if(x.key==='appt')out.push({title:`${i.name}: not attended`,at:at(i.time),note:'',details:[i.place].filter(Boolean),missed:true,untimed:!i.time})
else if(x.key.startsWith('refill:')&&i.refill&&i.refill.since&&day>=i.refill.since)out.push({title:`${i.name}: refill not done`,at:at(''),note:'',details:[x.title],missed:true,untimed:true})}
return out}
const reportEntriesBeforeMissed=reportEntries;
reportEntries=function(list=items,day=today(),vitalsLog){return [...reportEntriesBeforeMissed(list,day,vitalsLog),...reportMissed(list,day)].sort((x,y)=>new Date(x.at)-new Date(y.at))};

/* Everyone who documented that day, in the order they first did, with how much and from when to when. */
function pastDayPeople(day){const seen=new Map();for(const x of reportEntries(items,day).filter(x=>!x.missed)){const n=reportWho(x),p=seen.get(n)||{name:n,count:0,from:x.at,to:x.at};p.count++;p.to=x.at;seen.set(n,p)}return [...seen.values()]}

const dayX='<button class="day-report-x" id="day-report-close" aria-label="Close">×</button>';
/* The patient's full name under the photo, as on their information page: on Home and on each day opened from Your schedule. */
const heroFullName=()=>infoOf(profile).name||welcomeName()||(typeof Account!=='undefined'&&Account.patient()?.name)||'';
const heroName=()=>heroFullName()?`<h2 class="hero-name">${esc(heroFullName())}</h2>`:'';
const dayHero=()=>`<section class="profile-hero day-report-hero"><div class="profile-circle">${avatarInner()}</div>${heroName()}</section>`;
const galleryBeforeName=gallery;
gallery=function(){const el=document.createElement('div');el.innerHTML=galleryBeforeName();const c=view==='overview'&&el.querySelector(':scope>.profile-hero:not(.profile-hero-compact)>.profile-circle');if(c)c.insertAdjacentHTML('afterend',heroName());return el.innerHTML};
function pastDayHTML(){const {day,tab,who}=pastDay,people=pastDayPeople(day);
if(people.length>1&&!who)return `<div class="day-report-top"><span></span>${dayX}</div>${dayHero()}<div class="day-report-pick"><h2>${esc(pastDayLong(day))}</h2><p>${people.length} people documented this day. Pick whose daily care report to see.</p><ul>${people.map(p=>`<li><button data-day-who="${esc(p.name)}"><span class="day-report-initial">${esc(p.name.slice(0,1).toUpperCase())}</span><span><strong>${esc(p.name)}</strong><small>${p.count} ${p.count>1?'entries':'entry'} · ${esc(reportTime(p.from))}${p.to!==p.from?' to '+esc(reportTime(p.to)):''}</small></span><em aria-hidden="true">›</em></button></li>`).join('')}</ul></div>`;
const back=people.length>1?`<button class="day-report-back" id="day-report-people" aria-label="Back to who documented this day">${menuIcon(menuIcons.back)}</button>`:'<span></span>';
return `<div class="day-report-top">${back}${dayX}</div>${dayHero()}${reportHTML({day,tab,who:people.length>1?who:'',attr:'day-tab',label:C.parseDate(day).toLocaleDateString('en-US',{month:'short',day:'numeric'})})}`}

/* A day still to come: My Tasks as it will be that day, without the vital signs. Doses only from the day a medication starts,
   visits booked that day and the tasks planned for it; refill steps follow what's done, so they show from today on Home. */
const futureTasks=day=>homeTasks(day).filter(x=>x.slot?day>=schedStart(x.item)&&!x.item.pickup:['appt','task'].includes(x.key));
function futureDayHTML(){const {day,open}=futureDay,tasks=futureTasks(day);
const x=open&&tasks.find(t=>t.item.id+'|'+t.key===open);if(x)return `<div class="day-report-top"><button class="day-report-back" id="future-day-list" aria-label="Back to My Tasks">${menuIcon(menuIcons.back)}</button>${dayX}</div>${futureDetail(x,day)}`;
const rows=tasks.map(t=>todayRow(t).replace('data-today-start=','data-future-open=')).join('');
return `<div class="day-report-top"><span></span>${dayX}</div>${dayHero()}<section class="day-tasks"><div class="tasks-title"><h2>My Tasks</h2></div><p class="day-tasks-date">${esc(pastDayLong(day))}</p><div class="home-today">${rows?`<ul class="today-list">${rows}</ul>`:'<p class="today-empty">Nothing planned for this day.</p>'}</div></section>`}

/* What a task on a day to come is, laid out like its Take page, with nothing to start or fill in. */
function futureDetail(x,day){const i=x.item,when=pastDayLong(day)+(x.time?' at '+clockText(x.time):''),blocks=[];
const photo=x.key==='appt'?apptPhoto(i):x.key==='task'?taskPhoto(i,null):medPhoto(i);
const block=(h,lines)=>{const l=lines.filter(Boolean);if(l.length)blocks.push(`<section class="take-block"><h2>${esc(h)}</h2>${l.map((t,n)=>`<p${n?' class="take-sub"':''}>${t}</p>`).join('')}</section>`)};
const tel=p=>p?`<a class="flow-text-link" href="tel:${esc(String(p).replace(/[^\d+]/g,''))}">${esc(p)}</a>`:'';
if(x.slot){block('How to take it',[esc(howText(i)||'Add how to take it from the discharge papers.'),...(i.warnings||[]).map(esc)]);
block('Prescribed by',[esc(i.prescriber&&i.prescriber.name||''),tel(i.prescriber&&i.prescriber.phone)]);block('Pharmacy',[esc(i.pharmacy&&i.pharmacy.name||''),tel(i.pharmacy&&i.pharmacy.phone)])}
else if(x.key==='appt')block('The visit',[esc(i.with||''),esc(i.place||''),tel(i.phone),esc(i.note||'')]);
else {const b=[esc(i.note||i.name),esc(repeatText(i))];blocks.push(`<section class="take-block"><h2>What to do</h2><p>${b[0]}</p>${proofRow(i.photos||[],false)}<p class="take-sub">${b[1]}</p></section>`)}
return `<section class="take-page day-future"><div class="take-hero">${photo}<h1>${esc(x.title)}</h1><p>${esc([x.slot?i.dose:'',when].filter(Boolean).join(' · '))}</p></div>${blocks.join('')}<p class="day-future-note">This is still to come. It can be started in My Tasks on its day.</p></section>`}

function paintDay(){const d=$('#day-report');if(!d)return;d.innerHTML=pastDay?pastDayHTML():futureDay?futureDayHTML():'';d.scrollTop=0}
function dayDialog(){let d=$('#day-report');if(d)return d;d=document.createElement('dialog');d.id='day-report';d.className='day-report';d.setAttribute('aria-label','Your schedule');document.body.append(d);
d.addEventListener('close',()=>{pastDay=futureDay=null;calendarDay='';d.innerHTML='';render()});
d.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
if(b.id==='day-report-close'){d.close();return}
if(pastDay){if(b.id==='day-report-people'){pastDay={...pastDay,who:'',tab:'today'};paintDay();return}
if(b.dataset.dayWho!==undefined){pastDay={...pastDay,who:b.dataset.dayWho,tab:'today'};paintDay();return}
if(b.dataset.dayTab){pastDay={...pastDay,tab:b.dataset.dayTab};paintDay()}return}
if(futureDay){if(b.dataset.futureOpen){futureDay={...futureDay,open:b.dataset.futureOpen};paintDay();return}if(b.id==='future-day-list'){futureDay={...futureDay,open:''};paintDay()}}});
return d}
function openPastDay(day){const d=dayDialog();futureDay=null;pastDay={day,tab:'today',who:''};paintDay();if(!d.open)d.showModal()}
function openFutureDay(day){const d=dayDialog();pastDay=null;futureDay={day,open:''};paintDay();if(!d.open)d.showModal()}

document.addEventListener('click',e=>{const b=e.target.closest('.calendar-cell[data-date]');if(!b||view!=='calendar')return;const day=b.dataset.date;(day>today()?openFutureDay:openPastDay)(day)});

/* Under the calendar, nothing but its note and the export: each day opens on its own. */
const calendarPageBeforeDays=calendarPage;
calendarPage=function(){const el=document.createElement('div');el.innerHTML=calendarPageBeforeDays();const h=el.querySelector('.section-heading');
if(h){let n=h.nextElementSibling;while(n&&!n.classList.contains('demo-strip')){const next=n.nextElementSibling;n.remove();n=next}h.remove()}
el.querySelectorAll('.calendar-cell.selected').forEach(c=>c.classList.remove('selected'));return el.innerHTML};
