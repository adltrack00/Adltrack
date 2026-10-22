/* Home: the daily care report. Under the profile picture, three tabs (Previous day, Today, Photos), a small black banner with
   the person's name, the date and Print, then everything done that day as numbered entries in time order. Each entry has a
   subhead saying what happened and its time stamp, then the note written during the task, then the details. A dose says which
   one, as in "Lisinopril 10 mg (8am dose)"; each vital sign is its own entry. Photos shows today's proof photos as one post per
   dose, like Instagram: its 2 or 3 photos swipe side to side, the number from Today sits on the photo's top left, and one
   caption (the medication and its note) sits under it. Tapping a photo opens the post full size, where it swipes too. The
   medication cards are on All medications, in the menu. */
let reportTab='today';
const reportTime=t=>new Date(t).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
const reportDate=day=>C.parseDate(day).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
const onDay=(t,day)=>!!t&&C.iso(new Date(t))===day;
/* A dose time the short way: "08:00" is 8am, "20:30" is 8:30pm. */
const shortClock=t=>{const [h,m]=String(t).split(':').map(Number);return `${h%12||12}${m?':'+String(m).padStart(2,'0'):''}${h<12?'am':'pm'}`};
/* Each vital sign by its full name, and how its reading is written. */
const REPORT_VITALS=[['bp','Blood pressure',x=>x+' mmHg'],['heart','Heart rate',x=>x+' bpm'],['temp','Temperature',x=>x+'°F'],['pain','Pain level',x=>x+' out of 10']];
const REPORT_LOG={'refill-needed':'needs a refill','refill-called':'called for a refill','refill-ready':'refill ready to pick up',refilled:'refill picked up','picked-up':'picked up from the pharmacy'};

/* Everything done on one day, oldest first: doses taken or skipped, vital signs, refill steps, visits and finished medications.
   Each entry: title (the subhead), at (its time), note (written during the task)
   and details; a dose also has its medication's name and photos. Who marked it is left out: the report is already that
   person's. A vital sign shows at the save where it was recorded: the form keeps the last readings, so one saved again
   unchanged the same day isn't listed twice. */
function reportEntries(list=items,day=today(),vitalsLog=settings.vitalsLog||(settings.vitals?[settings.vitals]:[])){const meds=list.filter(i=>i.med),out=[];
for(const i of meds)for(const d of (i.doses||[]).filter(d=>dayOf(d)===day&&d.at&&['taken','skipped'].includes(d.kind)))
out.push({title:`${i.name} (${d.slot?shortClock(d.slot)+' dose':'as-needed dose'})${d.kind==='skipped'?' skipped':''}`,at:d.at,note:d.note||'',details:[i.dose].filter(Boolean),name:i.name,photos:d.photos||[]});
vitalsLog.forEach((v,n)=>{if(!onDay(v.at,day))return;const before=vitalsLog.slice(0,n).reverse().find(x=>onDay(x.at,day))||{};
for(const [k,label,reading] of REPORT_VITALS)if(v[k]&&v[k]!==before[k])out.push({title:`${label}: ${reading(v[k])}`,at:v.at,note:'',details:[]})});
for(const i of meds)for(const l of (i.log||[]).filter(l=>onDay(l.at,day)&&REPORT_LOG[l.kind]))out.push({title:`${i.name}: ${REPORT_LOG[l.kind]}`,at:l.at,note:'',details:[i.pharmacy&&i.pharmacy.name||''].filter(Boolean)});
for(const i of meds.filter(i=>i.status==='received'&&onDay(i.finishedAt,day)))out.push({title:`${i.name} finished`,at:i.finishedAt,note:'',details:['No more reminders for it']});
for(const a of appointments(list).filter(a=>a.status==='received'&&a.date===day))out.push({title:`${a.name}: went`,at:day+'T'+(a.time||'12:00'),note:a.note||'',details:[a.place].filter(Boolean)});
return out.sort((x,y)=>new Date(x.at)-new Date(y.at))}

