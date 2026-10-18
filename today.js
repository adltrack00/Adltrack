/* Today's cards and the Take page. Tapping a dose on Today opens one page for it: how to take it, a photo as proof, a note on
   how it went, then Done, Skipped or Need help. The photo and note are kept with the dose. Home shows only the profile and
   Today; the medication cards with their tabs (All medications, Due today, Needs refill, Finished) are on All medications. */
let takeRef='',takeDraft={photo:'',note:'',help:false,busy:false};
const takeTask=()=>{const [id,key]=takeRef.split('|');return todayTasks(items,today()).find(x=>x.item.id===id&&x.key===key&&x.slot)};
const takeDose=x=>(x.item.doses||[]).find(d=>dayOf(d)===today()&&d.slot===x.slot);
const takeAt=t=>new Date(t).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
const proofImg=src=>/^data:image\/jpeg;base64,/.test(src)||/^\/api\/files\/[0-9a-f-]{36}$/i.test(src)?`<img src="${esc(src)}" alt="Photo of the dose">`:'';

function takePage(){const x=takeTask();if(!x)return '';const i=x.item,d=takeDose(x);
const how=`<h2>How to take it</h2><p>${esc(howText(i)||'Add how to take it from the discharge papers.')}</p>${i.pillLooks?`<p class="take-muted">Looks like: ${esc(i.pillLooks)}</p>`:''}${(i.warnings||[]).map(w=>`<p class="take-muted">${esc(w)}</p>`).join('')}`;
const head=`<div class="take-head">${medPhoto(i)}<div><strong>${esc(i.dose||i.name)}</strong><small>Today at ${esc(clockText(x.slot))}${i.demo?' · Example':''}</small></div></div>`;
const done=d?`<h2>${d.kind==='taken'?'Taken':'Skipped'}</h2><p>${d.kind==='taken'?'Taken':'Skipped'} at ${esc(takeAt(d.at))}${d.by?' by '+esc(d.by):''}.</p>${d.photo?`<div class="take-photo">${proofImg(d.photo)}</div>`:''}${d.note?`<p>${esc(d.note)}</p>`:''}`
:`<h2>Photo</h2><label class="take-photo" for="take-photo">${takeDraft.photo?proofImg(takeDraft.photo):'+ Add a photo'}</label><input type="file" id="take-photo" accept="image/*" hidden><p class="take-muted">A photo showing the dose was taken.</p>
<h2>Note</h2><textarea id="take-note" maxlength="500" placeholder="How did it go?">${esc(takeDraft.note)}</textarea>
<div class="take-actions"><button class="today-pill" data-take="done"${takeDraft.busy?' disabled':''}>Done</button><button class="today-pill is-light" data-take="skipped"${takeDraft.busy?' disabled':''}>Skipped</button><button class="today-pill is-light" data-take="help">Need help</button></div>${takeDraft.help?helpNote(i):''}`;
return `<section class="sub-page take-page">${subHeader(esc(i.name),'overview')}${head}${how}${done}</section>`}

/* A smaller copy of the photo, kept on the dose itself when it can't be saved to the account right now. */
async function smallPhoto(src,max=480){const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src});const s=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.naturalWidth*s));c.height=Math.max(1,Math.round(img.naturalHeight*s));c.getContext('2d').drawImage(img,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.7)}

/* Done or Skipped: the dose goes into the same record as the reminder buttons and the Take tab, with its photo and note. */
async function finishTake(kind){const x=takeTask();if(!x||takeDose(x)||takeDraft.busy)return;takeDraft.busy=true;render();let photo='';
if(takeDraft.photo){try{photo=(await Account.api('POST','/api/files/proof',{data:takeDraft.photo})).url}catch{photo=await smallPhoto(takeDraft.photo).catch(()=>'')}}
const i=x.item,note=takeDraft.note.trim();i.doses=[...(i.doses||[]),{at:new Date().toISOString(),day:today(),kind:kind==='done'?'taken':'skipped',slot:x.slot,...(markedBy()?{by:markedBy()}:{}),...(note?{note}:{}),...(photo?{photo}:{})}].slice(-200);
takeRef='';takeDraft={photo:'',note:'',help:false,busy:false};view='overview';save();render();window.scrollTo(0,0);
toast(kind==='skipped'?'Marked skipped. Don’t take an extra dose to make up for it unless the papers or your pharmacist say so.':'Marked taken.')}

document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
if(b.dataset.todayStart){const [id,key]=b.dataset.todayStart.split('|'),i=find(id);if(!i)return;if(key==='appt'){showDetail(id);return}
if(takeRef!==b.dataset.todayStart)takeDraft={photo:'',note:'',help:false,busy:false};takeRef=b.dataset.todayStart;view='take';render();window.scrollTo(0,0);return}
if(view!=='take'||!b.dataset.take)return;if(b.dataset.take==='help'){takeDraft.help=!takeDraft.help;render();return}finishTake(b.dataset.take)});
document.addEventListener('input',e=>{if(e.target.id==='take-note')takeDraft.note=e.target.value});
document.addEventListener('change',async e=>{if(e.target.id!=='take-photo')return;try{takeDraft.photo=await readPhoto(e.target.files[0]);render()}catch(err){toast(err.message)}});

/* Home keeps the profile and Today; everything else in the gallery moves to All medications, with When to call under it. */
const galleryBeforeTake=gallery;
gallery=function(){const el=document.createElement('div');el.innerHTML=galleryBeforeTake();
if(view==='purchases'){el.querySelectorAll(':scope>.profile-hero,:scope>.home-today').forEach(n=>n.remove());el.insertAdjacentHTML('afterbegin','<div class="page-heading"><div><h1>All medications.</h1><p>Due today, needs refill and finished.</p></div></div>');el.insertAdjacentHTML('beforeend',`<section class="home-today">${whenToCallHTML()}</section>`)}
else el.querySelectorAll(':scope>*:not(.profile-hero):not(.home-today)').forEach(n=>n.remove());
return el.innerHTML};

menuIcons.meds='<rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="m9.5 9.5 5 5"/>';
menuItems.splice(1,0,['purchases','All medications','meds']);

const renderBeforeTake=render;
render=function(){if(view==='take'&&!takeTask())view='overview';
if(view==='take'){ensureMenuChrome();if(typeof stopJourneyCamera==='function')stopJourneyCamera();document.body.classList.remove('flow-active');const fp=$('#flow-profile');if(fp)fp.hidden=true;$('#main').innerHTML=takePage();paintIcons()}else renderBeforeTake();
document.querySelectorAll('.global-header [data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===(view==='take'?'overview':view)))};
render();
