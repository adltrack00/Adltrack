/* Patient information: tapping the patient's photo anywhere opens one page with everything about them, saved with the
   family's Home profile (profile.info), so the whole care team sees the same page. Admins and people who may change
   medications edit each card in place; the server checks it too (server/permissions.js, profile changes need meds).
   "For EMS" at the top opens a one-page sheet for paramedics: print it, save it as a PDF, or let them scan its code, which
   holds the sheet's text itself, so nothing about the patient is put on a public link. Uses the sub-page and the plus list's
   white rounded cards. */
const CODE_NAMES={full:'Full code',dnr:'DNR (do not resuscitate)',dni:'DNI (do not intubate)','dnr-dni':'DNR and DNI',comfort:'Comfort care only'};
const MOBILITY_NAMES={own:'Walks on their own',cane:'Uses a cane',walker:'Uses a walker',wheelchair:'Uses a wheelchair',bed:'Bed bound'};
const FALL_NAMES={high:'High fall risk',low:'Not a fall risk'};
const SEX_NAMES={female:'Female',male:'Male',other:'Other'};
/* Each card and its fields. lines = one per line, so a line is added or taken out by typing or deleting it. */
const INFO_CARDS=[
  {key:'about',title:'About',fields:[['name','Full name','text'],['preferred','Goes by','text','For example: Rosie'],['dob','Date of birth','date'],['sex','Sex','choice',SEX_NAMES],['language','Language spoken','text','For example: English, Spanish'],['height','Height','text','For example: 5 ft 4 in'],['weight','Weight','text','For example: 150 lb']]},
  {key:'code',title:'Code status',fields:[['code','Code status','choice',CODE_NAMES],['directive','Where the DNR, POLST or living will is kept','text','For example: on the fridge door'],['proxy','Health care proxy or power of attorney','text','Name and phone']]},
  {key:'allergies',title:'Allergies',fields:[['allergies','Allergies and the reaction','lines','One per line. For example: Penicillin, rash. Or: No known allergies']]},
  {key:'conditions',title:'Conditions',fields:[['conditions','Medical conditions','lines','One per line. For example: Type 2 diabetes'],['reason','Why they were in the hospital','text'],['hospital','Hospital','text'],['discharged','Discharged on','date']]},
  {key:'mobility',title:'Mobility and safety',fields:[['mobility','Walking','choice',MOBILITY_NAMES],['assist','Help they need','text','For example: 1 person to stand up'],['fall','Fall risk','choice',FALL_NAMES],['equipment','Equipment and devices','lines','One per line. For example: Oxygen 2 L, pacemaker, catheter']]},
  {key:'senses',title:'Seeing, hearing and memory',fields:[['aids','Glasses, hearing aids, dentures','lines','One per line'],['memory','Memory and thinking','text','For example: dementia, confused at night'],['talk','Communication','text','For example: hard of hearing on the left']]},
  {key:'food',title:'Eating and drinking',fields:[['diet','Diet','text','For example: diabetic, low salt'],['swallow','Swallowing','text','For example: thickened liquids, pills crushed']]},
  {key:'history',title:'Medical history',fields:[['history','Surgeries, hospital stays and past illnesses','lines','One per line. For example: Hip replacement, 2019']]},
  {key:'doctor',title:'Doctor and hospital',fields:[['doctor','Primary doctor','text'],['doctorPhone','Doctor’s phone','tel'],['prefHospital','Preferred hospital','text']]},
  {key:'contacts',title:'Emergency contacts',fields:[['contacts','Name, relationship and phone','lines','One per line. For example: Ana Diaz, daughter, (555) 201-3344']]},
  {key:'notes',title:'Other things to know',fields:[['notes','For EMS and new caregivers','lines','One per line. For example: Key under the mat, dog in the house']]}];
