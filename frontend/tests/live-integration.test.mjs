import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveState,liveCriteria,placeQueries,normalizePlace,mergePlaces,displayedFacilities,resetLiveRequest,acceptLiveResponse} from '../live-data.mjs';
import {searchKakao,loadKakaoSdk} from '../kakao-client.mjs';
import {searchFacilities,emptyCriteria} from '../facilities.mjs';
import {publicConfig,startServer} from '../server.mjs';
import {mountApp} from './dom-harness.mjs';
const raw=(id='101',group='HP8')=>({id,place_name:group==='HP8'?'테스트의원':'테스트약국',category_group_code:group,category_name:group==='HP8'?'의료 > 병원 > 내과':'의료 > 약국',x:'127.03',y:'37.51',phone:'02-000-0000',road_address_name:'서울 테스트로 1',distance:'0',place_url:'javascript:bad'});
const result=(id,options={})=>({items:[normalizePlace(raw(id))],page:1,hasMore:false,nextCategories:[],...options});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setupLive(){
 const ui=mountApp();
 ui.run("state.source='live';state.live.configured=true;state.live.key='test-key';var requests=[];searchKakao=(key,criteria,options)=>new Promise((resolve,reject)=>requests.push({criteria,options,resolve,reject}));mountKakaoMap=()=>Promise.resolve();");
 ui.document.getElementById('skip').click();return ui;
}
function submit(ui,region){ui.document.getElementById('search-region').value=region;ui.document.getElementById('search-form').emit('submit');}
test('Place query categories reflect type and specialty without sending health information',()=>{
 const criteria={...emptyCriteria(),region:'춘천',allergies:'private',history:'private'};
 assert.deepEqual(placeQueries(criteria).map(q=>q.code),['HP8','PM9']);
 assert.deepEqual(placeQueries({...criteria,department:'internal'}),[{code:'HP8',keyword:'춘천 내과'}]);
 assert.deepEqual(placeQueries({...criteria,department:'pharmacy'}),[{code:'PM9',keyword:'춘천 약국'}]);
 assert.deepEqual(placeQueries({...criteria,type:'pharmacy',department:'internal'}),[]);
 assert.ok(!JSON.stringify(placeQueries(criteria)).includes('private'));
 assert.throws(()=>placeQueries(emptyCriteria()),/regionRequired/);
});
test('Provider normalization never manufactures opening status, photos, accessibility, or user distance',()=>{
 const item=normalizePlace(raw());
 assert.equal(item.lat,37.51);assert.equal(item.lng,127.03);assert.equal(item.source,'kakao');
 assert.equal(item.status,'unknown');assert.equal(item.hours,null);assert.equal(item.photo,null);assert.equal(item.distance,null);assert.equal(item.accessible,null);
 assert.equal(item.department,'internal');assert.equal(item.placeUrl,'https://place.map.kakao.com/101');
 assert.ok(item.directionsUrl.startsWith('https://map.kakao.com/link/to/'));
 for(const bad of [{...raw(),x:''},{...raw(),y:'NaN'},{...raw(),y:'190'},{...raw(),category_group_code:'FD6'},{...raw(),id:'"><img'}])assert.equal(normalizePlace(bad),null);
});
test('Loaded live results never fall back to the fictional catalog; ties retain provider order',()=>{
 const state={source:'live',live:{items:[]},search:{criteria:emptyCriteria()}};
 assert.deepEqual(displayedFacilities(state,searchFacilities),[]);
 state.live.items=[normalizePlace(raw('200'),0),normalizePlace(raw('100'),1)];
 assert.deepEqual(displayedFacilities(state,searchFacilities).map(x=>x.id),['kakao-200','kakao-100']);
 const filtered=liveCriteria({...emptyCriteria(),openOnly:true,priority:'access',sort:'distance'});
 assert.equal(filtered.openOnly,true);assert.equal(filtered.priority,'provider');assert.equal(filtered.sort,'distance');
 const merged=mergePlaces([state.live.items[0]],[state.live.items[0],state.live.items[1]]);
 assert.equal(merged.length,2);
});
test('Only the latest live request can replace state, while pagination deduplicates by provider id',()=>{
 const one=resetLiveRequest(createLiveState(),{...emptyCriteria(),region:'춘천'});
 const two=resetLiveRequest(one,{...emptyCriteria(),region:'서울'});
 assert.equal(acceptLiveResponse(two,one.token,result('101')),two);
 const accepted=acceptLiveResponse(two,two.token,result('101'));
 const appended=acceptLiveResponse(accepted,accepted.token,{...result('102'),items:[...accepted.items,...result('102').items]},{append:true});
 assert.deepEqual(appended.items.map(x=>x.id),['kakao-101','kakao-102']);
});
test('Kakao callback contract, per-category pagination, and partial failure use the documented shape',async()=>{
 const calls=[];
 const api={maps:{services:{Status:{OK:'OK',ZERO_RESULT:'ZERO_RESULT'},Places:class{keywordSearch(keyword,callback,options){calls.push({keyword,options});callback([raw(options.category_group_code==='HP8'?'101':'102',options.category_group_code)],'OK',{hasNextPage:options.category_group_code==='HP8'});}}}}};
 const first=await searchKakao('',{...emptyCriteria(),region:'춘천'},{api});
 assert.equal(first.items.length,2);assert.deepEqual(first.nextCategories,['HP8']);assert.equal(calls[0].options.size,15);
 const next=await searchKakao('',{...emptyCriteria(),region:'춘천'},{api,page:2,categories:first.nextCategories});
 assert.equal(next.items.length,1);assert.equal(calls.at(-1).options.page,2);
 api.maps.services.Places=class{keywordSearch(query,callback){callback([],'ZERO_RESULT',{});}};
 assert.equal((await searchKakao('',{...emptyCriteria(),region:'춘천'},{api})).items.length,0);
 api.maps.services.Places=class{keywordSearch(query,callback){callback([],'ERROR',{});}};
 await assert.rejects(searchKakao('',{...emptyCriteria(),region:'춘천'},{api}),/searchFailed/);
 api.maps.services.Places=class{keywordSearch(){}};
 await assert.rejects(searchKakao('',{...emptyCriteria(),region:'춘천'},{api,timeoutMs:5}),/searchTimeout/);
 api.maps.services.Places=class{keywordSearch(){throw Error('sdk');}};
 await assert.rejects(searchKakao('',{...emptyCriteria(),region:'춘천'},{api}),/searchFailed/);
});
test('SDK failure cleans up and successful concurrent loads share one script',async()=>{
 let removed=0;
 const failedDoc={createElement:()=>({remove(){removed++;}}),head:{appendChild(script){queueMicrotask(()=>script.onerror());}}};
 await assert.rejects(loadKakaoSdk('key',{document:failedDoc,window:{},timeoutMs:20}),/mapLoadFailed/);
 assert.equal(removed,1);
 let script,count=0;const win={};
 const doc={createElement:()=>({remove(){}}),head:{appendChild(node){script=node;count++;}}};
 const a=loadKakaoSdk('public-key',{document:doc,window:win,timeoutMs:100});
 const b=loadKakaoSdk('public-key',{document:doc,window:win,timeoutMs:100});
 assert.equal(a,b);assert.equal(count,1);assert.ok(script.src.includes('autoload=false'));assert.ok(script.src.includes('libraries=services'));
 win.kakao={maps:{Map:class{},MarkerClusterer:class{},services:{Places:class{}},load:callback=>callback()}};
 script.onload();assert.equal(await a,win.kakao);
});
test('Application ignores stale responses and preserves an unsent message during live completion',async()=>{
 const ui=setupLive();await tick();
 submit(ui,'춘천');await tick();assert.equal(ui.run('requests.length'),1);
 submit(ui,'서울');await tick();assert.equal(ui.run('requests.length'),2);
 ui.document.getElementById('chat-open')?.click();ui.document.getElementById('composer-input').value='작성 중';
 ui.run('requests[1].resolve('+JSON.stringify(result('202'))+')');await tick();
 ui.run('requests[0].resolve('+JSON.stringify(result('101'))+')');await tick();
 assert.deepEqual(ui.document.querySelectorAll('.facility-card').map(x=>x.dataset.card),['kakao-202']);
 assert.equal(ui.document.getElementById('composer-input').value,'작성 중');
 assert.ok(!ui.app.innerHTML.includes('clinic-demo.png'));
 assert.ok(ui.app.innerHTML.includes('내 위치를 확인하면 거리가 나와요'));
 ui.document.querySelectorAll('[data-facility]')[0].click();
 assert.ok(ui.app.innerHTML.includes('href="tel:020000000"'));
 assert.ok(ui.app.innerHTML.includes('https://map.kakao.com/link/to/'));
 assert.ok(!ui.app.innerHTML.includes('data-demo-action'));
});
test('Loading more preserves list position and a newer real search invalidates pending results',async()=>{
 const ui=setupLive();await tick();submit(ui,'서울');await tick();
 ui.run('requests[0].resolve('+JSON.stringify(result('101',{hasMore:true,nextCategories:['HP8']}))+')');await tick();
 ui.document.querySelector('.facility-results').scrollTop=190;
 ui.document.getElementById('live-more').click();
 assert.equal(ui.document.querySelector('.facility-results').scrollTop,190);
 ui.run('requests[1].resolve('+JSON.stringify(result('102',{page:2}))+')');await tick();
 assert.equal(ui.document.querySelector('.facility-results').scrollTop,190);
 assert.equal(ui.document.querySelectorAll('.facility-card').length,2);
 submit(ui,'춘천');await tick();
 submit(ui,'Seoul');await tick();
 ui.run('requests[2].resolve('+JSON.stringify(result('999'))+')');await tick();
 assert.equal(ui.document.querySelectorAll('.facility-card').length,0);
 assert.ok(!ui.app.innerHTML.includes('kakao-999'));
});
test('Live errors remain explicit and do not show sample institutions',async()=>{
 const ui=setupLive();await tick();submit(ui,'춘천');await tick();
 ui.run("requests[0].reject(Error('searchFailed'))");await tick();
 assert.equal(ui.document.querySelectorAll('.facility-card').length,0);
 assert.ok(ui.document.getElementById('live-retry'));
 assert.ok(!ui.app.innerHTML.includes('예시 내과 A'));
});
test('Public configuration exposes only the JavaScript map key; environment files remain inaccessible',async()=>{
 const env={KAKAO_JAVASCRIPT_KEY:'public-test-key',KAKAO_REST_API_KEY:'not-public',OPENAI_API_KEY:'also-private'};
 assert.deepEqual(Object.keys(publicConfig(env)),['map','publicData','routing']);
 assert.ok(!JSON.stringify(publicConfig(env)).includes('not-public'));assert.ok(!JSON.stringify(publicConfig(env)).includes('also-private'));
 const server=await startServer({port:0,log:()=>{},env});
 const request=(url,method='GET')=>new Promise(resolve=>{
  let status,headers;
  server.emit('request',{url,method},{writeHead(code,value){status=code;headers=value;},end(body){resolve({status,headers,body});}});
 });
 try{
  const config=await request('/api/config');assert.equal(config.status,200);assert.equal(JSON.parse(config.body).map.javascriptKey,'public-test-key');
  assert.equal((await request('/.env')).status,404);
  assert.equal((await request('/api/config','POST')).status,405);
  for(const path of ['/live-data.mjs','/kakao-client.mjs','/clinic-demo.png']){
   const response=await request(path);assert.equal(response.status,200);assert.ok(response.body.length>0);
   assert.ok(response.headers['Content-Security-Policy'].includes("connect-src 'self' https://dapi.kakao.com"));
  }
 }finally{await new Promise(resolve=>server.close(resolve));}
});


