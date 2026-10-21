/* Home: the daily care report. Under the profile picture, three tabs (Previous day, Today, Photos), a small black banner with
   the person's name, the date and Print, then everything done that day as numbered entries in time order. Each entry has a
   subhead saying what happened and its time stamp, then the note written during the task, then the details: which dose, who
   marked it and how many photos. Photos shows the proof photos added to today's doses. The medication cards are on All
   medications, in the menu. */
let reportTab='today';
const reportTime=t=>new Date(t).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
const reportDate=day=>C.parseDate(day).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
const onDay=(t,day)=>!!t&&C.iso(new Date(t))===day;
const REPORT_LOG={'refill-needed':'needs a refill','refill-called':'called for a refill','refill-ready':'refill ready to pick up',refilled:'refill picked up','picked-up':'picked up from the pharmacy'};

/* Everything done on one day, oldest first: doses taken or skipped, vital signs, refill steps, visits and finished medications.
   Each entry: title (the subhead), at (its time), note (written during the task) and details. */
function reportEntries(list=items,day=today(),vitalsLog=settings.vitalsLog||(settings.vitals?[settings.vitals]:[])){const meds=list.filter(i=>i.med),out=[],by=x=>x&&x.by?'Marked by '+x.by:'';
for(const i of meds)for(const d of (i.doses||[]).filter(d=>dayOf(d)===day&&d.at&&['taken','skipped'].includes(d.kind)))
out.push({title:`${i.name} ${d.kind==='taken'?'taken':'skipped'}`,at:d.at,note:d.note||'',details:[[d.slot?clockText(d.slot)+' dose':'As-needed dose',i.dose].filter(Boolean).join(' · '),by(d),d.photos&&d.photos.length?`${d.photos.length} photo${d.photos.length>1?'s':''} added`:''].filter(Boolean)});
for(const v of vitalsLog.filter(v=>onDay(v.at,day)))out.push({title:'Vital signs recorded',at:v.at,note:'',details:[[v.bp&&'BP '+v.bp,v.heart&&'Heart '+v.heart,v.temp&&'Temp '+v.temp+'°',v.pain&&'Pain '+v.pain+'/10'].filter(Boolean).join(' · ')]});
for(const i of meds)for(const l of (i.log||[]).filter(l=>onDay(l.at,day)&&REPORT_LOG[l.kind]))out.push({title:`${i.name}: ${REPORT_LOG[l.kind]}`,at:l.at,note:'',details:[i.pharmacy&&i.pharmacy.name||'',by(l)].filter(Boolean)});
for(const i of meds.filter(i=>i.status==='received'&&onDay(i.finishedAt,day)))out.push({title:`${i.name} finished`,at:i.finishedAt,note:'',details:['No more reminders for it',i.finishedBy?'Marked by '+i.finishedBy:''].filter(Boolean)});
for(const a of appointments(list).filter(a=>a.status==='received'&&a.date===day))out.push({title:`${a.name}: went`,at:day+'T'+(a.time||'12:00'),note:a.note||'',details:[a.place].filter(Boolean)});
return out.sort((x,y)=>new Date(x.at)-new Date(y.at))}

/* Today's proof photos, newest first, each with the medication and when it was marked. */
function reportPhotos(list=items,day=today()){return list.filter(i=>i.med).flatMap(i=>(i.doses||[]).filter(d=>dayOf(d)===day).flatMap(d=>(d.photos||[]).map(src=>({src,name:i.name,at:d.at})))).sort((a,b)=>String(b.at).localeCompare(String(a.at)))}

function reportHTML(){const now=today(),day=reportTab==='previous'?C.shift(now,-1):now,who=welcomeName()||'Your care';
const tabs=[['previous','Previous day'],['today','Today'],['photos','Photos']].map(([id,label])=>`<button data-report-tab="${id}" class="${reportTab===id?'active':''}" aria-pressed="${reportTab===id}">${label}</button>`).join('');
const head=`<div class="gallery-filters report-tabs">${tabs}</div>`;
if(reportTab==='photos'){const shots=reportPhotos(items,now);return `<section class="report">${head}${shots.length?`<div class="report-photos">${shots.map(p=>`<figure>${proofImg(p.src)}<figcaption><strong>${esc(p.name)}</strong>${p.at?esc(reportTime(p.at)):''}</figcaption></figure>`).join('')}</div>`:`<div class="report-empty"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 18 5.5-5.5 4 4 2.5-2.5 4.5 4.5"/></svg><h2>No photos yet</h2><p>Photos added when a dose is taken will appear here.</p></div>`}</section>`}
const entries=reportEntries(items,day),sections=entries.length?entries.map((x,n)=>`<div class="report-section${x.note?' wide':''}"><h3><span>${String(n+1).padStart(2,'0')}</span>${esc(x.title)}<time datetime="${esc(x.at)}">${esc(reportTime(x.at))}</time></h3>${x.note?`<p class="report-note-text">${esc(x.note)}</p>`:''}${x.details.length?`<ul>${x.details.map(l=>`<li>${esc(l)}</li>`).join('')}</ul>`:''}</div>`).join(''):`<div class="report-section wide"><p class="report-none">${day===now?'Nothing done yet today. Everything marked during the day shows here, with its time.':'Nothing was recorded this day.'}</p></div>`;
return `<section class="report">${head}<div class="report-banner"><div><span>DAILY CARE REPORT</span><h2>${esc(who)}</h2><p>${esc(reportDate(day))}</p></div><button id="report-print">Print</button></div><div class="report-grid">${sections}</div></section>`}

document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.reportTab){reportTab=b.dataset.reportTab;render();return}if(b.id==='report-print')window.print()});

/* Home is the profile picture, the report and My Tasks. All medications is the gallery on its own, with When to call under it. */
const galleryBeforeReport=gallery;
gallery=function(){const el=document.createElement('div');el.innerHTML=galleryBeforeReport();
if(view==='purchases'){el.querySelectorAll(':scope>.profile-hero,:scope>.home-today,:scope>.tasks-sheet').forEach(n=>n.remove());el.insertAdjacentHTML('afterbegin','<div class="page-heading"><div><h1>All medications.</h1><p>Due today, needs refill and finished.</p></div></div>');el.insertAdjacentHTML('beforeend',`<section class="home-today">${whenToCallHTML()}</section>`);return el.innerHTML}
const hero=el.querySelector(':scope>.profile-hero'),sheet=el.querySelector(':scope>.tasks-sheet');return (hero?hero.outerHTML:'')+reportHTML()+(sheet?sheet.outerHTML:'')};

menuItems.unshift(['purchases','All medications','meds']);

/* Only Home has the menu lines. Every other page has a round back button in their place, top left, that goes back one step
   (to Settings or Support from their pages, otherwise Home); the page's own back arrow is hidden, so its picture or title
   moves up to the top. */
function paintMenuButton(){const b=$('#menu-open');if(!b)return;const back=view!=='overview';document.body.classList.toggle('not-home',back);
if(b.classList.contains('is-back')===back)return;b.classList.toggle('is-back',back);b.setAttribute('aria-label',back?'Back':'Open menu');b.toggleAttribute('aria-haspopup',!back);if(!back)b.setAttribute('aria-haspopup','dialog');b.innerHTML=menuIcon(back?menuIcons.back:menuIcons.menu)}
document.addEventListener('click',e=>{if(!e.target.closest('#menu-open.is-back'))return;e.stopPropagation();const own=$('#main .sub-back');go(own&&own.dataset.menuGo||'overview')},true);
const renderBeforeBack=render;
render=function(){renderBeforeBack();paintMenuButton()};
render();