const infoOf=p=>p&&p.info&&typeof p.info==='object'?p.info:{};
const infoLines=v=>(Array.isArray(v)?v:String(v||'').split('\n')).map(s=>String(s).trim()).filter(Boolean);
/* Whole years on that day, or '' when the birthday isn't a real date or is in the future. */
function ageOn(dob,day){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(dob||''),d=/^(\d{4})-(\d{2})-(\d{2})$/.exec(day||'');if(!m||!d)return '';let a=d[1]-m[1];if(d[2]+d[3]<m[2]+m[3])a--;return a>=0&&a<130?a:''}
const longDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')?new Date(d+'T12:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}):'';
/* What a field shows: the choice's words, the date written out, the lines as they are. */
function infoValue(info,[k,,type,names]){const v=info[k];if(type==='lines')return infoLines(v);if(type==='choice')return names[v]||'';if(type==='date')return longDate(v);return String(v||'').trim()}
/* The medications still being taken, as EMS reads them: name, how it's taken, and at what times. Examples are left out. */
function infoMeds(list){return list.filter(i=>i&&i.med&&!i.demo&&i.status!=='received').map(i=>({name:i.name,how:i.instructions||[i.dose,i.route,i.frequency].filter(Boolean).join(', '),times:i.asNeeded?['As needed']:[...(i.times||[])].sort(),unconfirmed:i.status==='kept'}))}
/* The EMS sheet as plain text, for its code: any phone camera shows it, no app or internet needed. */
function emsText(info,meds,{name='',day='',time=t=>t}={}){const v=f=>infoValue(info,f),F=Object.fromEntries(INFO_CARDS.flatMap(c=>c.fields).map(f=>[f[0],f])),line=(label,k)=>{const x=v(F[k]);return (Array.isArray(x)?x.length:x)?`${label}: ${Array.isArray(x)?x.join('; '):x}`:''};
const age=ageOn(info.dob,day);
return ['PATIENT INFORMATION FOR EMS',`Name: ${info.name||name||'Not added'}${info.preferred?` (goes by ${info.preferred})`:''}`,info.dob?`Born: ${longDate(info.dob)}${age!==''?`, age ${age}`:''}`:'',line('Sex','sex'),line('Language','language'),
`CODE STATUS: ${v(F.code)||'Not added'}`,line('Papers kept','directive'),line('Health care proxy','proxy'),
`ALLERGIES: ${v(F.allergies).join('; ')||'Not added'}`,line('Conditions','conditions'),line('In the hospital for','reason'),line('Hospital','hospital'),line('Discharged','discharged'),
meds.length?'MEDICATIONS:\n'+meds.map(m=>`- ${m.name}${m.how?', '+m.how:''}${m.times.length?' at '+m.times.map(t=>/^\d\d:\d\d$/.test(t)?time(t):t).join(', '):''}${m.unconfirmed?' (not confirmed yet)':''}`).join('\n'):'',
line('Walking','mobility'),line('Help needed','assist'),line('Fall risk','fall'),line('Equipment','equipment'),line('Aids','aids'),line('Memory','memory'),line('Communication','talk'),line('Diet','diet'),line('Swallowing','swallow'),
line('History','history'),line('Doctor','doctor'),line('Doctor phone','doctorPhone'),line('Preferred hospital','prefHospital'),line('Emergency contacts','contacts'),line('Notes','notes'),
info.updatedAt?`Updated ${longDate(String(info.updatedAt).slice(0,10))}`:''].filter(Boolean).join('\n')}
if(typeof module!=='undefined')module.exports={INFO_CARDS,ageOn,infoLines,infoValue,infoMeds,emsText};

