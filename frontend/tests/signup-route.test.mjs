import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {signupConsentPolicy} from '../signup-consent.mjs';

test('production signup records consent without a demo switch and retains authentication and validation',async t=>{
 const route=new URL('../app/api/auth/signup/route.js',import.meta.url);
 const state={calls:[],account:{user:{id:'test-user'},client:{rpc:async(name,args)=>{
  state.calls.push({name,args});return {error:null};
 }}}};
 const key='capstone.signup.route.test';
 globalThis[Symbol.for(key)]=state;
 const previous=process.env.NODE_ENV;
 process.env.NODE_ENV='production';
 t.after(()=>{
  delete globalThis[Symbol.for(key)];
  if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;
 });
 // Replace only route dependencies; execute the actual POST handler without a network or real credentials.
 const hooks=registerHooks({resolve(specifier,context,next){
  if(context.parentURL===route.href){
   let source;
   if(specifier==='next/server')source='export const NextResponse={json:(...args)=>Response.json(...args)};';
   if(specifier.endsWith('/lib/supabase/auth.js'))source=`
    export const sameOrigin=request=>request.headers.get('origin')==='https://app.example';
    export const verifiedAccount=async()=>globalThis[Symbol.for('${key}')].account;
   `;
   if(source)return {url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true};
  }
  return next(specifier,context);
 }});
 let POST;
 try{({POST}=await import(route.href));}finally{hooks.deregister();}
 const decisions=signupConsentPolicy.sections.map(item=>({id:item.id,agreed:item.required}));
 const request=(values=decisions,origin='https://app.example')=>new Request('https://app.example/api/auth/signup',{
  method:'POST',headers:{origin,'content-type':'application/json'},
  body:JSON.stringify({policyVersion:signupConsentPolicy.version,decisions:values}),
 });
 assert.equal(signupConsentPolicy.operationalReady,false);
 assert.equal((await POST(request())).status,200);
 assert.equal(state.calls[0].name,'capstone_record_consents');
 assert.equal((await POST(request(decisions,'https://other.example'))).status,403);
 assert.equal((await POST(request(decisions.map(item=>({...item,agreed:false}))))).status,400);
 state.account={user:null};
 assert.equal((await POST(request())).status,401);
 assert.equal(state.calls.length,1);
});
