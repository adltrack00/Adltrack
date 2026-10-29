/* Documents, in the menu: every paper about the patient in one place, sorted into categories so it's easy to find. The discharge
   papers already scanned show up on their own (their pages stay with the medications they were read from); anything else (an
   insurance card, a lab result, a power of attorney) is added here as photos or a PDF, with a name and a category. A document is
   an item ({doc:true}) like a task or an incident, so the whole care team sees the same list. Adding, moving and removing one
   needs the medications tick, like scanning the papers (the server checks it too). Uses the sub-page, the white rounded cards
   of Patient information and the + forms' grey blocks. */
const DOC_CATEGORIES=[['discharge','Discharge papers'],['insurance','Insurance'],['prescriptions','Prescriptions'],['results','Lab and test results'],['visits','Doctor visits'],['legal','ID and legal papers'],['other','Other']];
const DOC_HINTS={discharge:'From the hospital or rehab',insurance:'Cards, Medicare, approvals and bills',prescriptions:'Written prescriptions and pharmacy printouts',results:'Blood work, scans and X-rays',visits:'Visit summaries and referrals',legal:'ID, power of attorney, DNR, POLST, living will',other:'Anything else about their care'};
const DOC_PAGES=10;
const docCategory=c=>DOC_CATEGORIES.some(([k])=>k===c)?c:'other';
const docCategoryName=c=>(DOC_CATEGORIES.find(([k])=>k===docCategory(c))||[])[1];
/* Every document, newest first: the scanned discharge papers (one per scan, from the medications that carry its pages) and the
   documents added here. Papers filed by Scan before their medications are confirmed show as their own document until then.
   Examples are left out. */
function docList(list){const scans=new Map();
for(const i of list){if(!i||!i.med||i.demo||!Array.isArray(i.papers)||!i.papers.length)continue;const k=i.purchaseId||i.id;
  if(!scans.has(k)){const d=i.discharge||{};scans.set(k,{id:'scan-'+k,scanned:true,name:'Discharge papers'+(d.hospital?' · '+d.hospital:''),category:'discharge',date:d.discharged||i.purchased||'',files:i.papers.map(url=>({url})),meds:[]})}
  const s=scans.get(k);if(!s.meds.includes(i.name))s.meds.push(i.name)}
const added=list.filter(i=>i&&i.doc&&!i.demo&&!(i.scanned&&scans.has(i.purchaseId))).map(i=>({id:i.id,name:i.name||'Document',category:docCategory(i.category),date:i.date||String(i.addedAt||'').slice(0,10),files:Array.isArray(i.files)?i.files:[],note:i.note||''}));
return [...scans.values(),...added].sort((a,b)=>String(b.date).localeCompare(String(a.date))||a.name.localeCompare(b.name))}
/* The categories in their order, each with its documents; empty ones are left out. */
const docGroups=docs=>DOC_CATEGORIES.map(([key,name])=>({key,name,docs:docs.filter(d=>d.category===key)})).filter(g=>g.docs.length);
if(typeof module!=='undefined')module.exports={DOC_CATEGORIES,docCategory,docList,docGroups};

if(typeof document!=='undefined'){
let docFilter='all',docOpen='',docDraft=null;
const DOC_VIEWS=['documents','document','document-add'];
menuIcons.documents='<path d="M3.5 7.5a2 2 0 0 1 2-2h4.2l2 2.3h6.8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>';
menuItems.splice(menuItems.findIndex(([v])=>v==='purchases')+1,0,['documents','Documents','documents']);
const isPdf=f=>/pdf/i.test(f.type||'')||/^data:application\/pdf/i.test(f.data||f.url||'');
/* A page's small picture over the paper icon, so a PDF (or a scanned page that turns out to be one) shows the icon instead. */
const docThumb=(f,tag='span',attrs='')=>`<${tag} class="doc-thumb"${attrs}${f&&!isPdf(f)?` style="background-image:url('${esc(f.data||f.url)}'),var(--doc-icon)"`:''}></${tag}>`;
const docDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')?new Date(d+'T12:00').toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'}):'';
const pagesText=n=>n===1?'1 page':n+' pages';
const docRow=d=>`<li><button data-doc-open="${esc(d.id)}">${docThumb(d.files[0])}<span><strong>${esc(d.name)}</strong><small>${esc([docDate(d.date),d.files.length?pagesText(d.files.length):''].filter(Boolean).join(' · '))}</small></span>${menuIcon(menuIcons.chevron)}</button></li>`;

