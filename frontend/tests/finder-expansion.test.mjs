
import test from 'node:test';
import assert from 'node:assert/strict';
import {departmentCatalog,departmentFromCategory} from '../departments.mjs';
import {placeQueries,normalizePlace} from '../live-data.mjs';
import {emptyCriteria} from '../facilities.mjs';
import {buildSuggestion} from '../care-context.mjs';
import {copy} from '../copy.mjs';
import {searchKakao} from '../kakao-client.mjs';
import {startServer} from '../server.mjs';
import {mountApp} from './dom-harness.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('Every listed specialty has aligned labels, a real query keyword, and the correct hospital/pharmacy category',()=>{
 assert.equal(new Set(departmentCatalog.map(d=>d.key)).size,departmentCatalog.length);
 for(const dept of departmentCatalog){
  assert.ok(copy.ko[dept.key]);assert.ok(copy.en[dept.key]);
  const criteria={...emptyCriteria(),region:'Chuncheon',department:dept.key};
  const [query]=placeQueries(criteria);
  assert.equal(query.code,dept.key==='pharmacy'?'PM9':'HP8');
  assert.ok(query.keyword.includes(dept.keyword));
  assert.deepEqual(placeQueries({...criteria,type:dept.key==='pharmacy'?'hospital':'pharmacy'}),[]);
 }
});
test('Detailed provider categories normalize only explicit specialties and retain unknown categories',()=>{
 const raw={id:'100',category_group_code:'HP8',place_name:'Clinic',x:'127',y:'37'};
 for(const [category,key] of [['의료 > 병원 > 피부과','dermatology'],['의료 > 병원 > 신경외과','neurosurgery'],['의료 > 병원 > 비뇨기과','urology']]){
  assert.equal(normalizePlace({...raw,category_name:category}).department,key);
 }
 assert.equal(departmentFromCategory('Unknown clinic category'),'other');
});
test('Explicit specialty names prefer specific matches and do not classify symptom descriptions or English substrings',()=>{
 assert.equal(buildSuggestion('신경외과를 찾아주세요').department,'neurosurgery');
 assert.equal(buildSuggestion('정형외과를 찾아주세요').department,'orthopedics');
 assert.equal(buildSuggestion('피부과 말고 이비인후과').department,'ent');
 assert.equal(buildSuggestion('Neurosurgery nearby').department,'neurosurgery');
 assert.equal(buildSuggestion('Recent pain and discomfort').department,'all');
 assert.equal(buildSuggestion('피부가 가렵고 코가 막혀요').department,'all');
});
test('New nearby specialty searches send the selected keyword and actual coordinates to the existing SDK',async()=>{
 const calls=[],api={maps:{LatLng:class{constructor(lat,lng){this.lat=lat;this.lng=lng;}},services:{SortBy:{DISTANCE:'distance'},Status:{OK:'OK',ZERO_RESULT:'ZERO_RESULT'},Places:class{
  keywordSearch(keyword,callback,options){calls.push({keyword,options});callback([],'ZERO_RESULT',{});}
  categorySearch(){throw Error('Specialty search must use a keyword');}
 }}}};
 await searchKakao('',{...emptyCriteria(),center:{lat:37.87,lng:127.74},department:'dermatology'},{api});
 assert.equal(calls[0].keyword,'피부과');assert.equal(calls[0].options.category_group_code,'HP8');
 assert.equal(calls[0].options.location.lat,37.87);assert.equal(calls[0].options.radius,5000);
});
function setup(scope={}){
 const ui=mountApp({source:null});
 ui.run("state.view='explore';state.live.configured=true;state.live.hoursConfigured=true;state.live.locationAttempted=true;state.search.criteria={...emptyCriteria(),..."+JSON.stringify(scope)+"};var searchRequests=[];searchKakao=async(key,criteria)=>{searchRequests.push({...criteria});return {items:[],hasMore:false,nextCategories:[],page:1};};mountKakaoMap=()=>Promise.resolve();getKakaoMapCenter=()=>null;render()");
 return ui;
}
function searchOpen(ui){
 ui.document.getElementById('search-region').value='';
 ui.document.getElementById('open-only').checked=true;
 ui.document.getElementById('search-form').emit('submit');
}
test('Open-only search with blank text reuses the prior region and preserves the selected specialty',async()=>{
 const ui=setup({region:'Chuncheon'});await tick();ui.run('searchRequests.length=0');
 ui.document.getElementById('department').value='dermatology';searchOpen(ui);await tick();
 assert.equal(ui.run('searchRequests.at(-1).region'),'Chuncheon');
 assert.equal(ui.run('searchRequests.at(-1).department'),'dermatology');
 assert.equal(ui.run('searchRequests.at(-1).openOnly'),true);
 assert.equal(ui.document.getElementById('search-region').value,'Chuncheon');
});
test('Open-only filter keeps the searched map center after panning instead of silently searching a new area',async()=>{
 const ui=setup({center:{lat:37.87,lng:127.74}});await tick();ui.run("searchRequests.length=0;state.live.position={lat:37.5,lng:127};getKakaoMapCenter=()=>({lat:35,lng:129})");
 searchOpen(ui);await tick();
 assert.equal(ui.run('searchRequests.at(-1).center.lat'),37.87);
 assert.equal(ui.run('searchRequests.at(-1).openOnly'),true);
});
test('Without prior search scope, open-only uses the real user position, then the visible map',async()=>{
 for(const position of [true,false]){
  const ui=setup();await tick();ui.run("searchRequests.length=0;getKakaoMapCenter=()=>({lat:35,lng:129});state.live.position="+(position?"{lat:37.87,lng:127.74}":"null"));
  searchOpen(ui);await tick();
  assert.equal(ui.run('searchRequests.at(-1).center.lat'),position?37.87:35);
 }
});
test('Typed searches take priority over all coordinate scopes even with open-only selected',async()=>{
 const ui=setup({center:{lat:37.87,lng:127.74}});await tick();ui.run('searchRequests.length=0');
 ui.document.getElementById('search-region').value='Seoul';
 ui.document.getElementById('open-only').checked=true;
 ui.document.getElementById('search-form').emit('submit');await tick();
 assert.equal(ui.run('searchRequests.at(-1).region'),'Seoul');assert.equal(ui.run('searchRequests.at(-1).center'),null);
});
test('Open-only without a scope requests location with the filters intact and reports denial without invented coordinates',async()=>{
 const ui=setup();await tick();
 ui.run("searchRequests.length=0;var geoAttempts=0;requestLocation=async()=>{geoAttempts++;return {lat:37.87,lng:127.74};}");
 searchOpen(ui);await tick();await tick();
 assert.equal(ui.run('geoAttempts'),1);
 assert.equal(ui.run('state.search.criteria.openOnly'),true);
 assert.equal(ui.run('state.search.criteria.center.lat'),37.87);
 assert.equal(ui.run('searchRequests.at(-1).openOnly'),true);
 const denied=setup();await tick();
 denied.run("searchRequests.length=0;requestLocation=async()=>{const error=Error('denied');error.code=1;throw error}");
 searchOpen(denied);await tick();
 assert.equal(denied.run('state.live.locationError'),'locationPermissionDenied');
 assert.equal(denied.run('searchRequests.length'),0);
 assert.equal(denied.run('state.search.criteria.center'),null);
});
test('Hospital and pharmacy open badges use the same semantic style while closed and unknown remain distinct',()=>{
 const ui=mountApp();
 ui.run("state.view='explore';state.search.criteria=emptyCriteria();render()");
 const badges=ui.document.querySelectorAll('.status-open');
 assert.ok(badges.length>=2);
 assert.ok(badges.every(b=>b.attributes.class==='facility-status status-open'));
 assert.match(ui.app.innerHTML,/진료 중/);assert.match(ui.app.innerHTML,/영업 중/);
 assert.equal(ui.document.querySelectorAll('.status-unknown').length,0);
});
test('New specialty module is served by the existing server while its server-only modules stay private',async()=>{
 const server=await startServer({port:0,log(){},env:{}});
 try{
  const base='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(base+'/departments.mjs')).status,200);
  assert.equal((await fetch(base+'/public-data-server.mjs')).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
