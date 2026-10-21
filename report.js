/* Home: the daily care report. Under the profile picture, "Today's care." with three tabs (Previous day, Today, Photos), a black
   banner with the person's name and the date, then numbered sections with what was recorded that day: doses taken and skipped,
   what's still to do, vital signs, refills, visits, notes and finished medications. Photos shows the proof photos added to
   today's doses. The medication cards moved to All medications, their own page in the menu. Print prints the report. */
let reportTab='today';
const reportTime=t=>new Date(t).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
const reportDate=day=>C.parseDate(day).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});

/* What happened on one day, section by section. Each line is plain text; a section with no lines says nothing was recorded. */
function reportSections(list=items,day=today(),vitals=settings.vitals,now=today()){const meds=list.filter(i=>i.med),doses=meds.flatMap(i=>(i.doses||[]).filter(d=>dayOf(d)===day).map(d=>({i,d}))).sort((a,b)=>String(a.d.at).localeCompare(String(b.d.at)));
const doseLine=({i,d})=>[d.slot?clockText(d.slot)+' dose':'As needed',i.name,d.at?(d.kind==='taken'?'taken ':'skipped ')+reportTime(d.at):'',d.by?'by '+d.by:''].filter(Boolean).join(' · ');
const left=todayTasks(list,day).filter(x=>!x.state).map(x=>[x.time?clockText(x.time):'',x.title].filter(Boolean).join(' · '));
const v=vitals&&vitals.at&&C.iso(new Date(vitals.at))===day?vitals:null;
const refills=meds.flatMap(i=>[...(i.marks||[]).filter(m=>m.day===day&&(m.key==='pickup'||m.key.startsWith('refill:'))).map(m=>`${i.name} · ${m.key==='refill:call'?'called for a refill':m.key==='refill:ready'||m.key==='pickup'?'picked up':'marked'}`),
...(i.refilledOn===day?[`${i.name} · refilled`]:[])]);
const visits=appointments(list).filter(a=>a.date===day).map(a=>[a.time?clockText(a.time):'',a.name,a.status==='received'?'went':day<now?'not marked':'coming up'].filter(Boolean).join(' · '));
return [{title:'Doses taken',lines:doses.filter(x=>x.d.kind==='taken').map(doseLine)},
{title:'Doses skipped',lines:doses.filter(x=>x.d.kind==='skipped').map(doseLine)},
{title:day===now?'Still to do':'Not marked',lines:left,wide:true,none:day===now?'Nothing left to do':'Everything was marked'},
{title:'Vital signs',lines:v?[[v.bp&&'BP '+v.bp,v.heart&&'Heart '+v.heart,v.temp&&'Temp '+v.temp+'°',v.pain&&'Pain '+v.pain+'/10'].filter(Boolean).join(' · ')+' · '+reportTime(v.at)]:[]},
{title:'Refills',lines:refills},
{title:'Visits',lines:visits},
{title:'Notes',lines:doses.filter(x=>x.d.note).map(({i,d})=>`${i.name}: ${d.note}`)},
{title:'Finished',lines:meds.filter(i=>i.status==='received'&&String(i.finishedAt||i.returnedOn||'').slice(0,10)===day).map(i=>i.name+(i.finishedBy?' · by '+i.finishedBy:'')),wide:true,none:'No medications finished'}]}

/* Today's proof photos, newest first, each with the medication and when it was marked. */
function reportPhotos(list=items,day=today()){return list.filter(i=>i.med).flatMap(i=>(i.doses||[]).filter(d=>dayOf(d)===day).flatMap(d=>(d.photos||[]).map(src=>({src,name:i.name,at:d.at})))).sort((a,b)=>String(b.at).localeCompare(String(a.at)))}

function reportHTML(){const now=today(),day=reportTab==='previous'?C.shift(now,-1):now,who=welcomeName()||'Your care';
const tabs=[['previous','Previous day'],['today','Today'],['photos','Photos']].map(([id,label])=>`<button data-report-tab="${id}" class="${reportTab===id?'active':''}" aria-pressed="${reportTab===id}">${label}</button>`).join('');
const head=`<div class="page-heading report-heading"><div><span class="eyebrow">ADLTRACK</span><h1>${reportTab==='previous'?'Yesterday’s care.':'Today’s care.'}</h1></div><button class="outline-button" id="report-print">Print</button></div><div class="gallery-filters report-tabs">${tabs}</div>`;
if(reportTab==='photos'){const shots=reportPhotos(items,now);return `<section class="report">${head}${shots.length?`<div class="report-photos">${shots.map(p=>`<figure>${proofImg(p.src)}<figcaption><strong>${esc(p.name)}</strong>${p.at?esc(reportTime(p.at)):''}</figcaption></figure>`).join('')}</div>`:`<div class="report-empty"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 18 5.5-5.5 4 4 2.5-2.5 4.5 4.5"/></svg><h2>No photos yet</h2><p>Photos added when a dose is taken will appear here.</p></div>`}</section>`}
const sections=reportSections(items,day,settings.vitals,now).map((s,n)=>`<div class="report-section${s.wide?' wide':''}"><h3><span>${String(n+1).padStart(2,'0')}</span>${esc(s.title)}</h3>${s.lines.length?`<ul>${s.lines.map(l=>`<li>${esc(l)}</li>`).join('')}</ul>`:`<p>${esc(s.none||'Nothing recorded')}</p>`}</div>`).join('');
return `<section class="report">${head}<div class="report-banner"><span>DAILY CARE REPORT</span><h2>${esc(who)}</h2><p>${esc(reportDate(day))}</p></div><div class="report-grid">${sections}</div></section>`}

document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.reportTab){reportTab=b.dataset.reportTab;render();return}if(b.id==='report-print')window.print()});

/* Home is the profile picture, the report and My Tasks. All medications is the gallery on its own, with When to call under it. */
const galleryBeforeReport=gallery;
gallery=function(){const el=document.createElement('div');el.innerHTML=galleryBeforeReport();
if(view==='purchases'){el.querySelectorAll(':scope>.profile-hero,:scope>.home-today,:scope>.tasks-sheet').forEach(n=>n.remove());el.insertAdjacentHTML('afterbegin','<div class="page-heading"><div><h1>All medications.</h1><p>Due today, needs refill and finished.</p></div></div>');el.insertAdjacentHTML('beforeend',`<section class="home-today">${whenToCallHTML()}</section>`);return el.innerHTML}
const hero=el.querySelector(':scope>.profile-hero'),sheet=el.querySelector(':scope>.tasks-sheet');return (hero?hero.outerHTML:'')+reportHTML()+(sheet?sheet.outerHTML:'')};

menuItems.unshift(['purchases','All medications','meds']);
render();
