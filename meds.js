/* Medications, as George laid them out: Medications starts with "Add a medication" (scan it, or type it in with a photo of what
   it looks like). All medications shows the ones being taken (Open) and the Finished ones, medications only. Tapping one
   opens its own page: the big picture and everything about it in large, bold type, then Needs refill, Finished and Delete
   this medication. Deleting it takes it off the schedule, My Tasks and the reminders. The refill steps still open from Your
   refills. Scan also scans any document straight into Documents. */
let medBack='purchases';
const showDetailBeforeMeds=showDetail;showDetail=function(id){const i=find(id);if(i&&i.med&&view!=='plan')medBack=view==='overview'||view==='upload'||view==='review'?'purchases':view;return showDetailBeforeMeds(id)};

/* Medications page: Add a medication on top, as Appointments has Add an appointment. */
const medicationsBeforeAdd=menuPages.medications;
menuPages.medications=()=>medicationsBeforeAdd().replace('<div class="plus-list">',`${mayDo('meds')?'<button class="primary doc-add" data-menu-go="med-add">Add a medication</button>':''}<div class="plus-list">`);
function medAddPage(){return `<section class="sub-page settings-page">${subHeader('Add a medication','medications')}<p class="sub-intro">Scan the pharmacy paper or the bottle, or type it in yourself for anything without a label to scan.</p><div class="plus-list">${plusRow('id="flow-bottles"','Scan it<small class="plus-sub">The pharmacy paper or the bottle</small>')}${plusRow('id="med-type"','Type it in<small class="plus-sub">With a photo of what it looks like</small>')}</div></section>`}
/* Typed in: the same Confirm card as a scanned bottle, empty, so the name, how to take it, the photo and the times are filled by hand. */
function typeMedication(){stopJourneyCamera();cameraAttempted=false;Object.assign(journey,{mode:'papers',step:'capture',kind:'',shots:[],shotFrom:'',error:'',more:false,purchaseId:''});draft={channel:'store',evidence:[],products:[{...blankProduct(),typed:true}],retailer:'',purchased:today(),delivered:'',discharge:null,bottlesOnly:true,typed:true};openReview('Type the name and how to take it, add a photo of what it looks like, pick the times, then confirm.')}
/* Its card has no bottle steps and nothing to read from a label: the photo only shows what it looks like. */
const bottleRowBeforeTyped=bottleRow;bottleRow=(p,n)=>p.typed?'':bottleRowBeforeTyped(p,n);
const readLabelBeforeTyped=readLabel;readLabel=n=>draft.products[n]&&draft.products[n].typed?undefined:readLabelBeforeTyped(n);
const reviewBeforeTyped=reviewPage;reviewPage=function(){const html=reviewBeforeTyped();return draft.typed?html.split('+ Photos of the bottle').join('+ Photo of what it looks like').split('I checked this against the bottle.').join('I checked the name and how to take it.'):html};

/* Scan: discharge papers, medications, and any document. */
const scanBeforeDocs=menuPages.scan;
menuPages.scan=()=>scanBeforeDocs().replace('The first way in. Scan the discharge papers, or go straight to the medication bottles.','Scan the discharge papers, a medication, or any paper you want to keep in Documents.').replace(plusRow('id="flow-bottles"','Scan medications'),plusRow('id="flow-bottles"','Scan medications')+plusRow('id="scan-docs"','Scan a document'));

/* All medications: Open, Needs refill and Finished, medications only. Needs refill lists each medication that needs one, its
   photo on the left and on the right what's left and how many days until it runs out. */
