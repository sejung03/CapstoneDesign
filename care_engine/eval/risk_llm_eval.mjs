// 위험 규칙 + LLM 보조 평가. 사례 원문은 출력·결과 파일에 남기지 않는다.
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';
import {detectRiskSignal} from '../llm/index.mjs';
import {getConfig, MODEL_PRICES_USD_PER_1M, RISK_MAX_OUTPUT_TOKENS} from '../llm/config.mjs';
import {getProvider} from '../llm/provider.mjs';
import {estimateCostUsd} from '../llm/cost.mjs';
import {riskSignalSchema} from '../llm/schemas.mjs';
import riskPrompt from '../llm/prompts/risk_v2.mjs';
import {loadFreeTextRules} from '../engine/free-text.mjs';
import {evaluateSafety} from '../engine/rules.mjs';
import {loadIntakeData} from '../engine/intake-data.mjs';
import {collectSensitiveEvents} from '../engine/sensitive-choice.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CASES = [path.join(HERE, 'cases', 'risk_v1.jsonl'), path.join(HERE, 'cases', 'risk_review_v1.jsonl')];
// LC4/LC5 지시: 네트워크 제한이면 다른 방법으로 우회하지 않고 즉시 중단한다.
const STOP_ERRORS = new Set(['auth', 'quota', 'bad_request', 'network']);
const SENSITIVE = new Set(['self_harm', 'threat', 'violence']);

export function readRiskLlmCases(files) {
  return files.flatMap((file) => readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l, i) => {
    const c = JSON.parse(l);
    if (typeof c.id !== 'string' || typeof c.text !== 'string') throw new Error(`${path.basename(file)} ${i + 1}행: id·text 필요`);
    return c;
  }));
}

export function normalizeRiskKey(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v || ['none', '해당 없음', '해당없음'].includes(v)) return 'none';
  if (['freetext_emergency_119', 'emergency_stop', '119'].includes(v)) return 'emergency_stop';
  if (['freetext_urgent', 'emergency', '응급실', '119·응급실', '119/응급실'].includes(v)) return 'emergency';
  if (['crisis_notice_109', 'self_harm', '109'].includes(v)) return 'self_harm';
  if (['threat_notice_112', 'threat', '112'].includes(v)) return 'threat';
  if (['violence_notice_1366', 'violence', '1366'].includes(v)) return 'violence';
  return v;
}

function expectedKeys(c) {
  const primary = c.expect_key ?? c.gold_key ?? c.label ?? (c.expect === 'none' ? 'none' : c.expect);
  // 11/17 LC5: 대안 정답이 'a,b' 한 문자열로 오는 경우(holdout B-45)를 나눠 읽는다
  const split = (v) => (typeof v === 'string' ? v.split(/[,|]/).map((x) => x.trim()).filter(Boolean) : [v]);
  return new Set([primary, c.expect_key_alt, ...(Array.isArray(c.accept_keys) ? c.accept_keys : [])].filter((v) => v != null).flatMap(split).map(normalizeRiskKey));
}

const KNOWN_KEYS = new Set(['none', 'emergency_stop', 'emergency', 'self_harm', 'threat', 'violence']);

/**
 * 11/17 LC5: holdout 형식을 열어 보지 않고 돌리므로 ambiguous 표시를 여러 필드에서 찾는다.
 * ambiguous 사례는 본 표에서 빼고 따로 센다(지시서 LC5 1번).
 */
export function isAmbiguousCase(c) {
  if (c.ambiguous === true) return true;
  return [c.category, c.group, c.type, c.kind, c.tag, c.expect, c.expect_key, c.gold_key, c.label]
    .some((v) => typeof v === 'string' && ['ambiguous', '애매', '모호'].includes(v.trim().toLowerCase()));
}

function ruleOutcome(top) {
  return top ? normalizeRiskKey(top.messageKey) : 'none';
}

function signalOutcome(signal) {
  return signal === 'emergency' ? 'emergency' : SENSITIVE.has(signal) ? signal : 'none';
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p / 100) - 1))];
}

