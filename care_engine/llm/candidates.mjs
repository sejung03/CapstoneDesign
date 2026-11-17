// 후보 생성(사전 기반, LLM 없음, 결정적). 설계 5-2.
import {normalizeInput, normalizeTerm} from './normalize.mjs';

function grams(s) {
  const cps = Array.from(s);
  if (cps.length === 0) return [];
  if (cps.length === 1) return cps; // 길이 1이면 1-gram
  const out = [];
  for (let i = 0; i < cps.length - 1; i += 1) out.push(cps[i] + cps[i + 1]);
  return out;
}

function countMap(arr) {
  const m = new Map();
  for (const g of arr) m.set(g, (m.get(g) ?? 0) + 1);
  return m;
}

/** 문자 2-gram Dice 계수(다중집합). 길이 1인 문자열은 1-gram. */
export function dice(a, b) {
  const ga = grams(a);
  const gb = grams(b);
  if (ga.length === 0 || gb.length === 0) return 0;
  const ca = countMap(ga);
  let inter = 0;
  for (const [g, n] of countMap(gb)) inter += Math.min(n, ca.get(g) ?? 0);
  return (2 * inter) / (ga.length + gb.length);
}

/** 정규화된 입력과 동의어 하나의 점수. 동의어가 입력의 부분 문자열이면 1.0. */
export function scoreTerm(inputNorm, termNorm) {
  if (!inputNorm || !termNorm) return 0;
  if (inputNorm.includes(termNorm)) return 1;
  return dice(inputNorm, termNorm);
}

function allowedBySex(symptom, sex) {
  if (sex !== 'female' && sex !== 'male') return true;
  return symptom.sexRestriction == null || symptom.sexRestriction === sex;
}

/**
 * @param {string} inputText
 * @param {object} refData loadRefData() 결과
 * @param {{k?:number, mode?:'retrieve'|'all', sex?:string|null}} [opts]
 * @returns {Array<{symptomId:string, score:number|null}>}
 */
export function buildCandidates(inputText, refData, {k = 40, mode = 'retrieve', sex = null} = {}) {
  const eligible = (id) => {
    const s = refData.symptoms.get(id);
    return s != null && s.isCandidate && allowedBySex(s, sex);
  };

  if (mode === 'all') {
    return [...refData.symptoms.keys()]
      .filter(eligible)
      .sort(cmpId)
      .map((symptomId) => ({symptomId, score: null}));
  }
  if (mode !== 'retrieve') throw new Error(`buildCandidates: 알 수 없는 mode '${mode}'`);

  const inputNorm = normalizeInput(inputText);
  const best = new Map();
  for (const syn of refData.synonyms) {
    if (!eligible(syn.symptomId)) continue;
    const sc = scoreTerm(inputNorm, normalizeTerm(syn.termNorm));
    if (sc > (best.get(syn.symptomId) ?? 0)) best.set(syn.symptomId, sc);
  }
  return [...best.entries()]
    .filter(([, sc]) => sc > 0)
    .sort((a, b) => (b[1] - a[1]) || cmpId(a[0], b[0]))
    .slice(0, k)
    .map(([symptomId, score]) => ({symptomId, score}));
}

function cmpId(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * LLM에 주는 후보 표기: 줄마다 "ID | name_ko | 동의어 최대 3개".
 * 동의어는 사전 id 오름차순 앞 3개(term 원형). name_ko와 같은 것(정규화 비교)과 앞에서 나온 것은 건너뜀.
 */
export function formatCandidatesForPrompt(candidates, refData) {
  const bySymptom = new Map();
  for (const syn of refData.synonyms) {
    if (!bySymptom.has(syn.symptomId)) bySymptom.set(syn.symptomId, []);
    bySymptom.get(syn.symptomId).push(syn);
  }
  const clean = (t) => String(t).replace(/[\r\n|]+/g, ' ').trim();
  return candidates.map(({symptomId}) => {
    const s = refData.symptoms.get(symptomId);
    const seen = new Set([normalizeTerm(s.nameKo)]);
    const terms = [];
    for (const syn of (bySymptom.get(symptomId) ?? []).slice().sort((a, b) => a.id - b.id)) {
      if (terms.length >= 3) break;
      const n = normalizeTerm(syn.term);
      if (seen.has(n)) continue;
      seen.add(n);
      terms.push(clean(syn.term));
    }
    const parts = [symptomId, clean(s.nameKo)];
    if (terms.length > 0) parts.push(terms.join(', '));
    return parts.join(' | ');
  }).join('\n');
}
