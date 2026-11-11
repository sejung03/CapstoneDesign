import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestKakaoPlaces} from '../kakao-client.mjs';
import {liveQueryKey} from '../live-data.mjs';
import {routeQuery} from '../routing.mjs';
import {mountApp} from './dom-harness.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const raw=(id,name='하나병원',code='HP8')=>({id,place_name:name,category_group_code:code,category_name:'병원 > 내과',x:'127.75',y:'37.87',address_name:'춘천시 효자동'});
const record=(id,name,lng=127.75)=>({id,source:'kakao',type:'hospital',department:'internal',categoryLabel:'내과',name:{ko:name,en:name},area:{ko:'춘천시 효자동',en:'Chuncheon'},region:'춘천시 효자동',lat:37.87,lng,status:'open',schedule:Array.from({length:8},(_,i)=>({day:i+1,start:'0000',end:'2400'})),hoursSource:'nmc',access:{ko:'',en:''},phone:'',placeUrl:'https://place.map.kakao.com/1'});
function popup(){
 const ui=mountApp({source:null});ui.document.getElementById('skip').click();
 ui.run("mountKakaoMap=()=>{};state.live.configured=true;state.live.key='test';state.live.locationAttempted=true;state.live.queryKey=liveQueryKey(state.search.criteria);globalThis.timers=[];setTimeout=(fn,delay)=>{timers.push({fn,delay});return timers.length};render()");
 return ui;
}
const latestLookup=ui=>ui.run('timers.filter(timer=>timer.delay===300).at(-1).fn()');

test('Keyword suggestions search the complete typed name in hospital and pharmacy categories using the documented SDK',async()=>{
 const calls=[];
 const api={maps:{LatLng:class{constructor(lat,lng){this.lat=lat;this.lng=lng;}},services:{SortBy:{DISTANCE:'distance'},Status:{OK:'OK',ZERO_RESULT:'EMPTY'},Places:class{keywordSearch(query,callback,options){calls.push({query,options});callback([raw(options.category_group_code==='HP8'?'1':'2',options.category_group_code==='HP8'?'하나병원':'하나약국',options.category_group_code )],'OK');}}}}};
 const items=await suggestKakaoPlaces('test','하나',{api,center:{lat:37.8,lng:127.7}});
 assert.equal(items.length,2);assert.ok(calls.every(call=>call.query==='하나'));
 assert.deepEqual(calls.map(call=>call.options.category_group_code),['HP8','PM9']);
 assert.ok(calls.every(call=>call.options.sort==='distance'&&call.options.location.lat===37.8));
 assert.ok(calls.every(call=>call.options.radius===undefined),'Explicit area text is not restricted to an unrelated local radius');
 assert.deepEqual(await suggestKakaoPlaces('test','하',{api}),[]);
});

test('Aborting suggestion lookup settles without waiting for stale provider callbacks',async()=>{
 const pending=[];const controller=new AbortController();
 const api={maps:{services:{Status:{OK:'OK'},Places:class{keywordSearch(query,callback){pending.push(callback);}}}}};
 const promise=suggestKakaoPlaces('test','하나',{api,signal:controller.signal});
 controller.abort();assert.deepEqual(await promise,[]);
 pending.forEach(callback=>callback([raw('1')],'OK'));
});

test('Typing 하나 during Korean composition fetches and displays 하나병원 without deleting a character',async()=>{
 const ui=popup(),hana=record('hana','하나병원');
 ui.run("globalThis.lookups=[];suggestKakaoPlaces=async(key,query)=>{lookups.push(query);return ["+JSON.stringify(hana)+"]}");
 const input=ui.document.getElementById('search-region'),renders=ui.renders;
 input.emit('compositionstart');input.value='하';input.emit('input',{isComposing:true});
 input.value='하나';input.emit('input',{isComposing:true});
 assert.match(ui.document.getElementById('search-suggestions').textContent,/찾고 있어요/);
 await latestLookup(ui);
 assert.equal(ui.document.getElementById('search-suggestion-0').children[0].textContent,'하나병원');
 assert.equal(input.value,'하나');assert.equal(ui.run('lookups[0]'),'하나');
 assert.equal(ui.renders,renders);assert.equal(ui.run('state.live.items.length'),0,'Suggestions stay separate from search results');
 input.emit('compositionend');await tick();assert.equal(ui.run('lookups.length'),1,'Composition commit reuses the just-completed response');
});

test('A slower old name response cannot replace newer suggestions or reopen a dismissed popup',async()=>{
 const ui=popup();ui.run("globalThis.pending=[];suggestKakaoPlaces=(key,query,{signal})=>new Promise(resolve=>pending.push({query,signal,resolve}))");
 const input=ui.document.getElementById('search-region');
 input.value='하나';input.emit('input');void latestLookup(ui);await tick();
 input.value='다른';input.emit('input');void latestLookup(ui);await tick();
 ui.run('pending[1].resolve(['+JSON.stringify(record('other','다른병원'))+'])');await tick();
 ui.run('pending[0].resolve(['+JSON.stringify(record('hana','하나병원'))+'])');await tick();
 assert.equal(ui.document.getElementById('search-suggestion-0').children[0].textContent,'다른병원');
 assert.equal(ui.run('pending[0].signal.aborted'),true);
 input.value='새로운';input.emit('input');void latestLookup(ui);await tick();
 input.emit('keydown',{key:'Escape'});
 ui.run('pending[2].resolve(['+JSON.stringify(record('new','새로운병원'))+'])');await tick();
 assert.equal(ui.document.getElementById('search-suggestions').hidden,true);
});