/* Today's proof photos in the order of Today's entries: one post per dose with photos, with that entry's number, the
   medication, the note and its photos. */
function reportPhotos(list=items,day=today()){return reportEntries(list,day).map((x,n)=>({n:n+1,name:x.name,note:x.note,photos:x.photos||[]})).filter(p=>p.photos.length)}
/* A dot for each photo along the bottom of a post when there's more than one; the one showing is filled. */
const photoDots=(count,on=0)=>count>1?`<div class="post-dots" aria-hidden="true">${Array.from({length:count},(_,i)=>`<i${i===on?' class="on"':''}></i>`).join('')}</div>`:'';

function reportHTML(){const now=today(),day=reportTab==='previous'?C.shift(now,-1):now,who=welcomeName()||'Your care';
const tabs=[['previous','Previous day'],['today','Today'],['photos','Photos']].map(([id,label])=>`<button data-report-tab="${id}" class="${reportTab===id?'active':''}" aria-pressed="${reportTab===id}">${label}</button>`).join('');
const head=`<div class="gallery-filters report-tabs">${tabs}</div>`;
if(reportTab==='photos'){const posts=reportPhotos(items,now);reportPosts=posts;return `<section class="report">${head}${posts.length?`<div class="report-photos">${posts.map((p,k)=>`<figure class="report-post"><div class="post-frame"><div class="post-track">${p.photos.map((src,i)=>`<button class="report-photo-open" data-photo-post="${k}" data-photo-at="${i}" aria-label="View photo ${i+1} of ${p.photos.length} of ${esc(p.name)} full size">${proofImg(src)}</button>`).join('')}</div><span class="post-num">${String(p.n).padStart(2,'0')}</span>${p.photos.length>1?`<span class="post-count">1/${p.photos.length}</span>`:''}${photoDots(p.photos.length)}</div><figcaption><strong>${esc(p.name)}</strong>${p.note?`<p>${esc(p.note)}</p>`:''}</figcaption></figure>`).join('')}</div>`:`<div class="report-empty"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 18 5.5-5.5 4 4 2.5-2.5 4.5 4.5"/></svg><h2>No photos yet</h2><p>Photos added when a dose is taken will appear here.</p></div>`}</section>`}
const entries=reportEntries(items,day),sections=entries.length?entries.map((x,n)=>`<div class="report-section${x.note?' wide':''}"><h3><span>${String(n+1).padStart(2,'0')}</span>${esc(x.title)}<time datetime="${esc(x.at)}">${esc(reportTime(x.at))}</time></h3>${x.note?`<p class="report-note-text">${esc(x.note)}</p>`:''}${x.details.length?`<ul>${x.details.map(l=>`<li>${esc(l)}</li>`).join('')}</ul>`:''}</div>`).join(''):`<div class="report-section wide"><p class="report-none">${day===now?'Nothing done yet today. Everything marked during the day shows here, with its time.':'Nothing was recorded this day.'}</p></div>`;
return `<section class="report">${head}<div class="report-banner"><div><span>DAILY CARE REPORT</span><h2>${esc(who)}</h2><p>${esc(reportDate(day))}</p></div><button id="report-print">Print</button></div><div class="report-grid">${sections}</div></section>`}

document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.reportTab){reportTab=b.dataset.reportTab;render();return}if(b.id==='report-print')window.print();if(b.dataset.photoPost)viewPhotos(reportPosts[b.dataset.photoPost],Number(b.dataset.photoAt))});
let reportPosts=[];
/* Swiping a post moves its dots and its 1/3 count along. */
document.addEventListener('scroll',e=>{const t=e.target;if(!t.classList||!t.classList.contains('post-track')||!t.clientWidth)return;const at=Math.round(t.scrollLeft/t.clientWidth),post=t.closest('.report-post,.photo-view');
post.querySelectorAll('.post-dots i').forEach((d,i)=>d.classList.toggle('on',i===at));const c=post.querySelector('.post-count');if(c)c.textContent=`${at+1}/${t.children.length}`},true);