const refillList=(list=items,day=today())=>list.filter(i=>i.med&&i.status!=='received'&&i.status!=='kept'&&(!!i.pickup||!!(i.refill&&i.refill.step)||C.refillDue(i,day)));
function refillLeft(i,day=today()){const out=C.runsOut(i),d=out?C.days(out,day):null,per=C.perDose(i),n=(i.times||[]).length,lines=[];
  if(d!==null&&per&&n)lines.push(`About ${Math.max(0,d*per*n)} ${/capsule/i.test(howText(i)||'')?'capsule':'pill'}${Math.max(0,d*per*n)===1?'':'s'} left`);
  if(i.refills!=null&&i.refills!=='')lines.push(Number(i.refills)===0?'No refills left. Call the doctor':`${i.refills} refill${Number(i.refills)===1?'':'s'} left`);
  const days=d===null?'':d<0?'Ran out':d===0?'Runs out today':d===1?'1 day left':`${d} days left`;
  return {days,when:out&&d>=0?new Date(out+'T12:00').toLocaleDateString([],{month:'short',day:'numeric'}):'',lines}}
const refillCard=i=>{const r=refillLeft(i),step=typeof refillStep==='function'?refillStep(i):'';
  return `<button class="med-refill-card" data-open="${esc(i.id)}"><span class="med-refill-photo">${medPhoto(i)}</span><span class="med-refill-info"><strong class="med-refill-name">${esc(i.name)}</strong>${r.days?`<span class="med-refill-days">${esc(r.days)}</span>${r.when?`<small>Runs out ${esc(r.when)}</small>`:''}`:''}${r.lines.map(l=>`<span class="med-refill-left">${esc(l)}</span>`).join('')}${step?`<small class="med-refill-step">${esc(step)}</small>`:''}</span></button>`};
const galleryBeforeOpen=gallery;
gallery=function(){if(view!=='purchases')return galleryBeforeOpen();if(!['open','refill','received'].includes(galleryFilter))galleryFilter='open';
  const el=document.createElement('div');el.innerHTML=galleryBeforeOpen();const tabs=el.querySelector('.gallery-filters');
  if(tabs){tabs.classList.add('med-tabs');tabs.innerHTML=[['open','Open'],['refill','Needs refill'],['received','Finished']].map(([id,label])=>`<button data-gallery="${id}" class="${galleryFilter===id?'active':''}">${label}</button>`).join('')}
  const p=el.querySelector('.page-heading p');if(p)p.textContent='Every medication being taken. Tap one to see everything about it.';
  const grid=el.querySelector('.photo-gallery');
  if(galleryFilter==='refill'&&grid){const list=refillList();el.querySelectorAll('.empty').forEach(x=>x.remove());grid.outerHTML=`<div class="med-refills">${list.length?list.map(refillCard).join(''):'<p class="sub-note med-none">Nothing needs a refill right now.</p>'}</div>`}
  if(galleryFilter==='received'&&!items.some(i=>i.med&&i.status==='received'))grid?.insertAdjacentHTML('afterend','<p class="sub-note med-none">Finished medications show here.</p>');
  return el.innerHTML};

