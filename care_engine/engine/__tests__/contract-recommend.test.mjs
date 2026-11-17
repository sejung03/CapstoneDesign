import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {checkResponseContract, FRONTEND_DEPARTMENT_KEYS} from '../contract.mjs';
import {recommend} from '../recommend.mjs';
import {buildSummary, buildEmergencySummary, displayOf} from '../summary.mjs';
import {applyMappings} from '../slots.mjs';
import {emergencyNotice, TEMPLATE_VERSION} from '../templates.mjs';
import {data, ref} from './helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** frontend/departments.mjs를 파일로 읽어(가져오지 않고) key 목록을 뽑는다. */
function frontendKeys() {
  const src = readFileSync(path.resolve(HERE, '../../../frontend/departments.mjs'), 'utf8');
  return [...src.matchAll(/"key":\s*"([a-z_]+)"/g)].map((m) => m[1]);
}

test('프론트 진료과 key 목록 = contract.mjs 사본', () => {
  assert.deepEqual([...frontendKeys()].sort(), [...FRONTEND_DEPARTMENT_KEYS].sort());
});

test('추천에 쓰이는 모든 search_key(시드 variant·fallback, never_recommend 제외)가 프론트 목록에 있다', () => {
  const keys = new Set(frontendKeys());
  const never = new Set(data.appConfig.never_recommend);
  const used = new Set();
  for (const list of data.variants.values()) for (const v of list) used.add(v.deptId);
  for (const list of data.fallbackDepartments.values()) for (const id of list) used.add(id);
  assert.ok(used.size >= 15);
  for (const id of used) {
    if (never.has(id)) continue;
    const sk = data.departments.get(id)?.searchKey;
    assert.ok(sk && keys.has(sk), `${id} → ${sk}`);
  }
  assert.ok(keys.has('pharmacy') && keys.has('korean'));
});

const GOOD = {
  summary: {ko: '요약'},
  followUp: {id: 'Q0', type: 'singleChoice', required: true, label: {ko: '질문'}, options: [{id: 'yes', label: {ko: '예'}}]},
  search: {type: 'hospital', department: 'internal', openOnly: true},
  emergency: {active: true, title: {ko: '제목'}, message: {ko: '안내'}},
  profileUpdates: [{id: 'age-1', field: 'age', operation: 'set', value: '30', evidence: {kind: 'message', index: 0, quote: '30살'}}],
};

test('계약 검사: 맞는 응답 통과', () => {
  assert.deepEqual(checkResponseContract(GOOD), {ok: true, errors: []});
  assert.ok(checkResponseContract({search: {type: 'pharmacy', department: 'pharmacy'}}).ok);
  assert.ok(checkResponseContract({emergency: {active: true}}).ok);
  assert.ok(checkResponseContract({summary: {ko: '가'.repeat(2000)}}).ok);
});

test('계약 검사: 위반 응답 거부', () => {
  const bad = [
    null, {}, {foo: 1}, {profileUpdates: []},
    {summary: {ko: ' '}}, {summary: {ko: '가'.repeat(2001)}}, {summary: {ko: 'a', fr: 'b'}},
    {followUp: {...GOOD.followUp, type: 'multiChoice'}},
    {followUp: {...GOOD.followUp, required: undefined}},
    {followUp: {...GOOD.followUp, options: []}},
    {followUp: {...GOOD.followUp, label: {ko: '가'.repeat(301)}}},
    {followUp: GOOD.followUp, followUpQuestionId: 'Q0'},
    {search: {}}, {search: {priority: 'distance'}}, {search: {department: 'xyz'}},
    {search: {type: 'pharmacy', department: 'internal'}}, {search: {type: 'hospital', department: 'pharmacy'}},
    {search: {openOnly: 'yes'}}, {search: {mode: 'bike'}}, {search: {region: 'a'.repeat(81)}}, {search: {type: 'clinic'}},
    {emergency: {title: {ko: 'x'}}}, {emergency: {active: true, videos: []}}, {emergency: {active: true, topicId: 'cpr'}},
    {emergency: {active: true, title: {ko: '가'.repeat(121)}}}, {emergency: {active: true, message: {ko: '가'.repeat(1001)}}},
    {profileUpdates: Array.from({length: 5}, (_, i) => ({...GOOD.profileUpdates[0], id: `a${i}`}))},
    {profileUpdates: [{...GOOD.profileUpdates[0], field: 'weight'}]},
    {profileUpdates: [{...GOOD.profileUpdates[0], value: 'abc'}]},
    {profileUpdates: [{...GOOD.profileUpdates[0], operation: 'clear'}]},
    {profileUpdates: [{...GOOD.profileUpdates[0], evidence: {kind: 'message', quote: 'x'}}]},
    {profileUpdates: [GOOD.profileUpdates[0], {...GOOD.profileUpdates[0], id: 'age-2'}]},
  ];
  for (const r of bad) assert.equal(checkResponseContract(r).ok, false, JSON.stringify(r)?.slice(0, 120));
});

const filter = (sex, ageBand) => ({sex, ageBand});

test('추천: variant rank 순 최대 3개, DB 함수와 같은 행', () => {
  const r = recommend({symptom: ref.symptoms.get('R05'), filter: filter('female', 'adult'), data});
  const expected = data.variants.get('R05|female|adult').slice(0, 3).map((v) => v.deptId);
  assert.deepEqual(r.departments.map((d) => d.deptId), expected);
  assert.deepEqual(r.departments.map((d) => d.rank), expected.map((_, i) => i + 1));
  assert.equal(r.group, null);
  assert.deepEqual(r.search, {type: 'hospital', department: r.departments[0].searchKey});
});

