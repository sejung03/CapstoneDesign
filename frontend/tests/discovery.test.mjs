import test from 'node:test';
import assert from 'node:assert/strict';
import {nearerOpenHospitals,searchSuggestions,facilityDepartments} from '../discovery.mjs';
import {routeQuery} from '../routing.mjs';
import {resetLiveRequest,liveQueryKey} from '../live-data.mjs';
import {copy} from '../copy.mjs';
import {mountApp} from './dom-harness.mjs';
import {startServer} from '../server.mjs';
const t=key=>copy.ko[key];
const schedule=(start='0000',end='2400')=>Array.from({length:8},(_,i)=>({day:i+1,start,end}));
function fixture({searchedAt=Date.now()-1000}={}){
 const item=(id,lng,department='internal')=>({id,providerId:id,source:'kakao',type:'hospital',department,name:{ko:id,en:id},area:{ko:'춘천시 효자동',en:'Chuncheon'},region:'춘천시 효자동',lat:37.87,lng,status:'open',schedule:schedule(),hoursSource:'nmc',phone:'',access:{ko:'',en:''}});
 const active=item('active',127.74),near=item('near',127.75),nearer=item('nearer',127.76);
 const state={source:'live',view:'explore',locale:'ko',draft:{region:''},search:{criteria:{region:'',type:'all',department:'all',openOnly:false,center:{lat:37.87,lng:127.74}}},live:{items:[active,near,nearer],position:{lat:37.86,lng:127.73},searchedAt},routing:{mode:'walk',cache:{}}};
 state.live.queryKey=liveQueryKey(state.search.criteria);
 for(const [record,meters] of [[active,2000],[near,1000],[nearer,500]])state.routing.cache[routeQuery('walk',state.live.position,record)]={phase:'ready',expires:Date.now()+60000,data:{distanceMeters:meters,durationSeconds:600,paths:[],steps:[]}};
 return {state,active,near,nearer};
}

test('Alternatives require the same specialty, verified opening hours and a shorter current route; duplicates are removed',()=>{
 const {state,active,near,nearer}=fixture();
 const other={...near,id:'other',department:'dental'};
 assert.deepEqual(nearerOpenHospitals(state,active,[active,near,nearer,near,other]).map(match=>match.item.id),['nearer','near']);
 assert.equal(nearerOpenHospitals(state,active,[near])[0].savedMeters,1000);
 assert.deepEqual(facilityDepartments({department:'internal',departments:['internal','family','invented','pharmacy']}),['internal','family']);
});

test('Candidates must have been open at search time and must still be open at display time',()=>{
 const searchedAt=Date.parse('2026-10-29T00:00:00Z'),now=new Date('2026-10-29T02:00:00Z');
 const {state,active,near}=fixture({searchedAt});
 near.schedule=schedule('1000','1800');
 assert.equal(nearerOpenHospitals(state,active,[near],{now}).length,0,'Opened after the search');
 near.schedule=schedule('0800','1030');
 assert.equal(nearerOpenHospitals(state,active,[near],{now}).length,0,'Closed after the search');
 near.schedule=schedule('0800','1800');
 assert.equal(nearerOpenHospitals(state,active,[near],{now}).length,1);
 for(const patch of [{schedule:null},{status:'unknown'},{hoursError:'hoursNotMatched'},{hoursStatus:'UNKNOWN'},{operatingStatus:'STALE'},{status:'stale'}]){
  assert.equal(nearerOpenHospitals(state,active,[{...near,...patch}],{now}).length,0);
 }
});

test('No route, expired route, another mode or changed origin never fall back to straight-line distance',()=>{
 for(const change of [
  state=>state.routing.cache={},
  state=>Object.values(state.routing.cache).forEach(entry=>entry.expires=0),
  state=>state.routing.mode='car',
  state=>state.live.position={lat:38,lng:128},
  state=>Object.values(state.routing.cache).forEach(entry=>entry.phase='error')
 ]){
  const {state,active,near}=fixture();change(state);
  assert.equal(nearerOpenHospitals(state,active,[near]).length,0);
 }
 const {state,active,near}=fixture();
 state.routing.cache[routeQuery('walk',state.live.position,near)].data.distanceMeters=2000;
 assert.equal(nearerOpenHospitals(state,active,[near]).length,0,'Equal route length is not closer');
});

