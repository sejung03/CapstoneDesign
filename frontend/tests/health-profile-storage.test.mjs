import test from 'node:test';
import assert from 'node:assert/strict';
import {createHealthProfileHandler} from '../lib/health-profile-api.mjs';
import {healthStoragePolicyVersion,emptyHealth} from '../health-storage.mjs';
import {mountApp} from './dom-harness.mjs';
import {createAccountClient} from '../account-client.mjs';
const health={age:'32',sex:'female',allergies:'페니실린',medications:'혈압약',history:'직접 입력한 병력'};
const req=(method,body,origin='http://local.test')=>new Request('http://local.test/api/health-profile',{method,headers:{origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
function fixture(){
 const rows=new Map(),consents=new Map();let user='A',fail=false;
 const handle=createHealthProfileHandler({sameOrigin:r=>r.headers.get('origin')==='http://local.test',resolveAccount:async()=>({user:user?{id:user}:null,ready:true}),repository:()=>({consents:async id=>['healthProcessing','healthStorage'].map(item=>({item,agreed:consents.get(id)===true})),read:async id=>rows.get(id)||null,grant:async id=>{consents.set(id,true);},save:async(id,p)=>{if(fail)throw Error('unavailable');rows.set(id,{...p,confirmed_at:'2026-11-17T00:00:00Z'});return rows.get(id);},remove:async id=>{if(fail)throw Error('unavailable');consents.set(id,false);rows.delete(id);}})});
 return {handle,rows,consents,setUser:id=>{user=id;},setFail:()=>{fail=true;}};
}
test('authenticated profile save, reload and deletion are scoped to the verified account',async()=>{
 const f=fixture(),grant={version:healthStoragePolicyVersion,granted:true};
 assert.equal((await f.handle(req('PUT',{profile:health}))).status,409);
 const save=await f.handle(req('PUT',{profile:health,consent:grant}));assert.equal(save.status,200);assert.deepEqual((await save.json()).profile,health);
 assert.deepEqual((await (await f.handle(req('GET'))).json()).profile,health);
 f.setUser('B');assert.deepEqual((await (await f.handle(req('GET'))).json()).profile,emptyHealth());
 await f.handle(req('PUT',{profile:{...health,age:'20'},consent:grant}));
 f.setUser('A');assert.equal((await f.handle(req('DELETE'))).status,200);assert.equal(f.rows.has('A'),false);assert.equal(f.rows.has('B'),true);assert.equal(f.consents.get('A'),false);
});
test('guests, foreign origins and caller-supplied account IDs cannot write',async()=>{
 const f=fixture();f.setUser(null);assert.equal((await f.handle(req('GET'))).status,401);assert.equal((await f.handle(req('DELETE'))).status,401);
 f.setUser('A');assert.equal((await f.handle(req('DELETE',null,'https://foreign.test'))).status,403);
 const stale=req('DELETE');stale.headers.set('X-Account-Scope','B');assert.equal((await f.handle(stale)).status,409);
 assert.equal((await f.handle(req('PUT',{profile:health,user_id:'B'}))).status,400);
 assert.equal((await f.handle(req('PUT',{profile:{...health,sex:'invalid'}}))).status,400);
 assert.equal((await f.handle(req('PUT',{profile:{...health,age:'121'}}))).status,400);
 assert.equal((await f.handle(req('PUT',{profile:{...health,allergies:'a'.repeat(501)}}))).status,400);assert.equal(f.rows.size,0);
});
test('database errors never produce a successful save or delete result',async()=>{
 const f=fixture();f.setFail();
 assert.equal((await f.handle(req('PUT',{profile:health,consent:{version:healthStoragePolicyVersion,granted:true}}))).status,503);
 assert.equal((await f.handle(req('DELETE'))).status,503);
});
function browser(db=new Map(),id='A'){
 const ui=mountApp();ui.run('viewRenderer=()=>{};render=()=>{};state.workspace=createWorkspace();');
 const client={getSession:async()=>({authenticated:true,accountId:id}),logout:async()=>{},healthProfile:{get:async()=>({profile:db.get(id)||emptyHealth(),storageConsent:db.has(id)}),save:async p=>{db.set(id,p);return {profile:p,storageConsent:true};},remove:async()=>{db.delete(id);return {profile:emptyHealth(),storageConsent:false};}}};
 ui.setGlobal('healthAccountAdapter',client);return {ui,client,db};
}
test('member controller restores on a new page, saves only after acknowledgement, and clears on logout',async()=>{
 const {ui,client,db}=browser();await ui.run('setAccountAdapter(healthAccountAdapter)');
 ui.run('state.profileDraft={...state.profileDraft,...'+JSON.stringify(health)+'};state.healthStorage.grant=true;');
 let finish;client.healthProfile.save=p=>new Promise(resolve=>{finish=()=>{db.set('A',p);resolve({profile:p,storageConsent:true});};});
 const work=ui.run('persistAccountHealth()');assert.equal(ui.run('state.profile.age'),'');assert.equal(ui.run('state.healthStorage.phase'),'saving');finish();assert.equal(await work,true);assert.equal(ui.run('state.profile.age'),'32');
 const fresh=browser(db);await fresh.ui.run('setAccountAdapter(healthAccountAdapter)');assert.equal(fresh.ui.run('state.profile.age'),'32');
 await ui.run('logoutAccount()');assert.equal(ui.run('state.profile.age'),'');assert.equal(db.get('A').age,'32');
 assert.equal(await fresh.ui.run('persistAccountHealth(true)'),true);assert.equal(db.has('A'),false);assert.equal(fresh.ui.run('state.profile.age'),'');
});
test('member failed saves retain drafts and failed deletes retain applied data',async()=>{
 const {ui,client}=browser(new Map([['A',health]]));await ui.run('setAccountAdapter(healthAccountAdapter)');
 ui.run('state.profileDraft.age="40"');client.healthProfile.save=async()=>{throw Error('offline');};
 assert.equal(await ui.run('persistAccountHealth()'),false);assert.equal(ui.run('state.profile.age'),'32');assert.equal(ui.run('state.profileDraft.age'),'40');assert.equal(ui.run('state.healthStorage.error'),'saveError');
 client.healthProfile.remove=async()=>{throw Error('offline');};assert.equal(await ui.run('persistAccountHealth(true)'),false);assert.equal(ui.run('state.profile.age'),'32');
});
test('guests keep health only in page memory and never write health to browser storage',()=>{
 const ui=mountApp();ui.run('state.profileDraft={...state.profileDraft,...'+JSON.stringify(health)+'};commitProfile()');assert.equal(ui.run('state.profile.age'),'32');assert.equal(ui.storage.size,0);assert.equal(mountApp().run('state.profile.age'),'');
});
test('late profile loads from a previous account cannot overwrite the next account',async()=>{
 const {ui,client}=browser();let resolveA;client.healthProfile.get=()=>new Promise(resolve=>resolveA=resolve);
 const pending=ui.run('setAccountAdapter(healthAccountAdapter)');for(let i=0;i<20&&!resolveA;i++)await new Promise(resolve=>setImmediate(resolve));assert.ok(resolveA);
 ui.setGlobal('nextHealthAccount',{...client,getSession:async()=>({authenticated:true,accountId:'B'}),healthProfile:{...client.healthProfile,get:async()=>({profile:{...health,age:'50'},storageConsent:true})}});
 await ui.run('setAccountAdapter(nextHealthAccount)');resolveA({profile:health,storageConsent:true});await pending;assert.equal(ui.run('state.account.accountId'),'B');assert.equal(ui.run('state.profile.age'),'50');
});
test('late session responses cannot change the account-scope header used for health storage',async()=>{
 let resolveOld,n=0,scope;
 const client=createAccountClient({fetchImpl:async(path,options={})=>{
  if(path==='/api/auth/session'){if(n++===0)return new Promise(resolve=>{resolveOld=resolve;});return Response.json({authenticated:true,accountId:'B'});}
  scope=options.headers['X-Account-Scope'];return Response.json({profile:emptyHealth()});
 }});
 const old=client.getSession();await client.getSession();resolveOld(Response.json({authenticated:true,accountId:'A'}));await old;await client.healthProfile.get();assert.equal(scope,'B');
});

test('account client: 가입 동의를 마치지 않은 로그인(pendingSignup)이 남아 있어도 페이지를 /signup으로 보내지 않고 비회원으로 둔다',async()=>{
 const previous=globalThis.location;let assigned=null;
 globalThis.location={assign:url=>{assigned=url;}};
 try{
  const client=createAccountClient({fetchImpl:async()=>Response.json({authenticated:false,pendingSignup:true})});
  const session=await client.getSession();
  assert.equal(session.authenticated,false);
  assert.equal(assigned,null);
 }finally{globalThis.location=previous;}
});
