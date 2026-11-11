import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiHandlers} from '../lib/server-api.mjs';
import {contentSecurityPolicy} from '../lib/security.mjs';
import {mountApp} from './dom-harness.mjs';
const request=(path,method='GET')=>new Request('http://localhost'+path,{method});

test('Next config returns only public key and feature availability; HEAD and methods preserve API behavior',async()=>{
 const handle=createApiHandlers({KAKAO_JAVASCRIPT_KEY:'public-js',KAKAO_REST_API_KEY:'private-rest',PUBLIC_DATA_SERVICE_KEY:'private-hours'});
 const response=await handle('config',request('/api/config'));
 const text=await response.text();assert.match(text,/public-js/);assert.doesNotMatch(text,/private-rest|private-hours/);
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(await (await handle('config',request('/api/config','HEAD'))).text(),'');
 assert.equal((await handle('config',request('/api/config','POST'))).status,405);
});

test('Next adapter reuses validated hours query, private upstream key, XML and cache',async()=>{
 let calls=0;
 const xml='<response><header><resultCode>00</resultCode></header><body><items></items></body></response>';
 const handle=createApiHandlers({PUBLIC_DATA_SERVICE_KEY:'private-hours'},{fetcher:async url=>{
  calls++;assert.equal(url.searchParams.get('serviceKey'),'private-hours');
  return {ok:true,text:async()=>xml};
 }});
 const req=()=>request('/api/public-hours?type=hospital&name='+encodeURIComponent('테스트의원'));
 for(let i=0;i<2;i++){
  const res=await handle('public-hours',req());assert.equal(res.status,200);assert.equal(await res.text(),xml);
  assert.match(res.headers.get('content-type'),/xml/);
 }
 assert.equal(calls,1);
 assert.equal((await handle('public-hours',request('/api/public-hours?type=invalid'))).status,400);
});

test('Next adapter gives actionable missing-key errors without calling upstream',async()=>{
 const handle=createApiHandlers({}, {fetcher:()=>{throw Error('must not call');}});
 const hours=await handle('public-hours',request('/api/public-hours?type=hospital&name=test'));
 assert.equal(hours.status,503);assert.equal((await hours.json()).error,'hoursKeyMissing');
 // Query validation is deliberately preserved before credentials are checked.
 assert.equal((await handle('route',request('/api/route'))).status,400);
});

test('production CSP uses nonce, permits Kakao and upgrades SDK subresources without unsafe inline scripts',()=>{
 const csp=contentSecurityPolicy('unique-nonce');
 assert.match(csp,/nonce-unique-nonce/);assert.match(csp,/upgrade-insecure-requests/);
 assert.match(csp,/https:\/\/\*\.kakaocdn.net/);
 const script=csp.split(';').find(value=>value.trim().startsWith('script-src'));
 assert.doesNotMatch(script,/unsafe-inline|unsafe-eval/);
 assert.match(contentSecurityPolicy('dev',{development:true}),/unsafe-eval/);
});

test('React compatibility mount can dispose and remount; old config response cannot replace the new session',async()=>{
 const ui=mountApp();
 ui.run(`globalThis.replyConfig=null;globalThis.fetch=()=>new Promise(resolve=>{replyConfig=resolve;});configureLive();`);
 ui.run('globalThis.oldReply=replyConfig;disposeApp();globalThis.disposeAgain=mountMedicalApp();');
 // Aborted first request still resolves: the sequence guard must reject it.
 ui.run(`oldReply({ok:true,json:async()=>({map:{configured:true,javascriptKey:'stale'}})});`);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(ui.run('appMounted'),true);
 assert.notEqual(ui.run('state.live.key'),'stale');
 assert.equal(ui.document.querySelectorAll('button[data-view]').filter(node=>node.dataset.view==='profile').length,1);
 ui.run('disposeAgain();disposeAgain();');assert.equal(ui.run('appMounted'),false);
});
