const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../core.js');
/* The family viewer's Home: "Today so far" in place of My Tasks (viewer.js todaySoFar and todaySoFarLine). */
function viewer(items){const h=fs.readFileSync('home.js','utf8'),r=fs.readFileSync('report.js','utf8'),v=fs.readFileSync('viewer.js','utf8');
const src=h.slice(h.indexOf('const dayOf='),h.indexOf('/* The totals in the menu.'))+r.slice(r.indexOf('const reportTime='),r.indexOf('function reportHTML('))+v.slice(v.indexOf('const plural='),v.indexOf('function todaySoFarHTML('));
const ctx={items,C:core,today:()=>'2026-10-14',howText:()=>'',clockText:t=>t,settings:{},refillWho:()=>'the pharmacy'};
vm.runInNewContext(src.replace(/const (\w+)=/g,'var $1=')+';this.todaySoFar=todaySoFar;this.todaySoFarLine=todaySoFarLine;',ctx);return ctx}
const at=t=>new Date('2026-10-14T'+t).toISOString();
const meds=()=>[{id:'a',med:true,status:'deciding',name:'Lisinopril 10 mg',times:['08:00'],doses:[{at:at('08:04'),day:'2026-10-14',slot:'08:00',kind:'taken'}]},
{id:'b',med:true,status:'deciding',name:'Metoprolol 25 mg',times:['08:00','20:00'],doses:[{at:at('08:06'),day:'2026-10-14',slot:'08:00',kind:'taken'}]},
{id:'c',med:true,status:'deciding',name:'Furosemide 20 mg',times:['13:00'],doses:[{at:at('13:10'),day:'2026-10-14',slot:'13:00',kind:'skipped'}]},
{id:'d',med:true,status:'deciding',name:'Atorvastatin 20 mg',times:['21:00'],refill:{step:'call'}},
{id:'v',appt:true,status:'deciding',name:'Follow-up visit',date:'2026-10-14',time:'15:00'}];
const plain=x=>JSON.parse(JSON.stringify(x));

test('doses due by now, given and skipped; other tasks done; the last update is the latest report entry',()=>{const v=viewer(meds()),s=plain(v.todaySoFar(undefined,'2026-10-14','18:10',[]));
  assert.deepEqual(s,{given:2,skipped:1,due:3,done:0,tasks:2,incidents:0,last:at('13:10')});
  assert.deepEqual(plain(v.todaySoFarLine(s)),['2 of 3 doses given','1 skipped','0 of 2 tasks done','No incidents'])});
test('a dose marked before its time counts as due; nothing done yet says so',()=>{const list=meds();list[1].doses.push({at:at('07:50'),day:'2026-10-14',slot:'20:00',kind:'taken'});
  const v=viewer(list);assert.equal(v.todaySoFar(undefined,'2026-10-14','09:00',[]).due,4);assert.equal(v.todaySoFar(undefined,'2026-10-14','09:00',[]).given,3);
  const e=viewer([]),s=e.todaySoFar(undefined,'2026-10-14','09:00',[]);assert.equal(s.last,'');assert.deepEqual(plain(e.todaySoFarLine(s)),['No doses due yet','No other tasks today','No incidents'])});
test('Home loads viewer.js after the report and before permissions, and keeps it offline',()=>{const html=fs.readFileSync('app.html','utf8');
  assert.ok(html.indexOf('src="report.js"')<html.indexOf('src="viewer.js"')&&html.indexOf('src="viewer.js"')<html.indexOf('src="can.js"'));
  assert.match(fs.readFileSync('sw.js','utf8'),/'viewer\.js'/)});
