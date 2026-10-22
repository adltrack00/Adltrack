/* The + at the top right of My Tasks, across from its title: a new task or an incident, for the family on screen
   (each family's plan is its own, so a caregiver on several families adds it to the patient they're looking at). Only people
   allowed to add tasks or report incidents see it; the server checks it too (server/permissions.js).
   A new task: what to do, an optional note and photo, the date and exact time, once or repeating (every day, chosen days or
   every week), from today up to one year ahead. It shows in My Tasks on its days at its time and is done on the Take page with
   the same Done or Skip, note and photos. An incident: what happened, when, a note, photos, the witnesses and who was told, with Call 911 on
   the form. Both show in the daily care report, numbered and time-stamped. Uses the Take card's blocks. */
const PLUS_PHOTOS=3,YEAR_AHEAD=365;
const TASK_DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const REPEATS=[['once','Once'],['daily','Every day'],['days','Chosen days'],['weekly','Every week']];
const INCIDENTS=[['fall','Fall'],['refused','Refused medication'],['injury','Injury'],['behaviour','Behaviour'],['other','Other']];
const mayAddTask=()=>mayDo('addTasks'),mayReport=()=>mayDo('care');
const weekdayOf=day=>C.parseDate(day).getDay();
const taskDayText=day=>C.parseDate(day).toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});
const untilText=day=>C.parseDate(day).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});

/* Is a task due on this day: on its date when it's once, otherwise from its date to its last day, every day, on its chosen
   weekdays, or on its date's weekday each week. */
function taskOn(t,day){if(!t.date||day<t.date)return false;if(!t.repeat||t.repeat==='once')return day===t.date;if(t.until&&day>t.until)return false;
return t.repeat==='daily'||t.repeat==='weekly'&&weekdayOf(day)===weekdayOf(t.date)||t.repeat==='days'&&(t.days||[]).includes(weekdayOf(day))}
/* How often, as in "Every Monday at 3:00 PM until Oct 22, 2027". */
function repeatText(t){const at=t.time?' at '+clockText(t.time):'',until=t.until?' until '+untilText(t.until):'';
if(!t.repeat||t.repeat==='once')return taskDayText(t.date)+at;
if(t.repeat==='daily')return 'Every day'+at+until;
if(t.repeat==='weekly')return 'Every '+C.parseDate(t.date).toLocaleDateString('en-US',{weekday:'long'})+at+until;
return [...(t.days||[])].sort().map(d=>TASK_DAYS[d]).join(', ')+at+until}

/* Today's tasks from the +, at their time among the doses and visits, and each incident reported that day at the time it
   happened, crossed off as done like a finished task. */
