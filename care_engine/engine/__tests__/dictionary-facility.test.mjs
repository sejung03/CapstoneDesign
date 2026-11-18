import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {loadIntakeData} from '../intake-data.mjs';
import {matchSymptoms} from '../dictionary-match.mjs';
import {checkFacilityKeywords, evaluateFacilityKeywords, buildFacilitySearch, loadFacilityKeywords, compileFacilityKeywords, messageCues} from '../facility-keywords.mjs';

const data = loadIntakeData();
const ref = data.refData;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONT = path.resolve(HERE, '../../../frontend');

/** 프론트 시작 선택지 파일을 읽어(가져오지 않고) 약국 문장을 꺼낸다. */
function pharmacyStarterText() {
  const src = readFileSync(path.join(FRONT, 'care-context.mjs'), 'utf8');
  const m = src.match(/id:'pharmacy'[^\n]*?text:(?:expandLocales\()?\{ko:'([^']+)'/);
  assert.ok(m, '프론트 약국 시작 문장을 찾지 못함');
  return m[1];
}

const facility = (messages, {hasAnyAnswer = false} = {}) => checkFacilityKeywords({
  messages, hasAnyAnswer, dictMatches: matchSymptoms(messages.join('\n'), ref), data,
});

test('matchSymptoms: 시작 문장(사실 확인 §2와 같은 결과)', () => {
  assert.deepEqual(matchSymptoms('기침이 나요', ref), ['R05']);
  assert.deepEqual(matchSymptoms('열이 나는 것 같아요', ref), ['A03']);
  assert.deepEqual(matchSymptoms('배가 아파요', ref), ['D01']); // 11/18 일상 표현 사전(synonym_everyday_v1.csv)
  assert.deepEqual(matchSymptoms('몸이 아파요', ref), []); // 증상 단서만 있고 사전에는 없는 문장
  assert.deepEqual(matchSymptoms(pharmacyStarterText(), ref), []);
  assert.deepEqual(matchSymptoms('', ref), []);
});

test('matchSymptoms: 부정 규칙 없음(계속됨을 뜻하는 문장도 매칭)', () => {
  assert.ok(matchSymptoms('기침이 안 멈춰요', ref).includes('R05'));
});

test('matchSymptoms: 성별 제한 증상은 다른 성별이면 뺀다', () => {
  const syn = ref.synonyms.find((s) => {
    const sym = ref.symptoms.get(s.symptomId);
    return sym.isCandidate && sym.sexRestriction === 'female' && Array.from(s.termNorm).length >= 3;
  });
  assert.ok(syn, '여성 제한 증상 동의어가 시드에 없음');
  assert.ok(matchSymptoms(syn.term, ref, {sex: 'female'}).includes(syn.symptomId));
  assert.ok(matchSymptoms(syn.term, ref).includes(syn.symptomId));
  assert.ok(!matchSymptoms(syn.term, ref, {sex: 'male'}).includes(syn.symptomId));
});

test('matchSymptoms: fallback·상위 증상은 후보가 아니다', () => {
  const syn = ref.synonyms.find((s) => !ref.symptoms.get(s.symptomId).isCandidate && Array.from(s.termNorm).length >= 3);
  assert.ok(syn);
  assert.ok(!matchSymptoms(syn.term, ref).includes(syn.symptomId));
});

test('matchSymptoms: 한 글자 표현은 바로 뒤가 이·가·을·를일 때만', () => {
  const syn = ref.synonyms.find((s) => ref.symptoms.get(s.symptomId).isCandidate && Array.from(s.termNorm).length === 1);
  assert.ok(syn, '한 글자 동의어가 시드에 없음');
  assert.ok(matchSymptoms(`${syn.termNorm}이 있어요`, ref).includes(syn.symptomId));
  assert.ok(!matchSymptoms(`${syn.termNorm}도 있어요`, ref).includes(syn.symptomId));
});

test('matchSymptoms: 최대 5개, 맞은 표현 길이 내림차순 → id 오름차순', () => {
  const picked = [];
  const seen = new Set();
  for (const s of ref.synonyms) {
    const sym = ref.symptoms.get(s.symptomId);
    if (!sym.isCandidate || sym.sexRestriction || seen.has(s.symptomId) || Array.from(s.termNorm).length < 2) continue;
    seen.add(s.symptomId);
    picked.push(s.term);
    if (picked.length === 8) break;
  }
  const out = matchSymptoms(picked.join('\n'), ref);
  assert.equal(out.length, 5);
  const lens = out.map((id) => Math.max(...ref.synonyms.filter((s) => s.symptomId === id && picked.some((t) => t.replace(/\s/g, '').toLowerCase().includes(s.termNorm))).map((s) => Array.from(s.termNorm).length)));
  for (let i = 1; i < out.length; i += 1) {
    assert.ok(lens[i - 1] > lens[i] || (lens[i - 1] === lens[i] && out[i - 1] < out[i]), `순서: ${out}`);
  }
  // 줄 경계를 넘는 매칭은 없다
  assert.deepEqual(matchSymptoms('기\n침이', ref), []);
});

test('키워드: 약국 시작 문장(프론트 파일에서 읽음) → pharmacy·openOnly', () => {
  assert.deepEqual(facility([pharmacyStarterText()]), {search: {type: 'pharmacy', department: 'pharmacy', openOnly: true}});
});


// ---- 11/17 EF F1: 약국만 바로 search, 위험 단서는 지름길을 막는다 ----
const reasonOf = (messages) => evaluateFacilityKeywords({messages, hasAnyAnswer: false, dictMatches: matchSymptoms(messages.join('\n'), ref), data}).reason;

test('F1 키워드: 규칙 파일은 v2, riskCues가 없는 규칙 파일(v1 포함)은 거부', () => {
  assert.equal(loadFacilityKeywords().version, 'facility-keywords-v2');
  const v1 = JSON.parse(readFileSync(path.resolve(HERE, '../rules/facility_keywords_v1.json'), 'utf8'));
  assert.throws(() => compileFacilityKeywords(v1), /riskCues/);
});

test('F1 키워드: 병원·의원·진료과 찾기 문장은 바로 search로 가지 않는다(no_pharmacy)', () => {
  for (const m of ['근처 치과 어디 있나요', '정형외과 알려줘', '소아과 추천해 주세요', '마취통증의학과 찾아요', '지금 여는 병원 있나요', '진료하는 의원 알려줘']) {
    assert.equal(facility([m]), null, m);
    assert.equal(reasonOf([m]), 'no_pharmacy', m);
  }
});

test('F1 키워드: 위험 단서(쓰러짐·호흡·응급실·자해/자살) → blocked_risk, 약국 문장에도 적용', () => {
  for (const m of ['할머니가 쓰러졌어요 병원 어디요', '숨을 못 쉬겠어요 병원 알려줘', '응급실 있는 병원 찾아줘', '죽고 싶어요 정신과 어디예요',
    '숨이 안 쉬어지는데 약국 어디', '약을 많이 먹었어요 문 연 약국', '응급의학과 근처 약국']) {
    assert.equal(facility([m]), null, m);
    assert.equal(reasonOf([m]), 'blocked_risk', m);
  }
});

test('F1 키워드: "사고" 단독은 위험 단서가 아니다(약 사고 싶어요 → 약국 search)', () => {
  assert.deepEqual(facility(['약 사고 싶은데 약국 어디예요']), {search: {type: 'pharmacy', department: 'pharmacy'}});
});

test('F1 키워드: 약국 + 증상·약 질문 단서·사전 매칭·병원 이름·답 → null(사유 코드)', () => {
  assert.equal(reasonOf(['몸이 아픈데 약국 어디예요']), 'blocked_symptom'); // 11/18: '배가 아픈데'는 이제 사전에 맞아 blocked_dict
  assert.equal(reasonOf(['배가 아픈데 약국 어디예요']), 'blocked_dict');
  assert.equal(reasonOf(['약국 약이랑 같이 먹어도 되나요']), 'blocked_medication');
  assert.equal(reasonOf(['병원이나 약국 어디 있어요']), 'blocked_place');
  assert.equal(reasonOf(['기침 심한데 약국 어디예요']), 'blocked_dict');
  assert.equal(evaluateFacilityKeywords({messages: [pharmacyStarterText()], hasAnyAnswer: true, dictMatches: [], data}).reason, 'answered');
  assert.equal(reasonOf([]), 'no_message');
  assert.equal(reasonOf([pharmacyStarterText()]), 'search');
});

test('F1 키워드: "효과·결과" 같은 단어나 기관 표현 없는 문장은 걸리지 않음', () => {
  assert.equal(facility(['효과 좋은 결과 알려줘']), null);
  assert.equal(facility(['검사 결과 어디서 봐요']), null);
  assert.equal(facility(['그냥 궁금해요']), null);
});

test('buildFacilitySearch: LLM facility_search용(진료과 이름 → search_key, 긴 이름 우선, 옛 이름 표, 응급의학과 제외)', () => {
  assert.deepEqual(buildFacilitySearch(['문 연 약국'], data), {type: 'pharmacy', department: 'pharmacy', openOnly: true});
  assert.deepEqual(buildFacilitySearch(['가까운 데 가고 싶어요'], data), {type: 'hospital'});
  assert.deepEqual(buildFacilitySearch(['근처 치과 어디 있나요'], data), {type: 'hospital', department: 'dental'});
  assert.deepEqual(buildFacilitySearch(['정형외과 알려줘'], data), {type: 'hospital', department: 'orthopedics'});
  assert.deepEqual(buildFacilitySearch(['소아과 추천해 주세요'], data), {type: 'hospital', department: 'pediatrics'});
  assert.deepEqual(buildFacilitySearch(['마취통증의학과 찾아요'], data), {type: 'hospital', department: 'pain'});
  assert.deepEqual(buildFacilitySearch(['지금 여는 병원 있나요'], data), {type: 'hospital', openOnly: true});
  assert.deepEqual(buildFacilitySearch(['응급의학과 어디 있어요'], data), {type: 'hospital'});
});

test('messageCues: 증상·약·위험 단서(값은 불리언만)', () => {
  assert.deepEqual(messageCues(['배가 아파요'], data), {symptomCue: true, medicationCue: false, riskCue: false});
  assert.deepEqual(messageCues(['약 먹어도 되나요'], data), {symptomCue: false, medicationCue: true, riskCue: false});
  assert.deepEqual(messageCues(['쓰러졌어요'], data), {symptomCue: false, medicationCue: false, riskCue: true});
  assert.deepEqual(messageCues([], data), {symptomCue: false, medicationCue: false, riskCue: false});
});
