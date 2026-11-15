import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
test('Supabase routes reject unauthenticated and cross-origin operations and omit Kakao email scope',{timeout:45000},async()=>{
 const probe=net.createServer().listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const base='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,NODE_ENV:'production',APP_URL:base,NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
 try{
  let ready=false;for(let i=0;i<150;i++){if(child.exitCode!==null)throw Error(output);try{if((await fetch(base+'/api/config')).ok){ready=true;break;}}catch{}await delay(60);}assert.ok(ready,output);
  const session=await fetch(base+'/api/auth/session');assert.equal(session.status,200);assert.equal((await session.json()).authenticated,false);
  for(const action of ['settings','favorites','signal','statements']){
   const response=await fetch(base+'/api/behavior/'+action,{headers:{cookie:'capstone_session=forged; behavior_demo_account=a'}});
   assert.equal(response.status,401,action);assert.equal((await response.json()).error,'authentication_required');
  }
  const forged=await fetch(base+'/api/behavior/settings',{method:'PATCH',headers:{origin:base,'Content-Type':'application/json'},body:JSON.stringify({user_id:'11111111-1111-4111-8111-111111111111',preference:'open'})});assert.equal(forged.status,401);
  const logout=await fetch(base+'/api/auth/logout',{method:'POST',headers:{origin:'https://other.example'}});assert.equal(logout.status,403);
  const callback=await fetch(base+'/api/auth/kakao/callback',{redirect:'manual'});assert.equal(callback.status,307);assert.equal(callback.headers.get('location'),base+'/?auth_error=invalid_oauth');
  const oauth=await fetch(base+'/api/auth/kakao',{redirect:'manual'});assert.equal(oauth.status,302);
  const authUrl=new URL(oauth.headers.get('location'));assert.equal(authUrl.pathname,'/auth/v1/authorize');assert.equal(authUrl.searchParams.get('provider'),'kakao');assert.equal(authUrl.searchParams.get('redirect_to'),base+'/api/auth/kakao/callback');assert.equal(authUrl.searchParams.get('code_challenge_method'),'s256');
  assert.equal(authUrl.searchParams.get('scope'),'');
  assert.equal(authUrl.searchParams.has('scopes'),false);
  assert.match(oauth.headers.get('set-cookie'),/code-verifier/);
 }finally{child.kill();await Promise.race([once(child,'exit'),delay(2000)]);}
});