const todayTasksBeforePlus=todayTasks;
const clockOf=t=>{const d=new Date(t);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')};
todayTasks=function(list=items,day=today()){const tasks=todayTasksBeforePlus(list,day);
for(const t of list.filter(i=>i.task&&taskOn(i,day))){const m=markOf(t,day,'task');tasks.push({item:t,key:'task',time:t.time||'',title:t.name,sub:t.note||'',state:m?m.kind:''})}
for(const i of list.filter(i=>i.incident&&onDay(i.at,day)))tasks.push({item:i,key:'incident',time:clockOf(i.at),title:'Incident: '+i.name,sub:i.note||'',state:'done'});
return tasks.sort((a,b)=>(a.time||'99')<(b.time||'99')?-1:(a.time||'99')>(b.time||'99')?1:0)};
/* A task's photo on its card and Take page: once it's done, the first photo taken then; otherwise its own (an incident's is
   the one uploaded with the report), or the clock when there's none. */
const taskPhoto=(i,mark)=>{const src=(mark&&mark.photos||[])[0]||(i.photos||[])[0];return src?`<div class="product-photo">${proofImg(src)}</div>`:`<div class="product-photo today-icon">${icon('clock')}</div>`};

/* The Take page for a task: its photo, what to do with its note and photos, then the same photo, note and Done, Skipped, Need help. */
function taskTakePage(x,d,full){const i=x.item;
const top=`<div class="take-hero">${taskPhoto(i)}<h1>${esc(i.name)}</h1><p>${esc('Today'+(x.time?' at '+clockText(x.time):''))}</p></div>`;
const how=`<section class="take-block"><h2>What to do</h2><p>${esc(i.note||i.name)}</p>${proofRow(i.photos||[],false)}<p class="take-sub">${esc(repeatText(i))}</p></section>`;
const details=`<details class="take-more" id="take-help"${takeDraft.help?' open':''}><summary>Instructions</summary>${helpNote(i)}</details>`;
return `<section class="sub-page take-page"><div class="sub-top"><button class="sub-back" data-menu-go="overview" aria-label="Back">${menuIcon(menuIcons.back)}</button></div>${top}${how}${takeBody(d,full,true)}${details}</section>`}

/* In the daily care report: a task on the day it was added and each day it was done or skipped, and an incident at the time
   it happened. Like the other entries, it doesn't say who added it. */
const reportEntriesBeforePlus=reportEntries;
reportEntries=function(list=items,day=today(),vitalsLog){const out=reportEntriesBeforePlus(list,day,vitalsLog);
for(const t of list.filter(i=>i.task)){
if(onDay(t.addedAt,day))out.push({title:'New task: '+t.name,at:t.addedAt,note:t.note||'',details:[repeatText(t)],name:t.name,photos:t.photos||[]});
for(const m of (t.marks||[]).filter(m=>m.key==='task'&&m.day===day&&m.at))out.push({title:`${t.name} (${t.time?shortClock(t.time)+' task':'task'})${m.kind==='skipped'?' skipped':''}`,at:m.at,note:m.note||'',details:[],name:t.name,photos:m.photos||[]})}
for(const i of list.filter(i=>i.incident&&onDay(i.at,day)))out.push({title:'Incident: '+i.name,at:i.at,note:i.note||'',details:[i.witnesses?'Witnesses: '+i.witnesses:'',i.told?'Told: '+i.told:''].filter(Boolean),name:'Incident: '+i.name,photos:i.photos||[]});
return out.sort((x,y)=>new Date(x.at)-new Date(y.at))};

/* The + itself: the Take card's round +. Someone who may do both picks one first; otherwise it opens the one they may do. */
const plusButton=()=>mayAddTask()||mayReport()?'<button class="take-add tasks-plus" id="tasks-plus" aria-label="Add a task or report an incident">+</button>':'';
/* Tapping an incident in My Tasks shows it in today's daily care report. */
document.addEventListener('click',e=>{const b=e.target.closest('[data-today-start$="|incident"]');if(!b)return;e.stopImmediatePropagation();reportTab='today';setTasksOpen(false);view='overview';render();window.scrollTo(0,0)},true);
document.addEventListener('click',e=>{if(!e.target.closest('#tasks-plus'))return;e.stopPropagation();go(mayAddTask()&&mayReport()?'plus':mayAddTask()?'task-new':'incident-new')});

/* What's being written, kept while a photo is added or the page redraws. */

let plusDraft=null;
const blankTaskDraft=()=>({what:'',note:'',date:today(),time:'',repeat:'once',days:[],until:C.shift(today(),YEAR_AHEAD),photos:[],busy:false});
const blankIncidentDraft=()=>({kind:'',date:today(),time:hmNow(),note:'',witnesses:'',told:'',photos:[],busy:false});
const plusPhotos=(d,id)=>`<section class="take-block"><div class="take-line"><h2>Photo <span>${d.photos.length} of ${PLUS_PHOTOS}</span></h2>${d.photos.length>=PLUS_PHOTOS?'':`<label class="take-add" for="${id}" aria-label="Add a photo">+</label>`}</div><input type="file" id="${id}" accept="image/*" multiple hidden>${proofRow(d.photos,true)}<p class="take-muted">Optional. Up to ${PLUS_PHOTOS} photos.</p></section>`;
const plusField=(label,html)=>`<section class="take-block"><h2>${label}</h2>${html}</section>`;
const plusRadios=(name,list,value)=>`<div class="plus-choice">${list.map(([v,l])=>`<label><input type="radio" name="${name}" value="${v}"${v===value?' checked':''}><span>${l}</span></label>`).join('')}</div>`;

function plusPage(){return `<section class="sub-page settings-page">${subHeader('Add to My Tasks','overview')}<div class="settings-list">${settingsRow('task-new','New task')}${settingsRow('incident-new','Report an incident')}</div></section>`}
function taskNewPage(){const d=plusDraft,last=C.shift(today(),YEAR_AHEAD);
return `<section class="sub-page take-page plus-page">${subHeader('New task',mayReport()?'plus':'overview')}<form id="task-form" class="plus-form" novalidate>
${plusField('What to do',`<input name="what" maxlength="100" required autocomplete="off" value="${esc(d.what)}" placeholder="Change the dressing on the left knee">`)}
${plusField('Note',`<textarea name="note" maxlength="500" placeholder="Anything to know (optional)">${esc(d.note)}</textarea>`)}
${plusPhotos(d,'plus-photo')}
${plusField('When',`<div class="plus-when"><input name="date" type="date" min="${today()}" max="${last}" value="${esc(d.date)}" aria-label="Date"><input name="time" type="time" value="${esc(d.time)}" aria-label="Time"></div>`)}
${plusField('Repeats',`${plusRadios('repeat',REPEATS,d.repeat)}${d.repeat==='days'?`<div class="plus-days">${TASK_DAYS.map((w,n)=>`<label><input type="checkbox" name="day" value="${n}"${d.days.includes(n)?' checked':''}><span>${w}</span></label>`).join('')}</div>`:''}${d.repeat!=='once'?`<label class="plus-until"><span>Until</span><input name="until" type="date" min="${esc(d.date||today())}" max="${last}" value="${esc(d.until)}"></label><p class="take-muted">Up to one year ahead.</p>`:''}`)}
<button class="primary plus-save"${d.busy?' disabled':''}>Add the task</button></form></section>`}
function incidentNewPage(){const d=plusDraft;
return `<section class="sub-page take-page plus-page">${subHeader('Report an incident',mayAddTask()?'plus':'overview')}<form id="incident-form" class="plus-form" novalidate>
<section class="take-block plus-911"><p>In an emergency, call 911 first.</p><p>${call911}</p></section>
${plusField('What happened',plusRadios('kind',INCIDENTS,d.kind))}
${plusField('When',`<div class="plus-when"><input name="date" type="date" max="${today()}" value="${esc(d.date)}" aria-label="Date"><input name="time" type="time" value="${esc(d.time)}" aria-label="Time"></div>`)}
${plusField('Note',`<textarea name="note" maxlength="1000" placeholder="What happened, and what was done">${esc(d.note)}</textarea>`)}
${plusPhotos(d,'plus-photo')}
${plusField('Witnesses',`<input name="witnesses" maxlength="200" autocomplete="off" value="${esc(d.witnesses)}" placeholder="Ann, Luis">`)}
${plusField('Who was told',`<input name="told" maxlength="200" autocomplete="off" value="${esc(d.told)}" placeholder="Dr. Patel, Ann">`)}
<button class="primary plus-save"${d.busy?' disabled':''}>Report the incident</button></form></section>`}
Object.assign(menuPages,{plus:plusPage,'task-new':taskNewPage,'incident-new':incidentNewPage});
menuViews.push('plus','task-new','incident-new');
const goBeforePlus=go;go=function(v){if(v==='task-new'&&(!plusDraft||!('what'in plusDraft)))plusDraft=blankTaskDraft();if(v==='incident-new'&&(!plusDraft||!('kind'in plusDraft)))plusDraft=blankIncidentDraft();if(v==='overview'||v==='plus')plusDraft=null;return goBeforePlus(v)};

/* Typing keeps the draft; a new repeat choice shows its days or its last day. */
function readPlusForm(f){const d=plusDraft;for(const k of ['what','note','date','time','until','witnesses','told','kind','repeat'])if(f.elements[k]){const el=f.elements[k];d[k]=el instanceof RadioNodeList?el.value:el.value}
if(f.querySelector('[name="day"]'))d.days=[...f.querySelectorAll('[name="day"]:checked')].map(c=>Number(c.value))}
document.addEventListener('input',e=>{const f=e.target.closest('.plus-form');if(f&&plusDraft)readPlusForm(f)});
document.addEventListener('change',async e=>{const f=e.target.closest('.plus-form');if(!f||!plusDraft)return;
if(e.target.id==='plus-photo'){const files=[...e.target.files].slice(0,PLUS_PHOTOS-plusDraft.photos.length);try{for(const file of files)plusDraft.photos.push(await readPhoto(file));if(e.target.files.length>files.length)toast(`Up to ${PLUS_PHOTOS} photos.`)}catch(err){toast(err.message)}render();return}
readPlusForm(f);if(e.target.name==='repeat'||e.target.name==='date')render()});
document.addEventListener('click',e=>{const b=e.target.closest('[data-take-remove]');if(!b||!plusDraft||!['task-new','incident-new'].includes(view))return;plusDraft.photos.splice(Number(b.dataset.takeRemove),1);render()});

const clockOk=t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t),dayOk=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!!C.parseDate(d);
const uploadPlus=(photos,kind)=>Promise.all(photos.map(src=>Account.api('POST','/api/files/proof',{data:src,for:kind}).then(r=>r.url,()=>smallPhoto(src).catch(()=>''))));
function taskProblem(d){const last=C.shift(today(),YEAR_AHEAD);
if(!d.what.trim())return 'Add what to do.';if(!dayOk(d.date)||d.date<today()||d.date>last)return 'Pick a day from today up to one year ahead.';if(!clockOk(d.time))return 'Pick the time.';
if(d.date===today()&&d.repeat==='once'&&d.time<hmNow())return 'That time has already passed today. Pick a later time.';
if(d.repeat==='days'&&!d.days.length)return 'Pick the days it repeats.';if(d.repeat!=='once'&&(!dayOk(d.until)||d.until<d.date||d.until>last))return 'Pick when it stops, up to one year ahead.';return ''}
function incidentProblem(d){if(!d.kind)return 'Pick what happened.';if(!dayOk(d.date)||d.date>today()||!clockOk(d.time))return 'Check the date and time.';if(new Date(d.date+'T'+d.time)>new Date())return 'That time hasn’t happened yet.';return ''}
document.addEventListener('submit',async e=>{const f=e.target;if(!['task-form','incident-form'].includes(f.id)||!plusDraft)return;e.preventDefault();if(plusDraft.busy)return;readPlusForm(f);const d=plusDraft,task=f.id==='task-form';
const problem=task?taskProblem(d):incidentProblem(d);if(problem){toast(problem);return}
d.busy=true;render();const photos=(await uploadPlus(d.photos,task?'task':'incident')).filter(Boolean),by=markedBy(),added=new Date().toISOString();
if(task){const t={id:crypto.randomUUID(),task:true,name:d.what.trim(),...(d.note.trim()?{note:d.note.trim()}:{}),...(photos.length?{photos}:{}),date:d.date,time:d.time,repeat:d.repeat,...(d.repeat==='days'?{days:[...d.days].sort()}:{}),...(d.repeat!=='once'?{until:d.until}:{}),...(by?{by}:{}),addedAt:added,marks:[]};
  items.push(t);plusDraft=null;view='overview';tasksOpen=taskOn(t,today());save();render();window.scrollTo(0,0);toast(`Task added: ${repeatText(t)}.`);return}
const kind=INCIDENTS.find(([k])=>k===d.kind),at=new Date(d.date+'T'+d.time).toISOString();
items.push({id:crypto.randomUUID(),incident:true,kind:kind[0],name:kind[1],at,...(d.note.trim()?{note:d.note.trim()}:{}),...(d.told.trim()?{told:d.told.trim()}:{}),...(d.witnesses.trim()?{witnesses:d.witnesses.split(',').map(w=>w.trim()).filter(Boolean).join(', ')}:{}),...(photos.length?{photos}:{}),...(by?{by}:{}),addedAt:added});
plusDraft=null;reportTab=d.date===today()?'today':d.date===C.shift(today(),-1)?'previous':reportTab;view='overview';tasksOpen=false;save();render();window.scrollTo(0,0);toast('Incident reported. Everyone on the care team is told, and it’s in the daily care report.')});

/* The forms aren't open to people who can't use them. */
const renderBeforePlus=render;
render=function(){if(view==='task-new'&&!mayAddTask()||view==='incident-new'&&!mayReport()||view==='plus'&&!(mayAddTask()&&mayReport()))view='overview';if(['task-new','incident-new'].includes(view)&&!plusDraft)plusDraft=view==='task-new'?blankTaskDraft():blankIncidentDraft();renderBeforePlus()};
render();
