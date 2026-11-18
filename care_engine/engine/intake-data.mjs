// 문진 데이터 로더(설계 §3). 시드 CSV를 읽기만 한다(LLM 모듈 ref-data.mjs와 같은 방식).
// 로드 때 검사에 실패하면 IntakeDataError를 던진다. runCare는 이것을 잡아 error:'data'로 돌려준다.
// 11/17 연결: Supabase ref 표에서도 같은 형식으로 만든다(loadIntakeDataFromRows, source = 'supabase'). 검사는 CSV와 같다.
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {parseCsv, DEFAULT_CSV_DIR, loadRefData, buildRefData, toCsvRow, JSONB_COLUMNS} from '../llm/ref-data.mjs';
import {buildI18nIndex} from './i18n.mjs';

export {DEFAULT_CSV_DIR};

export class IntakeDataError extends Error {
  /** @param {string[]} problems */
  constructor(problems) {
    super(`intake data: ${problems.length}개 문제 — ${problems.slice(0, 5).join(' / ')}`);
    this.name = 'IntakeDataError';
    this.problems = problems;
  }
}

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const SLOT_RE = /^(card|filter|detail|report|flow)\.[a-z][a-z0-9_]*$/;
const ITEM_TYPES = new Set(['choice', 'string', 'display']);
const ENABLE_OPERATORS = new Set(['=', '!=', 'exists']);
const RULE_OPERATORS = new Set(['=', 'in']);
const RULE_RESULTS = new Set(['EMERGENCY_STOP', 'URGENT_NOTICE']);
const BEHAVIORS = new Set(['all', 'any']);
const ENGINE_CONDITIONS = new Set(['', 'symptom_is_fallback']);
const UI_VALUES = new Set(['', 'frontend']);
const MAX_OPTIONS = 12;

const bool = (v) => v === 'true';

/** Postgres 배열 문자열 `{no,unknown}` → ['no','unknown']. 형식이 다르면 null. */
export function parsePgArray(s) {
  const t = String(s ?? '').trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return null;
  const body = t.slice(1, -1).trim();
  if (body === '') return [];
  return body.split(',').map((x) => x.trim().replace(/^"(.*)"$/, '$1'));
}

function parseConfigValue(v) {
  const s = String(v ?? '');
  try { return JSON.parse(s); } catch { return s; }
}

function readCsv(dir, name) {
  return parseCsv(readFileSync(path.join(dir, name), 'utf8'));
}

function loadFromCsv(dir) {
  return buildIntakeData((name) => readCsv(dir, name), 'csv', loadRefData({dir}));
}

/**
 * 11/17 연결: Supabase ref 스키마에서 읽은 표({표 이름: 행 배열}, REST JSON 그대로)로 같은 데이터를 만든다.
 * 값은 toCsvRow로 CSV 형식에 맞춘 뒤 CSV와 똑같은 검사를 거친다. 표가 없으면 IntakeDataError.
 */
export function loadIntakeDataFromRows(tables, {source = 'supabase'} = {}) {
  const readRows = (name) => {
    const table = name.replace(/\.csv$/, '');
    const rows = tables?.[table];
    if (!Array.isArray(rows)) throw new IntakeDataError([`${name}: 표를 읽지 못함`]);
    return rows.map((r) => toCsvRow(r, JSONB_COLUMNS[table] ?? []));
  };
  return buildIntakeData(readRows, source, buildRefData(readRows, source));
}

