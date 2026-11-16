// 사전 증상 매칭 기본 구현(설계 §4-2). LLM 없음, 결정적.
// ⚠ 팀원 2의 사전 매칭 모듈 자리다. runCare의 deps.matchSymptoms로 교체할 수 있다(같은 서명).
//
// 규칙:
//  - llm/normalize.mjs의 normalizeTerm(NFKC → 소문자 → 공백 제거)으로 입력과 동의어를 같게 정규화한다.
//  - 동의어 termNorm이 입력에 들어 있으면 매칭. 한 글자 표현은 바로 뒤 글자가 이·가·을·를일 때만.
//  - fallback 증상·상위 증상(isCandidate === false)은 빼고, 성별을 알면 sexRestriction이 다른 증상을 뺀다.
//  - 부정 규칙은 넣지 않는다(설계 §4-2, 사실 확인 §4-2: "안 멈춰요"류 양성 문장을 잘못 뺌).
//  - 순서: 맞은 표현 길이 내림차순 → 같으면 symptomId 오름차순. 최대 5개.
//  - 입력은 줄 단위로 따로 정규화한다(메시지 경계를 넘는 매칭을 막는다).
import {normalizeTerm} from '../llm/normalize.mjs';

export const MAX_DICT_MATCHES = 5;
const ONE_CHAR_FOLLOWERS = new Set(['이', '가', '을', '를']);

function allowedBySex(symptom, sex) {
  if (sex !== 'female' && sex !== 'male') return true;
  return symptom.sexRestriction == null || symptom.sexRestriction === sex;
}

function oneCharHit(text, term) {
  let i = text.indexOf(term);
  while (i >= 0) {
    if (ONE_CHAR_FOLLOWERS.has(text[i + term.length])) return true;
    i = text.indexOf(term, i + 1);
  }
  return false;
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
  for (const syn of refData.synonyms) {
    const term = syn.termNorm;
    if (!term) continue;
    const s = refData.symptoms.get(syn.symptomId);
    if (!s || !s.isCandidate || !allowedBySex(s, sex)) continue;
    const len = Array.from(term).length;
    const hit = len === 1 ? lines.some((l) => oneCharHit(l, term)) : lines.some((l) => l.includes(term));
    if (hit && len > (best.get(syn.symptomId) ?? 0)) best.set(syn.symptomId, len);
  }
  return [...best.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, MAX_DICT_MATCHES)
    .map(([id]) => id);
}
