// 사전 증상 매칭 기본 구현(설계 §4-2). LLM 없음, 결정적.
// ⚠ 팀원 2의 사전 매칭 모듈 자리다. runCare의 deps.matchSymptoms로 교체할 수 있다(같은 서명).
//
// 규칙:
//  - llm/normalize.mjs의 normalizeTerm(NFKC → 소문자 → 공백 제거)으로 입력과 동의어를 같게 정규화한다.
//  - 동의어 termNorm이 입력에 들어 있으면 매칭. 한 글자 표현은 바로 뒤 글자가 이·가·을·를일 때만.
//  - (11/18) 더 긴 표현이 맞은 범위 안에 통째로 들어가는 짧은 표현은 버린다("발목이"의 "목이", "소변에 피"의 "변에 피").
//  - (11/24) 약 이름(MEDICINE_TERMS) 안에 통째로 들어가는 표현도 버린다("감기약"의 "감기").
//  - fallback 증상·상위 증상(isCandidate === false)은 빼고, 성별을 알면 sexRestriction이 다른 증상을 뺀다.
//  - 부정 규칙은 넣지 않는다(설계 §4-2, 사실 확인 §4-2: "안 멈춰요"류 양성 문장을 잘못 뺌).
//  - 순서: 맞은 표현 길이 내림차순 → 같으면 symptomId 오름차순. 최대 5개.
//  - 입력은 줄 단위로 따로 정규화한다(메시지 경계를 넘는 매칭을 막는다).
import {normalizeTerm} from '../llm/normalize.mjs';

export const MAX_DICT_MATCHES = 5;
const ONE_CHAR_FOLLOWERS = new Set(['이', '가', '을', '를']);
/**
 * 11/24: 약 이름 안의 증상 단어는 증상으로 세지 않는다("감기약 같이 먹어도 돼요?"의 "감기").
 * 사전이 후보를 내면 LLM을 부르지 않으므로, 약 질문(medication_question)을 LLM이 알아보도록 비워 둔다.
 * 약 이름 밖에서 증상을 다시 말하면("두통약 먹어도 두통이 안 나아요") 그 표현은 그대로 맞는다. normalizeTerm 형태로 적는다.
 */
export const MEDICINE_TERMS = Object.freeze(['감기약', '두통약', '기침약', '콧물약', '설사약', '변비약', '비염약', '가려움약']);

function medicineSpans(line) {
  const spans = [];
  for (const term of MEDICINE_TERMS) {
    for (let i = line.indexOf(term); i >= 0; i = line.indexOf(term, i + 1)) spans.push({start: i, end: i + term.length});
  }
  return spans;
}

function allowedBySex(symptom, sex) {
  if (sex !== 'female' && sex !== 'male') return true;
  return symptom.sexRestriction == null || symptom.sexRestriction === sex;
}

/**
 * 11/18: 한 줄에서 맞은 표현과 위치. 더 긴 표현이 맞은 범위 안에 통째로 들어가는 짧은 표현은 버린다(가장 긴 표현 우선).
 * "발목이"의 "목이", "소변에 피"의 "변에 피", "소변이 시원하게 안"의 "변이 시원하게 안"이 다른 증상으로 잡히지 않게.
 * 덮는 쪽은 성별이 맞는 표현이면 후보가 아닌 증상(fallback)이어도 된다(그 말의 뜻은 긴 표현이 정한다).
 */
function lineHits(line, synonyms, symptoms, sex) {
  const hits = [];
  for (const syn of synonyms) {
    const term = syn.termNorm;
    if (!term) continue;
    const s = symptoms.get(syn.symptomId);
    if (!s || !allowedBySex(s, sex)) continue;
    const oneChar = Array.from(term).length === 1;
    for (let i = line.indexOf(term); i >= 0; i = line.indexOf(term, i + 1)) {
      if (oneChar && !ONE_CHAR_FOLLOWERS.has(line[i + term.length])) continue;
      hits.push({syn, s, start: i, end: i + term.length});
    }
  }
  const medicines = medicineSpans(line);
  return hits.filter((h) => !hits.some((o) => o.end - o.start > h.end - h.start && o.start <= h.start && h.end <= o.end)
    && !medicines.some((m) => m.start <= h.start && h.end <= m.end));
}

/**
 * @param {string} text 사용자 메시지(여러 개면 '\n'으로 이은 것)
 * @param {{symptoms:Map, synonyms:Array}} refData llm/ref-data.mjs loadRefData() 결과
 * @param {{sex?:'female'|'male'|null}} [opts]
 * @returns {string[]} symptomId(관련도 순, 최대 5개)
 */
export function matchSymptoms(text, refData, {sex = null} = {}) {
  const lines = String(text ?? '').split('\n').map((l) => normalizeTerm(l)).filter(Boolean);
  if (lines.length === 0) return [];
  const best = new Map(); // symptomId → 맞은 표현 길이
  for (const line of lines) {
    for (const {syn, s} of lineHits(line, refData.synonyms, refData.symptoms, sex)) {
      if (!s.isCandidate) continue;
      const len = Array.from(syn.termNorm).length;
      if (len > (best.get(syn.symptomId) ?? 0)) best.set(syn.symptomId, len);
    }
  }
  return [...best.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, MAX_DICT_MATCHES)
    .map(([id]) => id);
}
