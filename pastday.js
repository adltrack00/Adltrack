/* Your schedule: a day that has ended opens its daily care report over the whole screen, and the × closes it. It is Home
   without My Tasks: the patient's photo, then that day and Photos, then the report as on Home, under the name of
   the person who wrote it. Days still to come stay as they are. When more than one person documented that day (a shift handed
   on, family helping), it first asks whose report to see; the back button goes back to pick the next person. */
let pastDay=null;
const pastDayLong=day=>C.parseDate(day).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
/* Everyone who documented that day, in the order they first did, with how much and from when to when. */
function pastDayPeople(day){const seen=new Map();for(const x of reportEntries(items,day)){const n=reportWho(x),p=seen.get(n)||{name:n,count:0,from:x.at,to:x.at};p.count++;p.to=x.at;seen.set(n,p)}return [...seen.values()]}

function pastDayHTML(){const {day,tab,who}=pastDay,people=pastDayPeople(day),x='<button class="day-report-x" id="day-report-close" aria-label="Close">×</button>';
const hero=`<section class="profile-hero day-report-hero"><div class="profile-circle">${avatarInner()}</div></section>`;
if(people.length>1&&!who)return `<div class="day-report-top"><span></span>${x}</div>${hero}<div class="day-report-pick"><h2>${esc(pastDayLong(day))}</h2><p>${people.length} people documented this day. Pick whose daily care report to see.</p><ul>${people.map(p=>`<li><button data-day-who="${esc(p.name)}"><span class="day-report-initial">${esc(p.name.slice(0,1).toUpperCase())}</span><span><strong>${esc(p.name)}</strong><small>${p.count} ${p.count>1?'entries':'entry'} · ${esc(reportTime(p.from))}${p.to!==p.from?' to '+esc(reportTime(p.to)):''}</small></span><em aria-hidden="true">›</em></button></li>`).join('')}</ul></div>`;
const back=people.length>1?`<button class="day-report-back" id="day-report-people" aria-label="Back to who documented this day">${menuIcon(menuIcons.back)}</button>`:'<span></span>';
return `<div class="day-report-top">${back}${x}</div>${hero}${reportHTML({day,tab,who:people.length>1?who:'',attr:'day-tab',label:C.parseDate(day).toLocaleDateString('en-US',{month:'short',day:'numeric'})})}`}

function paintPastDay(){const d=$('#day-report');if(!d||!pastDay)return;d.innerHTML=pastDayHTML();d.scrollTop=0}
function openPastDay(day){let d=$('#day-report');if(!d){d=document.createElement('dialog');d.id='day-report';d.className='day-report';d.setAttribute('aria-label','Daily care report');document.body.append(d);
d.addEventListener('close',()=>{pastDay=null;d.innerHTML='';render()});
d.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||!pastDay)return;
if(b.id==='day-report-close'){d.close();return}
if(b.id==='day-report-people'){pastDay={...pastDay,who:'',tab:'today'};paintPastDay();return}
if(b.dataset.dayWho!==undefined){pastDay={...pastDay,who:b.dataset.dayWho,tab:'today'};paintPastDay();return}
if(b.dataset.dayTab){pastDay={...pastDay,tab:b.dataset.dayTab};paintPastDay()}})}
pastDay={day,tab:'today',who:''};paintPastDay();if(!d.open)d.showModal()}

document.addEventListener('click',e=>{const b=e.target.closest('.calendar-cell[data-date]');if(b&&view==='calendar'&&b.dataset.date<today())openPastDay(b.dataset.date)});