function summarize(rows, field) {
  const positive = rows.filter((r) => !r.expected.includes('none'));
  const negative = rows.filter((r) => r.expected.includes('none'));
  const misses = positive.filter((r) => r[field] === 'none');
  const wrong = positive.filter((r) => r[field] !== 'none' && !r.expected.includes(r[field]));
  const fp = negative.filter((r) => r[field] !== 'none');
  return {
    total: rows.length,
    correct: rows.filter((r) => r.expected.includes(r[field])).length,
    emergencyMisses: misses.filter((r) => r.expected.some((x) => x === 'emergency' || x === 'emergency_stop')).length,
    sensitiveMisses: misses.filter((r) => r.expected.some((x) => SENSITIVE.has(x))).length,
    wrongPositive: wrong.length,
    falsePositiveEscape: fp.filter((r) => r[`${field}Escape`] === true).length,
    falsePositiveNoEscape: fp.filter((r) => r[`${field}Escape`] === false).length,
  };
}

/** providerFactory는 네트워크 없는 테스트 주입용. noLlm(11/17 LCR1)이면 LLM을 만들지도 부르지도 않고 규칙+강한 단서까지만 낸다. */
export async function runRiskLlmEval({cases, config: inputConfig, providerFactory, budgetUsd = 1, noLlm = false} = {}) {
  const config = inputConfig ?? (noLlm ? {model: 'none'} : getConfig({...process.env, LLM_PROVIDER: 'openai', LLM_EVAL_BUDGET_USD: String(budgetUsd)}));
  const price = noLlm ? {input: 0, output: 0} : MODEL_PRICES_USD_PER_1M[config.model];
  if (!price) throw new Error('가격표에 없는 모델이라 비용 한도를 확인할 수 없음');
  const maxPerCall = 2 * ((riskPrompt.system.length + 500 + JSON.stringify(riskSignalSchema()).length) * price.input
    + RISK_MAX_OUTPUT_TOKENS * price.output) / 1e6;
  const rules = loadFreeTextRules();
  const data = loadIntakeData();
  const plannedCalls = cases.filter((c) => {
    const safety = evaluateSafety({codes: new Map(), messages: [c.text], data, freeTextRules: rules});
    return safety.hits.length === 0 && collectSensitiveEvents({hits: safety.hits, messages: [c.text]}).length === 0;
  }).length;
  if (!noLlm && plannedCalls * maxPerCall > budgetUsd) throw new Error(`예상 최대 비용 $${(plannedCalls * maxPerCall).toFixed(4)}가 한도 $${budgetUsd} 초과`);

  const rows = [];
  let totalCost = 0;
  let stoppedBy = null;
  for (const c of cases) {
    if (stoppedBy) break;
    const safety = evaluateSafety({codes: new Map(), messages: [c.text], data, freeTextRules: rules});
    const ruleOnly = ruleOutcome(safety.top);
    const cues = collectSensitiveEvents({hits: safety.hits, messages: [c.text]});
    // 규칙+단서: 규칙이 못 잡았을 때 강한 민감 단서가 안내 선택을 띄운 결과(빠져나갈 길 있음)
    const ruleCue = ruleOnly === 'none' && cues.length > 0 ? normalizeRiskKey(cues[0].messageKey) : ruleOnly;
    const ruleCueEscape = ruleCue !== 'none' && ruleCue !== 'emergency_stop';
    let combined = ruleCue;
    let combinedEscape = ruleCueEscape;
    let called = false;
    let error = null;
    let latencyMs = null;
    let cost = 0;
    if (combined === 'none' && !noLlm) {
      const provider = providerFactory ? providerFactory(c) : getProvider({config});
      const consent = config.devConsent ? undefined : {granted: true, provider: provider.name, version: 'risk-eval-only', healthInfo: true};
      const r = await detectRiskSignal({text: c.text, consent, requestId: c.id, reason: 'eval'}, {provider, config});
      called = r.meta.attempts > 0;
      error = r.meta.error;
      latencyMs = r.meta.latencyMs;
      const measured = estimateCostUsd(r.meta);
      if (measured === null) throw new Error('실측 비용을 계산할 수 없음');
      cost = measured;
      totalCost += cost;
      combined = signalOutcome(r.riskSignal);
      combinedEscape = combined !== 'none';
      if (STOP_ERRORS.has(error)) stoppedBy = error;
      if (totalCost > budgetUsd) stoppedBy = 'budget';
    }
    const expected = [...expectedKeys(c)];
    const ambiguous = isAmbiguousCase(c);
    // 정답 라벨을 읽지 못하면 맞다·틀리다로 세지 않고 따로 센다(추측하지 않음)
    const unknownLabel = !ambiguous && (expected.length === 0 || expected.some((k) => !KNOWN_KEYS.has(k)));
    rows.push({id: c.id, expected, ruleOnly, ruleCue, combined,
      ruleOnlyEscape: ruleOnly !== 'none' && ruleOnly !== 'emergency_stop', ruleCueEscape, combinedEscape,
      cueOnly: ruleOnly === 'none' && cues.length > 0,
      ambiguous, unknownLabel, called, error, latencyMs, costUsd: Number(cost.toFixed(6))});
  }
  const scored = rows.filter((r) => !r.ambiguous && !r.unknownLabel);
  const amb = rows.filter((r) => r.ambiguous);
  const latencies = rows.filter((r) => r.called && Number.isFinite(r.latencyMs)).map((r) => r.latencyMs);
  return {
    createdAt: new Date().toISOString(), noLlm, model: config.model, promptId: riskPrompt.id,
    casesPlanned: cases.length, casesCompleted: rows.length, plannedCalls, actualCalls: rows.filter((r) => r.called).length,
    budgetUsd, costUsd: Number(totalCost.toFixed(6)), stoppedBy,
    latencyMs: {p50: percentile(latencies, 50), p95: percentile(latencies, 95)},
    ambiguous: rows.filter((r) => r.ambiguous).length,
    unknownLabel: rows.filter((r) => r.unknownLabel).length,
    // 본 표: ambiguous·라벨 미상 제외
    ruleOnly: summarize(scored, 'ruleOnly'), ruleCue: summarize(scored, 'ruleCue'), combined: summarize(scored, 'combined'),
    // ambiguous 사례: 각 방식이 안내(none 아님)를 낸 수
    ambiguousFlagged: {ruleOnly: amb.filter((r) => r.ruleOnly !== 'none').length, ruleCue: amb.filter((r) => r.ruleCue !== 'none').length,
      combined: amb.filter((r) => r.combined !== 'none').length},
    // 강한 단서 경로 오탐: 정답 none인데 규칙은 못 잡고 강한 단서만으로 민감 안내가 뜬 수(LCR1 목표 10건 이하)
    cueFalsePositive: rows.filter((r) => r.cueOnly && r.expected.includes('none')).length,
    rows,
  };
}

