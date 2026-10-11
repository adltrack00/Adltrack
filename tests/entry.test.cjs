const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function entry(mode,{fail}={}){
  const listeners={},store=new Map(),calls=[];
  const values={name:'Alex',email:'alex@example.com',password:'password123',time:'10:30'};
  const el=k=>({get value(){return values[k]},set value(v){values[k]=v}});
  const form={elements:{name:el('name'),email:el('email'),password:el('password'),time:el('time'),daily:{checked:true}},addEventListener(n,fn){listeners[n]=fn},querySelector:()=>({disabled:false,textContent:''})};
  const stage={innerHTML:''},error={textContent:''},location={href:'',replace(u){this.href=u}};
  const Account={user:()=>null,api:async()=>({}),clearLocal(){},
    async signIn(x){calls.push(['signIn',x]);if(fail)throw new Error(fail)},
    async signUp(x){calls.push(['signUp',x]);if(fail)throw new Error(fail)},
    async flush(){calls.push(['flush'])}};
  const context={Account,document:{body:{dataset:{mode}},querySelector:s=>s==='#local-entry'?form:s==='#auth-content'?stage:error,addEventListener(){}},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},location};
  vm.runInNewContext(fs.readFileSync('auth.js','utf8'),context);
  return {values,calls,stage,error,location,store,submit:()=>listeners.submit({preventDefault(){}})};
}
test('sign in sends email and password, then opens the dashboard',async()=>{const x=entry('signin');await x.submit();assert.deepEqual(JSON.parse(JSON.stringify(x.calls[0])),['signIn',{email:'alex@example.com',password:'password123'}]);assert.equal(x.location.href,'app.html')});
test('sign up creates the account, then saves reminders and opens the dashboard',async()=>{const x=entry('signup');await x.submit();assert.deepEqual(JSON.parse(JSON.stringify(x.calls[0])),['signUp',{name:'Alex',email:'alex@example.com',password:'password123'}]);assert.equal(x.location.href,'');assert.match(x.stage.innerHTML,/reminder time/i);await x.submit();assert.equal(JSON.parse(x.store.get('back-reminders-v1')).time,'10:30');assert.deepEqual(JSON.parse(JSON.stringify(x.calls[1])),['flush']);assert.equal(x.location.href,'app.html')});
test('short passwords are caught before contacting the server',async()=>{const x=entry('signup');x.values.password='short';await x.submit();assert.equal(x.calls.length,0);assert.match(x.error.textContent,/8 characters/)});
test('server errors are shown to the user',async()=>{const x=entry('signin',{fail:'Email or password is incorrect.'});await x.submit();assert.equal(x.error.textContent,'Email or password is incorrect.');assert.equal(x.location.href,'')});
