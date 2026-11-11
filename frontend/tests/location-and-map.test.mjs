import test from 'node:test';
import assert from 'node:assert/strict';
import {requestLocation,searchKakao} from '../kakao-client.mjs';
import {emptyCriteria} from '../facilities.mjs';
import {mountApp} from './dom-harness.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('Geolocation handles success, denial, timeout, missing support and invalid coordinates',async()=>{
 let options;
 assert.deepEqual(await requestLocation({getCurrentPosition(ok,fail,value){options=value;ok({coords:{latitude:37.5,longitude:127,accuracy:50}});}}),{lat:37.5,lng:127,accuracy:50});
 assert.equal(options.timeout,15000);assert.equal(options.enableHighAccuracy,true);assert.equal(options.maximumAge,0);
 await assert.rejects(requestLocation({getCurrentPosition(ok,fail){fail({code:1});}}),/locationUnavailable/);
 await assert.rejects(requestLocation({getCurrentPosition(ok,fail){fail({code:3});}}),/locationUnavailable/);
 await assert.rejects(requestLocation(null),/locationUnavailable/);
 await assert.rejects(requestLocation({getCurrentPosition(ok){ok({coords:{latitude:NaN,longitude:127}});}}),/locationUnavailable/);
});
test('Nearby search uses category coordinates and radius, and specialty stays a keyword',async()=>{
 const calls=[];
 const api={maps:{LatLng:class{constructor(lat,lng){this.lat=lat;this.lng=lng;}},services:{SortBy:{DISTANCE:'distance'},Status:{OK:'OK',ZERO_RESULT:'ZERO_RESULT'},Places:class{
  categorySearch(code,callback,options){calls.push({kind:'category',code,options});callback([],'ZERO_RESULT',{});}
  keywordSearch(keyword,callback,options){calls.push({kind:'keyword',keyword,options});callback([],'ZERO_RESULT',{});}
 }}}};
 const criteria={...emptyCriteria(),center:{lat:37.5,lng:127}};
 await searchKakao('',criteria,{api});
 assert.deepEqual(calls.map(call=>call.code),['HP8','PM9']);
 assert.ok(calls.every(call=>call.options.radius===5000&&call.options.location.lat===37.5&&call.options.sort==='distance'));
 calls.length=0;
 await searchKakao('',{...criteria,department:'internal'},{api});
 assert.equal(calls.length,1);assert.equal(calls[0].kind,'keyword');assert.ok(!calls[0].keyword.includes('nearby'));
});
function setupLocation(){
 const ui=mountApp();
 ui.run("state.source='live';state.live.configured=true;state.live.key='test';var geoCalls=0;var resolveGeo,rejectGeo,refineGeo;requestLocation=(_geo,options)=>{refineGeo=options?.onRefine;geoCalls++;return new Promise((resolve,reject)=>{resolveGeo=resolve;rejectGeo=reject;});};var requests=[];searchKakao=(key,criteria)=>new Promise(resolve=>requests.push({criteria,resolve}));var mapCalls=[];mountKakaoMap=(key,items,selection,callback,options)=>{mapCalls.push({items,selection,options});return Promise.resolve();};");
 ui.document.getElementById('skip').click();return ui;
}
test('Map opens before search, location starts nearby lookup once, and coordinates are not persisted',async()=>{
 const ui=setupLocation();await tick();
 assert.equal(ui.run('geoCalls'),1);
 assert.ok(ui.run('mapCalls.length')>0);assert.equal(ui.run('mapCalls[0].items.length'),0);
 assert.equal(ui.run('requests.length'),0);
 ui.run('resolveGeo({lat:37.5,lng:127})');await tick();
 assert.equal(ui.run('requests.length'),1);
 assert.equal(ui.run('requests[0].criteria.center.lat'),37.5);
 assert.equal(ui.run('requests[0].criteria.region'),'');
 ui.document.getElementById('language').click();await tick();
 assert.equal(ui.run('geoCalls'),1);
 assert.ok(!JSON.stringify([...ui.storage]).includes('37.5'));
});
test('Location denial leaves the map available and manual search works',async()=>{
 const ui=setupLocation();await tick();
 ui.run("rejectGeo(Error('locationUnavailable'))");await tick();
 assert.ok(ui.document.getElementById('kakao-map'));
 assert.equal(ui.run('geoCalls'),1);
 ui.document.getElementById('search-region').value='Seoul';
 ui.document.getElementById('search-form').emit('submit');await tick();
 assert.equal(ui.run('requests[0].criteria.region'),'Seoul');
});
test('Late location response never replaces a manual search or unsubmitted area',async()=>{
 for(const submitted of [false,true]){
  const ui=setupLocation();await tick();
  ui.document.getElementById('search-region').value='Busan';
  if(submitted){ui.document.getElementById('search-form').emit('submit');await tick();}
  ui.run('resolveGeo({lat:37.5,lng:127})');await tick();
  assert.equal(ui.document.getElementById('search-region').value,'Busan');
  assert.ok(ui.run('state.search.criteria.center==null'));
  if(submitted)assert.equal(ui.run('state.search.criteria.region'),'Busan');
 }
});
test('Whole-card click and keyboard focus the map without replacing the result list',()=>{
 const ui=mountApp();ui.document.getElementById('skip').click();
 ui.document.querySelector('.facility-results').scrollTop=145;
 let cards=ui.document.querySelectorAll('[data-card]');
 const id=cards[0].dataset.card;
 cards[0].click();
 assert.equal(ui.run('state.search.focusedId'),id);
 assert.equal(ui.document.getElementById('detail-heading'),null);
 assert.equal(ui.document.querySelectorAll('[data-card]').length,6);
 assert.equal(ui.document.querySelector('.facility-results').scrollTop,145);
 assert.ok(ui.document.querySelectorAll('[data-card]')[0].attributes.class.includes('is-selected'));
 cards=ui.document.querySelectorAll('[data-card]');cards[1].emit('keydown',{key:'Enter'});
 assert.equal(ui.run('state.search.focusedId'),cards[1].dataset.card);
 ui.document.querySelectorAll('[data-facility]').find(node=>node.tagName==='BUTTON'&&node.attributes.class==='facility-detail-button').click();
 assert.ok(ui.document.getElementById('detail-heading'));
});