function parseArgs(argv) {
  const files = [];
  let noText = false;
  let noLlm = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--cases' && argv[i + 1]) files.push(path.resolve(argv[++i]));
    else if (argv[i] === '--no-text') noText = true;
    else if (argv[i] === '--no-llm') noLlm = true;
  }
  return {files: files.length ? files : DEFAULT_CASES, noText, noLlm};
}

async function main() {
  // 문장(text)은 어떤 모드에서도 출력·저장하지 않는다. --no-text는 holdout 실행 명령과의 호환·명시용이다.
  const {files, noLlm} = parseArgs(process.argv.slice(2));
  const cases = readRiskLlmCases(files);
  const result = await runRiskLlmEval({cases, budgetUsd: 1, noLlm});
  console.log(`위험 LLM 평가: ${result.casesCompleted}/${result.casesPlanned}, 호출 ${result.actualCalls}, 비용 $${result.costUsd}`);
  console.log(`규칙만: ${JSON.stringify(result.ruleOnly)}`);
  console.log(`규칙+단서: ${JSON.stringify(result.ruleCue)} (강한 단서 오탐 ${result.cueFalsePositive})`);
  console.log(`규칙+단서+LLM${noLlm ? '(LLM 끔)' : ''}: ${JSON.stringify(result.combined)}`);
  console.log(`지연 p50=${result.latencyMs.p50 ?? '-'}ms p95=${result.latencyMs.p95 ?? '-'}ms, ambiguous=${result.ambiguous}(안내 규칙만 ${result.ambiguousFlagged.ruleOnly}/규칙+단서 ${result.ambiguousFlagged.ruleCue}/+LLM ${result.ambiguousFlagged.combined}), 라벨 미상=${result.unknownLabel}, 중단=${result.stoppedBy ?? '없음'}`);
  for (const r of result.rows) console.log(`${r.id}\t${r.expected.join('|')}\t${r.ruleOnly}\t${r.ruleCue}\t${r.combined}\t${r.error ?? '-'}`);
  const outDir = path.join(HERE, 'out');
  mkdirSync(outDir, {recursive: true});
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const file = path.join(outDir, `risk_llm_eval_${stamp}.json`);
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(`저장: ${path.relative(process.cwd(), file)}`);
  if (result.stoppedBy) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`risk_llm_eval: ${e.message}`); process.exitCode = 1; });
}