test('A multi-specialty target uses the explicitly selected specialty and does not guess across unrelated departments',()=>{
 const {state,active,near}=fixture();active.departments=['internal','family'];near.department='family';
 assert.equal(nearerOpenHospitals(state,active,[near]).length,0,'No selected specialty for an ambiguous target');
 state.search.criteria.department='internal';state.live.queryKey=liveQueryKey(state.search.criteria);
 assert.equal(nearerOpenHospitals(state,active,[near]).length,0);
 near.departments=['family','internal'];assert.equal(nearerOpenHospitals(state,active,[near]).length,1);
 state.search.criteria.department='dental';state.live.queryKey=liveQueryKey(state.search.criteria);
 assert.equal(nearerOpenHospitals(state,active,[near]).length,0);
});

test('Old query results, unknown search time, pharmacies and sample sources do not become hospital alternatives',()=>{
 for(const modify of [
  (state,active)=>{state.source='demo';},
  (state,active)=>{active.type='pharmacy';},
  state=>{state.live.searchedAt=undefined;},
  state=>{state.search.criteria.region='new region';}
 ]){
  const {state,active,near}=fixture();modify(state,active);
  assert.equal(nearerOpenHospitals(state,active,[near]).length,0);
 }
 const initial={token:2,items:[]};const reset=resetLiveRequest(initial,{region:'춘천'});
 assert.ok(Number.isFinite(reset.searchedAt));assert.equal(reset.token,3);
});

test('Suggestion terms come from the specialty catalog and loaded records, never from symptom inference',()=>{
 const {state}=fixture();state.search.criteria.region='춘천';
 const compact=searchSuggestions('춘천내과',state,t);
 assert.equal(compact[0].department,'internal');assert.equal(compact[0].value,'춘천');
 assert.equal(searchSuggestions('기침이 나요',state,t).length,0);
 assert.equal(searchSuggestions('',state,t).length,0);
 assert.equal(searchSuggestions('약',state,t)[0].type,'pharmacy');
 state.live.items[0].name.ko='한마음의원';
 const matches=searchSuggestions('한마음',state,t);
 assert.equal(matches[0].label,'한마음의원');assert.match(matches[0].value,/춘천시 효자동 한마음의원/);
 assert.ok(searchSuggestions('내과',state,t).some(option=>option.label==='한마음의원'),'Known specialty can suggest a general clinic name');
 assert.ok(searchSuggestions('과',state,t).length<=6);
});

test('Typing suggestions preserves input focus and does not rerender the map or send requests',()=>{
 const ui=mountApp({source:null});ui.document.getElementById('skip').click();
 const input=ui.document.getElementById('search-region'),renders=ui.renders;
 input.focus();input.value='내';input.emit('input');
 assert.equal(ui.renders,renders);assert.equal(ui.document.activeElement,input);
 assert.equal(input.attributes['aria-expanded'],'true');
 assert.ok(ui.document.getElementById('search-suggestion-0'));
 assert.equal(ui.run('state.live.phase'),'idle');assert.equal(ui.storage.size,0);
});

test('Keyboard suggestion selection updates form conditions and uses real nearby scope on search',()=>{
 const ui=mountApp({source:null});ui.document.getElementById('skip').click();
 ui.run("state.live.position={lat:37.87,lng:127.74};state.live.locationAttempted=true");
 const input=ui.document.getElementById('search-region');
 input.value='내';input.emit('input');input.emit('keydown',{key:'ArrowDown'});
 assert.equal(input.attributes['aria-activedescendant'],'search-suggestion-0');
 input.emit('keydown',{key:'Enter'});
 assert.equal(ui.run('state.search.department'),'internal');
 assert.equal(ui.document.getElementById('department').value,'internal');
 assert.equal(ui.run('state.search.criteria.department'),'internal','Choosing a suggestion immediately submits the existing search form');
 assert.equal(ui.document.getElementById('search-suggestions').hidden,true);
 assert.equal(ui.run('state.search.criteria.department'),'internal');
 assert.equal(ui.run('state.search.criteria.center.lat'),37.87);
});

