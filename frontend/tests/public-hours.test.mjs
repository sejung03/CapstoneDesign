import {renderFacilityPhoto} from '../facilities-view.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicDataProxy,publicDataKey} from '../public-data-server.mjs';
import {publicConfig,startServer} from '../server.mjs';
import {matchPublicFacility,readSchedule,evaluateSchedule,formatSlot,enrichPublicHours,parsePublicHours} from '../public-hours.mjs';
import {mountApp} from './dom-harness.mjs';
const xml='<response><header><resultCode>00</resultCode></header><body><items/></body></response>';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const invoke=(proxy,query)=>new Promise(resolve=>proxy(new URL('http://localhost/api/public-hours?'+query),{
 writeHead(status,headers){this.status=status;this.headers=headers;},
 end(body){resolve({status:this.status,headers:this.headers,body});}
}));
test('Public data key stays server-side, supports per-service keys and URL encoding exactly once',()=>{
 const env={PUBLIC_DATA_SERVICE_KEY:'test%2Bsecret%3D'};
 assert.equal(publicDataKey(env,'hospital'),'test+secret=');
 assert.equal(publicDataKey({...env,PUBLIC_DATA_PHARMACY_KEY:'separate'},'pharmacy'),'separate');
 assert.deepEqual(publicConfig(env).publicData,{configured:true});
 assert.ok(!JSON.stringify(publicConfig(env)).includes('secret'));
});
test('Hours proxy uses only documented fixed upstream endpoints and caches schedules',async()=>{
 let calls=0,target;
 const proxy=createPublicDataProxy({PUBLIC_DATA_SERVICE_KEY:'test+secret='},{fetcher:async url=>{
  calls++;target=url;return {ok:true,text:async()=>xml};
 }});
 const query=new URLSearchParams({type:'hospital',name:'테스트의원',province:'강원특별자치도',url:'https://evil.example',serviceKey:'injected'});
 const result=await invoke(proxy,query);
 assert.equal(result.status,200);
 assert.equal(target.host,'apis.data.go.kr');
 assert.ok(target.pathname.endsWith('getHsptlMdcncListInfoInqire'));
 assert.equal(target.searchParams.get('serviceKey'),'test+secret=');
 assert.equal(target.searchParams.get('QN'),'테스트의원');
 assert.equal(target.searchParams.get('Q0'),'강원특별자치도');
 assert.ok(!result.body.includes('secret'));
 await invoke(proxy,query);assert.equal(calls,1);
 await invoke(proxy,new URLSearchParams({type:'pharmacy',name:'테스트약국'}));
 assert.ok(target.pathname.endsWith('getParmacyListInfoInqire'));
});
test('Missing keys, bad input, auth failures and quota errors never reveal upstream bodies or keys',async()=>{
 assert.equal((await invoke(createPublicDataProxy({}),'type=hospital&name=test')).status,503);
 assert.equal((await invoke(createPublicDataProxy({}),'type=https://evil.example&name=test')).status,400);
 for(const [code,error] of [['30','hoursAuthFailed'],['22','hoursQuotaExceeded']]){
  const proxy=createPublicDataProxy({PUBLIC_DATA_SERVICE_KEY:'private-key'},{fetcher:async()=>({ok:true,text:async()=>'<response><resultCode>'+code+'</resultCode><resultMsg>private-key</resultMsg></response>'})});
  const response=await invoke(proxy,'type=hospital&name=test');
  assert.equal(JSON.parse(response.body).error,error);
  assert.ok(!response.body.includes('private-key'));
 }
 assert.throws(()=>parsePublicHours('<!DOCTYPE response SYSTEM "file:///secret">'),/hoursInvalidResponse/);
});
const place={id:'kakao-1',name:{ko:'테스트의원',en:'Test'},area:{ko:'강원특별자치도 춘천시 한림대학길 1',en:'Chuncheon'},phone:'033-123-4567',lat:37.88,lng:127.73,type:'hospital',source:'kakao',status:'unknown'};
const row={hpid:'A0000001',dutyName:'테스트의원',dutyAddr:'강원특별자치도 춘천시 한림대학길 1',dutyTel1:'0331234567',wgs84Lat:'37.88',wgs84Lon:'127.73',dutyTime1s:'0900',dutyTime1c:'1800'};
test('Facility matching requires exact name plus corroboration, and ambiguous branches remain unknown',()=>{
 assert.equal(matchPublicFacility(place,[row]).hpid,'A0000001');
 assert.equal(matchPublicFacility(place,[row,{...row,hpid:'A0000002'}]),null);
 assert.equal(matchPublicFacility(place,[{...row,dutyName:'다른의원'}]),null);
 assert.equal(matchPublicFacility(place,[{...row,dutyAddr:'서울특별시 강남구 다른길 2',dutyTel1:'0211112222',wgs84Lat:'37.5',wgs84Lon:'127.1'}]),null);
});
test('Schedules use Korean time, close exclusively, handle overnight hours, and keep absent data unknown',()=>{
 const schedule=readSchedule(row);
 assert.equal(evaluateSchedule(schedule,new Date('2026-10-26T00:00:00Z')).status,'open');
 assert.equal(evaluateSchedule(schedule,new Date('2026-10-26T09:00:00Z')).status,'closed');
 assert.equal(evaluateSchedule(schedule,new Date('2026-10-27T00:00:00Z')).status,'unknown');
 const overnight=readSchedule({...row,dutyTime1s:'2200',dutyTime1c:'0200'});
 assert.equal(evaluateSchedule(overnight,new Date('2026-10-26T16:00:00Z')).status,'open');
 assert.equal(evaluateSchedule(overnight,new Date('2026-10-26T17:00:00Z')).status,'unknown');
 assert.equal(formatSlot({start:'0900',end:'1800'}),'09:00–18:00');
 assert.equal(formatSlot({start:'0900',end:'9960'}),null);
 assert.equal(evaluateSchedule(readSchedule({...row,dutyTime8s:'1000',dutyTime8c:'1200'}),new Date('2026-10-26T01:00:00Z'),{holiday:true}).status,'open');
});
test('Enrichment preserves map identity and leaves unmatched or failed records unknown',async()=>{
 const result=await enrichPublicHours([place,{...place,id:'kakao-2',name:{ko:'다른의원'}}],{
  fetcher:async()=>({ok:true,text:async()=>xml}),parse:()=>[row]
 });
 assert.equal(result[0].id,'kakao-1');assert.equal(result[0].hoursSource,'nmc');
 assert.equal(result[0].schedule.length,8);assert.equal(result[0].photo,undefined);
 assert.equal(result[1].hoursError,'hoursNotMatched');
 const failed=await enrichPublicHours([place],{fetcher:async()=>({ok:false,json:async()=>({error:'hoursAuthFailed'})})});
 assert.equal(failed[0].status,'unknown');assert.equal(failed[0].hoursError,'hoursAuthFailed');
});
test('Browser exposes live open-only filtering and ignores stale enrichment',async()=>{
 const ui=mountApp();
 ui.run("state.source='live';state.live.configured=true;state.live.hoursConfigured=true;state.live.locationAttempted=true;mountKakaoMap=()=>Promise.resolve();var requests=[];searchKakao=()=>new Promise(resolve=>requests.push(resolve));var hours=[];enrichPublicHours=()=>new Promise(resolve=>hours.push(resolve));");
 ui.document.getElementById('skip').click();await tick();
 assert.ok(ui.document.getElementById('open-only'));
 ui.document.getElementById('search-region').value='Chuncheon';
 ui.document.getElementById('search-form').emit('submit');await tick();
 ui.run('requests[0]({items:['+JSON.stringify({...place,department:'other',region:place.area.ko,access:{ko:'',en:''}})+'],hasMore:false,page:1,nextCategories:[]})');await tick();
 ui.document.getElementById('search-region').value='Seoul';
 ui.document.getElementById('search-form').emit('submit');await tick();
 ui.run('hours[0]([{id:"stale",status:"open"}])');await tick();
 assert.ok(!ui.app.innerHTML.includes('data-card="stale"'));
});
test('HTTP hours route integrates proxy; server-only modules and env stay inaccessible',async()=>{
 const server=await startServer({port:0,log:()=>{},env:{PUBLIC_DATA_SERVICE_KEY:'secret'},fetcher:async()=>({ok:true,text:async()=>xml})});
 const req=url=>new Promise(resolve=>server.emit('request',{url,method:'GET'},{
 writeHead(status,headers){this.status=status;this.headers=headers;},
 end(body){resolve({status:this.status,body,headers:this.headers});}
 }));
 try{
  assert.equal((await req('/api/public-hours?type=hospital&name=test')).status,200);
  assert.equal((await req('/public-data-server.mjs')).status,404);
  assert.equal((await req('/.env')).status,404);
  assert.equal((await req('/public-hours.mjs')).status,200);
  assert.ok(!String((await req('/api/config')).body).includes('secret'));
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('A completed hours lookup renders weekday details and an applied open-only filter hides unknown facilities',async()=>{
 const ui=mountApp();
 ui.run("state.source='live';state.live.configured=true;state.live.hoursConfigured=true;state.live.locationAttempted=true;mountKakaoMap=()=>Promise.resolve();var requests=[];searchKakao=()=>new Promise(resolve=>requests.push(resolve));var hours=[];enrichPublicHours=()=>new Promise(resolve=>hours.push(resolve));");
 ui.document.getElementById('skip').click();await tick();
 const item={...place,department:'other',region:place.area.ko,access:{ko:'',en:''}};
 ui.document.getElementById('search-region').value='Chuncheon';
 ui.document.getElementById('search-form').emit('submit');await tick();
 ui.run('requests[0]({items:['+JSON.stringify(item)+'],hasMore:false,page:1,nextCategories:[]})');await tick();
 const schedule=Array.from({length:8},(_,i)=>({day:i+1,start:'0000',end:'2400'}));
 const open={...item,schedule,hoursSource:'nmc'},unknown={...item,id:'kakao-2',name:{ko:'미확인의원',en:'Unknown'}};
 ui.run('hours[0]('+JSON.stringify([open,unknown])+')');await tick();
 assert.equal(ui.document.querySelectorAll('.facility-card').length,2);
 ui.document.querySelectorAll('[data-facility]').find(n=>n.attributes.class==='facility-detail-button').click();
 assert.ok(ui.document.querySelector('.weekly-hours'));
 assert.ok(ui.app.innerHTML.includes('00:00'));
 ui.document.getElementById('close-detail').click();
 ui.document.getElementById('open-only').checked=true;
 ui.document.getElementById('search-form').emit('submit');await tick();
 ui.run('requests[1]({items:'+JSON.stringify([item,unknown])+',hasMore:false,page:1,nextCategories:[]})');await tick();
 ui.run('hours[1]('+JSON.stringify([open,unknown])+')');await tick();
 assert.equal(ui.document.querySelectorAll('.facility-card').length,1);
 assert.equal(ui.document.querySelectorAll('.facility-card')[0].dataset.card,'kakao-1');
});

test('Matched records without usable hours differ from unmatchable facilities',async()=>{
 const blank={...row,dutyTime1s:'',dutyTime1c:''};
 const result=await enrichPublicHours([place],{fetcher:async()=>({ok:true,text:async()=>xml}),parse:()=>[blank]});
 assert.equal(result[0].hoursError,'hoursScheduleMissing');
 assert.equal(result[0].status,'unknown');
 assert.equal(result[0].publicId,row.hpid);
});
test('Live type illustration has no photo browsing action',()=>{
 const item={...place,photo:null,placeUrl:'https://place.map.kakao.com/1'};
 const html=renderFacilityPhoto(item,key=>key,value=>String(value),{detail:true});
 assert.ok(html.includes('facility-illustration'));assert.ok(!html.includes('facilityArtNote'));
 assert.ok(!html.includes('>noPhoto<'));
 assert.ok(!html.includes('href="https://place.map.kakao.com/1"'));
 assert.ok(!html.includes('viewProviderPhotos'));
 assert.ok(!html.includes('<img'));
});
