import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRoute,createRoutingProxy} from '../routing-server.mjs';
import {routeQuery,kakaoRouteLink,routeEntry} from '../routing.mjs';
import {startServer,publicConfig} from '../server.mjs';
import {mountApp} from './dom-harness.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const walk={status:'OK',route:{properties:{totalDistance:1700,totalTime:1350},legs:[{steps:[{properties:{guidance:'우회전',distance:200,time:100},path:{points:[[127,37],[127.01,37.01]]}}]}]}};
const traffic={status:'OK',routes:[{properties:{totalDistance:4200,totalTime:900},steps:[{properties:{guidance:'버스 10번 탑승',distance:3000,time:600},path:{points:[[127,37],[127.01,37.01]]}}]}]};
const car={routes:[{result_code:0,summary:{distance:3000,duration:500},sections:[{roads:[{vertexes:[127,37,127.02,37.02]}],guides:[{guidance:'목적지 도착',distance:3000,duration:500}]}]}]};
async function proxyCall(proxy,query){
 let result;await proxy(new URL('http://local/api/route?'+query),{writeHead(status){result={status};},end(body){result.body=JSON.parse(body);}});return result;
}
const query='mode=walk&startLat=37&startLng=127&endLat=37.01&endLng=127.01';
test('Normalizes documented walking, transit and driving distances, durations and geometry',()=>{
 const a=normalizeRoute(walk,'walk'),b=normalizeRoute(traffic,'traffic'),c=normalizeRoute(car,'car');
 assert.equal(a.distanceMeters,1700);assert.equal(a.durationSeconds,1350);assert.equal(b.distanceMeters,4200);assert.equal(c.durationSeconds,500);
 for(const value of [a,b,c]){assert.equal(value.paths[0][0][0],127);assert.ok(value.steps[0].guidance);}
 assert.throws(()=>normalizeRoute({status:'NO_RESULTS'},'traffic'),/routeNotFound/);
 assert.throws(()=>normalizeRoute({status:'OK',route:{properties:{totalDistance:null,totalTime:1}}},'walk'),/routeInvalidResponse/);
});
test('Proxy uses fixed official endpoints and server-only Authorization with correct coordinate order',async()=>{
 const calls=[],proxy=createRoutingProxy({KAKAO_REST_API_KEY:'secret-route-key'},{fetcher:async(url,options)=>{calls.push({url,options});return {ok:true,text:async()=>JSON.stringify(url.hostname==='apis-navi.kakaomobility.com'?car:url.pathname.endsWith('publictraffic')?traffic:walk)};}});
 for(const mode of ['walk','traffic','car'])assert.equal((await proxyCall(proxy,query.replace('mode=walk','mode='+mode))).status,200);
 assert.equal(calls[0].url.href.startsWith('https://dapi.kakao.com/v2/routing/walk?'),true);
 assert.equal(calls[1].url.pathname,'/v2/routing/publictraffic');
 assert.equal(calls[2].url.searchParams.get('origin'),'127,37');
 assert.equal(calls[2].url.hostname,'apis-navi.kakaomobility.com');
 assert.equal(calls[0].options.headers.Authorization,'KakaoAK secret-route-key');
 assert.equal(calls[0].options.redirect,'error');
 assert.equal(calls[0].url.searchParams.get('start_x'),'127');
 assert.doesNotMatch(JSON.stringify(publicConfig({KAKAO_REST_API_KEY:'secret-route-key'})),/secret-route-key/);
});
test('Proxy deduplicates concurrent requests, caches briefly and expires route estimates',async()=>{
 let count=0,time=0;const proxy=createRoutingProxy({KAKAO_REST_API_KEY:'key'},{now:()=>time,fetcher:async()=>{count++;return {ok:true,text:async()=>JSON.stringify(walk)};}});
 await Promise.all([proxyCall(proxy,query),proxyCall(proxy,query)]);assert.equal(count,1);
 await proxyCall(proxy,query);assert.equal(count,1);time=120001;await proxyCall(proxy,query);assert.equal(count,2);
});
test('Missing keys, invalid coordinates, upstream failures and quota never create estimated substitutes or expose secrets',async()=>{
 const noKey=createRoutingProxy({});assert.equal((await proxyCall(noKey,query)).body.error,'routeKeyMissing');
 for(const bad of [query.replace('mode=walk','mode=https://evil.example'),query.replace('startLat=37','startLat='),query.replace('endLng=127.01','endLng=181')])assert.equal((await proxyCall(noKey,bad)).status,400);
 for(const [status,error] of [[403,'routeAuthFailed'],[429,'routeQuotaExceeded'],[500,'routeUpstreamFailed']]){
  const proxy=createRoutingProxy({KAKAO_REST_API_KEY:'private'},{fetcher:async()=>({ok:false,status,text:async()=>'private'})});
  const response=await proxyCall(proxy,query);assert.equal(response.body.error,error);assert.doesNotMatch(JSON.stringify(response),/private|distanceMeters/);
 }
 const noRoute=createRoutingProxy({KAKAO_REST_API_KEY:'key'},{fetcher:async()=>({ok:true,text:async()=>JSON.stringify({status:'NO_RESULTS'})})});
 assert.equal((await proxyCall(noRoute,query)).body.error,'routeNotFound');
});
test('Official links encode names and modes and never use map center as departure',()=>{
 const origin={lat:37,lng:127},dest={lat:37.01,lng:127.01,name:{ko:'병원/#?'}};
 for(const mode of ['walk','traffic','car']){
  const link=kakaoRouteLink(mode,origin,dest);assert.match(link,new RegExp('/link/by/'+mode+'/'));assert.match(link,/37,127/);assert.match(link,/%2F%23%3F/);
 }
 assert.match(kakaoRouteLink('walk',null,dest),/\/link\/to\//);
 assert.equal(routeQuery('bicycle',origin,dest),'');
 const state={routing:{mode:'walk',cache:{}},live:{position:origin}};
 state.routing.cache[routeQuery('walk',origin,dest)]={expires:Date.now()-1,data:{distanceMeters:1}};
 assert.equal(routeEntry(state,dest),null);
});
function browserRoutes(){
 const ui=mountApp();
 ui.run("state.source='live';state.view='explore';state.live.configured=true;state.live.routingConfigured=true;state.live.locationAttempted=true;state.live.position={lat:37,lng:127};state.live.items=Array.from({length:4},(_,i)=>({id:'kakao-'+i,source:'kakao',providerOrder:i,lat:37.01+i*.001,lng:127.01,name:{ko:'병원'+i,en:'Clinic'+i},area:{ko:'서울',en:'Seoul'},type:'hospital',status:'unknown',categoryLabel:'병원',access:{ko:'',en:''}}));state.search.initialized=true;state.search.criteria={...emptyCriteria(),region:'Seoul',sort:'distance'};state.live.queryKey=liveQueryKey(state.search.criteria);mountKakaoMap=(...args)=>{window.lastMapOptions=args[4]};var routeCalls=[];globalThis.fetch=(url,options)=>new Promise(resolve=>routeCalls.push({url,options,resolve}));render();");
 return ui;
}
test('Search and details make zero route calls; directions request only the selected destination and reuse cache',async()=>{
 const ui=browserRoutes();await tick();assert.equal(ui.run('routeCalls.length'),0);
 ui.run("state.search.selectedId='kakao-0';render()");await tick();assert.equal(ui.run('routeCalls.length'),0);
 ui.document.getElementById('route-toggle').click();await tick();assert.equal(ui.run('routeCalls.length'),1);
 ui.run("routeCalls[0].resolve({ok:true,json:async()=>({distanceMeters:1700,durationSeconds:1350,steps:[],paths:[]})})");await tick();
 assert.match(ui.app.innerHTML,/1.7 km/);
 assert.equal(ui.run("displayedFacilities(state,searchFacilities).filter(i=>i.distance!==null).length"),4);
 ui.document.getElementById('route-toggle').click();ui.document.getElementById('route-toggle').click();await tick();
 assert.equal(ui.run('routeCalls.length'),1);
 ui.run("navigate('report')");await tick();assert.equal(ui.run('routeCalls.length'),1);
});
test('Mode switching and location changes ignore older route responses and clear prior geometry',async()=>{
 const ui=browserRoutes();await tick();
 ui.run("state.search.selectedId='kakao-0';render()");ui.document.getElementById('route-toggle').click();await tick();
 ui.document.querySelectorAll('[data-travel-mode]').find(n=>n.dataset.travelMode==='car').click();await tick();
 assert.equal(ui.run('routeCalls.length'),2);
 ui.run("routeCalls[0].resolve({ok:true,json:async()=>({distanceMeters:1700,durationSeconds:1350,paths:[],steps:[]})})");await tick();
 assert.doesNotMatch(ui.app.innerHTML,/1.7 km/);assert.equal(ui.run('state.routing.mode'),'car');
 assert.match(ui.app.innerHTML,/\/link\/by\/car/);
 ui.run("routeCalls[1].resolve({ok:true,json:async()=>({distanceMeters:3000,durationSeconds:500,steps:[{guidance:'<img src=x>'}],paths:[[[127,37],[127.01,37.01]]]})})");await tick();
 assert.match(ui.app.innerHTML,/3.0 km/);assert.match(ui.app.innerHTML,/&lt;img src=x&gt;/);
 assert.equal(ui.run('window.lastMapOptions.routePaths.length'),1);
 ui.run("state.live.position={lat:38,lng:128};render()");assert.equal(ui.run('window.lastMapOptions.routePaths.length'),0);assert.doesNotMatch(ui.app.innerHTML,/3.0 km/);
});
test('Without routing configuration or location, directions remain usable and no false distance appears',()=>{
 const ui=mountApp();ui.run("state.source='live';state.view='explore';state.live.configured=true;state.live.locationAttempted=true;state.live.items=[{id:'kakao-1',source:'kakao',lat:37,lng:127,name:{ko:'병원',en:'Clinic'},area:{ko:'서울',en:'Seoul'},access:{ko:'',en:''},type:'hospital',status:'unknown'}];state.search.selectedId='kakao-1';state.live.queryKey=liveQueryKey(state.search.criteria);mountKakaoMap=()=>{};render()");
 assert.equal(ui.document.getElementById('route-heading'),null);ui.document.getElementById('route-toggle').click();
 assert.match(ui.app.innerHTML,/내 위치를 확인하면/);assert.match(ui.app.innerHTML,/\/link\/to\//);
 assert.doesNotMatch(ui.app.innerHTML,/직선 약|NaN/);
});
test('HTTP routing integration serves browser helper but protects routing server module and REST key',async()=>{
 const server=await startServer({port:0,log(){},env:{KAKAO_REST_API_KEY:'private-route'},fetcher:async()=>({ok:true,text:async()=>JSON.stringify(walk)})});
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const response=await fetch(base+'/api/route?'+query);assert.equal(response.status,200);assert.equal((await response.json()).distanceMeters,1700);
  assert.equal((await fetch(base+'/routing-server.mjs')).status,404);assert.equal((await fetch(base+'/routing.mjs')).status,200);
  assert.doesNotMatch(await (await fetch(base+'/api/config')).text(),/private-route/);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