test('추천: 남성에게 산부인과 없음, 아이에게 소아청소년과', () => {
  // 성별 제한이 없는 증상: 남성 행에 산부인과 없음.
  // (여성 제한 증상 W·X의 남성 행에는 산부인과가 있다 — 사전·LLM 후보가 성별로 걸러져 남성에게는 그 증상이 나오지 않는다. 보고서 참고)
  for (const [key, list] of data.variants) {
    const [sid, sex] = key.split('|');
    if (sex !== 'male' || ref.symptoms.get(sid)?.sexRestriction) continue;
    assert.ok(!list.slice(0, 3).some((v) => v.deptId === 'obstetrics_gynecology'), key);
  }
  const r0 = recommend({symptom: ref.symptoms.get('A02'), filter: filter('male', 'adult'), data});
  assert.ok(!r0.departments.some((d) => d.deptId === 'obstetrics_gynecology'));
  const anyChildPeds = [...data.variants.entries()].some(([k, l]) => k.endsWith('|unknown|child') && l[0]?.deptId === 'pediatrics');
  assert.ok(anyChildPeds);
  const sid = [...data.variants.entries()].find(([k, l]) => k.endsWith('|female|child') && l[0]?.deptId === 'pediatrics')[0].split('|')[0];
  const r = recommend({symptom: ref.symptoms.get(sid), filter: filter('female', 'child'), data});
  assert.equal(r.departments[0].deptId, 'pediatrics');
});

test('추천: fallback 증상·증상 모름·F2=예·소아 fallback, never_recommend 제외', () => {
  assert.deepEqual(recommend({symptom: null, filter: filter('unknown', 'unknown'), data}).departments.map((d) => d.deptId), ['internal_medicine', 'family_medicine']);
  const inj = recommend({symptom: null, filter: filter('unknown', 'adult'), injuryAnswer: true, data});
  assert.equal(inj.group, 'injury');
  assert.deepEqual(inj.search, {type: 'hospital', department: 'orthopedics'});
  const t04 = ref.symptoms.get('T04');
  assert.equal(t04.fallbackGroup, 'pediatric');
  const ped = recommend({symptom: t04, filter: filter('unknown', 'child'), data});
  assert.equal(ped.group, 'pediatric');
  assert.deepEqual(ped.departments.map((d) => d.deptId), ['pediatrics']);
  // [판단] 성인에게는 소아청소년과(최대 18세)를 빼고 general로
  const pedAdult = recommend({symptom: t04, filter: filter('unknown', 'adult'), data});
  assert.equal(pedAdult.group, 'general');
  const injSym = [...ref.symptoms.values()].find((s) => s.isInjury && s.isFallback);
  if (injSym) assert.equal(recommend({symptom: injSym, filter: filter('unknown', 'adult'), data}).group, 'injury');
  for (const r of [inj, ped]) assert.ok(!r.departments.some((d) => data.appConfig.never_recommend.includes(d.deptId)));
});

test('요약: 답이 없는 줄은 빼고, 표시 문구만', () => {
  const codes = new Map([['Q0', 'no'], ['T1', 'child']]);
  const slots = applyMappings({codes, data});
  const s = buildSummary({slots, codes, symptom: null, departments: [], data});
  assert.deepEqual(s.split('\n'), [
    '입력한 답을 정리한 참고용 내용이에요. 진단이 아니에요.',
    '상담 대상: 아이',
    '주된 증상: 목록에서 찾지 못함',
    '복용 중인 약, 기존 질환, 함께 있는 다른 증상은 확인하지 않았어요. 해당되면 진료 때 꼭 알려 주세요.',
    '증상이 갑자기 심해지면 119에 연락하세요.',
  ]);
  const c2 = new Map([['Q0', 'no'], ['P0', 'yes'], ['P1', 'pain_7'], ['N6', 'no'], ['N6-1', 'freq_daily'], ['N11', 'yes'], ['N11-2', 'worse']]);
  const s2 = buildSummary({slots: applyMappings({codes: c2, data}), codes: c2, symptom: ref.symptoms.get('R05'), departments: [{nameKo: '내과'}, {nameKo: '이비인후과'}], data, safetyUnanswered: true});
  const lines = s2.split('\n');
  assert.equal(lines[0], '응급 확인 질문에 답하지 않았어요. 의식이 흐리거나 숨쉬기 힘들거나, 갑작스러운 마비·말하기 어려움·심한 가슴 통증·멈추지 않는 출혈이 있으면 지금 119에 연락하세요.');
  assert.ok(lines.includes('경과: 계속 나타남(아니요), 하루 한 번, 나빠짐'));
  assert.ok(lines.includes('통증: 7점 (0~10)'));
  assert.ok(lines.includes('참고할 진료과: 내과, 이비인후과'));
  assert.equal(displayOf({value: 'count_1', question: 'E8'}, data), '1명');
  assert.equal(buildEmergencySummary({slots: applyMappings({codes: new Map([['Q0', 'yes']]), data}), data}), null);
});

test('템플릿: 응급 문구 길이, 모르는 키', () => {
  assert.equal(TEMPLATE_VERSION, 'templates-v4'); // 11/17 R: 자유 입력 문구 3개, RF3: 민감 안내 2개
  for (const k of ['emergency_call_119', 'urgent_notice_consciousness', 'urgent_notice_breathing', 'urgent_notice_red_flags',
    'freetext_emergency_119', 'freetext_urgent', 'crisis_notice_109', 'threat_notice_112', 'violence_notice_1366', 'nope']) {
    const n = emergencyNotice(k);
    assert.ok(checkResponseContract({emergency: n.emergency}).ok, k);
    assert.equal(n.warning, k === 'nope' ? 'unknown_message_key' : null);
  }
  for (const rule of data.rules) assert.equal(emergencyNotice(rule.messageKey).warning, null, rule.messageKey);
});