if(typeof document!=='undefined'){
let infoEdit='';
const patientName=()=>infoOf(profile).name||(profile.name&&profile.name.toLowerCase()!=='you'?profile.name:'')||(typeof Account!=='undefined'&&Account.patient()?.name)||'';
const infoAge=()=>{const a=ageOn(infoOf(profile).dob,today());return a===''?'':`${a} years old`};
const phoneLinks=s=>esc(s).replace(/\(?\+?\d[\d\s().-]{6,}\d/g,p=>`<a class="flow-text-link" href="tel:${p.replace(/[^\d+]/g,'')}">${p}</a>`);
function infoTop(){const info=infoOf(profile),bits=[infoAge(),info.dob?'Born '+longDate(info.dob):''].filter(Boolean).join(' · ');return `<div class="info-top"><div class="profile-circle">${avatarInner()}</div><h1 class="sub-title">${esc(patientName()||'Patient information')}</h1><p>${esc(bits||'Patient information')}</p></div>`}
function infoField(info,f){const [k,label,type]=f,v=infoValue(info,f),empty=Array.isArray(v)?!v.length:!v;return `<div class="info-row"><dt>${esc(label)}</dt><dd class="${empty?'is-empty':''}">${empty?'Not added yet':Array.isArray(v)?`<ul>${v.map(x=>`<li>${k==='contacts'?phoneLinks(x):esc(x)}</li>`).join('')}</ul>`:type==='tel'?telLink('',v):k==='dob'&&infoAge()?`${esc(v)} <span class="info-age">(${esc(infoAge())})</span>`:esc(v)}</dd></div>`}
function infoInput(info,[k,label,type,extra]){const v=info[k];if(type==='choice')return `<label>${esc(label)}<select name="${k}"><option value="">Not added</option>${Object.entries(extra).map(([val,name])=>`<option value="${val}"${v===val?' selected':''}>${esc(name)}</option>`).join('')}</select></label>`;
if(type==='lines')return `<label>${esc(label)}<textarea name="${k}" rows="${Math.max(3,infoLines(v).length+1)}" maxlength="2000" placeholder="${esc(extra||'')}">${esc(infoLines(v).join('\n'))}</textarea></label>`;
return `<label>${esc(label)}<input name="${k}" type="${type==='tel'?'tel':type==='date'?'date':'text'}" maxlength="${type==='tel'?30:200}" value="${esc(v||'')}"${extra?` placeholder="${esc(extra)}"`:''}${k==='dob'?` max="${today()}"`:''}></label>`}
function infoCard(c){const info=infoOf(profile),edit=mayDo('meds');
if(infoEdit===c.key)return `<section class="info-card is-editing" id="info-${c.key}"><form id="info-form" class="guided-form" data-info="${c.key}"><h2>${esc(c.title)}</h2>${c.fields.map(f=>infoInput(info,f)).join('')}<div class="info-actions"><button type="button" class="outline-button" data-info-cancel>Cancel</button><button class="primary">Save</button></div></form></section>`;
return `<section class="info-card" id="info-${c.key}"><div class="info-head"><h2>${esc(c.title)}</h2>${edit?`<button class="info-edit" data-info-edit="${c.key}" aria-label="Edit ${esc(c.title)}">Edit</button>`:''}</div><dl>${c.fields.map(f=>infoField(info,f)).join('')}</dl></section>`}
function infoMedsCard(){const meds=infoMeds(items);return `<section class="info-card"><div class="info-head"><h2>Medications</h2><button class="info-edit" data-menu-go="purchases">All medications</button></div>${meds.length?`<ul class="info-meds">${meds.map(m=>`<li><strong>${esc(m.name)}</strong><small>${esc([m.how,m.times.map(t=>/^\d\d:\d\d$/.test(t)?clockText(t):t).join(', '),m.unconfirmed?'Not confirmed yet':''].filter(Boolean).join(' · '))}</small></li>`).join('')}</ul>`:'<p class="info-none">None yet. They show up here after the discharge papers or a label are scanned and confirmed.</p>'}</section>`}
function patientInfoPage(){const cards=INFO_CARDS.map(infoCard);cards.splice(4,0,infoMedsCard());
return `<section class="sub-page info-page"><div class="sub-top"><button class="sub-back" data-menu-go="overview" aria-label="Back">${menuIcon(menuIcons.back)}</button></div>${infoTop()}<section class="info-card info-ems"><div><h2>For EMS</h2><p>Show this to paramedics, print it or save it as a PDF, or let them scan its code.</p></div><button class="primary" data-menu-go="ems-sheet">Open the EMS sheet</button></section>${cards.join('')}${mayDo('meds')?'':'<p class="sub-note">Only admins and people who can change medications can edit this page.</p>'}</section>`}
/* The code holds the sheet's text; a very long sheet is cut, and the printed sheet has the rest. */
function emsCode(text){if(typeof qrcode!=='function')return '';for(const t of [text,text.slice(0,1800)+'\n(More on the printed sheet)']){try{const q=qrcode(0,'L');q.addData(t,'Byte');q.make();return q.createSvgTag({cellSize:4,margin:2,scalable:true,alt:'Code with this sheet’s information'})}catch{}}return ''}
function emsSheetPage(){const info=infoOf(profile),meds=infoMeds(items),v=k=>{const f=INFO_CARDS.flatMap(c=>c.fields).find(f=>f[0]===k);return infoValue(info,f)},show=x=>Array.isArray(x)?x.map(esc).join('<br>'):esc(x),
row=(label,k)=>{const x=v(k);return (Array.isArray(x)?x.length:x)?`<div class="ems-row"><dt>${label}</dt><dd>${k==='contacts'?x.map(phoneLinks).join('<br>'):show(x)}</dd></div>`:''},
text=emsText(info,meds,{name:patientName(),day:today(),time:clockText}),code=emsCode(text);
return `<section class="sub-page ems-page">${subHeader('For EMS','patient-info')}<article class="ems-sheet"><header class="ems-head"><div><span class="ems-eyebrow">Patient information for EMS</span><h2>${esc(patientName()||'Name not added')}</h2><p>${esc([info.dob?'Born '+longDate(info.dob):'',infoAge(),v('sex'),v('language')].filter(Boolean).join(' · '))}</p></div>${code?`<div class="ems-code">${code}<small>Scan for this sheet</small></div>`:''}</header>
<div class="ems-alerts"><div class="ems-alert"><span>Code status</span><strong>${esc(v('code')||'Not added')}</strong>${info.directive?`<small>Papers: ${esc(info.directive)}</small>`:''}</div><div class="ems-alert"><span>Allergies</span><strong>${v('allergies').length?v('allergies').map(esc).join('<br>'):'Not added'}</strong></div></div>
<dl class="ems-list">${row('Conditions','conditions')}${row('In the hospital for','reason')}${row('Hospital','hospital')}${row('Discharged','discharged')}
${meds.length?`<div class="ems-row"><dt>Medications</dt><dd>${meds.map(m=>`${esc(m.name)}${m.how?', '+esc(m.how):''}${m.times.length?' · '+esc(m.times.map(t=>/^\d\d:\d\d$/.test(t)?clockText(t):t).join(', ')):''}${m.unconfirmed?' · not confirmed yet':''}`).join('<br>')}</dd></div>`:''}
${row('Walking','mobility')}${row('Help needed','assist')}${row('Fall risk','fall')}${row('Equipment','equipment')}${row('Glasses, hearing aids, dentures','aids')}${row('Memory','memory')}${row('Communication','talk')}${row('Diet','diet')}${row('Swallowing','swallow')}${row('Medical history','history')}${row('Primary doctor','doctor')}${row('Doctor’s phone','doctorPhone')}${row('Preferred hospital','prefHospital')}${row('Health care proxy','proxy')}${row('Emergency contacts','contacts')}${row('Other things to know','notes')}</dl>
<p class="ems-foot">${info.updatedAt?`Updated ${esc(longDate(String(info.updatedAt).slice(0,10)))}. `:''}From the family’s Adltrack care plan. Confirm with the medication bottles.</p></article><button class="primary" id="ems-print">Print or save as PDF</button></section>`}
Object.assign(menuPages,{'patient-info':patientInfoPage,'ems-sheet':emsSheetPage});
menuViews.push('patient-info','ems-sheet');

/* The patient's photo opens this page: on Home, at the top right of the scan and confirm steps, and on every page header. */
const PHOTO_SPOTS='#main>.profile-hero .profile-circle,#flow-profile,.profile-hero-compact .profile-circle';
document.addEventListener('click',e=>{if(!e.target.closest(PHOTO_SPOTS))return;e.preventDefault();e.stopImmediatePropagation();infoEdit='';go('patient-info')},true);
document.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)&&e.target.matches?.('#main>.profile-hero div.profile-circle')){e.preventDefault();go('patient-info')}});
document.addEventListener('click',e=>{const b=e.target.closest('[data-info-edit],[data-info-cancel],#ems-print');if(!b)return;
  if(b.id==='ems-print'){window.print();return}
  infoEdit=b.dataset.infoEdit||'';const at=b.dataset.infoEdit||b.closest('form')?.dataset.info;render();const card=at&&$('#info-'+at);if(card){card.scrollIntoView({block:'nearest'});if(infoEdit)card.querySelector('input,select,textarea')?.focus()}});