test('Suggestion lookup failure explains the issue while keeping entered text and ordinary search usable',async()=>{
 const ui=popup();ui.run("suggestKakaoPlaces=async()=>{throw Error('private upstream data')}");
 const input=ui.document.getElementById('search-region');input.value='하나';input.emit('input');await latestLookup(ui);
 const panel=ui.document.getElementById('search-suggestions');
 assert.equal(panel.hidden,false);assert.match(panel.textContent,/불러오지 못/);assert.doesNotMatch(panel.textContent,/private upstream/);
 assert.equal(input.value,'하나');assert.ok(ui.document.getElementById('search-form'));
});

function narrowSearch(){
 const ui=mountApp({source:null}),active=record('active','하나내과',127.74),other=record('other','가까운내과',127.75);
 const criteria={region:'하나내과',type:'hospital',department:'all',openOnly:false,sort:'distance'};
 const position={lat:37.86,lng:127.73},key=routeQuery('walk',position,active);
 const live={configured:true,key:'test',locationAttempted:true,position,items:[active],queryKey:liveQueryKey(criteria),searchedAt:Date.now()-1000,hoursConfigured:true,routingConfigured:true,token:1};
 const cache={[routeQuery('walk',position,other)]:{phase:'ready',expires:Date.now()+60000,data:{distanceMeters:500,durationSeconds:300,paths:[],steps:[]}},[key]:{phase:'ready',expires:Date.now()+60000,data:{distanceMeters:2000,durationSeconds:600,paths:[],steps:[]}}};
 ui.run("mountKakaoMap=()=>{};state.search.criteria="+JSON.stringify(criteria)+";Object.assign(state.live,"+JSON.stringify(live)+");state.routing.cache="+JSON.stringify(cache)+";state.search.initialized=true;state.search.selectedId='active';state.view='explore';globalThis.nearbyQueries=[];searchKakao=async(key,criteria)=>{nearbyQueries.push(criteria);return {items:["+JSON.stringify(other)+"],page:1,hasMore:false,nextCategories:[]}};enrichPublicHours=async items=>items;globalThis.fetch=async()=>({ok:true,json:async()=>({distanceMeters:500,durationSeconds:300,paths:[],steps:[]})});render()");
 return ui;
}

test('A one-hospital name search independently finds and compares nearby hospitals without replacing the original results',async()=>{
 const ui=narrowSearch();for(let i=0;i<8;i++)await tick();
 assert.equal(ui.run('nearbyQueries.length'),1);
 assert.equal(ui.run('nearbyQueries[0].region'),'');assert.equal(ui.run('nearbyQueries[0].department'),'internal');
 assert.equal(ui.run('state.live.items.length'),1);assert.equal(ui.run('state.discovery.items.length'),1);
 assert.equal(ui.run('state.discovery.phase'),'ready');
 assert.match(ui.app.innerHTML,/가까운내과/);
 const button=ui.document.querySelectorAll('[data-facility]').find(node=>node.dataset.facility==='other');
 assert.ok(button);button.click();
 assert.equal(ui.run('state.search.selectedId'),'other');assert.match(ui.app.innerHTML,/가까운내과/);
 assert.equal(ui.run('state.routing.openId'),null);
 assert.equal(ui.run('state.live.items.length'),1);
 ui.document.getElementById('route-toggle').click();assert.equal(ui.run('routeContext(state).destination.id'),'other');
 ui.document.getElementById('close-detail').click();
 assert.equal(ui.run('state.discovery.items.length'),0);assert.equal(ui.run('state.live.items.length'),1);
});

test('Closing detail before a nearby response completes discards the late recommendation pool',async()=>{
 const ui=narrowSearch();
 // The initial request is queued on a microtask, so replace it before it starts.
 ui.run("globalThis.resolveNearby=null;searchKakao=()=>new Promise(resolve=>{resolveNearby=resolve})");
 await tick();ui.document.getElementById('close-detail').click();
 ui.run('resolveNearby({items:['+JSON.stringify(record('late','늦은병원'))+'],hasMore:false})');await tick();
 assert.equal(ui.run('state.discovery.items.length'),0);assert.equal(ui.run('state.search.selectedId'),null);
 assert.doesNotMatch(ui.app.innerHTML,/늦은병원/);
});

test('Missing specialty is explained instead of silently hiding all alternatives',()=>{
 const ui=mountApp({source:null}),active=record('unknown','진료과미등록의원');active.department='other';
 ui.run("state.live.items=["+JSON.stringify(active)+"];state.live.position={lat:37.8,lng:127.7};state.live.searchedAt=Date.now();state.live.queryKey=liveQueryKey(state.search.criteria);state.search.selectedId='unknown';state.view='explore';render()");
 assert.match(ui.app.innerHTML,/진료과 정보가 없어/);
 assert.equal(ui.run('state.discovery.phase'),'idle');
});