function documentsPage(){const docs=docList(items),groups=docGroups(docs),shown=docFilter==='all'?groups:groups.filter(g=>g.key===docFilter),edit=mayDo('meds');
const chips=groups.length>1?`<div class="doc-chips" role="group" aria-label="Show">${[['all','All',docs.length],...groups.map(g=>[g.key,g.name,g.docs.length])].map(([k,l,n])=>`<button data-doc-filter="${k}" class="${docFilter===k?'active':''}" aria-pressed="${docFilter===k}">${esc(l)} <span>${n}</span></button>`).join('')}</div>`:'';
return `<section class="sub-page doc-page">${subHeader('Documents','overview')}<p class="sub-intro">Every paper about the patient, sorted so it’s easy to find. The discharge papers you scan show up here on their own.</p>${edit?'<button class="primary doc-add" data-menu-go="document-add">Add a document</button>':''}${chips}
${shown.length?shown.map(g=>`<section class="info-card doc-card"><div class="info-head"><h2>${esc(g.name)}</h2><span class="doc-count">${g.docs.length}</span></div><ul class="doc-list">${g.docs.map(docRow).join('')}</ul></section>`).join(''):`<section class="info-card doc-card"><p class="info-none">No documents yet. ${edit?'Scan the discharge papers from Scan in the menu, or add an insurance card, a lab result or any other paper here.':'They show up here when someone on the care team scans the discharge papers or adds one.'}</p></section>`}
${edit?'':'<p class="sub-note">Only admins and people who can scan papers can add or remove documents.</p>'}</section>`}

function documentPage(){const d=docList(items).find(x=>x.id===docOpen);if(!d)return documentsPage();const edit=mayDo('meds')&&!d.scanned;
const pages=d.files.map((f,n)=>`<figure>${docThumb(f,'a',` href="${esc(f.url)}" target="_blank" rel="noopener" aria-label="Open page ${n+1} of ${esc(d.name)}"`)}<figcaption>${isPdf(f)?'PDF':'Page '+(n+1)} ↗</figcaption></figure>`).join('');
return `<section class="sub-page doc-page">${subHeader(esc(d.name),'documents')}<section class="info-card"><dl><div class="info-row"><dt>Category</dt><dd>${esc(docCategoryName(d.category))}</dd></div>${d.date?`<div class="info-row"><dt>${d.scanned?'Discharged':'Date'}</dt><dd>${esc(docDate(d.date))}</dd></div>`:''}${d.meds?`<div class="info-row"><dt>Medications read from it</dt><dd>${esc(d.meds.join(', '))}</dd></div>`:''}${d.note?`<div class="info-row"><dt>Note</dt><dd>${esc(d.note)}</dd></div>`:''}</dl></section>
<div class="doc-pages">${pages||'<p class="info-none">No pages saved with this document.</p>'}</div>
${edit?`<section class="info-card"><form id="doc-move-form" class="guided-form"><label>Move to<select name="category">${DOC_CATEGORIES.map(([k,l])=>`<option value="${k}"${k===d.category?' selected':''}>${esc(l)}</option>`).join('')}</select></label></form></section><button class="danger-button" data-doc-remove="${esc(d.id)}">Remove this document</button>`:d.scanned?'<p class="sub-note">Scanned with the medications. Their pages stay with them.</p>':''}</section>`}

const blankDocDraft=()=>({name:'',category:docFilter!=='all'?docFilter:'',date:'',note:'',files:[],busy:false});
function documentAddPage(){const d=docDraft;
return `<section class="sub-page take-page plus-page">${subHeader('Add a document','documents')}<form id="doc-add-form" class="plus-form" novalidate>
<section class="take-block"><div class="take-line"><h2>Pages <span>${d.files.length} of ${DOC_PAGES}</span></h2>${d.files.length>=DOC_PAGES?'':'<label class="take-add" for="doc-file" aria-label="Add a photo or PDF">+</label>'}</div><input type="file" id="doc-file" accept="image/*,application/pdf" multiple hidden>${d.files.length?`<div class="take-shots">${d.files.map((f,n)=>`<div class="take-shot">${docThumb(f)}<button type="button" class="take-shot-x" data-doc-unpage="${n}" aria-label="Remove page ${n+1}">×</button></div>`).join('')}</div>`:''}<p class="take-muted">Take a photo of each page, or upload a PDF.</p></section>
${plusField('Name',`<input name="name" maxlength="120" autocomplete="off" value="${esc(d.name)}" placeholder="For example: Medicare card">`)}
${plusField('Category',`<div class="plus-choice">${DOC_CATEGORIES.map(([k,l])=>`<label><input type="radio" name="category" value="${k}"${k===d.category?' checked':''}><span>${esc(l)}<small class="doc-hint">${esc(DOC_HINTS[k])}</small></span></label>`).join('')}</div>`)}
${plusField('Date on the document',`<input name="date" type="date" max="${today()}" value="${esc(d.date)}" aria-label="Date on the document"><p class="take-muted">Optional.</p>`)}
${plusField('Note',`<textarea name="note" maxlength="500" placeholder="Optional. For example: the original is in the kitchen drawer">${esc(d.note)}</textarea>`)}
<button class="primary plus-save"${d.busy?' disabled':''}>${d.busy?'Saving…':'Save the document'}</button></form></section>`}

