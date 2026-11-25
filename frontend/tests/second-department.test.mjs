import test from 'node:test';
import assert from 'node:assert/strict';
import {searchDepartments,searchFacilities,emptyCriteria} from '../facilities.mjs';
import {placeQueries,liveQueryKey} from '../live-data.mjs';
import {normalizeAssistantResponse,assistantSearchContext} from '../assistant.mjs';
import {rankFacilities} from '../lib/care-ranking.mjs';

const both={...emptyCriteria(),region:'춘천',type:'hospital',department:'internal',departments:['internal','family']};

test('문진의 1·2순위 진료과는 맨 앞이 지금 진료과일 때만 함께 검색한다', () => {
  assert.deepEqual(searchDepartments(both), ['internal', 'family']);
  assert.deepEqual(searchDepartments({...both, department: 'ent'}), ['ent']); // 사용자가 진료과를 바꿈
  assert.deepEqual(searchDepartments({...both, department: 'all'}), ['all']);
  assert.deepEqual(searchDepartments({...emptyCriteria(), department: 'internal'}), ['internal']);
});

test('두 진료과를 각각 카카오에서 검색하고, 검색 키도 두 과를 담는다', () => {
  assert.deepEqual(placeQueries(both), [{code: 'HP8', keyword: '춘천 내과'}, {code: 'HP8', keyword: '춘천 가정의학과'}]);
  assert.deepEqual(placeQueries({...both, departments: undefined}), [{code: 'HP8', keyword: '춘천 내과'}]);
  assert.notEqual(liveQueryKey(both), liveQueryKey({...both, departments: undefined}));
  assert.equal(liveQueryKey({...both, department: 'ent'}), liveQueryKey({...both, department: 'ent', departments: undefined}));
});

test('예시 데이터 목록도 두 진료과 기관을 함께 보여 준다', () => {
  const items = [
    {id: 'a', type: 'hospital', department: 'internal', status: 'open', region: '춘천', name: {ko: 'A', en: 'A'}, area: {en: ''}},
    {id: 'b', type: 'hospital', department: 'family', status: 'open', region: '춘천', name: {ko: 'B', en: 'B'}, area: {en: ''}},
    {id: 'c', type: 'hospital', department: 'ent', status: 'open', region: '춘천', name: {ko: 'C', en: 'C'}, area: {en: ''}},
  ];
  assert.deepEqual(searchFacilities(both, items).map(item => item.id).sort(), ['a', 'b']);
});

test('문진 응답의 departments는 맨 앞이 department인 병원 진료과 2개만 받는다', () => {
  const ok = normalizeAssistantResponse({search: {type: 'hospital', department: 'internal', departments: ['internal', 'family']}});
  assert.deepEqual(ok.search.departments, ['internal', 'family']);
  for (const departments of [['family', 'internal'], ['internal'], ['internal', 'pharmacy'], ['internal', 'internal'], ['internal', 'xyz'], 'internal']) {
    assert.throws(() => normalizeAssistantResponse({search: {type: 'hospital', department: 'internal', departments}}));
  }
  assert.deepEqual(assistantSearchContext({search: {criteria: both}}).departments, ['internal', 'family']);
  assert.equal(assistantSearchContext({search: {criteria: {...both, department: 'ent'}}}).departments, undefined);
});

test('추천 순위: 1순위 진료과 기관 → 2순위 진료과 기관 순', () => {
  const item = (facilityId, department, departments = [department], displayOrder = 0) => ({facilityId, name: facilityId, type: 'hospital', department, departments, status: 'open', displayOrder});
  const candidates = {resultSetId: 'r1', items: [item('fam', 'family', ['family'], 0), item('int', 'internal', ['internal'], 1), item('ent', 'ent', ['ent'], 2)]};
  const out = rankFacilities({search: {type: 'hospital', department: 'internal', departments: ['internal', 'family']}, candidates});
  assert.deepEqual(out.items.map(entry => entry.facilityId), ['int', 'fam']);
  assert.match(out.items[1].reason.ko, /함께 안내한 가정의학과/);
  // departments가 없으면 예전처럼 1순위만
  assert.deepEqual(rankFacilities({search: {type: 'hospital', department: 'internal'}, candidates}).items.map(entry => entry.facilityId), ['int']);
});