test('My location explicitly recenters for unchanged coordinates and unavailable controls are absent',async()=>{
 const ui=setupLocation();await tick();
 assert.ok(ui.document.getElementById('search-map-area'));
 assert.equal(ui.document.getElementById('open-only'),null);
 assert.ok(ui.document.querySelector('.search-hours-note'));
 ui.run('resolveGeo({lat:37.5,lng:127})');await tick();
 ui.run("state.search.focusedId='kakao-123';");
 ui.document.getElementById('locate-me').click();
 assert.equal(ui.run('geoCalls'),2);
 ui.run('resolveGeo({lat:37.5,lng:127})');await tick();
 assert.equal(ui.run('state.live.recenterToken'),1);
 assert.equal(ui.run('mapCalls.at(-1).options.recenterToken'),1);
 assert.equal(ui.run('state.search.focusedId'),null);
});
test('Permission errors retain a visible explanation after the location request ends',async()=>{
 const ui=setupLocation();await tick();
 ui.run("rejectGeo(Object.assign(Error('locationUnavailable'),{code:1}))");await tick();
 assert.equal(ui.run('state.live.locationError'),'locationPermissionDenied');
 assert.ok(ui.document.querySelector('.location-error'));
 assert.ok(ui.document.getElementById('kakao-map'));
});

