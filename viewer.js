/* The family viewer's Home: the same daily care report (Previous day, Today, Photos) in the same place, with no My Tasks sheet.
   In its place, a short "Today so far" line in the same white sheet at the bottom: doses given of doses due by now, tasks done,
   incidents, and when the last thing was recorded. Anyone without My Tasks gets it (a viewer, or an admin who isn't ticked for
   My Tasks). A viewer on several families keeps the picker and the switch under the photo (patients.js), and each family's
   Home counts only that family's day. Nothing here can be tapped to change anything. */
const plural=(n,one,many=one+'s')=>`${n} ${n===1?one:many}`;
/* Incidents come with the + button (care-team-plan step 5); until then there are none to count. */
const incidentsOn=(list=items,day=today())=>list.filter(i=>i.incident&&dayOf(i)===day);
/* Today's numbers: a dose is due once its time has come (or once it's marked, if marked early); tasks are the pick-ups, refill
   steps and visits due today. The last update is the time of the latest entry on today's report. */
function todaySoFar(list=items,day=today(),now=hmNow(),vitalsLog){const tasks=todayTasks(list,day),doses=tasks.filter(x=>x.slot&&(x.slot<=now||x.state)),other=tasks.filter(x=>!x.slot),entries=reportEntries(list,day,vitalsLog);
return {given:doses.filter(x=>x.state==='done').length,skipped:doses.filter(x=>x.state==='skipped').length,due:doses.length,done:other.filter(x=>x.state==='done').length,tasks:other.length,incidents:incidentsOn(list,day).length,last:entries.length?entries[entries.length-1].at:''}}
function todaySoFarLine(s){return [s.due?`${s.given} of ${plural(s.due,'dose')} given`:'No doses due yet',s.skipped?`${s.skipped} skipped`:'',s.tasks?`${s.done} of ${plural(s.tasks,'task')} done`:'No other tasks today',s.incidents?plural(s.incidents,'incident'):'No incidents'].filter(Boolean)}
function todaySoFarHTML(){const s=todaySoFar(),line=todaySoFarLine(s);
return `<section class="tasks-sheet so-far" id="so-far" aria-label="Today so far"><div class="tasks-top"><h2>Today so far</h2><p class="so-far-line">${esc(line.join('\u00a0· '))}</p><p class="so-far-when">${s.last?`Last update ${esc(reportTime(s.last))}`:'No updates yet today'}</p></div></section>`}
const galleryBeforeViewer=gallery;
gallery=function(){const html=galleryBeforeViewer();return view==='overview'&&!mayDo('tasks')?html+todaySoFarHTML():html};
render();
