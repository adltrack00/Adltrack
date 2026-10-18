/* Your schedule: Returnly's deadline calendar, now showing each day's doses, follow-up visits and refill steps. Only confirmed
   medications show. Past days show what was marked (Taken or Skipped, never moved or doubled), today matches the Today
   checklist on home, and later days show the dose times as confirmed. Refill steps show on the day they're due or were done. */
const schedStart=i=>[i.purchased,...(i.doses||[]).map(dayOf)].filter(Boolean).sort()[0]||today();
const schedClock=at=>{const d=new Date(at);return isNaN(d)?'':String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')};

/* Everything on one day, in time order. Built from the Today checklist so the two never disagree. */
function scheduleDay(list=items,day,now=today()){const out=[];
for(const x of todayTasks(list,day)){if(x.slot){if(day<schedStart(x.item)||(day>now&&x.item.pickup))continue;out.push(x)}else if(day===now||x.state||String(x.key).startsWith('appt'))out.push(x)}
for(const i of list.filter(i=>i.med&&!i.appt&&(i.asNeeded&&activeMed(i)||i.status==='received')))for(const d of (i.doses||[]).filter(d=>dayOf(d)===day))out.push({item:i,key:'dose:'+(d.slot||d.at),slot:d.slot||schedClock(d.at),time:d.slot||schedClock(d.at),title:i.name,sub:i.asNeeded?'As needed':howText(i),state:d.kind==='taken'?'done':'skipped'});
return out.sort((a,b)=>(a.time||'99')<(b.time||'99')?-1:(a.time||'99')>(b.time||'99')?1:0)}

/* The short labels inside a calendar day: visits first, then the doses, then refill steps. */
function scheduleLabels(tasks,day,now=today()){const doses=tasks.filter(x=>x.slot),other=tasks.filter(x=>!x.slot),appts=other.filter(x=>String(x.key).startsWith('appt')),rest=other.filter(x=>!appts.includes(x));
const taken=doses.filter(x=>x.state==='done').length,skipped=doses.filter(x=>x.state==='skipped').length;
const dose=doses.length?(day>now?`${doses.length} dose${doses.length>1?'s':''}`:`${taken} of ${doses.length} taken${skipped?` · ${skipped} skipped`:''}`):'';
return [...appts.map(x=>x.title),dose,...rest.map(x=>x.title)].filter(Boolean)}

function scheduleRow(x,day,now=today()){const line=[x.time?clockText(x.time):'',x.sub].filter(Boolean).join(' · ');
const pill=x.state==='done'?(x.slot?'✓ Taken':'✓ Done'):x.state==='skipped'?'Skipped':day<now||day===now&&x.time&&x.time<hmNow()?'Not marked':'';
return `<li class="today-row${x.state?' is-'+x.state:''}"><div class="today-thumb">${todayThumb(x)}</div><div class="today-what"><strong>${esc(x.title)}</strong>${line?`<small>${esc(line)}</small>`:''}</div>${pill?`<span class="today-pill is-marked">${pill}</span>`:'<span></span>'}</li>`}

/* Reminders for Google, Apple or Outlook: one daily event per confirmed dose time, as printed, and each booked visit. */
function scheduleICS(list=items,day=today()){const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z'),txt=s=>String(s||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/([,;])/g,'\\$1'),at=(d,t)=>d.replace(/-/g,'')+'T'+(t||'09:00').replace(':','')+'00';
const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Adltrack//Your schedule//EN','CALSCALE:GREGORIAN'];let n=0;
const event=(uid,start,summary,desc,rule)=>{n++;lines.push('BEGIN:VEVENT',`UID:${uid}@adltrack`,`DTSTAMP:${stamp}`,`DTSTART:${start}`,'DURATION:PT15M',...(rule?[rule]:[]),`SUMMARY:${txt(summary)}`,`DESCRIPTION:${txt(desc)}`,'BEGIN:VALARM','ACTION:DISPLAY',`DESCRIPTION:${txt(summary)}`,'TRIGGER:PT0M','END:VALARM','END:VEVENT')};
for(const i of list.filter(i=>activeMed(i)&&!i.asNeeded&&!i.appt))for(const t of i.times||[])event(`${i.id}-${t.replace(':','')}`,at(day,t),`${clockText(t)}: ${i.name}`,[howText(i),i.prescriber&&i.prescriber.name?'Prescribed by '+i.prescriber.name:''].filter(Boolean).join('\n'),'RRULE:FREQ=DAILY');
const visits=new Map();for(const d of Array.from({length:120},(_,k)=>C.shift(day,k)))for(const x of todayTasks(list,d).filter(x=>String(x.key).startsWith('appt')))visits.set(x.item.id+x.key,{d,x});
for(const [k,{d,x}] of visits)event('visit-'+k.replace(/[^a-z0-9]/gi,''),at(d,x.time),x.title,[x.sub,x.phone].filter(Boolean).join('\n'));
lines.push('END:VCALENDAR');return n?lines.join('\r\n'):''}

calendarPage=function(){const y=calendarMonth.getFullYear(),m=calendarMonth.getMonth(),first=new Date(y,m,1),last=new Date(y,m+1,0),offset=(first.getDay()+6)%7,now=today(),month=C.iso(first).slice(0,7);
const days=Array.from({length:last.getDate()},(_,n)=>{const d=C.iso(new Date(y,m,n+1)),tasks=scheduleDay(items,d,now);return {d,n:n+1,tasks,labels:scheduleLabels(tasks,d,now)}});
const shown=calendarDay?scheduleDay(items,calendarDay,now):days.flatMap(x=>x.tasks.filter(t=>!t.slot).map(t=>({...t,on:x.d})));
const heading=calendarDay?C.parseDate(calendarDay).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'}):'This month’s visits and refills';
const list=calendarDay?shown.map(x=>scheduleRow(x,calendarDay,now)).join(''):shown.map(x=>scheduleRow({...x,sub:[fmt(x.on),x.sub].filter(Boolean).join(' · ')},x.on,now)).join('');
return profileHeader()+`<div class="page-heading"><div><span class="eyebrow">EVERY DOSE IN ONE PLACE</span><h1>Your schedule.</h1><p>Doses, visits and refills. One clear view.</p></div></div><div class="calendar-toolbar"><h2>${first.toLocaleDateString('en-US',{month:'long',year:'numeric'})}</h2><div><button class="outline-button" data-month="-1" aria-label="Previous month">←</button><button class="outline-button" id="calendar-today">Today</button><button class="outline-button" data-month="1" aria-label="Next month">→</button></div></div><div class="calendar-week">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(s=>`<span>${s}</span>`).join('')}</div><div class="calendar-grid">${Array.from({length:offset},()=>'<div class="calendar-blank"></div>').join('')}${days.map(({d,n,labels})=>`<button class="calendar-cell ${d===now?'today':''} ${d===calendarDay?'selected':''}" data-date="${d}"><span>${n}</span>${labels.slice(0,2).map(l=>`<small>${esc(l)}</small>`).join('')}${labels.length>2?`<small>+${labels.length-2} more</small>`:''}</button>`).join('')}</div><p class="calendar-note">Only confirmed medications show, at the times you confirmed. A skipped dose is only recorded, never moved or doubled. <button class="text-button" id="export-schedule">Export reminders ↓</button></p><div class="section-heading"><h2>${esc(heading)}</h2>${calendarDay?'<button class="text-button" id="clear-calendar-day">Show all this month ↗</button>':''}</div>${list?`<ul class="today-list">${list}</ul>`:`<div class="empty"><h3>${calendarDay?'Nothing on this day.':'No visits or refill steps this month.'}</h3><p>${calendarDay?'Change the day or add the discharge papers.':'Tap a day to see each dose.'}</p></div>`}${demoStrip()}`};

document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.id!=='export-schedule')return;const s=scheduleICS();if(!s){toast('Confirm a medication first. Then its dose times can go in your calendar.');return}download('adltrack-schedule.ics',s,'text/calendar;charset=utf-8');toast('Calendar file exported. Import it and check that alerts are on.')});
