/* The menu's ways in: Scan first (the discharge papers or the medication bottles), then Medications (All medications and Your
   refills), Appointments and Planned tasks. They hold what used to be in the + on My Tasks; the + now keeps what happens now (plus.js).
   Scan: the two scans, as the + list showed them, opening their usual screens through their own buttons (data-add, #flow-bottles).
   Appointments: "Add an appointment" (the typed form from plus.js), then every appointment, like Documents: to confirm or book,
   coming up, and past. Each opens its own page; on its day it's in My Tasks, with its reminders as before.
   Planned tasks: "Add a planned task" (plus.js's form, once or repeating for months or years), then every planned task. Each
   shows in My Tasks on its days and, once done, in the daily care report. Uses Documents' cards and rows (documents.css). */
menuIcons.scan='<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M4 12h16"/>';
menuIcons.appointments='<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>';
menuIcons.planned='<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8.5 12 2.5 2.5 4.5-5"/>';
menuItems.unshift(['scan','Scan','scan']);
menuItems.splice(menuItems.findIndex(([v])=>v==='purchases')+1,0,['appointments','Appointments','appointments'],['planned-tasks','Planned tasks','planned']);
/* Fewer menu lines: Medications (in All medications' place) holds All medications and Your refills, and Settings holds
   Reminders and Support. The menu is Scan, Medications, Appointments, Planned tasks, Documents, Your schedule, Settings. */
menuItems.splice(menuItems.findIndex(([v])=>v==='purchases'),1,['medications','Medications','meds']);
for(const v of ['wallet','reminders','support'])menuItems.splice(menuItems.findIndex(x=>x[0]===v),1);
Object.assign(settingsParent,{reminders:'settings',support:'settings','medications-101':'settings'});

/* Medications: All medications, then Your refills, as Scan shows its two scans. */
function medicationsPage(){return `<section class="sub-page settings-page">${subHeader('Medications','overview')}<p class="sub-intro">Every medication, and the refills coming up.</p><div class="plus-list">${plusRow('data-menu-go="purchases"','All medications')}${plusRow('data-menu-go="wallet"','Your refills')}</div></section>`}
/* All medications gets the printable medication list from Your refills, under its heading. */
const galleryBeforeMedList=gallery;gallery=function(){const html=galleryBeforeMedList();if(view!=='purchases')return html;const el=document.createElement('div');el.innerHTML=html;el.querySelector(':scope>.page-heading')?.insertAdjacentHTML('beforeend','<button class="outline-button" id="med-list">Medication list ↓</button>');return el.innerHTML};
/* Settings gets Reminders and Support, after My doctors and pharmacies; Support goes back to Settings. */
const settingsBeforePlanner=menuPages.settings,supportBeforePlanner=menuPages.support;
menuPages.settings=()=>settingsBeforePlanner().replace(settingsRow('privacy','Security and privacy'),settingsRow('reminders','Reminders')+settingsRow('support','Support')+settingsRow('privacy','Security and privacy'));
menuPages.support=()=>supportBeforePlanner().replace('class="sub-back" data-menu-go="overview"','class="sub-back" data-menu-go="settings"');
/* The round back button goes up one step from the pages that moved: Reminders to Settings, All medications and Your refills
   to Medications. Ahead of report.js's own handler, which would go Home. */
const planBack={reminders:'settings',purchases:'medications',wallet:'medications'};
window.addEventListener('click',e=>{if(!e.target.closest('#menu-open.is-back')||!planBack[view])return;e.stopPropagation();e.preventDefault();go(planBack[view])},true);

/* Scan */
function scanPage(){const edit=mayDo('meds');
return `<section class="sub-page settings-page">${subHeader('Scan','overview')}<p class="sub-intro">The first way in. Scan the discharge papers, or go straight to the medication bottles.</p>${edit?`<div class="plus-list">${plusRow('data-add','Scan discharge papers')}${plusRow('id="flow-bottles"','Scan medications')}</div>`:'<p class="sub-note">Only admins and people who can scan papers can scan.</p>'}</section>`}

/* Appointments, newest first within each group; the examples show, labelled, as they do on Home. */
const apptWhen=a=>(a.date||'9999')+(a.time||'99');
function apptGroups(list=items,day=today()){const all=list.filter(i=>i.appt),open=all.filter(a=>a.status!=='received');
return [['confirm','To confirm or book',open.filter(a=>a.status==='kept'||!a.date).sort((x,y)=>apptWhen(x).localeCompare(apptWhen(y)))],
['coming','Coming up',open.filter(a=>a.status!=='kept'&&a.date&&a.date>=day).sort((x,y)=>apptWhen(x).localeCompare(apptWhen(y)))],
['past','Past',all.filter(a=>a.status==='received'||a.status!=='kept'&&a.date&&a.date<day).sort((x,y)=>apptWhen(y).localeCompare(apptWhen(x)))]].map(([key,name,list])=>({key,name,list})).filter(g=>g.list.length)}
const apptRow=a=>`<li><button data-plan-appt="${esc(a.id)}"><span class="doc-thumb plan-thumb">${apptPhoto(a)}</span><span><strong>${esc(a.name)}</strong><small>${esc([apptState(a),a.place].filter(Boolean).join(' · ')+(a.demo?' · Example':''))}</small></span>${menuIcon(menuIcons.chevron)}</button></li>`;
function appointmentsPage(){const groups=apptGroups(),edit=mayDo('meds');
return `<section class="sub-page doc-page">${subHeader('Appointments','overview')}<p class="sub-intro">Every appointment in one place. On its day it’s in My Tasks, and the reminders come before it.</p>${edit?'<button class="primary doc-add" data-menu-go="appt-new">Add an appointment</button>':''}
${groups.length?groups.map(g=>`<section class="info-card doc-card"><div class="info-head"><h2>${esc(g.name)}</h2><span class="doc-count">${g.list.length}</span></div><ul class="doc-list">${g.list.map(apptRow).join('')}</ul></section>`).join(''):`<section class="info-card doc-card"><p class="info-none">No appointments yet. ${edit?'Add one here, or scan the discharge papers and the follow-up visits on them show up here.':'They show up here when someone on the care team adds one.'}</p></section>`}
${edit?'':'<p class="sub-note">Only admins and people who can scan papers can add appointments.</p>'}</section>`}