/* A post full size, over the page, opened at the photo tapped: its photos swipe side to side (or the arrow keys move them).
   The × or a tap on the black around the photo closes it. */
function viewPhotos(post,at=0){if(!post)return;let d=$('#photo-view');if(!d){d=document.createElement('dialog');d.id='photo-view';d.className='photo-view';document.body.append(d);
d.addEventListener('click',e=>{if(!e.target.closest('img'))d.close()});
d.addEventListener('keydown',e=>{const t=d.querySelector('.post-track');if(!t||!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();t.scrollBy({left:(e.key==='ArrowRight'?1:-1)*t.clientWidth,behavior:'smooth'})})}
const n=post.photos.length;d.innerHTML=`<button class="photo-view-x" aria-label="Close">×</button>${n>1?`<span class="post-count">${at+1}/${n}</span>`:''}<div class="post-track">${post.photos.map(src=>`<div class="photo-view-slide">${proofImg(src)}</div>`).join('')}</div>${photoDots(n,at)}`;
d.showModal();const t=d.querySelector('.post-track');t.scrollLeft=at*t.clientWidth}

/* Home is the profile picture, the report and My Tasks. All medications is the gallery on its own, with When to call under it. */
const galleryBeforeReport=gallery;
gallery=function(){const el=document.createElement('div');el.innerHTML=galleryBeforeReport();
if(view==='purchases'){el.querySelectorAll(':scope>.profile-hero,:scope>.home-today,:scope>.tasks-sheet').forEach(n=>n.remove());el.insertAdjacentHTML('afterbegin','<div class="page-heading"><div><h1>All medications.</h1><p>Due today, needs refill and finished.</p></div></div>');el.insertAdjacentHTML('beforeend',`<section class="home-today">${whenToCallHTML()}</section>`);return el.innerHTML}
const hero=el.querySelector(':scope>.profile-hero'),sheet=el.querySelector(':scope>.tasks-sheet');return (hero?hero.outerHTML:'')+reportHTML()+(sheet?sheet.outerHTML:'')};

menuItems.unshift(['purchases','All medications','meds']);
/* History is no longer in the menu; the daily report on Home holds the day's record. */
menuItems.splice(menuItems.findIndex(([v])=>v==='history-log'),1);

/* Only Home has the menu lines. Every other page has a round back button in their place, top left, that goes back one step
   (to Settings or Support from their pages, otherwise Home); the page's own back arrow is hidden, so its picture or title
   moves up to the top. */
function paintMenuButton(){const b=$('#menu-open');if(!b)return;const back=view!=='overview';document.body.classList.toggle('not-home',back);
if(b.classList.contains('is-back')===back)return;b.classList.toggle('is-back',back);b.setAttribute('aria-label',back?'Back':'Open menu');b.toggleAttribute('aria-haspopup',!back);if(!back)b.setAttribute('aria-haspopup','dialog');b.innerHTML=menuIcon(back?menuIcons.back:menuIcons.menu)}
document.addEventListener('click',e=>{if(!e.target.closest('#menu-open.is-back'))return;e.stopPropagation();const own=$('#main .sub-back');go(own&&own.dataset.menuGo||'overview')},true);
const renderBeforeBack=render;
render=function(){const shown=[...document.querySelectorAll('.report-post .post-track')].map(t=>t.clientWidth?Math.round(t.scrollLeft/t.clientWidth):0);renderBeforeBack();paintMenuButton();
/* A post stays on the photo it was swiped to when the page redraws. */
document.querySelectorAll('.report-post .post-track').forEach((t,i)=>{if(shown[i])t.scrollLeft=shown[i]*t.clientWidth})};
render();
