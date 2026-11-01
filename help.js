/* Help on every working section: a small round chat button floats at the bottom right. Tapping it opens a pop-up the size
   of the medication photo pop-up in My Tasks (meds.js medZoom: dark backdrop, a 12px margin, rounded corners, the white × at
   the top right) that says what this section is, how it works and how to use it. It reads the section from the page that's
   open; pages without their own help (privacy, terms, Support's own help) don't show the button. On Home it sits just above
   the small My Tasks sheet so it never covers the +. */
const helpTopics={
  home:{title:'Home',intro:'The daily care report: everything done for the patient today, in order, under the name of the person who did it.',steps:[
    ['Today','Every dose, task, vital sign and note, numbered with its time. It fills in by itself as tasks are done in My Tasks.'],
    ['Previous day','Yesterday’s report. Any other day is on Your schedule in the menu.'],
    ['Photos','Every photo taken with a task, numbered to match the report.'],
    ['The patient’s photo','Tap it to open the patient’s information and the For EMS sheet.'],
    ['Print','Prints the report, or saves it as a PDF.'],
    ['My Tasks','At the bottom. Pull it up, or tap it, to see what’s due today and mark it done.']]},
  tasks:{title:'My Tasks',intro:'Everything due today, at its time: medications, tasks and appointments. Whatever you mark here goes into the daily care report.',steps:[
    ['Vital signs','Tap Blood pressure, Heart, Temp or Pain to add a reading. Take a photo of the monitor and the numbers fill in, or type them.'],
    ['The line','Shows how many are done today, like 5/8.'],
    ['Do a task','Tap it, add a note and live photos if you like, then tap Done or Skipped. Done tasks are crossed off with their photo.'],
    ['Need help','On a medication, it shows who to call and the warning signs from the papers.'],
    ['The +','At the top right: something done now, an incident or symptoms.'],
    ['Back to the report','Pull My Tasks down, or tap the little arrow at the top.']]},
  take:{title:'Doing a task',intro:'Everything about this one task or dose, and the buttons to mark it.',steps:[
    ['The picture','Tap it to see it large, to check you have the right one.'],
    ['How to take it','Copied word for word from the papers and the label, with the prescribing doctor.'],
    ['Photos and a note','Optional. Up to 3 live photos and a few words on how it went.'],
    ['Done or Skipped','Saves it with the time and your name, and it goes into the daily care report. A skipped dose is only recorded, never moved or doubled.'],
    ['Need help','Shows who to call and the warning signs. In an emergency, call 911.']]},
  plus:{title:'Add to My Tasks',intro:'For what is happening right now. It goes straight into today’s report.',steps:[
    ['New task','Something done now that wasn’t planned, with a note and photos.'],
    ['Report an incident','A fall or anything that went wrong: what happened, who saw it, and photos. Everyone on the care team is told straight away.'],
    ['Symptoms','How the patient feels, with photos if they help.'],
    ['Planning ahead?','Tasks for later go in Planned tasks, and visits in Appointments, both in the menu.']]},
  scan:{title:'Scan',intro:'Turn papers and bottles into the care plan, using the camera.',steps:[
    ['Scan discharge papers','Lay each page flat inside the corners and take the picture. Tap Read when every page is in. The papers are filed in Documents.'],
    ['Scan medications','The pharmacy paper or the bottle label. Adltrack reads the name, how to take it, the pharmacy and the doctor.'],
    ['Confirm','Check each medication against the bottle, then confirm. Nothing is reminded until you do.'],
    ['Scan a document','Any other paper, like an insurance card or a lab result, straight into Documents.']]},
  confirm:{title:'Confirm',intro:'Check what was read before it goes on the schedule.',steps:[
    ['Check every line','The name, the strength and how to take it, against the bottle in your hand.'],
    ['Fix anything','Type over anything that was read wrong. If you can’t read the label, call the pharmacy.'],
    ['Pick the times','Choose when each dose is given.'],
    ['Confirm','Tick that you checked it, then confirm. Only then does it show in My Tasks with reminders.']]},
  medications:{title:'Medications',intro:'Every medication, the refills coming up and the pharmacies.',steps:[
    ['Add a medication','Scan the pharmacy paper or the bottle, or type it in with a photo of what it looks like.'],
    ['All medications','The ones being taken (Open) and the Finished ones. Tap one for its page.'],
    ['Your refills','What needs a refill, step by step: call, wait, pick up.'],
    ['My pharmacies','Every pharmacy with its medications. Fix a phone number once and every medication uses it.']]},
  purchases:{title:'All medications',intro:'Every medication on the care plan.',steps:[
    ['Open','The ones being taken now.'],
    ['Finished','The ones that are done. They come off My Tasks and the reminders.'],
    ['Tap a medication','Its page shows everything about it, with Needs refill, Finished and Delete this medication.'],
    ['Needs refill','Adltrack reminds you to call the pharmacy or the doctor.']]},
  wallet:{title:'Your refills',intro:'Refills, one step at a time.',steps:[
    ['Needs refill','Call the pharmacy, or the doctor for a new prescription. A week before a medication runs out, Adltrack reminds you.'],
    ['Waiting at the pharmacy','You called. Mark it picked up when you have it.'],
    ['Open','Tap Open on a medication to see its next step and the number to call.']]},
  contacts:{title:'Doctors and pharmacies',intro:'Every doctor and pharmacy from the papers and the labels, once each, with the medications they’re on.',steps:[
    ['Tap a name','To see its medications, phone number and address.'],
    ['Fix a number','Change it once and every one of its medications uses it.']]},
  appointments:{title:'Appointments',intro:'Every doctor’s visit in one place.',steps:[
    ['Add an appointment','The doctor, the date and the time. Follow-up visits on the discharge papers show up here by themselves.'],
    ['On the day','It’s in My Tasks, and the reminders come before it.'],
    ['Tap an appointment','To see when and where, call to book it, get directions and tick off each step.'],
    ['My doctors','Every doctor with their phone number.']]},
  planned:{title:'Planned tasks',intro:'Care tasks set for a day and a time, once or repeating.',steps:[
    ['Add a planned task','What to do, a note, the date and time, and how often: once, every day, chosen days or every week.'],
    ['On its days','It shows in My Tasks at its time.'],
    ['Once it’s done','It’s crossed off in My Tasks and goes into the daily care report.'],
    ['Tap a task','To see when it repeats and how often it was done, or to remove it.']]},
  documents:{title:'Documents',intro:'Every paper about the patient, sorted so it’s easy to find.',steps:[
    ['Add a document','Take a photo or pick a file, give it a name and a category, like Insurance or Lab results.'],
    ['Discharge papers','The ones you scan show up here on their own.'],
    ['Tap a document','To open it full size.']]},
  calendar:{title:'Your schedule',intro:'The month at a glance: doses, tasks, visits and refills.',steps:[
    ['A past day','Tap it to read that day’s report. If several people wrote one, pick whose.'],
    ['A future day','Tap it to see that day’s My Tasks.'],
    ['Today','Jumps back to this month. The arrows go to the month before or after.']]},
  settings:{title:'Settings',intro:'The care team and your account.',steps:[
    ['People','The admin adds family and caregivers by email and phone, and chooses what each one can do.'],
    ['Plan','Your subscription.'],
    ['My profile','Your name and photo.'],
    ['Reminders','When reminders come, and turning on phone notifications.'],
    ['Support','How Adltrack works, When to call, and questions.']]},
  people:{title:'People',intro:'Everyone on the care team for this patient.',steps:[
    ['Add a person','Their name, email and phone. They get an invite by text.'],
    ['What they can do','Pick it for each person: My Tasks, scanning, changing medications, adding tasks. Anyone without My Tasks can see everything but not change it.'],
    ['Admins','Can add people and change what each one can do.']]},
  reminders:{title:'Reminders',intro:'How Adltrack reminds the care team.',steps:[
    ['Dose reminders','Go out at each dose time you confirmed.'],
    ['Daily reminder','One a day, at the time you pick, for refills and visits.'],
    ['When the app is closed','Tick it and allow notifications, so reminders come to the phone. Taken, Skipped and Snooze work right on the notification.']]},
  photos:{title:'Photos',intro:'Every photo taken with a task today, newest last.',steps:[
    ['Numbers','Each photo carries the number of its line in the report.'],
    ['Several photos','Swipe sideways to see them all.'],
    ['Tap a photo','To see it large.']]},
  info:{title:'Patient information',intro:'Everything about the patient in one place.',steps:[
    ['About','Name, allergies, conditions, walking, diet, who to call and more. Tap Edit to change it.'],
    ['For EMS','A one-page sheet for paramedics. Print it, save it as a PDF, or let them scan its code.']]}
};
const helpViews={take:'take',plus:'plus','activity-new':'plus','incident-new':'plus','symptom-new':'plus','task-new':'planned','planned-tasks':'planned','planned-task':'planned',
  scan:'scan',upload:'scan',review:'confirm',medications:'medications','med-add':'medications',purchases:'purchases',wallet:'wallet',
  pharmacies:'contacts',doctors:'contacts','care-contacts':'contacts',appointments:'appointments','appt-new':'appointments',
  documents:'documents',document:'documents','document-add':'documents',calendar:'calendar',settings:'settings',people:'people',person:'people',
  'person-add':'people',reminders:'reminders','patient-info':'info','ems-sheet':'info'};