/* A medication's page. */
const infoRow=(label,value)=>value?`<div class="info-row"><dt>${label}</dt><dd>${value}</dd></div>`:'';
const medDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')?new Date(d+'T12:00').toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'}):'';
function medInfoPage(i){const doc=i.prescriber||{},ph=i.pharmacy||{},finished=i.status==='received',edit=mayDo('meds'),times=i.asNeeded?[]:[...(i.times||[])].sort();
const when=times.length?times.map(t=>esc((slotName(t)?slotName(t)+' ':'')+clockText(t))).join('<br>'):i.asNeeded||dosesPerDay(i)===0?'Only when needed':'';
const call=phone=>phone?`<a class="med-call" href="tel:${esc(phone.replace(/[^\d+]/g,''))}">Call ${esc(phone)}</a>`:'';
const photoBox=`<label class="med-hero-photo"${edit?` for="flow-photo-med" tabindex="0" role="button" aria-label="${i.photo?'Change':'Add'} photo of ${esc(i.name)}"`:''}>${medPhoto(i)}${!i.photo&&edit?'<span class="pick-photo-hint">+ Photo of what it looks like</span>':''}</label>${edit?`<input type="file" id="flow-photo-med" data-med-photo="${esc(i.id)}" accept="image/*" hidden>`:''}`;
const papers=papersRow(i).replace(/^<p class="pick-price plan-when"><span>The papers<\/span>/,'').replace(/<\/p>$/,'');
return `<section class="sub-page med-info">${subHeader('',medBack)}${photoBox}<h1 class="med-name">${esc(i.name)}</h1><p class="med-state">${esc(medState(i))}${i.demo?' · Example':''}</p>
<section class="info-card"><dl>${infoRow('How to take it',esc(howText(i)||'Not written down yet'))}${infoRow('Dose times',when)}${infoRow('Looks like',esc(i.pillLooks||''))}${infoRow('Quantity',i.quantity?esc(i.quantity):'')}${infoRow('Refills left',i.refills!=null&&i.refills!==''?esc(i.refills):'')}${infoRow('Refill by',esc(medDate(i.refillBy)))}${infoRow('Filled',esc(medDate(i.filled)))}${infoRow('Discard after',esc(medDate(i.discardAfter)))}${i.warnings&&i.warnings.length?infoRow('Warnings',`<ul>${i.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`):''}</dl></section>
<section class="info-card"><dl>${infoRow('Prescribed by',`${esc(doc.name||'Not written down')}${call(doc.phone)}`)}${infoRow('Pharmacy',`${esc(ph.name||'Not written down')}${ph.address?`<span class="med-sub">${esc(ph.address)}</span>`:''}${call(ph.phone)}${mapLink(ph)}`)}${papers?infoRow('Discharge papers',papers):''}</dl></section>
${i.status==='kept'?`<button class="primary" data-return="${esc(i.id)}">Confirm this medication</button>`:''}
${finished?'<p class="sub-note">Finished. No more reminders for this medication.</p>':mayDo('care')?'<div class="med-actions"><button class="outline-button" data-med-done="refill">Needs refill</button><button class="outline-button" data-med-done="finished">Finished</button></div>':''}
${edit?`<button class="danger-button" data-med-delete="${esc(i.id)}">Delete this medication</button>`:''}</section>`}
const planBeforeInfo=planPage;
planPage=function(){const i=find(selected);if(i&&i.med&&!(planTab&&planTab.id===i.id&&planTab.tab==='paid'))return medInfoPage(i);return planBeforeInfo()};

/* Delete: asked once; then it is gone for everyone, with its dose times, My Tasks rows and reminders. */
function deleteMedication(id){const i=find(id);if(!i||!i.med||!mayDo('meds'))return false;if(typeof confirm==='function'&&!confirm(`Delete ${i.name}? It comes off the schedule, My Tasks and the reminders for everyone on the care team. This can’t be undone.`))return false;
items=items.filter(x=>x.id!==id);if(selected===id)selected=null;planTab=null;save();return true}

/* Scan a document: the same scanner as the discharge papers, then the pages go to Add a document to be named and filed. */
function docScanPage(){const shots=journey.paperShots||[],n=shots.length;journey.justShot=false;
return flowShell('','',`<div class="scan-head"><h1>Scan a document.</h1><p>Insurance cards, test results, any paper. One page at a time.</p></div><div class="scan-stage">${scanCamera('page',n?`Page ${n+1}: flat, corners inside`:'Lay the page flat, corners inside','Document')}${scanControls('flow-receipt',shots,'page','image/jpeg,image/png,image/webp,application/pdf',true)}${n?`<button class="scan-done" id="scan-doc-done">Save ${n===1?'this page':`these ${n} pages`}</button>`:''}</div><p class="flow-subtle">Next, name it and pick its category. It’s saved privately in Documents.</p>`,1).replace(/<nav class="flow-tabs"[\s\S]*?<\/nav>/,'')}
const uploadBeforeDocs=uploadPage;uploadPage=function(){return journey.mode==='docs'?docScanPage():uploadBeforeDocs()};
function startDocScan(){stopJourneyCamera();cameraAttempted=false;Object.assign(journey,{mode:'docs',step:'capture',paperShots:[],error:'',more:false});view='upload';render();window.scrollTo(0,0)}
async function finishDocScan(extra=[]){const pages=[...(journey.paperShots||[]).map(data=>({data,type:'image/jpeg'}))];for(const f of extra)pages.push({data:await readingCopy(f),type:/^image\//.test(f.type)?'image/jpeg':f.type});if(!pages.length)return;stopJourneyCamera();journey.paperShots=[];journey.mode='papers';docAddPages(pages.slice(0,DOC_PAGES))}
const readPapersBeforeDocs=readPapers;readPapers=function(extra=[]){return journey.mode==='docs'?finishDocScan(extra):readPapersBeforeDocs(extra)};

if(typeof document!=='undefined'){
Object.assign(menuPages,{'med-add':medAddPage});menuViews.push('med-add');
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;try{
  if(b.id==='med-type'){typeMedication();return}
  if(b.hasAttribute('data-flow-another')&&view==='review'&&draft.typed){e.stopImmediatePropagation();retainReview();draft.products.push({...blankProduct(),typed:true});journey.error='';render();return}
  if(b.id==='scan-docs'){startDocScan();return}
  if(b.id==='flow-back'&&view==='upload'&&journey.mode==='docs'){e.stopImmediatePropagation();stopJourneyCamera();journey.mode='papers';journey.paperShots=[];go('scan');return}
  if(b.id==='scan-doc-done'){finishDocScan().catch(err=>{journey.error=err.message;render()});return}
  if(b.dataset.medDelete){const back=medBack;if(deleteMedication(b.dataset.medDelete)){go(back==='plan'?'purchases':back);toast('Deleted. It’s off the schedule, My Tasks and the reminders.')}return}
  /* Back from a typed-in medication goes back to Medications, not to a camera. */
  if(b.id==='flow-back'&&view==='review'&&draft.typed){e.stopImmediatePropagation();go('medications');return}
}catch(err){toast(err.message)}},true);
const renderBeforeMeds=render;render=function(){if(view==='med-add'&&!mayDo('meds'))view='medications';renderBeforeMeds();
  if(view==='med-add'&&typeof syncFlowProfile==='function'){syncFlowProfile();const fp=$('#flow-profile');if(fp){fp.hidden=false;fp.innerHTML=avatarInner()}}};
}

/* The medication's page from My Tasks: tap the photo to see only the photo, as large as the screen allows with a small
   margin, so the bottle's own label can be read before giving it. The × on top of it closes it. */
function medZoom(i){closeMedZoom();const box=document.createElement('div');box.className='med-zoom';box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-label',i.name);
  box.innerHTML=`<div class="med-zoom-photo${i.photo?' has-img':''}" tabindex="-1">${medPhoto(i)}<button class="med-zoom-x" aria-label="Close">×</button></div>`;
  document.body.appendChild(box);document.body.classList.add('med-zoom-open');box.querySelector('.med-zoom-photo').focus();
  /* A real photo is scaled up or down to fill the screen, whole, keeping its shape. */
  const img=box.querySelector('.has-img img'),fit=()=>{if(!img||!img.naturalWidth)return;const k=Math.min((innerWidth-24)/img.naturalWidth,(innerHeight-24)/img.naturalHeight);img.style.width=Math.round(img.naturalWidth*k)+'px';img.style.height=Math.round(img.naturalHeight*k)+'px'};
  if(img){img.complete?fit():img.addEventListener('load',fit,{once:true})}}
function closeMedZoom(){document.querySelector('.med-zoom')?.remove();document.body.classList.remove('med-zoom-open')}
if(typeof document!=='undefined'){
  document.addEventListener('click',e=>{if(e.target.closest('.med-zoom-x')||e.target.classList.contains('med-zoom')){closeMedZoom();return}
    const ph=e.target.closest('.take-page .take-hero .product-photo');if(!ph||typeof takeTask!=='function')return;const x=takeTask();if(x&&x.item)medZoom(x.item)});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.querySelector('.med-zoom'))closeMedZoom()});
}