test('Empty map mounts immediately; native clusters clean up, selected pins zoom, map survives rerenders',async()=>{
 const sdk=await import('../kakao-client.mjs');
 const oldDocument=globalThis.document,oldWindow=globalThis.window,oldObserver=globalThis.ResizeObserver;
 let currentNode={clientWidth:500,clientHeight:400},constructors=0,boundsFits=0,disconnected=0;
 const markers=[],overlays=[],clusters=[],selected=[],levels=[],routeLines=[];
 const api={maps:{services:{Places:class{}},Map:class{
  constructor(node,{center,level}){constructors++;this.center=center;this.level=level;}
  addControl(){}getCenter(){return this.center;}setCenter(value){this.center=value;}relayout(){}
  getLevel(){return this.level;}setLevel(value){levels.push(value);this.level=value;}
  setBounds(){boundsFits++;}panTo(point){this.center=point;}
 },LatLng:class{constructor(lat,lng){this.lat=lat;this.lng=lng;}getLat(){return this.lat;}getLng(){return this.lng;}},
 LatLngBounds:class{extend(){}},Polyline:class{constructor(options){this.options=options;this.map=options.map;routeLines.push(this);}setMap(map){this.map=map;}},ZoomControl:class{},ControlPosition:{RIGHT:'right'},
 Size:class{},Point:class{},MarkerImage:class{constructor(url){this.url=url;}},
 event:{addListener(target,type,fn){target[type]=fn;}},
 Marker:class{constructor(options){this.options=options;markers.push(this);}setMap(value){this.map=value;}},
 MarkerClusterer:class{
  constructor(options){this.options=options;this.markers=[];clusters.push(this);}
  clear(){for(const marker of this.markers)marker.setMap(null);this.markers=[];}
  addMarkers(items){this.markers=items;for(const marker of items)marker.setMap(this.options.map);}
 },
 CustomOverlay:class{constructor(options){this.options=options;overlays.push(this);}setMap(value){this.map=value;}}
 }};
 const doc={getElementById:()=>currentNode,createElement:()=>({events:{},setAttribute(){},addEventListener(key,handler){this.events[key]=handler;}})};
 globalThis.document=doc;globalThis.window={kakao:api};
 globalThis.ResizeObserver=class{observe(){}disconnect(){disconnected++;}};
 try{
  await sdk.mountKakaoMap('test',[],null,()=>{});
  assert.equal(constructors,1);assert.equal(clusters[0].markers.length,0);
  assert.equal(clusters[0].options.texts(7),'7');assert.equal(clusters[0].options.minLevel,4);
  const items=[normalizePlace(raw('101')),normalizePlace(raw('102'))];
  const original=currentNode;
  currentNode={clientWidth:700,clientHeight:400,replaceWith(node){currentNode=node;}};
  await sdk.mountKakaoMap('test',items,null,id=>selected.push(id));
  await sdk.mountKakaoMap('test',items,'kakao-102',id=>selected.push(id));
  assert.equal(constructors,1);assert.equal(currentNode,original);assert.equal(boundsFits,1);
  assert.equal(markers.filter(marker=>marker.map).length,2);
  assert.deepEqual(levels,[3]);
  assert.ok(decodeURIComponent(clusters[0].markers[1].options.image.url).includes('#f97316'));
  clusters[0].markers[1].click();assert.deepEqual(selected,['kakao-102']);
  assert.equal(overlays.filter(overlay=>overlay.map).length,1);
  const point={lat:37.5,lng:127};
  await sdk.mountKakaoMap('test',items,null,()=>{},{center:point,recenterToken:0});
  const map=clusters[0].options.map;
  map.setCenter(new api.maps.LatLng(35,129));
  await sdk.mountKakaoMap('test',items,null,()=>{},{center:point,recenterToken:0});
  assert.equal(map.getCenter().getLat(),35,'ordinary rerender preserves user pan');
  assert.deepEqual(sdk.getKakaoMapCenter(),{lat:35,lng:129});
  await sdk.mountKakaoMap('test',items,null,()=>{},{center:point,recenterToken:1});
  assert.equal(map.getCenter().getLat(),37.5,'explicit recenter works even for unchanged location');
  const routeOptions={routePaths:[[[127,37.5],[127.01,37.51]]],routeKey:'walk-route'};
  await sdk.mountKakaoMap('test',items,'kakao-102',()=>{},routeOptions);
  assert.equal(routeLines.filter(line=>line.map).length,1);
  assert.equal(routeLines.at(-1).options.path[0].getLat(),37.5);
  const fitsWithRoute=boundsFits;
  await sdk.mountKakaoMap('test',items,'kakao-102',()=>{},routeOptions);
  assert.equal(boundsFits,fitsWithRoute,'same route never resets a user pan');
  assert.equal(routeLines.filter(line=>line.map).length,1,'old route geometry is cleaned up');
  await sdk.mountKakaoMap('test',items,null,()=>{});
  assert.equal(routeLines.filter(line=>line.map).length,0,'closing details removes geometry');
  await sdk.mountKakaoMap('test',items,'kakao-102',()=>{},routeOptions);
  sdk.releaseKakaoMap();
  assert.equal(routeLines.filter(line=>line.map).length,0,'release removes all route geometry');
  assert.equal(markers.filter(marker=>marker.map).length,0);assert.equal(disconnected,1);
  assert.equal(overlays.filter(overlay=>overlay.map).length,0);
 }finally{sdk.releaseKakaoMap();globalThis.document=oldDocument;globalThis.window=oldWindow;globalThis.ResizeObserver=oldObserver;}
});
