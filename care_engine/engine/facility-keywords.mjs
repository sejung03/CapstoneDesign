// 키워드 기관 찾기(설계 §4-6, 11/17 EF 반영). LLM 없이 첫 요청의 **약국 찾기** 문장만 search로 보낸다.
// 병원·의원·진료과 찾기 문장은 바로 보내지 않는다(Q0부터 정상 문진 → 안전 질문 뒤 LLM 의도 facility_search).
// 규칙은 데이터 파일 engine/rules/facility_keywords_v2.json에 둔다(코드에 박지 않음). v1 파일은 기록용으로 남긴다.
// riskCues는 응급 판정에 쓰지 않는다. 걸리면 지름길만 막고 정상 문진으로 보낸다(판정은 안전 규칙 몫).
// 진료과 이름은 실행할 때 department.csv의 name_ko도 함께 쓴다. "○○과" 일반 패턴은 쓰지 않는다.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {normalizeTerm} from '../llm/normalize.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FACILITY_KEYWORDS_PATH = path.join(HERE, 'rules', 'facility_keywords_v2.json');

/** trace.facilityKeyword 값(사유 코드만, 원문 없음). */
export const FACILITY_KEYWORD_REASONS = Object.freeze([
  'search', 'answered', 'no_message', 'blocked_risk', 'no_pharmacy', 'blocked_dict', 'blocked_symptom', 'blocked_medication', 'blocked_place',
]);

const re = (list, at) => {
  if (!Array.isArray(list) || list.length === 0 || list.some((p) => typeof p !== 'string' || !p)) throw new Error(`facility keywords: ${at} 형식`);
  return list.map((p) => new RegExp(p, 'u'));
};

/** 규칙 객체를 검사하고 정규식을 만든다. riskCues가 없으면 거부(위험 단서 없이 지름길이 열리지 않게). */
export function compileFacilityKeywords(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('facility keywords: 객체 아님');
  if (typeof raw.version !== 'string' || !raw.version) throw new Error('facility keywords: version 없음');
  if (!raw.placeNames || typeof raw.placeNames !== 'object') throw new Error('facility keywords: placeNames 없음');
  if (!Number.isInteger(raw.requestWithin) || raw.requestWithin < 1) throw new Error('facility keywords: requestWithin');
  if (!Array.isArray(raw.requestWords) || raw.requestWords.length === 0) throw new Error('facility keywords: requestWords');
  return {
    version: raw.version,
    pharmacy: re(raw.pharmacyPatterns, 'pharmacyPatterns'),
    open: re(raw.openPatterns, 'openPatterns'),
    symptomCues: re(raw.symptomCues, 'symptomCues'),
    medicationCues: re(raw.medicationCues, 'medicationCues'),
    riskCues: re(raw.riskCues, 'riskCues'),
    request: new RegExp(raw.requestWords.map((w) => `(?:${w})`).join('|'), 'u'),
    requestWithin: raw.requestWithin,
    placeNames: Object.entries(raw.placeNames).map(([name, searchKey]) => ({name: normalizeTerm(name), searchKey: searchKey || null, blocked: false})),
  };
}

const cache = new Map();
export function loadFacilityKeywords(file = DEFAULT_FACILITY_KEYWORDS_PATH) {
  const key = path.resolve(file);
  if (!cache.has(key)) cache.set(key, compileFacilityKeywords(JSON.parse(readFileSync(key, 'utf8'))));
  return cache.get(key);
}

/** 규칙 파일의 이름 + department.csv name_ko. never_recommend 과(응급의학과)는 blocked. */
function placeList(rules, data) {
  const never = new Set(Array.isArray(data.appConfig?.never_recommend) ? data.appConfig.never_recommend : []);
  const list = [...rules.placeNames];
  for (const d of data.departments.values()) {
    const name = normalizeTerm(d.nameKo);
    if (!name || list.some((p) => p.name === name)) continue;
    list.push({name, searchKey: d.searchKey, blocked: never.has(d.deptId)});
  }
  return list;
}

/** 한 텍스트에서 기관·진료과 이름이 나온 자리(더 긴 이름 안에 든 짧은 이름은 뺀다, 예: '정형외과' 안의 '외과'). */
function placeHits(text, places) {
  const hits = [];
  for (const p of places) {
    let i = text.indexOf(p.name);
    while (i >= 0) {
      hits.push({start: i, end: i + p.name.length, place: p});
      i = text.indexOf(p.name, i + 1);
    }
  }
  return hits
    .filter((h) => !hits.some((o) => o !== h && o.start <= h.start && o.end >= h.end && o.end - o.start > h.end - h.start))
    .sort((a, b) => a.start - b.start);
}

