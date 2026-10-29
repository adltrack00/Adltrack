const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../core.js');
/* The daily report: everything done on one day as time-stamped entries (report.js reportEntries). */
function report(items){const h=fs.readFileSync('home.js','utf8'),r=fs.readFileSync('report.js','utf8');
const src=h.slice(h.indexOf('const dayOf='),h.indexOf('/* The totals in the menu.'))+r.slice(r.indexOf('const reportTime='),r.indexOf('function reportHTML('));
const ctx={items,C:core,today:()=>'2026-10-14',howText:()=>'',clockText:t=>({'08:00':'8:00 AM','14:00':'2:00 PM','18:00':'6:00 PM'})[t]||t,settings:{}};
vm.runInNewContext(src.replace(/const (\w+)=/g,'var $1=')+';this.reportEntries=reportEntries;this.reportPhotos=reportPhotos;this.shortClock=shortClock;',ctx);return ctx}
const at=t=>new Date('2026-10-14T'+t).toISOString(),y=t=>new Date('2026-10-13T'+t).toISOString();
const meds=()=>[{id:'a',med:true,status:'deciding',name:'Lisinopril 10 mg',dose:'1 tablet',times:['08:00'],pharmacy:{name:'CVS'},
doses:[{at:at('08:05'),day:'2026-10-14',slot:'08:00',kind:'taken',by:'Ana',note:'Took it with breakfast.',photos:['/api/files/x','/api/files/y']},{at:y('08:05'),day:'2026-10-13',slot:'08:00',kind:'taken'}],
log:[{at:at('10:30'),kind:'refill-called',by:'Ana'},{at:y('09:00'),kind:'refill-needed'}]},
{id:'b',med:true,status:'deciding',name:'Metoprolol 25 mg',times:['08:00','18:00'],doses:[{at:at('08:10'),day:'2026-10-14',slot:'08:00',kind:'skipped',note:'Felt dizzy.'}]},
{id:'v',appt:true,status:'received',name:'Follow-up visit with Dr. Patel',date:'2026-10-14',time:'14:00',place:'Heart Clinic'},
{id:'e',med:true,status:'received',name:'Amoxicillin 500 mg',finishedAt:at('16:00'),finishedBy:'Ana'}];
const plain=x=>JSON.parse(JSON.stringify(x));
test('today: every thing done, in time order, each with a subhead, its time, the note from the task and the details',()=>{const e=plain(report(meds()).reportEntries(undefined,'2026-10-14',[{bp:'120/76',heart:'72',at:at('09:00')},{bp:'130/80',at:y('09:00')}]));
  assert.deepEqual(e.map(x=>x.title),['Lisinopril 10 mg (8am dose)','Metoprolol 25 mg (8am dose) skipped','Blood pressure: 120/76 mmHg','Heart rate: 72 bpm','Lisinopril 10 mg: called for a refill','Follow-up visit with Dr. Patel: went','Amoxicillin 500 mg finished']);
  assert.deepEqual(e[0],{title:'Lisinopril 10 mg (8am dose)',at:at('08:05'),note:'Took it with breakfast.',details:['1 tablet'],name:'Lisinopril 10 mg',photos:['/api/files/x','/api/files/y']});
  assert.equal(e[1].note,'Felt dizzy.');assert.equal(e[2].at,at('09:00'));assert.deepEqual(e[2].details,[]);assert.deepEqual(e[4].details,['CVS']);assert.deepEqual(e[6].details,['No more reminders for it']);assert.deepEqual(e[5].details,['Heart Clinic'])});
test('the previous day shows only what was done that day',()=>{const e=plain(report(meds()).reportEntries(undefined,'2026-10-13',[{bp:'130/80',at:y('09:00')}]));
  assert.deepEqual(e.map(x=>x.title),['Lisinopril 10 mg (8am dose)','Blood pressure: 130/80 mmHg','Lisinopril 10 mg: needs a refill'])});
test('Photos has one post per dose: its number on Today, the medication, the note and all its photos',()=>{const p=plain(report(meds()).reportPhotos(undefined,'2026-10-14'));assert.deepEqual(p,[{n:1,name:'Lisinopril 10 mg',note:'Took it with breakfast.',photos:['/api/files/x','/api/files/y']}])});
test('each vital sign is its own entry with its own time; one saved again unchanged the same day is not listed twice',()=>{const e=plain(report([]).reportEntries([],'2026-10-14',[{bp:'120/76',heart:'72',temp:'98.6',pain:'2',at:at('09:00')},{bp:'118/74',heart:'72',temp:'98.6',pain:'2',at:at('13:00')}]));
  assert.deepEqual(e.map(x=>[x.title,x.at]),[['Blood pressure: 120/76 mmHg',at('09:00')],['Heart rate: 72 bpm',at('09:00')],['Temperature: 98.6°F',at('09:00')],['Pain level: 2 out of 10',at('09:00')],['Blood pressure: 118/74 mmHg',at('13:00')]])});
test('a dose time the short way',()=>{const r=report([]);assert.deepEqual(['08:00','08:30','12:00','20:15','00:00'].map(r.shortClock),['8am','8:30am','12pm','8:15pm','12am'])});
test('photos of the vital signs are one post with those entries’ numbers and each vital sign by its full name',()=>{const r=report(meds());r.settings.vitalsLog=[{bp:'120/76',heart:'72',at:at('07:00')},{bp:'120/76',heart:'72',temp:'98.6',at:at('09:00'),photos:['/api/files/v']}];
  const e=plain(r.reportEntries(undefined,'2026-10-14',r.settings.vitalsLog));assert.deepEqual(e.slice(0,2).map(x=>x.title),['Blood pressure: 120/76 mmHg','Heart rate: 72 bpm']);
  assert.deepEqual(plain(r.reportPhotos(undefined,'2026-10-14')),[{n:3,name:'Lisinopril 10 mg',note:'Took it with breakfast.',photos:['/api/files/x','/api/files/y']},{n:5,name:'Vital signs',note:'',photos:['/api/files/v'],lines:['Blood pressure: 120/76 mmHg','Heart rate: 72 bpm','Temperature: 98.6°F'],last:7}])});
