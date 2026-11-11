import test from 'node:test';
import assert from 'node:assert/strict';
import {facilities,emptyCriteria,searchFacilities,selectedFacility} from '../facilities.mjs';
import {renderExplore} from '../facilities-view.mjs';
test('전체 예시기관 검색',()=>{
 assert.equal(searchFacilities(emptyCriteria()).length,6);
 assert.ok(facilities.every(f=>f.name.ko.startsWith('예시')));
 assert.equal(new Set(facilities.map(f=>f.id)).size,facilities.length);
});
test('복합 지역 및 영어 검색',()=>{
 assert.equal(searchFacilities({...emptyCriteria(),region:'춘천시 효자동'}).length,2);
 assert.equal(searchFacilities({...emptyCriteria(),region:'CHUNCHEON hyoja-dong'}).length,2);
 assert.equal(searchFacilities({...emptyCriteria(),region:'서울'}).length,0);
 assert.equal(searchFacilities({...emptyCriteria(),region:'예시 내과'}).length,2);
});
test('필터 조합 및 운영정보 없음 처리',()=>{
 assert.equal(searchFacilities({...emptyCriteria(),type:'pharmacy'}).length,2);
 assert.equal(searchFacilities({...emptyCriteria(),department:'internal'}).length,2);
 assert.equal(searchFacilities({...emptyCriteria(),openOnly:true}).length,2);
 assert.equal(searchFacilities({...emptyCriteria(),type:'pharmacy',openOnly:true}).length,1);
 assert.equal(searchFacilities({...emptyCriteria(),type:'pharmacy',department:'internal'}).length,0);
});
test('정렬 시 원본 순서 보존',()=>{
 const original=facilities.map(f=>f.id);
 const names=searchFacilities({...emptyCriteria(),sort:'name'});
 assert.deepEqual(facilities.map(f=>f.id),original);
 assert.ok(names.every((x,i)=>!i||names[i-1].name.ko.localeCompare(x.name.ko,'ko')<=0));
 const distances=searchFacilities(emptyCriteria()).map(f=>f.distance);
 assert.deepEqual(distances,[...distances].sort((a,b)=>a-b));
});
test('검색 결과에서 사라진 선택 기관 해제',()=>{
 assert.equal(selectedFacility(searchFacilities(emptyCriteria()),'sample-a').id,'sample-a');
 assert.equal(selectedFacility(searchFacilities({...emptyCriteria(),type:'pharmacy'}),'sample-a'),null);
});
test('문진 스킵 여부와 관계없이 동일한 목록·지도 제공',()=>{
 const getState=draft=>({locale:'ko',draft,type:'all',search:{criteria:emptyCriteria(),department:'all',openOnly:false,selectedId:null,display:'map'}});
 const t=x=>x,icon=()=>'',escape=s=>String(s).replace(/[<>&"]/g,'');
 const skipped=renderExplore(getState({symptom:'',region:''}),t,icon,escape);
 const answered=renderExplore(getState({symptom:'배가 아파요',region:''}),t,icon,escape);
 for(const html of [skipped,answered]){
  assert.equal((html.match(/<article class="facility-card/g)||[]).length,6);
  assert.equal((html.match(/class="map-pin /g)||[]).length,6);
 }
 assert.equal(skipped,answered);
});
