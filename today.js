/* Today's cards and the Take page. Tapping a dose on Today opens one page for it: how to take it, a photo as proof, a note on
   how it went, then Done, Skipped or Need help. The photos (up to 3) and note are kept with the dose. Home shows the profile and
   the medication cards with their tabs (All medications, Due today, Needs refill, Finished); Today is in the My Tasks sheet. */
let takeRef='';const blankTake=()=>({photos:[],note:'',help:false,busy:false});let takeDraft=blankTake();
const TAKE_PHOTOS=3;
const takeTask=()=>{const [id,key]=takeRef.split('|');return todayTasks(items,today()).find(x=>x.item.id===id&&x.key===key&&x.slot)};
const takeDose=x=>(x.item.doses||[]).find(d=>dayOf(d)===today()&&d.slot===x.slot);
const takeAt=t=>new Date(t).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
const proofImg=src=>/^data:image\/jpeg;base64,/.test(src)||/^\/api\/files\/[0-9a-f-]{36}$/i.test(src)?`<img src="${esc(src)}" alt="Photo of the dose">`:'';
const proofRow=(photos,remove)=>photos.length?`<div class="take-shots">${photos.map((p,n)=>`<div class="take-shot">${proofImg(p)}${remove?`<button class="take-shot-x" data-take-remove="${n}" aria-label="Remove photo ${n+1}">×</button>`:''}</div>`).join('')}</div>`:'';

/* Laid out like the profile: the bottle's photo on top so they know it's the right one, its name and dose under it, then how to
   take it with the label's details and the prescriber. Photos (up to 3) appear only once added; the + sits at the end of the Photo
   line. Instructions (who to call, warning signs) fold away under the buttons. */
function takePage(){const x=takeTask();if(!x)return '';const i=x.item,d=takeDose(x),full=takeDraft.photos.length>=TAKE_PHOTOS;
const top=`<div class="take-hero">${medPhoto(i)}<h1>${esc(i.name)}</h1><p>${esc([i.dose,'Today at '+clockText(x.slot)].filter(Boolean).join(' · '))}${i.demo?' · Example':''}</p></div>`;
const how=`<section class="take-block"><h2>How to take it</h2><p>${esc(howText(i)||'Add how to take it from the discharge papers.')}</p>${i.pillLooks?`<p class="take-sub"><b>Looks like</b> ${esc(i.pillLooks)}</p>`:''}${(i.warnings||[]).map(w=>`<p class="take-sub">${esc(w)}</p>`).join('')}${i.prescriber&&i.prescriber.name?`<p class="take-sub"><b>Prescribed by</b> ${esc(i.prescriber.name)}</p>`:''}</section>`;
/* Instructions: who to call and the papers' warning signs, folded away; Need help opens it. */
const details=`<details class="take-more" id="take-help"${takeDraft.help?' open':''}><summary>Instructions</summary>${helpNote(i)}</details>`;
const photos=d?(d.photos||[]):[];
const body=d?`<section class="take-block"><h2>${d.kind==='taken'?'Taken':'Skipped'}</h2><p>${d.kind==='taken'?'Taken':'Skipped'} at ${esc(takeAt(d.at))}${d.by?' by '+esc(d.by):''}.</p>${proofRow(photos,false)}${d.note?`<p class="take-note-text">${esc(d.note)}</p>`:''}</section>`
:`<section class="take-block"><div class="take-line"><h2>Photo <span>${takeDraft.photos.length} of ${TAKE_PHOTOS}</span></h2>${full?'':`<label class="take-add" for="take-photo" aria-label="Add a photo">+</label>`}</div><input type="file" id="take-photo" accept="image/*" multiple hidden>${proofRow(takeDraft.photos,true)}<p class="take-muted">Up to ${TAKE_PHOTOS} photos showing the dose was taken.</p></section>
<section class="take-block"><h2>Note</h2><textarea id="take-note" maxlength="500" placeholder="How did it go?">${esc(takeDraft.note)}</textarea></section>
<div class="take-actions"><button class="today-pill" data-take="done"${takeDraft.busy?' disabled':''}>Done</button><button class="today-pill is-light" data-take="skipped"${takeDraft.busy?' disabled':''}>Skipped</button><button class="today-pill is-light" data-take="help">Need help</button></div>`;
return `<section class="sub-page take-page"><div class="sub-top"><button class="sub-back" data-menu-go="overview" aria-label="Back">${menuIcon(menuIcons.back)}</button></div>${top}${how}${body}${details}</section>`}

/* A smaller copy of a photo, kept on the dose itself when it can't be saved to the account right now. */
async function smallPhoto(src,max=480){const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src});const s=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.naturalWidth*s));c.height=Math.max(1,Math.round(img.naturalHeight*s));c.getContext('2d').drawImage(img,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.7)}
const saveProof=async src=>{try{return (await Account.api('POST','/api/files/proof',{data:src})).url}catch{return smallPhoto(src).catch(()=>'')}};

/* Done or Skipped: the dose goes into the same record as the reminder buttons and the Take tab, with its photos and note. */
async function finishTake(kind){const x=takeTask();if(!x||takeDose(x)||takeDraft.busy)return;takeDraft.busy=true;render();
const photos=(await Promise.all(takeDraft.photos.map(saveProof))).filter(Boolean),i=x.item,note=takeDraft.note.trim();
i.doses=[...(i.doses||[]),{at:new Date().toISOString(),day:today(),kind:kind==='done'?'taken':'skipped',slot:x.slot,...(markedBy()?{by:markedBy()}:{}),...(note?{note}:{}),...(photos.length?{photos}:{})}].slice(-200);
takeRef='';takeDraft=blankTake();view='overview';save();render();window.scrollTo(0,0);
toast(kind==='skipped'?'Marked skipped. Don’t take an extra dose to make up for it unless the papers or your pharmacist say so.':'Marked taken.')}

