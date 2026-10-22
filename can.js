/* Permissions on screen: what a person can't do isn't offered (the server refuses it anyway, see server/permissions.js).
   Everyone sees only what the admins allow: family viewers see My Tasks but can't mark anything, and nothing that changes the plan. Without
   My Tasks there's no Taken or Skipped; without the medications tick there's no Add discharge papers +, Confirm,
   or the controls that edit a medication, a visit, the profile or the reminder settings. Runs after every page is drawn. */
function applyPermissions(){const main=$('#main');if(!main)return;
const drop=sel=>main.querySelectorAll(sel).forEach(n=>n.remove()),off=sel=>main.querySelectorAll(sel).forEach(n=>{n.disabled=true});
if(!mayDo('tasks'))drop('[data-med-dose]');
if(!mayDo('care')){drop('[data-med-done],[data-med-picked],[data-med-refill]');off('[data-appt-step]')}
if(!mayDo('meds')){drop('[data-add],[data-return],#add-appointment,[data-appt-remove],.pick-edit:has([data-appt-book]),#appt-form button,#flow-photo-med,.pick-photo-hint,#profile-photo,#profile-photo-remove');
  // The bottle and profile photos stay, but tapping them no longer offers a new one.
  main.querySelectorAll('label[for="flow-photo-med"],label[for="profile-photo"]').forEach(l=>{l.removeAttribute('for');l.removeAttribute('role');l.removeAttribute('tabindex');l.removeAttribute('aria-label')});
  off('[data-dose-time],#reminder-form input,#reminder-form button,#appt-form input,#profile-name-form input,#profile-name-form button')}
}
/* My Tasks stays the same on every dashboard: a family viewer sees the same sheet, its done count and line, and today's task
   cards, but tapping a card or a vital sign opens nothing, so nothing gets marked or saved. */
document.addEventListener('click',e=>{if(!mayDo('tasks')&&e.target.closest('#tasks-sheet [data-today-start],#tasks-sheet [data-vitals]')){e.preventDefault();e.stopImmediatePropagation()}},true);
const renderBeforeCan=render;
render=function(){
  // The Take page and the scan and confirm steps aren't open to people who can't use them.
  if(view==='take'&&!mayDo('tasks')||['upload','review'].includes(view)&&!mayDo('meds'))view='overview';
  renderBeforeCan();applyPermissions()};
render();
