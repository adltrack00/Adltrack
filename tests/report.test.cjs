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
  assert.deepEqual(e[0],{title:'Lisinopril 10 mg (8am dose)',at:at('08:05'),note:'Took it with breakfast.',details:['1 tablet'],name:'Lisinopril 10 mg',photos:['/api/files/x','/api/files/y'],by:'Ana'});
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
/* Your schedule: a day that has ended opens its report; when several people documented it, each one's part is picked apart. */
test('a past day lists who documented it in order, and each person sees only their own entries and photos',()=>{const r=report(meds());r.welcomeName=()=>'George';
r.schedStart=i=>[i.purchased,...(i.doses||[]).map(d=>d.day||String(d.at||'').slice(0,10))].filter(Boolean).sort()[0]||'2026-10-14';
vm.runInNewContext(fs.readFileSync('pastday.js','utf8').split('const dayX=')[0].replace(/^let /m,'var ').replace(/const (\w+)=/g,'var $1=')+';this.pastDayPeople=pastDayPeople;',r);
const people=plain(r.pastDayPeople('2026-10-14'));assert.deepEqual(people.map(p=>p.name),['Ana','George']);assert.equal(people[0].count,3);assert.equal(people[1].count,2);assert.equal(people[0].from,at('08:05'));assert.equal(people[0].to,at('16:00'));
assert.deepEqual(plain(r.reportPhotos(undefined,'2026-10-14','Ana')).map(p=>[p.n,p.name]),[[1,'Lisinopril 10 mg']]);assert.deepEqual(plain(r.reportPhotos(undefined,'2026-10-14','George')),[]);
assert.deepEqual(plain(r.pastDayPeople('2026-10-13')).map(p=>p.name),['George'],'older entries saved without a name are the report’s own')});

test('a day that has ended shows what was missed: a dose not taken, a visit not attended, a task missed, a refill not done; not today, and in no one’s name',()=>{
const r=report([{id:'a',med:true,status:'deciding',name:'Lisinopril 10 mg',dose:'1 tablet',times:['08:00','20:00'],purchased:'2026-10-10',refill:{step:'call',since:'2026-10-12'},pharmacy:{name:'CVS'},doses:[{at:y('08:05'),day:'2026-10-13',slot:'08:00',kind:'taken',by:'Ana'}]},
{id:'v',appt:true,status:'deciding',name:'Follow-up visit with Dr. Patel',date:'2026-10-13',time:'14:00',place:'Heart Clinic'}]);r.welcomeName=()=>'George';
r.schedStart=i=>i.purchased;
vm.runInNewContext(fs.readFileSync('pastday.js','utf8').split('const dayX=')[0].replace(/^let /m,'var ').replace(/const (\w+)=/g,'var $1=')+';this.pastDayPeople=pastDayPeople;this.reportEntries=reportEntries;',r);
const e=plain(r.reportEntries(undefined,'2026-10-13',[]));
assert.deepEqual(e.map(x=>x.title),['Lisinopril 10 mg (8am dose)','Follow-up visit with Dr. Patel: not attended','Lisinopril 10 mg (8pm dose) not taken','Lisinopril 10 mg: refill not done']);
assert.ok(e.slice(1).every(x=>x.missed&&!x.by));assert.equal(e[3].untimed,true);
assert.deepEqual(plain(r.pastDayPeople('2026-10-13')).map(p=>p.name),['Ana'],'missed entries add no one to the people list');
assert.equal(r.reportEntries(undefined,'2026-10-14',[]).filter(x=>x.missed).length,0,'today is not over yet');
assert.equal(r.reportEntries(undefined,'2026-10-11',[]).filter(x=>/refill/.test(x.title)).length,0,'no refill missed before it was due')});
