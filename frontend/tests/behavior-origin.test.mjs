import test from 'node:test';
import assert from 'node:assert/strict';
import {createBehaviorApi} from '../lib/behavior/api.js';
import {createMockBehaviorRepository} from '../lib/behavior/mock-repository.js';
const session={user:{id:'11111111-1111-4111-8111-111111111111'}};
test('behavior mutation accepts configured app origin despite a different internal Next hostname',async()=>{
 const api=createBehaviorApi({repository:createMockBehaviorRepository(),resolveSession:async()=>session,expectedOrigin:'http://127.0.0.1:3080'});
 const request=(origin,site='same-origin')=>new Request('http://localhost:3080/api/behavior/favorites',{
  method:'PUT',headers:{Origin:origin,'Sec-Fetch-Site':site,'Content-Type':'application/json'},
  body:JSON.stringify({favorite:true,facility:{id:'test-hospital',type:'hospital',name:{ko:'가상 병원',en:'Test hospital'},address:''}}),
 });
 const accepted=await api(request('http://127.0.0.1:3080'),'favorites');assert.equal(accepted.status,200);assert.equal((await accepted.json()).items.length,1);
 for(const [origin,site] of [['https://other.example','same-origin'],['http://localhost:3080','same-origin'],['http://127.0.0.1:3080','cross-site']])assert.equal((await api(request(origin,site),'favorites')).status,403);
});
