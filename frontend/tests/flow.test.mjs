import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareDraft,appendSymptom,emptyDraft} from '../flow.mjs';
test('상태 입력 정리와 선택형 항목 검증',()=>{
 assert.deepEqual(prepareDraft({symptom:'  배가 아파요  ',onset:'yesterday',region:' 춘천 '}),{symptom:'배가 아파요',onset:'yesterday',region:'춘천'});
 assert.equal(prepareDraft({onset:'invented'}).onset,'');
 assert.equal(prepareDraft({symptom:' '.repeat(5)}).symptom,'');
});
test('상시 입력창은 기존 상태에 이어 붙이고 원본 객체는 변경하지 않음',()=>{
 const first={symptom:'배가 아파요',onset:'today',region:'춘천'};
 assert.equal(appendSymptom(first,'  속이 메스꺼워요 ').symptom,'배가 아파요\n속이 메스꺼워요');
 assert.equal(first.symptom,'배가 아파요');
 assert.deepEqual(appendSymptom(first,'  '),first);
});
test('건너뛰기는 증상 없이도 같은 검색 진입을 허용하는 빈 상태',()=>{
 assert.deepEqual(emptyDraft(),{symptom:'',onset:'',region:''});
 assert.deepEqual(prepareDraft({region:'춘천'}),{symptom:'',onset:'',region:'춘천'});
});
test('입력 길이 제한',()=>{
 assert.equal(prepareDraft({symptom:'가'.repeat(1001),region:'나'.repeat(81)}).symptom.length,1000);
 assert.equal(prepareDraft({region:'나'.repeat(81)}).region.length,80);
 assert.equal(appendSymptom({symptom:'가'.repeat(999)},'나다').symptom.length,1000);
});