import test from 'node:test';
import assert from 'node:assert/strict';
import {recommendationSnapshot,normalizeRecommendations,recommendationOrder,createRecommendations} from '../recommendations.mjs';
import {liveQueryKey} from '../live-data.mjs';
import {createAssistantState} from '../assistant.mjs';
import {mountApp} from './dom-harness.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function stateForRanking(){
 const criteria={region:'춘천',type:'all',department:'all',openOnly:false,sort:'distance'};
 const item=(id,status='open')=>({id,source:'kakao',name:{ko:id,en:id},type:'hospital',department:'internal',status,schedule:status==='open'?Array.from({length:8},(_,i)=>({day:i+1,start:'0000',end:'2400'})):null,lat:37.87,lng:127.74,phone:'private-phone',area:{ko:'춘천',en:'Chuncheon'},access:{ko:'',en:''}});
 return {source:'live',locale:'ko',view:'explore',profile:{},assistant:createAssistantState(),chat:{messages:[],intakeContext:null},search:{criteria,initialized:true},live:{configured:true,key:'mock',locationAttempted:true,items:[item('a'),item('b'),item('closed','closed'),item('unknown','unknown')],phase:'ready',hoursPhase:'ready',token:3,queryKey:liveQueryKey(criteria)},routing:{mode:'walk',cache:{}},discovery:{items:[]},recommendations:createRecommendations()};
}
test('candidate snapshot includes only real open results without coordinates or contact information',()=>{
 const state=stateForRanking();state.live.items[0].departments=['internal','family','invented'];const snapshot=recommendationSnapshot(state);
 assert.deepEqual(snapshot.payload.candidates.items[0].departments,['internal','family']);
 assert.deepEqual(snapshot.payload.candidates.items.map(item=>item.facilityId),['a','b']);
 assert.doesNotMatch(JSON.stringify(snapshot.payload),/private-phone|127.74|37.87/);
 state.live.hoursPhase='loading';assert.equal(recommendationSnapshot(state),null);
 state.live.hoursPhase='ready';state.search.criteria.region='서울';assert.equal(recommendationSnapshot(state),null);
});
test('recommendation contract validates text and set ID, ignores fabricated IDs and duplicates, and follows supplied order',()=>{
 const state=stateForRanking(),snapshot=recommendationSnapshot(state);
 const raw={resultSetId:'results-3',items:[{facilityId:'b',reason:{ko:'<img src=x>'},status:'closed'},{facilityId:'invented',reason:{ko:'invented'}},{facilityId:'a',reason:{ko:'이유'}},{facilityId:'b',reason:{ko:'duplicate'}}]};
 const items=normalizeRecommendations(raw,snapshot);
 assert.deepEqual(items.map(item=>item.facilityId),['b','a']);
 assert.equal(items[0].status,undefined);
 state.recommendations={phase:'ready',key:snapshot.key,items};
 const result=recommendationOrder(state,state.live.items.slice(0,2));
 assert.deepEqual(result.map(item=>item.id),['b','a']);assert.equal(result[0].status,'open');
 assert.equal(result[0].recommendationReason.ko,'<img src=x>');assert.equal(state.live.items[0].recommendationReason,undefined);
 for(const response of [{...raw,resultSetId:'old'},{resultSetId:'results-3',items:[{facilityId:'a',reason:{ko:''}}]},{resultSetId:'results-3',items:[{facilityId:'a',reason:{ko:'x'.repeat(241)}}]}])assert.throws(()=>normalizeRecommendations(response,snapshot),TypeError);
 state.live.items[0].status='closed';state.live.items[0].schedule=null;assert.equal(recommendationOrder(state,state.live.items),state.live.items);
 state.live.items[0].status='open';state.live.token++;assert.equal(recommendationOrder(state,state.live.items),state.live.items);
});
function controller(){
 const ui=mountApp({source:null});
 ui.run('Object.assign(state,'+JSON.stringify(stateForRanking())+');mountKakaoMap=()=>{};globalThis.ranks=[];setRecommendationAdapter((payload,{signal})=>new Promise((resolve,reject)=>ranks.push({payload,signal,resolve,reject})));');
 return ui;
}
test('one rank request per result/context snapshot, no route calls, and stale responses cannot replace a new search',async()=>{
 const ui=controller();await tick();assert.equal(ui.run('ranks.length'),1);
 ui.run('render();render();');await tick();assert.equal(ui.run('ranks.length'),1);
 ui.run("state.live.token=4;render()");await tick();assert.equal(ui.run('ranks.length'),2);assert.equal(ui.run('ranks[0].signal.aborted'),true);
 ui.run("ranks[0].resolve({resultSetId:'results-3',items:[{facilityId:'a',reason:{ko:'old'}}]});ranks[1].resolve({resultSetId:'results-4',items:[{facilityId:'b',reason:{ko:'new'}}]})");await tick();
 assert.equal(ui.run('state.recommendations.phase'),'ready');assert.equal(ui.run('state.recommendations.items[0].facilityId'),'b');
 ui.run("state.chat.messages.push({role:'user',text:'추가 상황'});render()");await tick();assert.equal(ui.run('ranks.length'),3);
 ui.run('disposeApp()');assert.equal(ui.run('ranks[2].signal.aborted'),true);ui.run("ranks[2].resolve({resultSetId:'results-4',items:[]})");await tick();assert.equal(ui.run('state.recommendations.phase'),'idle');
});
test('failure preserves ordinary results without automatic retries; disconnection clears recommendation state',async()=>{
 const ui=controller();await tick();ui.run("ranks[0].reject(new Error('offline'))");await tick();
 assert.equal(ui.run('state.recommendations.phase'),'error');assert.equal(ui.run('state.live.items.length'),4);
 ui.run('render();render();');await tick();assert.equal(ui.run('ranks.length'),1);
 ui.run('setRecommendationAdapter(null)');assert.equal(ui.run('state.recommendations.phase'),'idle');
});