test('Fresh coordinates retain reported accuracy without altering latitude or longitude',async()=>{
 const point=await requestLocation({getCurrentPosition(ok){
  ok({coords:{latitude:37.123456,longitude:127.654321,accuracy:240},timestamp:123456789});
 }});
 assert.deepEqual(point,{lat:37.123456,lng:127.654321,accuracy:240,timestamp:123456789});
 const ui=setupLocation();await tick();
 ui.run('resolveGeo('+JSON.stringify(point)+')');await tick();
 assert.equal(ui.run('state.search.criteria.center.lat'),37.123456);
 assert.equal(ui.run('state.search.criteria.center.lng'),127.654321);
 assert.equal(ui.run('mapCalls.at(-1).options.center.lat'),37.123456);
 assert.equal(ui.run('mapCalls.at(-1).options.center.lng'),127.654321);
 assert.equal(ui.run('mapCalls.at(-1).options.userLocation.accuracy'),240);
 assert.ok(!ui.app.innerHTML.includes('240 m'));
 assert.equal(ui.document.querySelector('.location-accuracy'),null);
 ui.document.getElementById('language').click();
 assert.ok(!ui.app.innerHTML.includes('Estimated location'));
 assert.ok(!JSON.stringify([...ui.storage]).includes('37.123456'));
});


test('Separate map button uses the visible center and can repeat the search; text Search never reuses it',async()=>{
 const ui=setupLocation();await tick();
 ui.run("getKakaoMapCenter=()=>({lat:35.18,lng:129.07});");
 ui.document.getElementById('search-form').emit('submit');await tick();
 assert.equal(ui.run('requests.length'),0,'empty text search does not query the map');
 ui.document.getElementById('search-region').value='Seoul';
 ui.document.getElementById('facility-type').value='pharmacy';
 ui.document.getElementById('search-map-area').click();await tick();
 assert.equal(ui.run('requests.length'),1);
 assert.equal(ui.run('requests[0].criteria.center.lat'),35.18);
 assert.equal(ui.run('requests[0].criteria.region'),'');
 assert.equal(ui.run('requests[0].criteria.type'),'pharmacy');
 assert.equal(ui.document.getElementById('search-region').value,'');
 assert.ok(ui.document.getElementById('search-map-area').attributes['aria-label']);
 ui.document.getElementById('search-map-area').click();await tick();
 assert.equal(ui.run('requests.length'),2);
 ui.run("getKakaoMapCenter=()=>({lat:33.5,lng:126.5});");
 ui.document.getElementById('search-map-area').click();await tick();
 assert.equal(ui.run('requests[2].criteria.center.lat'),33.5);
 ui.run('resolveGeo({lat:37.5,lng:127})');await tick();
 assert.equal(ui.run('state.search.criteria.center.lat'),33.5);
});
test('Typed area or facility search takes precedence over the current map center',async()=>{
 const ui=setupLocation();await tick();
 ui.run("getKakaoMapCenter=()=>({lat:35.18,lng:129.07});");
 ui.document.getElementById('search-region').value='Seoul';
 ui.document.getElementById('facility-type').value='pharmacy';
 ui.document.getElementById('search-form').emit('submit');await tick();
 assert.equal(ui.run('requests[0].criteria.region'),'Seoul');
 assert.equal(ui.run('requests[0].criteria.center'),null);
 assert.equal(ui.run('requests[0].criteria.type'),'pharmacy');
});


test('First location triggers immediate search even at 50km accuracy, without invented coordinates',async()=>{
 const point=await requestLocation({getCurrentPosition(ok){
  ok({coords:{latitude:37.8741,longitude:127.7474,accuracy:50000}});
 }});
 assert.equal(point.accuracy,50000);
 const ui=setupLocation();await tick();
 ui.run('resolveGeo('+JSON.stringify(point)+')');await tick();
 assert.equal(ui.run('state.live.position.lat'),37.8741);
 assert.equal(ui.run('requests.length'),1);
 assert.equal(ui.run('requests[0].criteria.center.lng'),127.7474);
 assert.ok(!ui.app.innerHTML.includes('50.0 km'));
 assert.equal(ui.run('state.live.locationError'),'');
});

