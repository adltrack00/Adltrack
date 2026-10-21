const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../core.js');
/* The daily report's sections, built from home.js's todayTasks and report.js's reportSections. */
function report(items){const h=fs.readFileSync('home.js','utf8'),r=fs.readFileSync('report.js','utf8');
const src=h.slice(h.indexOf('const dayOf='),h.indexOf('/* The totals in the menu.'))+r.slice(r.indexOf('const reportTime='),r.indexOf('function reportHTML('));
const ctx={items,C:core,today:()=>'2026-10-14',howText:()=>'',clockText:t=>({'08:00':'8:00 AM','14:00':'2:00 PM','18:00':'6:00 PM'})[t]||t,settings:{}};
vm.runInNewContext(src.replace(/const (\w+)=/g,'var $1=')+';this.reportSections=reportSections;this.reportPhotos=reportPhotos;',ctx);return ctx}
const meds=()=>[{id:'a',med:true,status:'deciding',name:'Lisinopril 10 mg',times:['08:00'],doses:[{at:'2026-10-14T08:05:00',day:'2026-10-14',slot:'08:00',kind:'taken',by:'Ana',note:'Took it with breakfast.',photos:['/api/files/x']},{at:'2026-10-13T08:05:00',day:'2026-10-13',slot:'08:00',kind:'taken'}],refill:{step:'call'},marks:[{day:'2026-10-13',key:'refill:call',kind:'done'}]},
{id:'b',med:true,status:'deciding',name:'Metoprolol 25 mg',times:['08:00','18:00'],doses:[{at:'2026-10-14T08:10:00',day:'2026-10-14',slot:'08:00',kind:'skipped'}]},
{id:'v',appt:true,status:'deciding',name:'Follow-up visit with Dr. Patel',date:'2026-10-14',time:'14:00'},
{id:'e',med:true,status:'received',name:'Amoxicillin 500 mg',finishedAt:'2026-10-14T12:00:00',finishedBy:'Ana'}];
const lines=s=>JSON.parse(JSON.stringify(s.map(x=>[x.title,x.lines])));
test('today: the task notes first, then taken, skipped, still to do, vitals, refills, visits and finished',()=>{const r=report(meds()),s=r.reportSections(undefined,'2026-10-14',{bp:'120/76',at:'2026-10-14T09:00:00'},'2026-10-14');
  const t=lines(s);assert.deepEqual(t.map(x=>x[0]),['Notes','Doses taken','Doses skipped','Still to do','Vital signs','Refills','Visits','Finished']);
  assert.match(t[1][1][0],/^8:00 AM dose · Lisinopril 10 mg · taken .* · by Ana$/);assert.match(t[2][1][0],/Metoprolol 25 mg · skipped/);
  assert.deepEqual(t[3][1],['2:00 PM · Follow-up visit with Dr. Patel','6:00 PM · Metoprolol 25 mg','Call the pharmacy to refill Lisinopril 10 mg']);
  assert.match(t[4][1][0],/^BP 120\/76 · /);assert.deepEqual(t[5][1],[]);assert.deepEqual(t[6][1],['2:00 PM · Follow-up visit with Dr. Patel · coming up']);
  assert.equal(t[0][1].length,1);assert.match(t[0][1][0].head,/^8:00 AM dose · Lisinopril 10 mg · taken .* · by Ana$/);assert.equal(t[0][1][0].text,'Took it with breakfast.');assert.deepEqual(t[7][1],['Amoxicillin 500 mg · by Ana'])});
test('the previous day shows only that day, says Not marked, and leaves out today\'s vitals and refill step',()=>{const r=report(meds()),t=lines(r.reportSections(undefined,'2026-10-13',{bp:'120/76',at:'2026-10-14T09:00:00'},'2026-10-14'));
  assert.deepEqual(t[0][1],[]);assert.equal(t[1][1].length,1);assert.equal(t[3][0],'Not marked');assert.deepEqual(t[3][1],['8:00 AM · Metoprolol 25 mg','6:00 PM · Metoprolol 25 mg']);assert.deepEqual(t[5][1],['Lisinopril 10 mg · called for a refill']);assert.deepEqual([t[4][1],t[6][1],t[7][1]].map(x=>x.length),[0,0,0])});
test('Photos lists the day\'s proof photos with their medication',()=>{const p=report(meds()).reportPhotos(undefined,'2026-10-14');assert.deepEqual(JSON.parse(JSON.stringify(p)),[{src:'/api/files/x',name:'Lisinopril 10 mg',at:'2026-10-14T08:05:00'}])});