document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
if(b.dataset.todayStart){const [id,key]=b.dataset.todayStart.split('|'),i=find(id);if(!i)return;if(key==='appt'){showDetail(id);return}
if(takeRef!==b.dataset.todayStart)takeDraft=blankTake();takeRef=b.dataset.todayStart;view='take';render();window.scrollTo(0,0);return}
if(view!=='take')return;if(b.dataset.takeRemove){takeDraft.photos.splice(Number(b.dataset.takeRemove),1);render();return}
if(!b.dataset.take)return;if(b.dataset.take==='help'){takeDraft.help=true;const h=$('#take-help');if(h){h.open=true;h.scrollIntoView({behavior:'smooth',block:'start'})}return}finishTake(b.dataset.take)});
document.addEventListener('toggle',e=>{if(e.target.id==='take-help')takeDraft.help=e.target.open},true);
document.addEventListener('input',e=>{if(e.target.id==='take-note')takeDraft.note=e.target.value});
document.addEventListener('change',async e=>{if(e.target.id!=='take-photo')return;const files=[...e.target.files].slice(0,TAKE_PHOTOS-takeDraft.photos.length);
try{for(const f of files)takeDraft.photos.push(await readPhoto(f));if(e.target.files.length>files.length)toast(`Up to ${TAKE_PHOTOS} photos.`)}catch(err){toast(err.message)}render()});

/* My Tasks: the vital signs, the done count and today's task cards sit in a sheet at the bottom of Home (report.js): drag its
   handle up to open it and down to make it small, or tap the handle. */
let tasksOpen=false;
const TASKS_CHEVRON='<svg viewBox="0 0 44 12" aria-hidden="true"><path d="M3 9 22 3l19 6"/></svg>';
const tasksSheet=inner=>`<section class="tasks-sheet${tasksOpen?' open':''}" id="tasks-sheet" aria-label="My Tasks"><div class="tasks-top" id="tasks-top"><button class="tasks-handle" id="tasks-handle" aria-expanded="${tasksOpen}" aria-controls="tasks-body" aria-label="${tasksOpen?'Make My Tasks smaller':'Open My Tasks'}">${TASKS_CHEVRON}</button><h2>My Tasks</h2></div><div class="tasks-body" id="tasks-body">${inner}</div></section>`;
const galleryBeforeTake=gallery;
gallery=function(){if(view!=='overview')return galleryBeforeTake();const el=document.createElement('div');el.innerHTML=galleryBeforeTake();
const tasks=el.querySelector(':scope>.home-today');if(tasks)tasks.remove();
el.insertAdjacentHTML('beforeend',`<section class="home-today">${whenToCallHTML()}</section>${tasksSheet(tasks?tasks.outerHTML:'')}`);
return el.innerHTML};
function setTasksOpen(open){tasksOpen=open;const s=$('#tasks-sheet'),h=$('#tasks-handle');if(!s)return;s.style.height='';s.classList.toggle('open',open);h.setAttribute('aria-expanded',open);h.setAttribute('aria-label',open?'Make My Tasks smaller':'Open My Tasks');if(!open)$('#tasks-body').scrollTop=0}
/* Dragging: the sheet follows the finger, then settles open (dragged up) or small (dragged down). A tap just flips it. */
let tasksDrag=null;
document.addEventListener('pointerdown',e=>{const top=e.target.closest('#tasks-top');if(!top)return;const s=$('#tasks-sheet');tasksDrag={y:e.clientY,h:s.getBoundingClientRect().height,moved:false};s.classList.add('dragging');top.setPointerCapture(e.pointerId)});
document.addEventListener('pointermove',e=>{if(!tasksDrag)return;const s=$('#tasks-sheet'),dy=tasksDrag.y-e.clientY;if(Math.abs(dy)>6)tasksDrag.moved=true;if(tasksDrag.moved)s.style.height=Math.max(0,tasksDrag.h+dy)+'px'});
const endTasksDrag=e=>{if(!tasksDrag)return;const s=$('#tasks-sheet'),d=tasksDrag,dy=d.y-e.clientY;tasksDrag=null;if(!s)return;s.classList.remove('dragging');
setTasksOpen(e.type==='pointercancel'?tasksOpen:!d.moved?!tasksOpen:dy>40?true:dy<-40?false:tasksOpen)};
document.addEventListener('pointerup',endTasksDrag);document.addEventListener('pointercancel',endTasksDrag);
/* Keyboard: Enter or Space on the handle. */
document.addEventListener('click',e=>{if(e.detail===0&&e.target.closest('#tasks-handle'))setTasksOpen(!tasksOpen)});

menuIcons.meds='<rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="m9.5 9.5 5 5"/>';

const renderBeforeTake=render;
render=function(){if(view==='take'&&!takeTask())view='overview';
if(view==='take'){ensureMenuChrome();if(typeof stopJourneyCamera==='function')stopJourneyCamera();document.body.classList.remove('flow-active');const fp=$('#flow-profile');if(fp)fp.hidden=true;$('#main').innerHTML=takePage();paintIcons()}else renderBeforeTake();
document.querySelectorAll('.global-header [data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===(view==='take'?'overview':view)))};
render();
