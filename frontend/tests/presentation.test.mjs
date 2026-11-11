import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startServer} from '../server.mjs';
import {copy} from '../copy.mjs';
import {mountApp} from './dom-harness.mjs';
const project=fileURLToPath(new URL('../',import.meta.url));
test('Bundled fonts, styles and icons are served under the existing CSP without an external font dependency',async()=>{
 const server=await startServer({port:0,env:{},log(){}});
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const html=await (await fetch(base)).text();
  assert.match(html,/href=".\/ui.css"/);assert.match(html,/fonts\/SUIT-Variable.woff2/);
  const style=await (await fetch(base+'/ui.css')).text();
  assert.doesNotMatch(style,/@import|url\(['"]?https?:/);assert.match(style,/font-display:swap/);
  for(const family of ['SUIT','SUITE']){
   const response=await fetch(base+'/fonts/'+family+'-Variable.woff2');
   assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/font\/woff2/);
   const buffer=Buffer.from(await response.arrayBuffer());assert.equal(buffer.subarray(0,4).toString(),'wOF2');
   assert.ok(buffer.length>100000);assert.equal((await fetch(base+'/fonts/'+family+'-LICENSE.txt')).status,200);
  }
  assert.equal((await fetch(base+'/ui-icons.mjs')).status,200);
  assert.equal((await fetch(base+'/.env')).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('Korean/English copy remains aligned and document navigation resolves after reorganization',()=>{
 assert.deepEqual(Object.keys(copy.ko).sort(),Object.keys(copy.en).sort());
 for(const lang of ['ko','en'])for(const text of Object.values(copy[lang]))assert.equal(text.includes('·'),false);
 const files=['README.md','docs/SETUP.md','docs/DEVELOPMENT.md'];
 for(const name of files){
  const content=fs.readFileSync(path.join(project,name),'utf8');
  for(const match of content.matchAll(/\]\(([^)]+)\)/g)){
   if(/^(https?:|#)/.test(match[1]))continue;
   assert.ok(fs.existsSync(path.resolve(project,path.dirname(name),match[1])),name+' -> '+match[1]);
  }
 }
 const ui=mountApp();ui.document.getElementById('skip').click();
 const routes=ui.document.querySelectorAll('button[data-view]').filter(n=>n.attributes.class?.includes('header-route'));
 assert.deepEqual(routes.map(n=>n.dataset.view),['explore','report','profile']);
 ui.run("state.draft.symptom='입력한 중앙점 · 유지';navigate('report')");
 assert.match(ui.app.innerHTML,/입력한 중앙점 · 유지/);
});
