// 위험 표현 사전 평가(11/17 R4). 네트워크·LLM 없음. 엔진과 같은 경로(evaluateSafety, priority hit policy)로 규칙만 돌린다.
// 실행: npm run eval:risk  → group별 일치 표, 오탐·누락 목록(사례 id와 rule_id만, 문장은 출력하지 않음) + eval/out/risk_eval_<시각>.json
// 통과 기준(지시서 R4): positive 누락 0, metaphor·nonemergency·facility 오탐 0. 못 맞추면 종료 코드 1.
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';
import {loadFreeTextRules} from '../engine/free-text.mjs';
import {evaluateSafety} from '../engine/rules.mjs';
import {loadIntakeData} from '../engine/intake-data.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_RISK_CASES = path.join(HERE, 'cases', 'risk_v1.jsonl');
// 11/17 R6: 독립 검토자가 지은 문장(검토 뒤 규칙 보완에 썼으므로 hold-out이 아니라 회귀셋). 기대값은 설계 판단으로 일부 조정(note).
export const REVIEW_RISK_CASES = path.join(HERE, 'cases', 'risk_review_v1.jsonl');
export const GROUPS = Object.freeze(['positive', 'nonemergency', 'metaphor', 'negation', 'other_person', 'past', 'facility', 'mixed_context', 'review_emergency', 'review_collision', 'review_neutral']);
const NONE_GROUPS = new Set(['nonemergency', 'metaphor', 'facility', 'review_collision', 'review_neutral']);
const MUST_MATCH_GROUPS = new Set(['positive', 'mixed_context', 'review_emergency', 'review_collision', 'review_neutral']);

export function loadRiskCases(file = DEFAULT_RISK_CASES) {
  return readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/**
 * @returns {{rulesVersion:string, total:number, groups:object, falsePositives:Array, misses:Array, keyMismatches:Array, criteriaMismatches:Array, pass:boolean, results:Array}}
 *   results: [{id, group, expect, got, gotKey, ruleIds, topRule, ok}] — 문장 없음
 */
/** 기본 평가셋 + 검토 회귀셋 */
export function loadAllRiskCases() {
  return [...loadRiskCases(DEFAULT_RISK_CASES), ...loadRiskCases(REVIEW_RISK_CASES)];
}

export function runRiskEval({cases = loadAllRiskCases(), freeTextRules = loadFreeTextRules(), data = loadIntakeData()} = {}) {
  const criteriaOf = new Map(freeTextRules.rules.map((r) => [r.ruleId, null]));
  try {
    const raw = JSON.parse(readFileSync(path.join(HERE, '../engine/rules/free_text_v1.json'), 'utf8'));
    for (const r of raw.rules) criteriaOf.set(r.rule_id, r.evidence?.criteria_id ?? null);
  } catch { /* 다른 규칙 객체를 넘긴 경우 criteria 비교는 건너뛴다 */ }
  const results = cases.map((c) => {
    const s = evaluateSafety({codes: new Map(), messages: [c.text], data, freeTextRules});
    const top = s.top;
    const got = top ? top.result : 'none';
    const gotKey = top ? top.messageKey : null;
    const ok = got === c.expect && (c.expect === 'none' || gotKey === c.expect_key);
    return {id: c.id, group: c.group, expect: c.expect, expectKey: c.expect_key ?? null, criteriaId: c.criteria_id ?? null,
      got, gotKey, ruleIds: s.hits.map((h) => h.ruleId), topRule: top?.ruleId ?? null, topCriteria: top ? (criteriaOf.get(top.ruleId) ?? null) : null, ok};
  });
  const groups = {};
  for (const g of GROUPS) {
    const rs = results.filter((r) => r.group === g);
    groups[g] = {n: rs.length, match: rs.filter((r) => r.ok).length, rate: rs.length ? Number((rs.filter((r) => r.ok).length / rs.length).toFixed(3)) : null};
  }
  const falsePositives = results.filter((r) => r.expect === 'none' && r.got !== 'none').map((r) => ({id: r.id, group: r.group, ruleIds: r.ruleIds}));
  const misses = results.filter((r) => r.expect !== 'none' && r.got === 'none').map((r) => ({id: r.id, group: r.group}));
  const keyMismatches = results.filter((r) => r.expect !== 'none' && r.got !== 'none' && !r.ok).map((r) => ({id: r.id, expect: r.expect, got: r.got, gotKey: r.gotKey, topRule: r.topRule}));
  const criteriaMismatches = results.filter((r) => r.criteriaId && r.topCriteria && r.criteriaId !== r.topCriteria).map((r) => ({id: r.id, expected: r.criteriaId, top: r.topCriteria, topRule: r.topRule}));
  // 통과 기준: positive·검토 회귀셋은 결과·문구까지 모두 일치, none 그룹은 오탐 0
  const positiveMisses = results.filter((r) => MUST_MATCH_GROUPS.has(r.group) && !r.ok);
  const noneFp = falsePositives.filter((f) => NONE_GROUPS.has(f.group));
  return {
    rulesVersion: freeTextRules.version,
    total: results.length,
    groups, falsePositives, misses, keyMismatches, criteriaMismatches,
    pass: positiveMisses.length === 0 && noneFp.length === 0,
    results,
  };
}

function main() {
  const r = runRiskEval();
  const pad = (v, n) => String(v ?? '-').padEnd(n);
  console.log(`위험 표현 사전 평가 (${r.rulesVersion}, 사례 ${r.total})`);
  console.log(`${pad('group', 14)}${pad('n', 5)}${pad('일치', 6)}일치율`);
  for (const g of GROUPS) console.log(`${pad(g, 14)}${pad(r.groups[g].n, 5)}${pad(r.groups[g].match, 6)}${r.groups[g].rate}`);
  console.log(`오탐(none인데 걸림) ${r.falsePositives.length}: ${r.falsePositives.map((f) => `${f.id}[${f.ruleIds.join(',')}]`).join(' ') || '-'}`);
  console.log(`누락(걸려야 하는데 안 걸림) ${r.misses.length}: ${r.misses.map((m) => m.id).join(' ') || '-'}`);
  console.log(`결과·문구 불일치 ${r.keyMismatches.length}: ${r.keyMismatches.map((m) => `${m.id}(${m.got}/${m.topRule})`).join(' ') || '-'}`);
  console.log(`기준ID 불일치(참고, 실패 아님) ${r.criteriaMismatches.length}: ${r.criteriaMismatches.map((m) => `${m.id}(${m.expected}→${m.top})`).join(' ') || '-'}`);
  console.log(`통과 기준(positive·검토 회귀셋 전부 일치, none 그룹 오탐 0): ${r.pass ? '통과' : '실패'}`);
  const outDir = path.join(HERE, 'out');
  mkdirSync(outDir, {recursive: true});
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const file = path.join(outDir, `risk_eval_${stamp}.json`);
  writeFileSync(file, `${JSON.stringify(r, null, 2)}\n`, 'utf8');
  console.log(`저장: ${path.relative(process.cwd(), file)}`);
  if (!r.pass) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch { console.error('risk_eval: 실행 실패'); process.exitCode = 1; }
}