function stripPlaces(text, hits) {
  let out = '';
  let at = 0;
  for (const h of hits) {
    if (h.start < at) continue;
    out += `${text.slice(at, h.start)}□`;
    at = h.end;
  }
  return out + text.slice(at);
}

function analyze(messages, data, rules) {
  const places = placeList(rules, data);
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => typeof m === 'string')
    .map((m) => normalizeTerm(m))
    .filter(Boolean)
    .map((text) => {
      const hits = placeHits(text, places);
      const rest = stripPlaces(text, hits); // 이름 속 글자(예: 마취통증의학과의 '통증')가 증상 단서로 걸리지 않게
      return {
        hits,
        pharmacy: rules.pharmacy.some((r) => r.test(text)),
        open: rules.open.some((r) => r.test(text)),
        symptomCue: rules.symptomCues.some((r) => r.test(rest)),
        medicationCue: rules.medicationCues.some((r) => r.test(rest)),
        riskCue: rules.riskCues.some((r) => r.test(text)), // 위험 단서는 이름을 지우지 않은 텍스트로 본다(보수적)
      };
    });
}

function searchFrom(rows) {
  const pharmacy = rows.some((r) => r.pharmacy);
  const search = pharmacy ? {type: 'pharmacy', department: 'pharmacy'} : {type: 'hospital'};
  if (!pharmacy) {
    const specific = rows.flatMap((r) => r.hits).find((h) => h.place.searchKey && !h.place.blocked);
    if (specific) search.department = specific.place.searchKey;
  }
  if (rows.some((r) => r.open)) search.openOnly = true;
  return search;
}

/**
 * LLM 의도 facility_search일 때 쓰는 search(조건 검사 없이 만드는 법만). 약국 표현이 있으면 약국,
 * 아니면 병원 + (진료과 이름이 있으면) 그 과의 search_key.
 * @returns {{type:string, department?:string, openOnly?:boolean}}
 */
export function buildFacilitySearch(messages, data, rules = loadFacilityKeywords()) {
  return searchFrom(analyze(messages, data, rules));
}

/**
 * 메시지의 단서(시작 선택 고정 해제 G3에 씀). 원문은 돌려주지 않는다.
 * @returns {{symptomCue:boolean, medicationCue:boolean, riskCue:boolean}}
 */
export function messageCues(messages, data, rules = loadFacilityKeywords()) {
  const rows = analyze(messages, data, rules);
  return {
    symptomCue: rows.some((r) => r.symptomCue),
    medicationCue: rows.some((r) => r.medicationCue),
    riskCue: rows.some((r) => r.riskCue),
  };
}

/**
 * 바로 search로 가는 조건(모두 만족할 때만 search):
 *  1. 아직 어떤 문진 답도 없음  2. 약국 표현  3. 사전 증상 매칭 0개  4. 증상 단서 없음  5. 약 질문 단서 없음
 *  6. 위험 단서 없음  (+ 병원·의원·진료과 이름이 함께 있으면 보내지 않음: 병원 찾기가 섞인 문장, EF 판단)
 * @param {{messages:string[], hasAnyAnswer:boolean, dictMatches:string[], data:object, rules?:object}} input
 * @returns {{search:object|null, reason:string}} reason은 FACILITY_KEYWORD_REASONS 중 하나(trace용)
 */
export function evaluateFacilityKeywords({messages, hasAnyAnswer, dictMatches, data, rules = loadFacilityKeywords()}) {
  const no = (reason) => ({search: null, reason});
  if (hasAnyAnswer) return no('answered');
  const rows = analyze(messages, data, rules);
  if (rows.length === 0) return no('no_message');
  if (rows.some((r) => r.riskCue)) return no('blocked_risk');
  if (!rows.some((r) => r.pharmacy)) return no('no_pharmacy');
  if (Array.isArray(dictMatches) && dictMatches.length > 0) return no('blocked_dict');
  if (rows.some((r) => r.symptomCue)) return no('blocked_symptom');
  if (rows.some((r) => r.medicationCue)) return no('blocked_medication');
  if (rows.some((r) => r.hits.length > 0)) return no('blocked_place');
  return {search: searchFrom(rows), reason: 'search'};
}

/** evaluateFacilityKeywords의 짧은 형태: 조건을 모두 만족하면 {search}, 아니면 null. */
export function checkFacilityKeywords(input) {
  const r = evaluateFacilityKeywords(input);
  return r.search ? {search: r.search} : null;
}
