// 증상·동의어 참조 데이터 읽기.
// 지금은 data_pipeline 시드 CSV만 읽는다. 나중에 source:'supabase' 로더를 같은 반환 형식으로 추가한다.
//
// fallback 판정은 DB 함수 ref.recommend_departments(001b_ref_functions.sql)와 같은 기준이다.
//   is_fallback=true 행을 돌려주는 조건:
//     (1) ref.symptom_department.fallback = true, 또는
//     (2) 요청한 (sex, age_band) 조합의 ref.symptom_department_variant 행이 없음
//   후보 생성은 성별·나이와 무관하게 한 번 판정해야 하므로, (2)는 "9개 조합 중 하나라도 없으면"으로
//   보수적으로 적용한다(후보에서 빼는 쪽). 시드 v2.1-20261113에서는 (2)가 D20(모든 조합 없음)뿐이다.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CSV_DIR = path.resolve(HERE, '../../data_pipeline/db/seed/v2.1-20261113');

const SEXES = ['female', 'male', 'unknown'];
const AGE_BANDS = ['child', 'adult', 'unknown'];

/**
 * 작은 CSV 파서(RFC 4180): UTF-8 BOM 제거, 따옴표 안 쉼표·줄바꿈, "" 이스케이프, CRLF.
 * @returns {Array<Record<string,string>>}
 */
export function parseCsv(text) {
  let s = String(text);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === ',') { row.push(field); field = ''; i += 1; continue; }
    if (ch === '\r' || ch === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      i += 1; continue;
    }
    field += ch; i += 1;
  }
  if (inQuotes) throw new Error('csv: 닫히지 않은 따옴표');
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((r) => !(r.length === 1 && r[0] === ''));
  if (nonEmpty.length === 0) return [];
  const header = nonEmpty[0];
  return nonEmpty.slice(1).map((r, idx) => {
    if (r.length !== header.length) {
      throw new Error(`csv: ${idx + 2}행 열 수 ${r.length} ≠ 머리글 ${header.length}`);
    }
    const o = {};
    header.forEach((h, j) => { o[h] = r[j]; });
    return o;
  });
}

function readCsv(dir, name) {
  return parseCsv(readFileSync(path.join(dir, name), 'utf8'));
}

const bool = (v) => v === 'true';

function loadFromCsv(dir) {
  const versions = readCsv(dir, 'data_version.csv');
  if (versions.length !== 1) {
    throw new Error(`data_version.csv 행이 ${versions.length}개다(1개여야 함)`);
  }
  const dataVersion = versions[0].version;
  const warnings = [];
  const sameVersion = (rows, name) => {
    const kept = rows.filter((r) => r.data_version === dataVersion);
    if (kept.length !== rows.length) warnings.push(`${name}: data_version 불일치 ${rows.length - kept.length}행 제외`);
    return kept;
  };

  const symRows = sameVersion(readCsv(dir, 'symptom.csv'), 'symptom');
  const sdRows = sameVersion(readCsv(dir, 'symptom_department.csv'), 'symptom_department');
  const varRows = sameVersion(readCsv(dir, 'symptom_department_variant.csv'), 'symptom_department_variant');
  const synRows = sameVersion(readCsv(dir, 'symptom_synonym.csv'), 'symptom_synonym');

  const sdFallback = new Map(sdRows.map((r) => [r.symptom_id, bool(r.fallback)]));
  const combos = new Map();
  for (const v of varRows) {
    if (!combos.has(v.symptom_id)) combos.set(v.symptom_id, new Set());
    combos.get(v.symptom_id).add(`${v.sex}|${v.age_band}`);
  }

  const symptoms = new Map();
  for (const r of symRows) {
    const have = combos.get(r.symptom_id) ?? new Set();
    const missingCombos = [];
    for (const sx of SEXES) for (const ab of AGE_BANDS) if (!have.has(`${sx}|${ab}`)) missingCombos.push(`${sx}|${ab}`);
    // symptom_department 행이 없는 증상은 DB 함수가 아무 행도 돌려주지 않는다 → 후보에서 빼는 쪽(보수적)
    const noDeptRow = !sdFallback.has(r.symptom_id);
    let fallbackReason = null;
    if (sdFallback.get(r.symptom_id) === true) fallbackReason = 'department_fallback';
    else if (noDeptRow) fallbackReason = 'no_department_row';
    else if (missingCombos.length > 0) fallbackReason = 'no_variant';
    const isParent = bool(r.is_parent);
    const isFallback = fallbackReason !== null;
    symptoms.set(r.symptom_id, {
      id: r.symptom_id,
      parentId: r.parent_id || null,
      isParent,
      nameKo: r.name_ko,
      chapterKo: r.chapter_ko,
      bodyPartUi: r.body_part_ui,
      sexRestriction: r.sex_restriction || null, // null | 'female' | 'male'
      isInjury: bool(r.is_injury),
      fallbackGroup: r.fallback_group || null,
      isFallback,
      fallbackReason,
      // 후보로 쓸 수 있는가: fallback도 아니고 상위(부모) 증상도 아님
      isCandidate: !isFallback && !isParent,
    });
  }

  const synonyms = synRows
    .filter((r) => symptoms.has(r.symptom_id))
    .map((r) => ({
      id: Number(r.id),
      symptomId: r.symptom_id,
      term: r.term,
      termNorm: r.term_norm,
      termType: r.term_type,
      spanGroup: r.span_group || null,
    }))
    .sort((a, b) => a.id - b.id);
  const orphan = synRows.length - synonyms.length;
  if (orphan > 0) warnings.push(`symptom_synonym: 없는 symptom_id ${orphan}행 제외`);

  return {source: 'csv', dataVersion, symptoms, synonyms, warnings};
}

const cache = new Map();

/**
 * @param {{source?:'csv', dir?:string}} [opts]
 * @returns {{dataVersion:string, symptoms:Map<string,object>, synonyms:Array<object>, warnings:string[], source:string}}
 */
export function loadRefData({source = 'csv', dir = DEFAULT_CSV_DIR} = {}) {
  if (source !== 'csv') throw new Error(`loadRefData: source '${source}'는 아직 구현하지 않았다`);
  const key = `${source}:${dir}`;
  if (!cache.has(key)) cache.set(key, loadFromCsv(dir));
  return cache.get(key);
}

/** fallback 증상 ID 목록(오름차순). */
export function fallbackSymptomIds(refData) {
  return [...refData.symptoms.values()].filter((s) => s.isFallback).map((s) => s.id).sort();
}
