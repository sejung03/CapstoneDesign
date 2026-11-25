import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
const root=fileURLToPath(new URL('../',import.meta.url));

test('Built Next.js application serves the preserved app and server APIs', {timeout:45000},async t=>{
 assert.ok(fs.existsSync(new URL('../.next/BUILD_ID',import.meta.url)),'Run npm run build first');
 const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
 const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{
  cwd:root,env:{...process.env,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',KAKAO_JAVASCRIPT_KEY:'test-public-js',KAKAO_REST_API_KEY:'',DATA_SERVICE_KEY:'',PUBLIC_DATA_HOSPITAL_KEY:'',PUBLIC_DATA_PHARMACY_KEY:''},stdio:['ignore','pipe','pipe']
 });
 let output='';child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{output+=data;});
 const base='http://127.0.0.1:'+port;
 try{
  let ready=false;
  for(let i=0;i<150;i++){
   if(child.exitCode!==null)throw Error('Next exited: '+output);
   try{const r=await fetch(base+'/api/config');if(r.ok){ready=true;break;}}catch{}
   await delay(60);
  }
  assert.ok(ready,output);
  await t.test('HTML contains React host, local styles and nonce-protected bootstrap',async()=>{
   const response=await fetch(base);assert.equal(response.status,200);
   const html=await response.text(),csp=response.headers.get('content-security-policy');
   assert.match(html,/id="app"/);assert.match(html,/fonts\/SUIT-Variable.woff2/);
   assert.match(csp,/upgrade-insecure-requests/);assert.match(csp,/worker-src 'self'/);
   const nonce=csp.match(/'nonce-([^']+)'/)?.[1];assert.ok(nonce);
   for(const script of html.matchAll(/<script\b([^>]*)>/g))assert.ok(script[1].includes('nonce="'+nonce+'"'),'Every bootstrap script needs the request nonce');
   const nextPolicy=(await fetch(base)).headers.get('content-security-policy');assert.notEqual(nextPolicy,csp);
   const scripts=[...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(match=>match[1]);
   assert.ok(scripts.length);
   for(const src of scripts)assert.equal((await fetch(new URL(src,base))).status,200);
   const styles=[...html.matchAll(/href="([^" ]+\.css[^" ]*)"/g)].map(match=>match[1]);assert.ok(styles.length);
   const css=await (await fetch(new URL(styles[0],base))).text();assert.match(css,/assistant-panel|app-workspace/);
  });
  await t.test('config and missing-key/invalid requests retain status and no-store',async()=>{
   const config=await fetch(base+'/api/config');
   assert.equal(config.headers.get('cache-control'),'no-store');
   assert.deepEqual(await config.json(),{map:{provider:'kakao',configured:true,javascriptKey:'test-public-js'},publicData:{configured:false},routing:{configured:false}});
   assert.equal((await fetch(base+'/api/config',{method:'HEAD'})).status,200);
   assert.equal((await fetch(base+'/api/config',{method:'POST'})).status,405);
   const hours=await fetch(base+'/api/public-hours?type=hospital&name=test');assert.equal(hours.status,503);assert.equal((await hours.json()).error,'hoursKeyMissing');
   assert.equal((await fetch(base+'/api/route')).status,400);
  });
  await t.test('fonts and favicon remain public; credentials and implementation stay private',async()=>{
   for(const name of ['/fonts/SUIT-Variable.woff2','/fonts/SUITE-Variable.woff2','/favicon.svg','/pdfjs/pdf.worker.min.mjs','/pdfjs/cmaps/Adobe-Korea1-UCS2.bcmap','/pdfjs/standard_fonts/LiberationSans-Regular.ttf'])assert.equal((await fetch(base+name)).status,200);
   for(const name of ['/.env','/.env.example','/server.mjs','/app.js','/routing-server.mjs','/lib/server-api.mjs','/package.json','/tests/dom-harness.mjs'])assert.equal((await fetch(base+name)).status,404,name);
  });
 }finally{
  if(child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}
 }
});
