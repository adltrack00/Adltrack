/* A caregiver on several families: each family's admin signs them up from their own Settings → People, with that family's
   own role and ticks. They pick who they're caring for first ("Who are you caring for?"), then see that patient's own Home
   and My Tasks; the switch under the photo on Home changes patient. They only ever see the families that signed them up
   (checked on the server, see server/team.js). Uses the profile circle and sub-page styles. */
const several=()=>Account.patients().length>1;
const patientCircle=p=>p.photo?`<img src="${esc(p.photo)}" alt="">`:esc((p.name||'').slice(0,1).toUpperCase());
function caringForPage(){const cur=Account.picked()?Account.patient():null;
return `<section class="sub-page caring-for">${cur?subHeader('Who are you caring for?','overview'):'<div class="sub-top"></div><h1 class="sub-title">Who are you caring for?</h1>'}<div class="patient-grid">${Account.patients().map(p=>`<button class="patient-pick${cur&&cur.id===p.id?' active':''}" data-patient-pick="${esc(p.id)}"${cur&&cur.id===p.id?' aria-current="true"':''}><span class="profile-circle">${patientCircle(p)}</span><span class="patient-name">${esc(p.name)}</span>${p.by&&p.by!==p.name?`<small>${esc(p.by)}’s family</small>`:''}</button>`).join('')}</div></section>`}
Object.assign(menuPages,{'caring-for':caringForPage});
menuViews.push('caring-for');
/* Someone on several families picks one before anything else; Home shows whose dashboard it is, with the switch under the photo. */
const renderBeforePatients=render;
render=function(){if(several()&&!Account.picked())view='caring-for';document.body.classList.toggle('picking',view==='caring-for'&&!Account.picked());renderBeforePatients();
const hero=view==='overview'&&several()&&$('#main>.profile-hero'),p=Account.patient();
if(hero&&p&&!hero.querySelector('.patient-switch'))hero.querySelector('.profile-circle')?.insertAdjacentHTML('afterend',`<button class="patient-switch" data-menu-go="caring-for" aria-label="Caring for ${esc(p.name)}. Change patient">${esc(p.name)}${menuIcon('<path d="m7 10 5 5 5-5"/>')}</button>`)};
document.addEventListener('adltrack:me',()=>{if(several()&&(!Account.picked()||view==='overview'&&!$('.patient-switch')))render()});
document.addEventListener('click',async e=>{const b=e.target.closest('[data-patient-pick]');if(!b)return;
  if(Account.picked()&&b.dataset.patientPick===Account.patient()?.id){go('overview');return}
  b.disabled=true;try{await Account.switchPatient(b.dataset.patientPick)}catch(err){b.disabled=false;toast(err.message)}});