function helpKey(){if(view==='plan'){const i=typeof selected!=='undefined'&&find(selected);return i&&i.appt?'appointments':'purchases'}if(view==='overview')return tasksOpen?'tasks':reportTab==='photos'?'photos':'home';return helpViews[view]||''}
const HELP_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-11.6 7.1L4 20l1.3-4A8 8 0 1 1 20 11.5z"/><path d="M10 9.4a2.1 2.1 0 1 1 3 1.9c-.6.3-1 .8-1 1.5v.4"/><circle cx="12" cy="15.6" r=".4" fill="currentColor"/></svg>';
function helpFab(){let b=document.getElementById('help-fab');if(!b){b=document.createElement('button');b.id='help-fab';b.className='help-fab';b.type='button';b.innerHTML=HELP_ICON;document.body.appendChild(b)}return b}
/* Shown only where there's help; on Home lifted above the small My Tasks sheet, so the + stays free. */
function placeHelp(){const b=helpFab(),k=helpKey(),t=helpTopics[k];b.hidden=!t||!!document.querySelector('.med-zoom,.help-pop');if(t)b.setAttribute('aria-label',`How ${t.title} works`);
  const s=document.getElementById('tasks-sheet');let bottom=s&&!tasksOpen&&view==='overview'?Math.round(s.getBoundingClientRect().height)+14:0;if(t)bottom=clearOfControls(bottom);b.style.bottom=bottom?bottom+'px':''}