/* Planned tasks: going on now or still to come, then the ones that have ended. */
const taskLast=t=>!t.repeat||t.repeat==='once'?t.date:t.until||'9999-12-31';
function plannedGroups(list=items,day=today()){const all=list.filter(i=>i.task);
return [['on','Coming up and ongoing',all.filter(t=>taskLast(t)>=day).sort((x,y)=>(x.date+x.time).localeCompare(y.date+y.time))],['ended','Ended',all.filter(t=>taskLast(t)<day).sort((x,y)=>taskLast(y).localeCompare(taskLast(x)))]].map(([key,name,list])=>({key,name,list})).filter(g=>g.list.length)}
const plannedRow=t=>`<li><button data-planned-open="${esc(t.id)}"><span class="doc-thumb plan-thumb">${taskPhoto(t)}</span><span><strong>${esc(t.name)}</strong><small>${esc(repeatText(t))}</small></span>${menuIcon(menuIcons.chevron)}</button></li>`;
function plannedTasksPage(){const groups=plannedGroups(),edit=mayAddTask();
return `<section class="sub-page doc-page">${subHeader('Planned tasks','overview')}<p class="sub-intro">Tasks set for a day and time, once or repeating for months or years. Each one shows in My Tasks on its day.</p>${edit?'<button class="primary doc-add" data-menu-go="task-new">Add a planned task</button>':''}
${groups.length?groups.map(g=>`<section class="info-card doc-card"><div class="info-head"><h2>${esc(g.name)}</h2><span class="doc-count">${g.list.length}</span></div><ul class="doc-list">${g.list.map(plannedRow).join('')}</ul></section>`).join(''):`<section class="info-card doc-card"><p class="info-none">No planned tasks yet. ${edit?'Add one here, like changing a dressing every Monday for 3 months.':'They show up here when someone on the care team adds one.'}</p></section>`}
${edit?'':'<p class="sub-note">Only admins and people who can add tasks can add planned tasks.</p>'}</section>`}
let plannedOpen='';
function plannedTaskPage(){const t=find(plannedOpen);if(!t||!t.task)return plannedTasksPage();const done=(t.marks||[]).filter(m=>m.key==='task'&&m.kind==='done').length;
return `<section class="sub-page doc-page">${subHeader(esc(t.name),'planned-tasks')}<section class="info-card"><dl><div class="info-row"><dt>When</dt><dd>${esc(repeatText(t))}</dd></div>${t.note?`<div class="info-row"><dt>Note</dt><dd>${esc(t.note)}</dd></div>`:''}<div class="info-row"><dt>Done</dt><dd>${done===1?'Once':done?done+' times':'Not yet'}</dd></div></dl></section>
${(t.photos||[]).length?`<div class="doc-pages">${t.photos.map(src=>`<figure><span class="doc-thumb" style="background-image:url('${esc(src)}'),var(--doc-icon)"></span></figure>`).join('')}</div>`:''}
${mayDo('meds')&&taskLast(t)>=today()&&!(t.repeat==='once'&&done)?`<button class="danger-button" data-planned-remove="${esc(t.id)}">Remove this task</button>`:''}</section>`}

Object.assign(menuPages,{medications:medicationsPage,scan:scanPage,appointments:appointmentsPage,'planned-tasks':plannedTasksPage,'planned-task':plannedTaskPage});
menuViews.push('medications','scan','appointments','planned-tasks','planned-task');

/* An appointment opens its own page, and its back button comes back here. */
let apptFromList=false;
document.addEventListener('click',e=>{const b=e.target.closest('[data-plan-appt],[data-planned-open],[data-planned-remove]');if(!b)return;
  if(b.dataset.planAppt){apptFromList=true;showDetail(b.dataset.planAppt);window.scrollTo(0,0);return}
  if(b.dataset.plannedOpen){plannedOpen=b.dataset.plannedOpen;go('planned-task');return}
  /* A task never marked goes; one already done or skipped on some days stops after the last of them, so those stay in the report. */
  if(b.dataset.plannedRemove&&mayDo('meds')){const t=find(b.dataset.plannedRemove);if(!t||!t.task||!confirm(`Remove “${t.name}” from My Tasks for everyone on the care team? What was already done stays in the daily care report.`))return;
    const days=(t.marks||[]).filter(m=>m.key==='task').map(m=>m.day).sort();if(days.length)t.until=days.at(-1);else items=items.filter(x=>x.id!==t.id);save();plannedOpen='';go('planned-tasks');toast('Task removed.')}});
document.addEventListener('click',e=>{if(!apptFromList||!e.target.closest('#flow-back,#menu-open.is-back'))return;if(view!=='plan'){apptFromList=false;return}e.stopImmediatePropagation();e.preventDefault();apptFromList=false;go('appointments')},true);

const renderBeforePlanner=render;
render=function(){if(view!=='plan')apptFromList=false;renderBeforePlanner();
  if(['medications','scan','appointments','planned-tasks','planned-task'].includes(view)&&typeof syncFlowProfile==='function'){syncFlowProfile();const fp=$('#flow-profile');if(fp){fp.hidden=false;fp.innerHTML=avatarInner();fp.title='Patient information';fp.setAttribute('aria-label','Patient information')}}};
render();
