import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {loadIntakeData} from '../intake-data.mjs';
import {matchSymptoms} from '../dictionary-match.mjs';
import {checkFacilityKeywords, buildFacilitySearch, loadFacilityKeywords} from '../facility-keywords.mjs';

const data = loadIntakeData();
const ref = data.refData;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONT = path.resolve(HERE, '../../../frontend');

/** 프론트 시작 선택지 파일을 읽어(가져오지 않고) 약국 문장을 꺼낸다. */
function pharmacyStarterText() {
  const src = readFileSync(path.join(FRONT, 'care-context.mjs'), 'utf8');
  const m = src.match(/id:'pharmacy'[^\n]*?text:\{ko:'([^']+)'/);
  assert.ok(m, '프론트 약국 시작 문장을 찾지 못함');
  return m[1];
}

const facility = (messages, {hasAnyAnswer = false} = {}) => checkFacilityKeywords({
  messages, hasAnyAnswer, dictMatches: matchSymptoms(messages.join('\n'), ref), data,
});

test('matchSymptoms: 시작 문장(사실 확인 §2와 같은 결과)', () => {
  assert.deepEqual(matchSymptoms('기침이 나요', ref), ['R05']);
  assert.deepEqual(matchSymptoms('열이 나는 것 같아요', ref), ['A03']);
  assert.deepEqual(matchSymptoms('배가 아파요', ref), []);
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

test('키워드: 진료과 이름 + 요청어 → 그 과 search_key (긴 이름 우선, 옛 이름 표)', () => {
  assert.deepEqual(facility(['근처 치과 어디 있나요']), {search: {type: 'hospital', department: 'dental'}});
  assert.deepEqual(facility(['정형외과 알려줘']), {search: {type: 'hospital', department: 'orthopedics'}});
  assert.deepEqual(facility(['소아과 추천해 주세요']), {search: {type: 'hospital', department: 'pediatrics'}});
  assert.deepEqual(facility(['마취통증의학과 찾아요']), {search: {type: 'hospital', department: 'pain'}});
  assert.deepEqual(facility(['지금 여는 병원 있나요']), {search: {type: 'hospital', openOnly: true}});
});

test('키워드: 증상 단서·약 질문 단서·사전 매칭·답이 있으면 null', () => {
  assert.equal(facility(['배가 아픈데 문 연 병원 있나요']), null);
  assert.equal(facility(['약국 약이랑 같이 먹어도 되나요']), null);
  assert.equal(facility(['기침 심한데 약국 어디예요']), null); // 사전 매칭 R05
  assert.equal(facility([pharmacyStarterText()], {hasAnyAnswer: true}), null);
  assert.equal(facility([]), null);
});

test('키워드: "효과·결과" 같은 단어나 기관 표현 없는 문장은 걸리지 않음', () => {
  assert.equal(facility(['효과 좋은 결과 알려줘']), null);
  assert.equal(facility(['검사 결과 어디서 봐요']), null);
  assert.equal(facility(['그냥 궁금해요']), null);
});

test('키워드: 응급의학과(never_recommend)는 바로 검색으로 보내지 않는다', () => {
  assert.equal(facility(['응급의학과 어디 있어요']), null);
});

test('buildFacilitySearch: LLM facility_search용(조건 없이 만드는 법만)', () => {
  assert.deepEqual(buildFacilitySearch(['문 연 약국'], data), {type: 'pharmacy', department: 'pharmacy', openOnly: true});
  assert.deepEqual(buildFacilitySearch(['가까운 데 가고 싶어요'], data), {type: 'hospital'});
  assert.equal(loadFacilityKeywords().version, 'facility-keywords-v1');
});