/* If it would sit on a button or a box (like Done, Skipped, Need help at the foot of a task), it steps up above it until the
   page scrolls on. Whole-width cards don't count: the list scrolls under it like any floating button. Worked out from where it
   will rest, not where it is while it glides. */
function clearOfControls(bottom){const controls=[...document.querySelectorAll('#main button,#main a,#main input,#main textarea,#main select,#tasks-sheet button,#tasks-sheet input,#tasks-sheet textarea')].filter(el=>el.offsetParent&&getComputedStyle(el).visibility!=='hidden').map(el=>el.getBoundingClientRect()).filter(q=>q.width&&q.width<innerWidth*.6&&q.height<120);
  for(let n=0;n<4;n++){const b=bottom||18,r={right:innerWidth-16,left:innerWidth-68,bottom:innerHeight-b,top:innerHeight-b-52},hit=controls.find(q=>q.left<r.right+6&&q.right>r.left-6&&q.top<r.bottom+6&&q.bottom>r.top-6);
    if(!hit||hit.top<innerHeight*.45)return bottom;bottom=Math.round(innerHeight-hit.top+12)}return bottom}
let helpScroll=0;document.addEventListener('scroll',()=>{clearTimeout(helpScroll);helpScroll=setTimeout(placeHelp,140)},true);
function openHelp(){const t=helpTopics[helpKey()];if(!t)return;closeHelp();const box=document.createElement('div');box.className='help-pop';box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-labelledby','help-pop-title');
  box.innerHTML=`<div class="help-pop-card" tabindex="-1"><button class="med-zoom-x help-pop-x" aria-label="Close">×</button><div class="help-pop-body"><span class="help-pop-eyebrow">How it works</span><h2 id="help-pop-title">${t.title}</h2><p class="help-pop-intro">${t.intro}</p><ol class="help-pop-steps">${t.steps.map(([h,p])=>`<li><strong>${h}</strong><span>${p}</span></li>`).join('')}</ol><p class="help-pop-note">Adltrack doesn’t give medical advice. For anything about a medication, call the doctor or the pharmacist. In an emergency, call 911.</p><button class="primary help-pop-done">Got it</button></div></div>`;
  document.body.appendChild(box);document.body.classList.add('help-open');box.querySelector('.help-pop-card').focus();placeHelp()}
function closeHelp(){const p=document.querySelector('.help-pop');if(!p)return;p.remove();document.body.classList.remove('help-open');placeHelp();document.getElementById('help-fab')?.focus({preventScroll:true})}
document.addEventListener('click',e=>{if(e.target.closest('#help-fab')){openHelp();return}if(e.target.closest('.help-pop-x,.help-pop-done')||e.target.classList.contains('help-pop'))closeHelp()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.querySelector('.help-pop'))closeHelp()});
/* Keep it in step with the page: every render, the report tabs, the My Tasks sheet and the photo pop-up. */
let helpQueued=false;new MutationObserver(()=>{if(helpQueued)return;helpQueued=true;requestAnimationFrame(()=>{helpQueued=false;placeHelp()})}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
window.addEventListener('resize',placeHelp);document.addEventListener('transitionend',e=>{if(e.target.id==='tasks-sheet')placeHelp()});placeHelp();