function buildIntakeData(readRows, source, refDataIn) {
  let refData = refDataIn;
  const problems = [];
  const warnings = [];

  const versions = readRows('data_version.csv');
  if (versions.length !== 1) throw new IntakeDataError([`data_version.csv 행이 ${versions.length}개(1개여야 함)`]);
  const dataVersion = versions[0].version;
  const read = (name) => {
    const rows = readRows(name);
    const kept = rows.filter((r) => r.data_version === dataVersion);
    if (kept.length !== rows.length) warnings.push(`${name}: data_version 불일치 ${rows.length - kept.length}행 제외`);
    return kept;
  };

  // ---- 문진 ----
  const qRows = read('questionnaire.csv');
  if (qRows.length !== 1) problems.push(`questionnaire: 행 ${qRows.length}개(1개여야 함)`);
  const q = qRows[0] ?? {};
  const questionnaire = {id: q.id ?? null, version: q.version ?? null, title: q.title ?? null};

  const items = read('questionnaire_item.csv').map((r) => ({
    linkId: r.link_id,
    questionnaireId: r.questionnaire_id,
    order: Number(r.order_no),
    textKo: r.text_ko,
    textEn: r.text_en || null,
    type: r.item_type,
    required: bool(r.required),
    enableBehavior: r.enable_behavior || 'all',
    flow: r.flow,
    ui: r.ui || '',
    source: r.source,
    todo: bool(r.todo),
    engineCondition: r.engine_condition || '',
  })).sort((a, b) => a.order - b.order);

  const itemById = new Map();
  const orders = new Set();
  for (const it of items) {
    if (!ID_RE.test(it.linkId ?? '')) problems.push(`item: link_id 형식 '${it.linkId}'`);
    if (itemById.has(it.linkId)) problems.push(`item ${it.linkId}: link_id 중복`);
    itemById.set(it.linkId, it);
    if (!Number.isInteger(it.order)) problems.push(`item ${it.linkId}: order 정수 아님`);
    else if (orders.has(it.order)) problems.push(`item ${it.linkId}: order ${it.order} 중복`);
    orders.add(it.order);
    if (questionnaire.id && it.questionnaireId !== questionnaire.id) problems.push(`item ${it.linkId}: questionnaire_id 불일치`);
    if (!ITEM_TYPES.has(it.type)) problems.push(`item ${it.linkId}: 지원하지 않는 item_type '${it.type}'`);
    if (!BEHAVIORS.has(it.enableBehavior)) problems.push(`item ${it.linkId}: enable_behavior '${it.enableBehavior}'`);
    if (!ENGINE_CONDITIONS.has(it.engineCondition)) problems.push(`item ${it.linkId}: engine_condition '${it.engineCondition}'`);
    if (!UI_VALUES.has(it.ui)) problems.push(`item ${it.linkId}: ui '${it.ui}'`);
    if (!String(it.textKo ?? '').trim() || it.textKo.length > 300) problems.push(`item ${it.linkId}: text_ko 비었거나 300자 초과`);
  }

  // 선택지
  const optionsById = new Map(items.map((it) => [it.linkId, []]));
  const optRows = read('questionnaire_answer_option.csv')
    .map((r) => ({linkId: r.link_id, code: r.code, orderNo: Number(r.order_no), displayKo: r.display_ko, displayEn: r.display_en || null}));
  for (const o of optRows) {
    if (!optionsById.has(o.linkId)) { problems.push(`option: 없는 문항 '${o.linkId}'`); continue; }
    if (!ID_RE.test(o.code ?? '')) problems.push(`option ${o.linkId}: code 형식 '${o.code}'`);
    if (!String(o.displayKo ?? '').trim() || o.displayKo.length > 300) problems.push(`option ${o.linkId}.${o.code}: display_ko 비었거나 300자 초과`);
    const list = optionsById.get(o.linkId);
    if (list.some((x) => x.code === o.code)) problems.push(`option ${o.linkId}: code '${o.code}' 중복`);
    list.push({code: o.code, displayKo: o.displayKo, displayEn: o.displayEn, orderNo: o.orderNo});
  }
  for (const [id, list] of optionsById) {
    list.sort((a, b) => a.orderNo - b.orderNo);
    const it = itemById.get(id);
    if (list.length > MAX_OPTIONS) problems.push(`item ${id}: 선택지 ${list.length}개(최대 ${MAX_OPTIONS})`);
    // 선택지 0개는 todo 문항, 그리고 선택지가 없는 형식(string·display)만 허용
    if (list.length === 0 && it.type === 'choice' && !it.todo) problems.push(`item ${id}: choice 문항인데 선택지 0개(todo 아님)`);
    if (list.length > 0 && it.type !== 'choice') problems.push(`item ${id}: ${it.type} 문항에 선택지가 있음`);
  }

  // enableWhen
  const enableWhenById = new Map();
  for (const r of read('questionnaire_enable_when.csv')) {
    const it = itemById.get(r.link_id);
    const target = itemById.get(r.question);
    if (!it) { problems.push(`enableWhen: 없는 문항 '${r.link_id}'`); continue; }
    if (!target) { problems.push(`enableWhen ${r.link_id}: 가리킨 문항 '${r.question}' 없음`); continue; }
    if (!ENABLE_OPERATORS.has(r.operator)) { problems.push(`enableWhen ${r.link_id}: 지원하지 않는 operator '${r.operator}'`); continue; }
    if (!(target.order < it.order)) problems.push(`enableWhen ${r.link_id}: 뒤 문항 '${r.question}'을 가리킴`);
    let answer = r.answer;
    if (r.operator === 'exists') {
      if (answer !== 'true' && answer !== 'false') problems.push(`enableWhen ${r.link_id}: exists 값 '${answer}'`);
      answer = answer === 'true';
    } else if (!(optionsById.get(target.linkId) ?? []).some((o) => o.code === answer)) {
      problems.push(`enableWhen ${r.link_id}: '${r.question}'에 없는 code '${answer}'`);
    }
    if (!enableWhenById.has(it.linkId)) enableWhenById.set(it.linkId, []);
    enableWhenById.get(it.linkId).push({question: target.linkId, operator: r.operator, answer});
  }

  // ---- 안전 규칙 ----
  const condByRule = new Map();
  for (const r of read('safety_rule_condition.csv')) {
    const answers = parsePgArray(r.answers);
    const target = itemById.get(r.question);
    if (!target) problems.push(`rule condition ${r.rule_id}: 없는 문항 '${r.question}'`);
    if (!RULE_OPERATORS.has(r.operator)) problems.push(`rule condition ${r.rule_id}: 지원하지 않는 operator '${r.operator}'`);
    if (!answers || answers.length === 0) problems.push(`rule condition ${r.rule_id}: answers 비었거나 형식 오류`);
    else {
      if (r.operator === '=' && answers.length !== 1) problems.push(`rule condition ${r.rule_id}: '=' 인데 answers ${answers.length}개`);
      if (target) {
        const codes = new Set((optionsById.get(target.linkId) ?? []).map((o) => o.code));
        for (const a of answers) if (!codes.has(a)) problems.push(`rule condition ${r.rule_id}: '${r.question}'에 없는 code '${a}'`);
      }
    }
    if (!condByRule.has(r.rule_id)) condByRule.set(r.rule_id, []);
    condByRule.get(r.rule_id).push({question: r.question, operator: r.operator, answers: answers ?? []});
  }
  const rules = read('safety_rule.csv').map((r) => ({
    ruleId: r.rule_id,
    priority: Number(r.priority),
    combine: r.combine || 'all',
    result: r.result,
    terminal: bool(r.terminal),
    triageCategoryId: r.triage_category_id === '' ? null : Number(r.triage_category_id),
    messageKey: r.message_key,
    evidence: {source: r.evidence_source, page: r.evidence_page === '' ? null : Number(r.evidence_page), note: r.evidence_note},
    reviewStatus: r.review_status,
    conditions: condByRule.get(r.rule_id) ?? [],
  })).sort((a, b) => a.priority - b.priority);
  const ruleIds = new Set();
  const priorities = new Set();
  for (const rule of rules) {
    if (!ID_RE.test(rule.ruleId ?? '')) problems.push(`rule: rule_id 형식 '${rule.ruleId}'`);
    if (ruleIds.has(rule.ruleId)) problems.push(`rule ${rule.ruleId}: 중복`);
    ruleIds.add(rule.ruleId);
    if (!Number.isInteger(rule.priority) || rule.priority < 10) problems.push(`rule ${rule.ruleId}: priority는 10 이상 정수(1~9는 자유 입력 규칙 예약)`);
    else if (priorities.has(rule.priority)) problems.push(`rule ${rule.ruleId}: priority ${rule.priority} 중복`);
    priorities.add(rule.priority);
    if (!BEHAVIORS.has(rule.combine)) problems.push(`rule ${rule.ruleId}: combine '${rule.combine}'`);
    if (!RULE_RESULTS.has(rule.result)) problems.push(`rule ${rule.ruleId}: result '${rule.result}'`);
    if (!String(rule.messageKey ?? '').trim()) problems.push(`rule ${rule.ruleId}: message_key 없음`);
    if (rule.conditions.length === 0) problems.push(`rule ${rule.ruleId}: 조건 없음`);
  }
  for (const id of condByRule.keys()) if (!ruleIds.has(id)) problems.push(`rule condition: 없는 규칙 '${id}'`);

  // ---- 결과 매핑 ----
  const mappings = read('output_mapping.csv').map((r) => ({
    id: Number(r.id),
    from: r.from_type,
    question: r.question || null,
    ruleId: r.rule_id || null,
    when: r.when_code || null,
    slot: r.slot,
    value: r.value === '' ? null : r.value,
  })).sort((a, b) => a.id - b.id);
  for (const m of mappings) {
    if (!SLOT_RE.test(m.slot ?? '')) problems.push(`mapping ${m.id}: slot 형식 '${m.slot}'`);
    if (m.from === 'answer') {
      const it = itemById.get(m.question);
      if (!it) { problems.push(`mapping ${m.id}: 없는 문항 '${m.question}'`); continue; }
      if (m.when !== 'any' && !(optionsById.get(it.linkId) ?? []).some((o) => o.code === m.when)) {
        problems.push(`mapping ${m.id}: '${m.question}'에 없는 when '${m.when}'`);
      }
    } else if (m.from === 'rule') {
      if (!ruleIds.has(m.ruleId)) problems.push(`mapping ${m.id}: 없는 규칙 '${m.ruleId}'`);
      if (m.value === null) problems.push(`mapping ${m.id}: 규칙 매핑에 value 없음`);
    } else {
      problems.push(`mapping ${m.id}: from_type '${m.from}'`);
    }
  }
  // 증상 확인이 들어갈 자리(N4): report.symptom 매핑이 가리키는 문항. 코드에 ID를 박지 않으려고 데이터에서 찾는다.
  const symptomMappings = mappings.filter((m) => m.from === 'answer' && m.slot === 'report.symptom');
  if (symptomMappings.length !== 1) problems.push(`mapping: report.symptom 매핑이 ${symptomMappings.length}개(1개여야 함)`);
  const symptomItemId = symptomMappings[0]?.question ?? null;

  // ---- 진료과·추천 ----
  const departments = new Map(read('department.csv').map((r) => [r.dept_id, {
    deptId: r.dept_id,
    nameKo: r.name_ko,
    searchKey: r.search_key || null,
    isGuidable: bool(r.is_guidable),
    sexOnly: r.sex_only || null,
    maxAge: r.max_age === '' ? null : Number(r.max_age),
  }]));

  const variants = new Map();
  for (const r of read('symptom_department_variant.csv')) {
    const key = `${r.symptom_id}|${r.sex}|${r.age_band}`;
    if (!variants.has(key)) variants.set(key, []);
    variants.get(key).push({rank: Number(r.rank), deptId: r.dept_id, level: r.level, share: r.share === '' ? null : Number(r.share)});
  }
  for (const list of variants.values()) list.sort((a, b) => a.rank - b.rank);

  const symptomDept = new Map(read('symptom_department.csv').map((r) => [r.symptom_id, {
    fallback: bool(r.fallback),
    deptRule: r.dept_rule || null,
    pediatricTop: bool(r.pediatric_top),
    pathUsed: r.path_used || null,
  }]));

  const fallbackDepartments = new Map();
  for (const r of read('fallback_department.csv').sort((a, b) => Number(a.rank) - Number(b.rank))) {
    if (!fallbackDepartments.has(r.grp)) fallbackDepartments.set(r.grp, []);
    fallbackDepartments.get(r.grp).push(r.dept_id);
  }

  const appConfig = {};
  for (const r of read('app_config.csv')) appConfig[r.key] = parseConfigValue(r.value);
  const never = new Set(Array.isArray(appConfig.never_recommend) ? appConfig.never_recommend : []);

  // 추천에 쓰이는 진료과(variant·fallback, never_recommend 제외)는 search_key가 있어야 한다
  const usedDepts = new Set();
  for (const list of variants.values()) for (const v of list) usedDepts.add(v.deptId);
  for (const list of fallbackDepartments.values()) for (const d of list) usedDepts.add(d);
  for (const d of usedDepts) {
    if (never.has(d)) continue;
    const dept = departments.get(d);
    if (!dept) problems.push(`추천 진료과 '${d}'가 department.csv에 없음`);
    else if (!dept.searchKey) problems.push(`추천 진료과 '${d}'의 search_key 없음`);
  }
  for (const grp of ['general', 'injury']) {
    if (!fallbackDepartments.has(grp)) problems.push(`fallback_department: '${grp}' 그룹 없음`);
  }
  if (!Number.isInteger(appConfig.max_recommendations) || appConfig.max_recommendations < 1) {
    problems.push('app_config: max_recommendations 정수 아님');
  }

  // 11/17 다국어: 번역 표(care_engine/docs/다국어_설계.md). 시드 폴더에 파일이 없으면 번역 없이(한국어만) 동작한다.
  let i18nRows = [];
  try { i18nRows = read('text_i18n.csv'); } catch (e) {
    if (source === 'csv' && e?.code === 'ENOENT') warnings.push('text_i18n.csv 없음: 번역 없이 한국어만');
    else throw e;
  }
  const i18n = buildI18nIndex(i18nRows, problems);

  if (problems.length > 0) throw new IntakeDataError(problems);

  refData = {...refData, i18n};
  return {
    source,
    i18n,
    dataVersion,
    questionnaire,
    items,
    itemById,
    optionsById,
    enableWhenById,
    rules,
    mappings,
    symptomItemId,
    departments,
    variants,
    symptomDept,
    fallbackDepartments,
    appConfig,
    refData,
    warnings: [...warnings, ...refData.warnings],
  };
}

const cache = new Map();

/**
 * @param {{dir?:string}} [opts]
 * @returns {object} 설명은 지시서 E1·파일 머리말
 * @throws {IntakeDataError}
 */
export function loadIntakeData({dir = DEFAULT_CSV_DIR} = {}) {
  const key = path.resolve(dir);
  if (!cache.has(key)) cache.set(key, loadFromCsv(key));
  return cache.get(key);
}

/** 테스트용: 캐시 비우기. */
export function clearIntakeDataCache() {
  cache.clear();
}