document.addEventListener('submit',e=>{if(e.target.id!=='info-form')return;e.preventDefault();if(!mayDo('meds'))return;const c=INFO_CARDS.find(c=>c.key===e.target.dataset.info);if(!c)return;
  const next={...infoOf(profile)};for(const [k,,type] of c.fields){const raw=e.target.elements[k].value;if(type==='lines'){const l=infoLines(raw).map(s=>s.slice(0,200)).slice(0,40);if(l.length)next[k]=l;else delete next[k]}else{const s=raw.trim();if(s)next[k]=s;else delete next[k]}}
  next.updatedAt=new Date().toISOString();const before=profile.info;profile.info=next;if(!saveProfile()){profile.info=before;toast('Browser storage is unavailable.');return}infoEdit='';render();$('#info-'+c.key)?.scrollIntoView({block:'nearest'});toast(`${c.title} saved.`)});
const renderBeforeInfo=render;
render=function(){if(view!=='patient-info')infoEdit='';document.body.classList.toggle('ems-printing',view==='ems-sheet');renderBeforeInfo();
  const home=$('#main>.profile-hero:not(.profile-hero-compact) div.profile-circle');if(home){home.setAttribute('role','button');home.tabIndex=0;home.setAttribute('aria-label','Patient information')}
  const fp=$('#flow-profile');if(fp){fp.title='Patient information';fp.setAttribute('aria-label','Patient information')}};
render();
}