test('Escape, empty input and leaving the form close suggestions; IME input does not select mid-composition',()=>{
 const ui=mountApp({source:null});ui.document.getElementById('skip').click();
 const input=ui.document.getElementById('search-region'),panel=ui.document.getElementById('search-suggestions');
 input.value='내';input.emit('compositionstart');input.emit('input',{isComposing:true});
 assert.equal(panel.hidden,false);input.emit('keydown',{key:'Enter',isComposing:true});
 assert.equal(ui.run('state.search.department'),'all');
 input.emit('compositionend');assert.equal(panel.hidden,false);
 input.emit('keydown',{key:'Escape'});assert.equal(panel.hidden,true);
 input.emit('focus');ui.document.getElementById('search-form').emit('focusout',{relatedTarget:null});
 assert.equal(panel.hidden,true);
 input.value='';input.emit('input');assert.equal(panel.hidden,true);
});

test('Pointer selection keeps area and specialty aligned; a manual edit removes the special nearby shortcut',()=>{
 const ui=mountApp({source:null});ui.document.getElementById('skip').click();
 const input=ui.document.getElementById('search-region');
 input.value='춘천 피부';input.emit('input');
 ui.document.getElementById('search-suggestion-0').click();
 assert.equal(input.value,'춘천');assert.equal(ui.run('state.search.department'),'dermatology');
 assert.equal(ui.run('state.search.criteria.region'),'춘천');
 const next=ui.document.getElementById('search-region');next.value='서울';next.emit('input');assert.equal(ui.run('state.search.suggestionScope'),false);
});

test('Provider markup stays literal in suggestion labels and is not inserted as HTML',()=>{
 const ui=mountApp({source:null});ui.document.getElementById('skip').click();
 ui.run("state.live.items=[{id:'1',source:'kakao',type:'hospital',status:'unknown',name:{ko:'<img src=x>',en:'<img src=x>'},area:{ko:'춘천시 효자동',en:'Chuncheon'}}]");
 const input=ui.document.getElementById('search-region');input.value='img';input.emit('input');
 const button=ui.document.getElementById('search-suggestion-0');
 assert.equal(button.children[0].textContent,'<img src=x>');
 assert.equal(button.children[0].children.length,0);
 button.click();assert.match(input.value,/<img src=x>/);
 assert.equal(ui.storage.size,0);
});

test('Closer hospital cards navigate through the existing detail flow and never open route panels automatically',()=>{
 const ui=mountApp({source:null});const {state}=fixture();
 ui.run('Object.assign(state.live,'+JSON.stringify(state.live)+');state.routing='+JSON.stringify(state.routing)+";state.search.criteria="+JSON.stringify(state.search.criteria)+";state.search.initialized=true;state.view='explore';state.search.selectedId='active';render()");
 assert.ok(ui.document.getElementById('nearer-heading'));
 assert.match(ui.app.innerHTML,/nearer/);
 assert.equal(ui.document.getElementById('facility-route-panel'),null);
 ui.document.querySelectorAll('[data-facility]').find(button=>button.dataset.facility==='nearer').click();
 assert.equal(ui.run('state.search.selectedId'),'nearer');assert.equal(ui.run('state.routing.openId'),null);
 assert.match(ui.app.innerHTML,/경로 거리를 조회할 수 없어/,'Missing prerequisites are visible instead of a silent empty section');
 ui.document.getElementById('close-detail').click();assert.equal(ui.run('state.search.selectedId'),null);
});

test('Discovery module is explicitly served as a browser module while server files stay private',async()=>{
 const server=await startServer({port:0,log:()=>{}});
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const response=await fetch(base+'/discovery.mjs');assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/javascript/);
  assert.equal((await fetch(base+'/server.mjs')).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('Selecting a loaded pharmacy name clears a conflicting hospital specialty and preserves its area',()=>{
 const ui=mountApp({source:null});ui.document.getElementById('skip').click();
 ui.run("state.type='hospital';state.search.department='internal';state.live.items=[{id:'p',source:'kakao',categoryLabel:'pharmacy',status:'unknown',type:'pharmacy',name:{ko:'한마음약국',en:'Pharmacy'},area:{ko:'춘천시 효자동',en:'Chuncheon'}}];render()");
 const input=ui.document.getElementById('search-region');input.value='한마음';input.emit('input');
 ui.document.getElementById('search-suggestion-0').click();
 assert.equal(ui.run('state.type'),'pharmacy');assert.equal(ui.run('state.search.department'),'all');
 assert.equal(input.value,'춘천시 효자동 한마음약국');
 assert.equal(ui.run('state.search.criteria.department'),'all');
});
