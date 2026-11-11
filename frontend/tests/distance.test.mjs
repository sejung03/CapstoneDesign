import test from 'node:test';
import assert from 'node:assert/strict';
import {distanceInKm,displayedFacilities,liveCriteria} from '../live-data.mjs';
import {emptyCriteria,searchFacilities} from '../facilities.mjs';
import {routeQuery} from '../routing.mjs';
import {mountApp} from './dom-harness.mjs';
test('Geographic distance remains distinct from route distance',()=>{
 assert.equal(distanceInKm({lat:0,lng:0},{lat:0,lng:0}),0);
 assert.ok(Math.abs(distanceInKm({lat:0,lng:0},{lat:1,lng:0})-111.195)<.001);
 for(const invalid of [null,{}, {lat:null,lng:0},{lat:91,lng:0}])assert.equal(distanceInKm(invalid,{lat:0,lng:0}),null);
});
const item=(id,lat,order)=>({id,lat,lng:127,type:'hospital',department:'other',status:'unknown',source:'kakao',name:{ko:id,en:id},region:'Chuncheon',area:{ko:'Chuncheon',en:'Chuncheon'},providerOrder:order,access:{ko:'',en:''}});
const ready=(distanceMeters)=>({phase:'ready',expires:Date.now()+120000,data:{distanceMeters,durationSeconds:600,steps:[],paths:[]}});
test('Default distance sort uses geographic distance independently of cached routes and search-map center',()=>{
 const items=[item('far',37.52,0),item('near',37.501,1)];
 const state={source:'live',routing:{mode:'walk',cache:{}},live:{items,position:{lat:37.5,lng:127}},search:{criteria:{...emptyCriteria(),center:{lat:35,lng:129},sort:'distance'}}};
 const put=(mode,dest,meters)=>state.routing.cache[routeQuery(mode,state.live.position,dest)]=ready(meters);
 put('walk',items[0],800);put('walk',items[1],3000);put('car',items[0],2000);put('car',items[1],500);
 let results=displayedFacilities(state,searchFacilities);
 assert.deepEqual(results.map(v=>v.id),['near','far']);assert.ok(results[0].distance>0&&results[0].distance<.12);
 state.search.criteria.center={lat:33,lng:126};assert.equal(displayedFacilities(state,searchFacilities)[0].distance,results[0].distance);
 state.routing.mode='car';assert.equal(displayedFacilities(state,searchFacilities)[0].id,'near');
 state.live.position={lat:37.519,lng:127};assert.equal(displayedFacilities(state,searchFacilities)[0].id,'far');
 state.live.position=null;assert.ok(displayedFacilities(state,searchFacilities).every(v=>v.distance===null));
 assert.equal(items[0].distance,undefined);assert.equal(liveCriteria({...emptyCriteria(),sort:'distance'}).sort,'distance');
});
test('Provider order is retained while base distance works without route requests',()=>{
 const state={source:'live',routing:{mode:'walk',cache:{}},live:{items:[item('far',37.52,0),item('near',37.501,1)],position:{lat:37.5,lng:127}},search:{criteria:{...emptyCriteria(),sort:'recommended'}}};
 state.routing.cache[routeQuery('walk',state.live.position,state.live.items[1])]=ready(200);
 const results=displayedFacilities(state,searchFacilities);assert.deepEqual(results.map(v=>v.id),['far','near']);assert.ok(results[0].distance>0);
});
test('List keeps a distance while detailed routing appears only after Directions',()=>{
 const ui=mountApp();
 ui.run("state.source='live';state.live.configured=true;state.live.routingConfigured=true;state.live.locationAttempted=true;state.live.key='test';mountKakaoMap=()=>Promise.resolve();state.live.items="+JSON.stringify([item('far',37.52,0),item('near',37.501,1)])+";state.live.position={lat:37.5,lng:127,accuracy:20};state.search.initialized=true;state.search.criteria={...emptyCriteria(),region:'Chuncheon',sort:'distance'};state.live.queryKey=liveQueryKey(state.search.criteria);state.live.phase='ready';state.live.items.forEach((item,i)=>state.routing.cache[routeQuery('walk',state.live.position,item)]={phase:'ready',expires:Date.now()+120000,data:{distanceMeters:i?450:2200,durationSeconds:600,steps:[],paths:[]}});");
 ui.document.getElementById('skip').click();
 assert.deepEqual(ui.document.querySelectorAll('[data-card]').map(c=>c.dataset.card),['near','far']);
 assert.match(ui.app.innerHTML,/450 m/);assert.doesNotMatch(ui.app.innerHTML,/10분/);assert.match(ui.app.innerHTML,/2.2 km/);
 ui.document.querySelectorAll('[data-facility]').find(n=>n.attributes.class==='facility-detail-button').click();
 assert.equal(ui.document.getElementById('route-heading'),null);ui.document.getElementById('route-toggle').click();
 assert.match(ui.app.innerHTML,/이동 거리/);assert.match(ui.app.innerHTML,/link\/by\/walk/);
 ui.run("state.live.position.accuracy=50000;render()");assert.match(ui.app.innerHTML,/출발 위치의 오차가 커요/);
 ui.run("state.live.position=null;render()");assert.match(ui.app.innerHTML,/내 위치를 확인하면 이동 거리/);
});
