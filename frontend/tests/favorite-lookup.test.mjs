import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePlace,displayedFacilities,facilityDistanceKm,liveQueryKey} from '../live-data.mjs';
import {searchFacilities,emptyCriteria} from '../facilities.mjs';
import {searchKakao} from '../kakao-client.mjs';
import {withCurrentHours,enrichPublicHours} from '../public-hours.mjs';
import {recommendationSnapshot} from '../recommendations.mjs';
const raw=(id,y)=>({id,place_name:'정문온누리약국',category_group_code:'PM9',category_name:'약국',x:'127.75',y:String(y),road_address_name:'강원특별자치도 춘천시 백령로 152'});
test('saved institution lookup selects its stable ID, never a distant open namesake',async()=>{
 let keyword;
 const api={maps:{services:{Status:{OK:'OK',ZERO_RESULT:'ZERO'},Places:class{keywordSearch(query,cb){keyword=query;cb([raw('99',38.57),raw('1',37.873)],'OK',{hasNextPage:false});}}}}};
 const criteria={...emptyCriteria(),region:'정문온누리약국',type:'pharmacy',targetFacilityId:'kakao-1',targetQuery:'정문온누리약국 강원특별자치도 춘천시'};
 const result=await searchKakao('',criteria,{api});assert.deepEqual(result.items.map(x=>x.id),['kakao-1']);assert.match(keyword,/춘천시/);assert.equal(result.hasMore,false);
 const state={source:'live',search:{criteria,origin:'favorite'},live:{position:{lat:37.87,lng:127.75},items:[{...normalizePlace(raw('99',38.57)),status:'open'},{...normalizePlace(raw('1',37.873)),status:'closed'}]}};
 const shown=displayedFacilities(state,searchFacilities);assert.deepEqual(shown.map(x=>x.id),['kakao-1']);assert.equal(shown[0].status,'unknown');assert.ok(shown[0].distance>.3&&shown[0].distance<.4);assert.equal(shown[0].distance,facilityDistanceKm(state,shown[0]));assert.equal(recommendationSnapshot(state),null);
 assert.notEqual(liveQueryKey(criteria),liveQueryKey({...criteria,targetFacilityId:'kakao-99'}));
});
test('a deleted or absent saved ID is not silently replaced by an identically named institution',async()=>{
 const api={maps:{services:{Status:{OK:'OK',ZERO_RESULT:'ZERO'},Places:class{keywordSearch(query,cb){cb([raw('99',38.57)],'OK',{});}}}}};
 const result=await searchKakao('',{...emptyCriteria(),region:'정문온누리약국',type:'pharmacy',targetFacilityId:'kakao-1',targetQuery:'정문온누리약국 춘천'},{api});assert.deepEqual(result.items,[]);
});
test('missing public hours clear unsupported open claims; device coordinates alone determine straight distance',async()=>{
 const item={...normalizePlace(raw('1',37.873)),status:'open',hours:'stale'};
 assert.equal(withCurrentHours(item).status,'unknown');assert.equal(withCurrentHours(item).hours,null);
 const [result]=await enrichPublicHours([item],{fetcher:async()=>({ok:true,text:async()=>''}),parse:()=>[]});assert.equal(result.status,'unknown');assert.equal(result.hoursError,'hoursNotMatched');
 const state={live:{position:{lat:37.87,lng:127.75}},search:{criteria:{center:{lat:38.57,lng:127.75}}}};
 assert.ok(facilityDistanceKm(state,{...item,distance:77.6})<.4);state.live.position=null;assert.equal(facilityDistanceKm(state,item),null);
});
test('a schedule-confirmed closed saved institution remains visible in the direct lookup',()=>{
 const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',hour:'2-digit',hourCycle:'h23'}).format(new Date()));
 const time=offset=>String((hour+offset)%24).padStart(2,'0')+'00';
 const schedule=Array.from({length:8},(_,index)=>({day:index+1,start:time(1),end:time(2)}));
 const institution={...normalizePlace(raw('1',37.873)),schedule};
 const state={source:'live',search:{origin:'favorite',criteria:{...emptyCriteria(),targetFacilityId:'kakao-1'}},live:{items:[institution],position:{lat:37.87,lng:127.75}}};
 const results=displayedFacilities(state,searchFacilities);assert.equal(results.length,1);assert.equal(results[0].id,'kakao-1');assert.equal(results[0].status,'closed');
});
