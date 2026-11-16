// 키워드 기관 찾기(설계 §4-6). LLM 없이 첫 요청의 기관 찾기 문장을 search로 보낸다.
// 규칙은 데이터 파일 engine/rules/facility_keywords_v1.json에 둔다(코드에 박지 않음).
// 진료과 이름은 실행할 때 department.csv의 name_ko도 함께 쓴다. "○○과" 일반 패턴은 쓰지 않는다.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {normalizeTerm} from '../llm/normalize.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FACILITY_KEYWORDS_PATH = path.join(HERE, 'rules', 'facility_keywords_v1.json');

const re = (list, at) => {
  if (!Array.isArray(list) || list.some((p) => typeof p !== 'string' || !p)) throw new Error(`facility keywords: ${at} 형식`);
  return list.map((p) => new RegExp(p, 'u'));
};
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 규칙 객체를 검사하고 정규식을 만든다. */
export function compileFacilityKeywords(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('facility keywords: 객체 아님');
  if (typeof raw.version !== 'string' || !raw.version) throw new Error('facility keywords: version 없음');
  if (!raw.placeNames || typeof raw.placeNames !== 'object') throw new Error('facility keywords: placeNames 없음');
  if (!Number.isInteger(raw.requestWithin) || raw.requestWithin < 1) throw new Error('facility keywords: requestWithin');
  if (!Array.isArray(raw.requestWords) || raw.requestWords.length === 0) throw new Error('facility keywords: requestWords');
  return {
    version: raw.version,
    facility: re(raw.facilityPatterns, 'facilityPatterns'),
    pharmacy: re(raw.pharmacyPatterns ?? ['약국'], 'pharmacyPatterns'),
    open: re(raw.openPatterns, 'openPatterns'),
    symptomCues: re(raw.symptomCues, 'symptomCues'),
    medicationCues: re(raw.medicationCues, 'medicationCues'),
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
      const rest = stripPlaces(text, hits); // 이름 속 글자(예: 마취통증의학과의 '통증')가 단서로 걸리지 않게
      return {
        text,
        hits,
        facility: rules.facility.some((r) => r.test(text))
          || hits.some((h) => rules.request.test(text.slice(h.end, h.end + rules.requestWithin))),
        pharmacy: rules.pharmacy.some((r) => r.test(text)),
        open: rules.open.some((r) => r.test(text)),
        symptomCue: rules.symptomCues.some((r) => r.test(rest)),
        medicationCue: rules.medicationCues.some((r) => r.test(rest)),
        blocked: hits.some((h) => h.place.blocked),
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
 * LLM 의도 facility_search일 때 쓰는 search(조건 검사 없이 만드는 법만 같음).
 * @returns {{type:string, department?:string, openOnly?:boolean}}
 */
export function buildFacilitySearch(messages, data, rules = loadFacilityKeywords()) {
  return searchFrom(analyze(messages, data, rules));
}

/**
 * 조건 1~5를 모두 만족할 때만 {search}. 아니면 null.
 *  1. 아직 어떤 문진 답도 없음  2. 기관 표현  3. 사전 증상 매칭 0개  4. 증상 단서 없음  5. 약 질문 단서 없음
 * @param {{messages:string[], hasAnyAnswer:boolean, dictMatches:string[], data:object, rules?:object}} input
 */
export function checkFacilityKeywords({messages, hasAnyAnswer, dictMatches, data, rules = loadFacilityKeywords()}) {
  if (hasAnyAnswer) return null;
  if (Array.isArray(dictMatches) && dictMatches.length > 0) return null;
  const rows = analyze(messages, data, rules);
  if (rows.length === 0) return null;
  if (!rows.some((r) => r.facility)) return null;
  if (rows.some((r) => r.symptomCue || r.medicationCue || r.blocked)) return null;
  return {search: searchFrom(rows)};
}