test('Coarse and unknown accuracy remain usable without rejecting valid coordinates',async()=>{
 const geo=accuracy=>({getCurrentPosition(ok){ok({coords:{latitude:37.8,longitude:127.7,accuracy}});}});
 for(const value of [1000,1001,50000,undefined]){
  const point=await requestLocation(geo(value));assert.equal(point.lat,37.8);
 }
});


test('Bounded watch returns first fix immediately, adopts better fixes, ignores worse ones and cleans up',async()=>{
 let receive,failed,options;const cleared=[],updates=[];
 const geo={watchPosition(ok,error,value){receive=ok;failed=error;options=value;return 7;},clearWatch(id){cleared.push(id);}};
 const pending=requestLocation(geo,{onRefine:point=>updates.push(point),refinementMs:1000});
 receive({coords:{latitude:37.8741,longitude:127.7474,accuracy:50000}});
 assert.equal((await pending).accuracy,50000);
 assert.equal(options.enableHighAccuracy,true);assert.equal(options.maximumAge,0);
 receive({coords:{latitude:37.89,longitude:127.73,accuracy:200}});
 assert.equal(updates.length,1);
 receive({coords:{latitude:37.8,longitude:127.7,accuracy:10000}});
 assert.equal(updates.length,1);
 receive({coords:{latitude:37.9,longitude:127.72,accuracy:20}});
 assert.equal(updates.length,2);assert.deepEqual(cleared,[7]);
});
test('Watch timeout keeps the available coarse fix and abort stops observation',async()=>{
 let receive;const cleared=[];
 const geo={watchPosition(ok){receive=ok;return 9;},clearWatch(id){cleared.push(id);}};
 const controller=new AbortController();
 const result=requestLocation(geo,{signal:controller.signal,refinementMs:1000});
 receive({coords:{latitude:37.8,longitude:127.7,accuracy:50000}});
 await result;controller.abort();assert.deepEqual(cleared,[9]);
 const timed=requestLocation(geo,{refinementMs:5});
 receive({coords:{latitude:37.8,longitude:127.7,accuracy:50000}});
 assert.equal((await timed).accuracy,50000);
 await new Promise(resolve=>setTimeout(resolve,15));assert.deepEqual(cleared,[9,9]);
});
test('More accurate updates refine automatic results but never replace a later manual search',async()=>{
 const ui=setupLocation();await tick();
 ui.run('resolveGeo({lat:37.8741,lng:127.7474,accuracy:50000})');await tick();
 assert.equal(ui.run('requests.length'),1);
 ui.run('refineGeo({lat:37.89,lng:127.73,accuracy:200})');await tick();
 assert.equal(ui.run('requests.length'),2);
 assert.equal(ui.run('requests[1].criteria.center.lat'),37.89);
 ui.document.getElementById('search-region').value='Seoul';
 ui.document.getElementById('search-form').emit('submit');await tick();
 const count=ui.run('requests.length');
 ui.run('refineGeo({lat:37.9,lng:127.72,accuracy:20})');await tick();
 assert.equal(ui.run('requests.length'),count);
 assert.equal(ui.run('state.search.criteria.region'),'Seoul');
});
test('A user-pan is preserved when a better automatic position arrives',async()=>{
 const ui=setupLocation();await tick();
 ui.run('resolveGeo({lat:37.8741,lng:127.7474,accuracy:50000})');await tick();
 ui.run('getKakaoMapCenter=()=>({lat:35,lng:129});');
 ui.run('refineGeo({lat:37.89,lng:127.73,accuracy:200})');await tick();
 assert.equal(ui.run('requests.length'),1);
 assert.equal(ui.run('state.live.position.accuracy'),200);
 assert.equal(ui.run('state.search.criteria.center.lat'),37.8741);
});
