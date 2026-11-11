import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEmergency,normalizeEmergencyGuides,emergencyGuidance,createEmergency,visibleEmergency,emergencyMapLink,emergencySearchLink,requestEmergencyPosition,lookupEmergencyAddress} from '../emergency.mjs';
import {normalizeAssistantResponse,assistantContentKey} from '../assistant.mjs';
import {contentSecurityPolicy} from '../lib/security.mjs';
import {mountApp} from './dom-harness.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('emergency data accepts external video IDs and explicit clearing without clinical rules or arbitrary URLs',()=>{
 const raw={active:true,title:{ko:'안내'},videos:[{youtubeId:'Abcdef123_-',title:{ko:'영상'}}]};
 assert.equal(normalizeAssistantResponse({emergency:raw}).emergency.videos[0].youtubeId,'Abcdef123_-');
 assert.deepEqual(normalizeEmergency({active:false}),{active:false});
 for(const value of [{},{active:'true'},{active:true,title:{ko:''}},{active:true,videos:[{youtubeId:'https://evil.test',title:{ko:'x'}}]},{active:true,videos:[{youtubeId:'Abcdef123_-',title:{ko:'x'.repeat(121)}}]}])assert.throws(()=>normalizeEmergency(value),TypeError);
 assert.match(contentSecurityPolicy('test'),/frame-src https:\/\/www.youtube-nocookie.com;/);
 assert.doesNotMatch(contentSecurityPolicy('test'),/frame-src[^;]*\*/);
});
test('old backend notices disappear when conversation content changes; manual state is separate',()=>{
 const state={profile:{},chat:{messages:[],intakeContext:null},assistant:{answers:[]},emergency:createEmergency()};
 state.emergency.notice={active:true,contentKey:assistantContentKey(state)};assert.ok(visibleEmergency(state,assistantContentKey(state)));
 state.chat.messages.push({role:'user',text:'new'});assert.equal(visibleEmergency(state,assistantContentKey(state)),null);
 assert.equal(state.emergency.manual,false);
 assert.equal(emergencyMapLink({lat:999,lng:127}),'');assert.match(emergencyMapLink({lat:37,lng:127}),/37,127$/);
});
test('position is requested once with high accuracy and no cached position; abort discards late location',async()=>{
 let success,options,calls=0;const controller=new AbortController();
 const promise=requestEmergencyPosition({signal:controller.signal,geolocation:{getCurrentPosition(fn,fail,value){calls++;success=fn;options=value;}}});
 assert.equal(calls,1);assert.deepEqual(options,{enableHighAccuracy:true,maximumAge:0,timeout:10000});
 controller.abort();await assert.rejects(promise,/locationCancelled/);success({coords:{latitude:37,longitude:127,accuracy:10}});
 await assert.rejects(requestEmergencyPosition({geolocation:null}),/locationUnavailable/);
});
test('address lookup uses returned address and building only; inaccurate GPS never invokes geocoder',async()=>{
 let count=0;
 const loadSdk=async()=>{count++;return {maps:{services:{Status:{OK:'OK'},Geocoder:class{coord2Address(lng,lat,callback){assert.equal(lng,127);assert.equal(lat,37);callback([{road_address:{address_name:'테스트로 1',building_name:'테스트아파트'}}],'OK');}}}}};};
 assert.equal(await lookupEmergencyAddress('key',{lat:37,lng:127,accuracy:50000},{loadSdk}),'');assert.equal(count,0);
 assert.equal(await lookupEmergencyAddress('key',{lat:37,lng:127,accuracy:20},{loadSdk}),'테스트로 1 (테스트아파트)');assert.equal(count,1);
 assert.equal(await lookupEmergencyAddress('key',{lat:37,lng:127,accuracy:20},{loadSdk:async()=>{throw new Error('SDK unavailable');}}),'');
});
test('emergency location does not mutate search location or initiate routes, and late responses after disposal are ignored',async()=>{
 const ui=mountApp({source:null});
 ui.run("globalThis.deliverLocation=null;requestEmergencyPosition=()=>new Promise(resolve=>deliverLocation=resolve);lookupEmergencyAddress=async()=> '조회 주소';globalThis.beforeSearch=JSON.stringify(state.search);locateForEmergency()");
 ui.run("deliverLocation({lat:37,lng:127,accuracy:20})");await tick();
 assert.equal(ui.run('state.emergency.location.address'),'조회 주소');assert.equal(ui.run('JSON.stringify(state.search)===beforeSearch'),true);assert.equal(ui.run('state.live.position'),undefined);
 ui.run('locateForEmergency();disposeApp();deliverLocation({lat:38,lng:128,accuracy:20})');await tick();
 assert.notEqual(ui.run('state.emergency.location.point?.lat'),38);
});

test('manually entered location links are encoded searches, not verified coordinates, and empty state is session-only',()=>{
 assert.equal(emergencySearchLink('  '),'');
 assert.equal(emergencySearchLink('정문/#?'), 'https://map.kakao.com/link/search/'+encodeURIComponent('정문/#?'));
 assert.equal(createEmergency().manualLocation,'');assert.equal(createEmergency().locationDraft,'');
});

test('reviewed topic catalog is validated atomically and topic notices resolve without unrelated fallback',()=>{
 const guides=normalizeEmergencyGuides([{id:'reviewed-topic',title:{ko:'검토된 안내'},instructions:[{ko:'팀 제공 안내문'}],videos:[],source:{label:'검토 기관',url:'https://example.org/guide'}}]);
 assert.equal(emergencyGuidance({active:true,topicId:'reviewed-topic'},guides,'').id,'reviewed-topic');
 assert.equal(emergencyGuidance({active:true,topicId:'missing'},guides,''),null);
 const direct=normalizeEmergency({active:true,topicId:'missing',instructions:[{ko:'응답에 포함된 안내'}]});
 assert.equal(emergencyGuidance(direct,guides,'reviewed-topic'),direct);
 assert.equal(emergencyGuidance(null,guides,'reviewed-topic').title.ko,'검토된 안내');
 for(const bad of [[...guides,...guides],[{id:'unsafe',title:{ko:'x'},videos:[]}],[{...guides[0],source:{label:'x',url:'javascript:alert(1)'}}],[{...guides[0],source:{label:'x',url:'https://user:pass@example.org'}}]])assert.throws(()=>normalizeEmergencyGuides(bad),TypeError);
 assert.throws(()=>normalizeEmergency({active:true,topicId:'<script>'}),TypeError);
 assert.deepEqual(normalizeEmergencyGuides([]),[]);
});
test('emergency catalog is independent of session notes and explicit notice is not a clinical decision',()=>{
 const ui=mountApp({source:null});
 ui.run("setEmergencyGuides([{id:'test-topic',title:{ko:'검토된 항목'},videos:[{youtubeId:'Abcdef123_-',title:{ko:'외부 영상'}}]}]);setEmergencyNotice({active:true,topicId:'test-topic'})");
 assert.equal(ui.run('state.emergencyGuides[0].id'),'test-topic');assert.equal(ui.run('state.emergency.notice.topicId'),'test-topic');
 assert.equal(ui.storage.size,0);ui.run('setEmergencyGuides(null)');assert.equal(ui.run('state.emergencyGuides[0].id'),'cpr');
});
