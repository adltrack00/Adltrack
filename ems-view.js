/* ems.html: unpacks the sheet's text from the link after # (ems-code.js) and lays it out as the For EMS sheet. Nothing is
   loaded from a server: what shows here is only what was printed in the code. */
(async()=>{const main=document.getElementById('ems-view'),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]),
tel=s=>esc(s).replace(/\(?\+?\d[\d\s().-]{6,}\d/g,p=>`<a href="tel:${p.replace(/[^\d+]/g,'')}">${p}</a>`),
text=await emsUnpack(location.hash);
if(!text){main.innerHTML='<span class="ems-view-brand">Adltrack</span><p class="ems-view-note">This link doesn’t hold a patient sheet. Scan the code on the printed For EMS sheet again.</p>';return}
const lines=text.split('\n'),rows=[],alerts={},top={};let meds=null,foot='',more='';
for(const l of lines.slice(1)){
  if(meds&&l.startsWith('- ')){meds.push(l.slice(2));continue}
  if(l==='MEDICATIONS:'){meds=[];rows.push(['Medications',meds]);continue}
  if(/^Updated /.test(l)){foot=l;continue}
  if(/^\(More on/.test(l)){more=l.slice(1,-1);continue}
  const m=/^([^:]+):\s(.*)$/.exec(l);if(!m)continue;const [,k,v]=m;
  if(k==='CODE STATUS'||k==='ALLERGIES')alerts[k]=v;else if(['Name','Born','Sex','Language'].includes(k))top[k]=v;else if(k==='Papers kept')alerts.papers=v;else rows.push([k,v])}
const sub=[top.Born?'Born '+top.Born:'',top.Sex,top.Language].filter(Boolean).join(' · ');
document.title=(top.Name||'Patient')+' — patient information';
main.innerHTML=`<span class="ems-view-brand">Adltrack</span><article class="ems-sheet"><header class="ems-head"><div><span class="ems-eyebrow">${esc(lines[0]||'Patient information')}</span><h2>${esc(top.Name||'Name not added')}</h2><p>${esc(sub)}</p></div></header>
<div class="ems-alerts"><div class="ems-alert"><span>Code status</span><strong>${esc(alerts['CODE STATUS']||'Not added')}</strong>${alerts.papers?`<small>Papers: ${esc(alerts.papers)}</small>`:''}</div><div class="ems-alert"><span>Allergies</span><strong>${(alerts.ALLERGIES||'Not added').split('; ').map(esc).join('<br>')}</strong></div></div>
<dl class="ems-list">${rows.map(([k,v])=>`<div class="ems-row"><dt>${esc(k)}</dt><dd>${(Array.isArray(v)?v:v.split('; ')).map(/contact|phone/i.test(k)?tel:esc).join('<br>')}</dd></div>`).join('')}</dl>
<p class="ems-foot">${foot?esc(foot)+'. ':''}${more?esc(more)+'. ':''}From the family’s Adltrack care plan. Confirm with the medication bottles.</p></article>
<p class="ems-view-note">This sheet was read from the code itself. Nothing about the patient is stored on this page or online.</p>`})();
