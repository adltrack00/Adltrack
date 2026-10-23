/* Settings → Plan: this family's plan, for its admins. One plan covers the whole care team; caregivers and family viewers
   never pay. Start the free trial, pay by card (Stripe's own page), change the card or cancel, and see receipts. Uses the
   Settings list, sub-page and button styles. */
let subs={state:'idle',data:null,error:''};
const subsAdmin=()=>(Account.user()?.team?.role||'admin')==='admin';
const subsMoney=(cents,cur)=>new Intl.NumberFormat([],{style:'currency',currency:cur||'usd',minimumFractionDigits:cents%100?2:0}).format(cents/100);
const subsDay=t=>new Date(t).toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'});
const subsDaysLeft=t=>Math.max(0,Math.ceil((Date.parse(t)-Date.now())/864e5));
async function loadSubs(){subs={...subs,state:'loading'};try{subs={state:'done',data:await Account.api('GET','/api/plan'),error:''}}catch(err){subs={state:'error',data:subs.data,error:err.message}}if(view==='subscription')render()}
const SUBS_HELP={solo:'Just you, looking after your own or a loved one’s health',family:'2 to 5 people: add family, caregivers and other admins',team:'6 to 10 people'};
const subsPrice=(t,d)=>`${subsMoney(t.amount,d.currency)} a ${d.interval}`;
function subsStatus(d){const left=d.trialEnds&&subsDaysLeft(d.trialEnds),tier=d.tiers.find(t=>t.id===d.tier);
  if(d.status==='paid')return `${tier?tier.name+' · '+subsPrice(tier,d)+' · ':''}${d.cancelAtEnd?`ends ${subsDay(d.periodEnd)}`:d.trialEnds&&Date.parse(d.trialEnds)>Date.now()?`free until ${subsDay(d.periodEnd)}, then paid by card`:`paid by card, renews ${subsDay(d.periodEnd)}`}`;
  if(d.status==='trial')return `Free trial · ${left} day${left===1?'':'s'} left, until ${subsDay(d.trialEnds)}`;
  if(d.status==='lapsed')return 'Ended · your care team still sees everything, but nobody new can be added';
  return `Not started · ${d.trialDays} days free`}
function subsTierRow(t,d){const current=d.tier===t.id,small=d.people>t.people,note=current?' · Your plan':small?` · Your team has ${d.people} people`:'',inner=`<span><strong>${esc(t.name)}</strong> · ${esc(subsPrice(t,d))}<small>${esc(SUBS_HELP[t.id]||`Up to ${t.people} people`)}${esc(note)}</small></span>`;
  return current||small?`<div class="settings-row person-row">${inner}</div>`:`<button class="settings-row person-row" data-tier="${esc(t.id)}">${inner}${menuIcon(menuIcons.chevron)}</button>`}
function subscriptionPage(){const d=subs.data;if(!d)return `<section class="sub-page prose">${subHeader('Plan','settings')}<p class="sub-note">${esc(subs.state==='error'?subs.error:'Loading…')}</p></section>`;
  return `<section class="sub-page settings-page">${subHeader('Plan','settings')}<p class="sub-intro">One plan covers this family’s whole care team, text invites and alerts included. Caregivers and family viewers never pay.</p><div class="settings-list"><div class="settings-row person-row"><span><strong>Your plan</strong><small>${esc(subsStatus(d))}</small></span></div><div class="settings-row person-row"><span>People on this care team<small>${d.people} ${d.people===1?'person':'people'} · ${d.texts} text${d.texts===1?'':'s'} sent this month, included</small></span></div></div>${d.status==='none'?`<button class="primary people-add" id="plan-trial">Start the ${d.trialDays}-day free trial</button>`:''}<div class="prose"><h2>Plans</h2><p class="sub-intro">${d.status==='paid'?'Tap a plan to switch. Your card is charged or credited the difference.':d.payments?'Tap a plan to pay by card.':'Card payments aren’t set up on this server yet.'}</p></div><div class="settings-list">${d.tiers.map(t=>subsTierRow(t,d)).join('')}</div>${d.card&&d.payments?'<button class="outline-button people-done" id="plan-portal">Change card or cancel</button>':''}<div class="prose"><h2>Receipts</h2></div>${d.receipts.length?`<div class="settings-list">${d.receipts.map(r=>`<a class="settings-row person-row" href="${esc(r.url)}" target="_blank" rel="noopener"><span>${esc(subsDay(r.at))}<small>${esc(subsMoney(r.amount,r.currency))} · Paid</small></span>${menuIcon(menuIcons.chevron)}</a>`).join('')}</div>`:'<p class="sub-note">Receipts show here after each payment.</p>'}</section>`}
Object.assign(menuPages,{subscription:subscriptionPage});
Object.assign(settingsParent,{subscription:'settings'});
menuViews.push('subscription');
const goBeforeSubs=go;go=function(v){if(v==='subscription')loadSubs();return goBeforeSubs(v)};
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b||!(b.dataset.tier||['plan-trial','plan-portal'].includes(b.id)))return;const d=subs.data,t=d?.tiers.find(x=>x.id===b.dataset.tier);
  if(t&&d.status==='paid'&&!confirm(`Switch to ${t.name} at ${subsPrice(t,d)}? Your card is charged or credited the difference.`))return;b.disabled=true;
  try{if(b.id==='plan-trial'){subs={state:'done',data:await Account.api('POST','/api/plan/trial',{}),error:''};toast('Your free trial has started.');render();return}
    if(t&&d.status==='paid'){subs={state:'done',data:await Account.api('POST','/api/plan/change',{tier:t.id}),error:''};toast(`You’re on the ${t.name} plan.`);render();return}
    const r=await Account.api('POST',t?'/api/plan/checkout':'/api/plan/portal',t?{tier:t.id}:{});location.href=r.url}
  catch(err){b.disabled=false;toast(err.message)}});
/* Back from Stripe: a finished payment is checked on the server, then the plan shows. */
(()=>{const q=new URLSearchParams(location.search),back=q.get('plan');if(!back||!Account.user())return;history.replaceState(null,'',location.pathname);view='subscription';
  if(back==='paid'&&q.get('session'))Account.api('POST','/api/plan/confirm',{session:q.get('session')}).then(d=>{subs={state:'done',data:d,error:''};render();toast('Thank you. Your plan is paid.')},err=>{toast(err.message);loadSubs()});
  else{loadSubs();if(back==='cancelled')toast('Nothing was charged.')}})();