Object.assign(menuPages,{documents:documentsPage,document:documentPage,'document-add':documentAddPage});
menuViews.push(...DOC_VIEWS);
const goBeforeDocs=go;go=function(v){if(v==='document-add'&&!docDraft)docDraft=blankDocDraft();if(v==='documents'||v==='overview')docDraft=null;return goBeforeDocs(v)};

/* Scan a document (meds.js) hands its pages here, to be named and filed. */
window.docAddPages=files=>{docFilter='all';docDraft={...blankDocDraft(),files};go('document-add')};
const readDocForm=f=>{for(const k of ['name','date','note'])docDraft[k]=f.elements[k].value;docDraft.category=f.elements.category.value||docDraft.category};
document.addEventListener('input',e=>{const f=e.target.closest('#doc-add-form');if(f&&docDraft)readDocForm(f)});
document.addEventListener('change',async e=>{
  if(e.target.id==='doc-file'&&docDraft){const all=[...e.target.files],files=all.slice(0,DOC_PAGES-docDraft.files.length);try{for(const file of files){if(file.size>10000000)throw Error('Choose a file smaller than 10 MB.');if(!/^image\/|^application\/pdf$/.test(file.type))throw Error('Use a photo or a PDF.');docDraft.files.push({data:await readingCopy(file),type:/^image\//.test(file.type)?'image/jpeg':file.type})}if(all.length>files.length)toast(`Up to ${DOC_PAGES} pages.`)}catch(err){toast(err.message)}render();return}
  if(e.target.closest('#doc-add-form')&&docDraft){readDocForm(e.target.closest('#doc-add-form'));return}
  const f=e.target.closest('#doc-move-form');if(f&&mayDo('meds')){const i=find(docOpen);if(!i||!i.doc)return;i.category=docCategory(f.elements.category.value);save();render();toast(`Moved to ${docCategoryName(i.category)}.`)}});
document.addEventListener('click',e=>{const b=e.target.closest('[data-doc-open],[data-doc-filter],[data-doc-unpage],[data-doc-remove]');if(!b)return;
  if(b.dataset.docOpen){docOpen=b.dataset.docOpen;go('document');return}
  if(b.dataset.docFilter){docFilter=b.dataset.docFilter;render();return}
  if(b.dataset.docUnpage&&docDraft){docDraft.files.splice(Number(b.dataset.docUnpage),1);render();return}
  if(b.dataset.docRemove&&mayDo('meds')){const i=find(b.dataset.docRemove);if(!i||!i.doc||!confirm(`Remove “${i.name}” and its pages for everyone on the care team?`))return;items=items.filter(x=>x.id!==i.id);save();docOpen='';go('documents');toast('Document removed.')}});
document.addEventListener('submit',async e=>{if(e.target.id!=='doc-add-form'||!docDraft)return;e.preventDefault();if(!mayDo('meds')||docDraft.busy)return;readDocForm(e.target);const d=docDraft;
  if(!d.files.length){toast('Add a photo or PDF of the document.');return}if(!d.name.trim()){toast('Give the document a name.');return}if(!d.category){toast('Pick a category.');return}
  d.busy=true;render();let files;try{files=await Promise.all(d.files.map(f=>Account.api('POST','/api/files/document',{data:f.data})))}catch(err){d.busy=false;render();toast(err.message||'We couldn’t save the pages. Try again.');return}
  const doc={id:crypto.randomUUID(),doc:true,name:d.name.trim(),category:docCategory(d.category),files:files.map(r=>({url:r.url,type:r.type})),...(d.date?{date:d.date}:{}),...(d.note.trim()?{note:d.note.trim()}:{}),addedAt:new Date().toISOString()};
  items.push(doc);docDraft=null;docFilter='all';save();go('documents');toast(`Saved in ${docCategoryName(doc.category)}.`)});

const renderBeforeDocs=render;
render=function(){if(view==='document-add'&&!mayDo('meds'))view='documents';if(view==='document-add'&&!docDraft)docDraft=blankDocDraft();if(view==='documents'&&docFilter!=='all'&&!docGroups(docList(items)).some(g=>g.key===docFilter))docFilter='all';renderBeforeDocs();
  /* The patient's photo at the top right, as on the + forms. */
  if(DOC_VIEWS.includes(view)&&typeof syncFlowProfile==='function'){syncFlowProfile();const fp=$('#flow-profile');if(fp){fp.hidden=false;fp.innerHTML=avatarInner();fp.title='Patient information';fp.setAttribute('aria-label','Patient information')}}};
render();
}
