/* Several patients per home: a home or small agency cares for 2 to 10 patients, each with their own medications, daily care
   report, photos and My Tasks (kept apart on the server, see server/team.js). Someone on more than one patient picks one first
   ("Who are you caring for?"), then sees that patient's own Home; the switch under the photo on Home changes patient. Admins
   add, rename and remove patients in Settings → People → Patients. Uses the profile circle, Settings list and form styles. */
let patientId='',patientPhoto;
const several=()=>Account.patients().length>1;
const patientCircle=p=>p.photo?`<img src="${esc(p.photo)}" alt="">`:esc((p.name||'').slice(0,1).toUpperCase());
const teamPatients=()=>team.data?.patients||[];
function caringForPage(){const cur=Account.picked()?Account.patient():null;
return `<section class="sub-page caring-for">${cur?subHeader('Who are you caring for?','overview'):'<div class="sub-top"></div><h1 class="sub-title">Who are you caring for?</h1>'}<div class="patient-grid">${Account.patients().map(p=>`<button class="patient-pick${cur&&cur.id===p.id?' active':''}" data-patient-pick="${esc(p.id)}"${cur&&cur.id===p.id?' aria-current="true"':''}><span class="profile-circle">${patientCircle(p)}</span><span class="patient-name">${esc(p.name)}</span></button>`).join('')}</div></section>`}
function patientsPage(){const d=team.data;if(!d)return `<section class="sub-page prose">${subHeader('Patients','people')}<p class="sub-note">${esc(team.state==='error'?team.error:'Loading…')}</p></section>`;
return `<section class="sub-page settings-page">${subHeader('Patients','people')}<p class="sub-intro">Each patient has their own medications, daily care report, photos and tasks. Choose who each person cares for in People.</p><div class="settings-list">${d.patients.map(p=>`<button class="settings-row person-row patient-row" data-patient="${esc(p.id)}"><span class="patient-line"><span class="profile-circle">${patientCircle(p)}</span><span><strong>${esc(p.name)}</strong>${p.first?'<small>First patient</small>':''}</span></span>${menuIcon(menuIcons.chevron)}</button>`).join('')}</div>${d.patients.length<10?'<button class="primary people-add" data-menu-go="patient-add">Add a patient +</button>':'<p class="sub-note">A care team can have up to 10 patients.</p>'}</section>`}
function patientForm(p){const photo=patientPhoto===undefined?p?.photo||'':patientPhoto||'',shown={name:p?.name||'',photo};
return `<div class="profile-edit"><div class="profile-avatar"><label class="profile-circle" for="patient-photo" tabindex="0" role="button" aria-label="${photo?'Change':'Add'} photo">${patientCircle(shown)}</label><input id="patient-photo" type="file" accept="image/jpeg,image/png,image/webp" hidden>${photo?'<button type="button" class="profile-photo-badge" id="patient-photo-remove" aria-label="Remove photo">×</button>':'<label class="profile-photo-badge" for="patient-photo" aria-hidden="true">+</label>'}</div><p class="sub-note">Tap the photo to add or change it.</p></div><form id="patient-form" class="guided-form"><label>Name<input name="name" maxlength="40" required autocomplete="off" value="${esc(p?.name||'')}" placeholder="Rose"></label><button class="primary">${p?'Save':'Add the patient'}</button></form>`}
function addPatientPage(){return `<section class="sub-page">${subHeader('Add a patient','patients')}<p class="sub-intro">They get their own medications, daily care report, photos and tasks.</p>${patientForm(null)}</section>`}
function patientPage(){const p=teamPatients().find(x=>x.id===patientId);if(!p)return patientsPage();return `<section class="sub-page">${subHeader(esc(p.name),'patients')}${patientForm(p)}${p.first?'':'<button class="danger-button" id="patient-remove">Remove this patient</button>'}</section>`}
Object.assign(menuPages,{'caring-for':caringForPage,patients:patientsPage,patient:patientPage,'patient-add':addPatientPage});
Object.assign(settingsParent,{patients:'settings',patient:'settings','patient-add':'settings'});
menuViews.push('caring-for','patients','patient','patient-add');
const goBeforePatients=go;go=function(v){if(['patients','patient-add'].includes(v)){patientPhoto=undefined;loadTeam()}return goBeforePatients(v)};
const loadTeamBeforePatients=loadTeam;loadTeam=async function(){await loadTeamBeforePatients();if(['patients','patient','patient-add'].includes(view))render()};
/* Someone on several patients picks one before anything else; Home shows whose dashboard it is, with the switch under the photo. */
const renderBeforePatients=render;
render=function(){if(several()&&!Account.picked())view='caring-for';document.body.classList.toggle('picking',view==='caring-for'&&!Account.picked());renderBeforePatients();
const hero=view==='overview'&&several()&&$('#main>.profile-hero'),p=Account.patient();
if(hero&&p&&!hero.querySelector('.patient-switch'))hero.querySelector('.profile-circle')?.insertAdjacentHTML('afterend',`<button class="patient-switch" data-menu-go="caring-for" aria-label="Caring for ${esc(p.name)}. Change patient">${esc(p.name)}${menuIcon('<path d="m7 10 5 5 5-5"/>')}</button>`)};
document.addEventListener('adltrack:me',()=>{if(several()&&(!Account.picked()||view==='overview'&&!$('.patient-switch')))render()});
/* A 256px square, like the profile photo. */
async function squarePhoto(file){if(!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>15000000)throw new Error('Use a JPG, PNG or WebP photo under 15 MB.');const url=URL.createObjectURL(file);try{const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('This photo could not be read. Try another.'));i.src=url});const s=Math.min(img.naturalWidth,img.naturalHeight),c=document.createElement('canvas');c.width=c.height=256;c.getContext('2d').drawImage(img,(img.naturalWidth-s)/2,(img.naturalHeight-s)/2,s,s,0,0,256,256);return c.toDataURL('image/jpeg',.85)}finally{URL.revokeObjectURL(url)}}
/* What's typed stays when the photo changes and the page redraws. */
const keepName=fn=>{const v=$('#patient-form')?.elements.name.value;fn();render();const f=$('#patient-form');if(f&&v!==undefined)f.elements.name.value=v};
document.addEventListener('change',async e=>{if(e.target.id!=='patient-photo'||!e.target.files[0])return;try{const photo=await squarePhoto(e.target.files[0]);keepName(()=>{patientPhoto=photo})}catch(err){toast(err.message)}});
document.addEventListener('keydown',e=>{if(e.target.matches?.('label[for="patient-photo"]')&&['Enter',' '].includes(e.key)){e.preventDefault();$('#patient-photo').click()}});
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;
  if(b.dataset.patientPick){if(Account.picked()&&b.dataset.patientPick===Account.patient()?.id){go('overview');return}b.disabled=true;try{await Account.switchPatient(b.dataset.patientPick)}catch(err){b.disabled=false;toast(err.message)}return}
  if(b.dataset.patient){patientId=b.dataset.patient;patientPhoto=undefined;view='patient';render();window.scrollTo(0,0);return}
  if(b.id==='patient-photo-remove'){keepName(()=>{patientPhoto=null});return}
  const p=teamPatients().find(x=>x.id===patientId);
  if(b.id==='patient-remove'&&p){if(!confirm(`Remove ${p.name}? Their medications, daily care reports and photos are deleted. This can’t be undone.`))return;b.disabled=true;const shown=Account.patient()?.id;try{await Account.api('DELETE',`/api/patients/${p.id}`,{});toast(`${p.name} was removed.`);await Account.refresh();
    // The patient on screen is gone, so this browser shows the first one instead.
    if(p.id===shown){await Account.switchPatient(Account.patients()[0].id);return}go('patients')}catch(err){b.disabled=false;toast(err.message)}}});
document.addEventListener('submit',async e=>{const f=e.target;if(f.id!=='patient-form')return;e.preventDefault();const btn=f.querySelector('button.primary');btn.disabled=true;
  const body={name:f.elements.name.value,...(patientPhoto!==undefined?{photo:patientPhoto}:{})};
  try{if(view==='patient-add'){const r=await Account.api('POST','/api/patients',body);toast(`${r.patient.name} was added.`)}
    else{await Account.api('PUT',`/api/patients/${patientId}`,body);toast('Saved.');
      // The patient on screen: their name and photo are the Home profile, so this browser's copy is fetched again.
      if(patientId===Account.patient()?.id){await Account.refresh();await Account.switchPatient(patientId);return}}
    patientPhoto=undefined;const shown=Account.patient()?.id;await Account.refresh();
    // A second patient doesn't send the admin to the picker: they stay on the one on screen.
    if(!Account.picked()&&shown)Account.pick(shown);go('patients')}
  catch(err){btn.disabled=false;toast(err.message)}});
