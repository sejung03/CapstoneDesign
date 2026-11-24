// 일상 표현 시나리오(eval/symptom_phrases_v1·v2.json)를 실제 LLM(OpenAI)으로 돌려 본다. 11/18.
// 실서비스 경로와 같게: 사전에서 못 찾으면 classifySymptomWithRisk(증상 분류 + 위험 신호, 1회 호출).
// 모든 문장을 LLM에도 보내서 세 가지를 한 번에 잰다.
//   - LLM 단독: 사전 없이 LLM만으로 맞히는가
//   - 사전(기존) → LLM: 11/18 일상 표현 보강 전 사전(id ≤ BASE_MAX_SYN_ID) + LLM. 처음 보는 표현에 가까운 조건
//   - 사전(보강) → LLM: 지금 사전 + LLM
// 통과 규칙은 symptom_phrases.mjs와 같다(기대 증상 중 하나가 후보 안 / fallback 사례는 후보 없음).
// 사전이 틀린 후보를 내면 실서비스에서는 LLM을 부르지 않는다 → 사용자가 "다른 증상"을 고르면 LLM으로 가므로 "한 번 더 묻고 회복"으로 따로 센다.
//
// 사용: node --env-file=.env eval/symptom_phrases_llm.mjs [--set v1|v2|v3] [--limit N] [--concurrency 3]
//   절충 1 측정: LLM_SYMPTOM_MODE=rewrite node --env-file=.env eval/symptom_phrases_llm.mjs (환경변수가 .env보다 먼저)
// 비용: 누적 비용이 LLM_EVAL_BUDGET_USD(기본 2)를 넘으면 남은 문장을 보내지 않는다. auth·quota·bad_request면 바로 멈춘다.
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {classifySymptomWithRisk} from '../llm/index.mjs';
import {getConfig} from '../llm/config.mjs';
import {getProvider} from '../llm/provider.mjs';
import {loadRefData} from '../llm/ref-data.mjs';
import {estimateCostUsd} from '../llm/cost.mjs';
import {STOP_ERRORS} from '../llm/errors.mjs';
import {matchSymptoms} from '../engine/dictionary-match.mjs';
import {PHRASE_SETS, loadPhrases, phraseOk} from './symptom_phrases.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 11/18 일상 표현(synonym_everyday_v1.csv)을 넣기 전 마지막 동의어 id */
export const BASE_MAX_SYN_ID = 1173;
const STOP = [...STOP_ERRORS, 'bad_request'];

const okFor = phraseOk;
/** LLM 통과: 증상이 아닌 문장은 intent까지 맞아야 한다. */
const llmOkFor = (c, got, intent) => (c.intent ? intent === c.intent : phraseOk(c, got));
const pct = (n, d) => (d ? `${(100 * n / d).toFixed(1)}%` : '-');
const percentile = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)]; };

/** 사전 → (못 찾으면) LLM. 사전이 틀리면 실서비스에서는 확인 질문에서 "다른 증상" → LLM으로 회복 가능. */
function pipeline(c, dictGot, llmOk) {
  if (dictGot.length === 0) return {ok: llmOk, by: 'llm', recovered: false};
  if (okFor(c, dictGot)) return {ok: true, by: 'dict', recovered: false};
  return {ok: false, by: 'dict_wrong', recovered: llmOk};
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const sets = arg('--set') ? [arg('--set')] : Object.keys(PHRASE_SETS);
  const limit = Number(arg('--limit', 0)) || Infinity;
  const concurrency = Math.max(1, Number(arg('--concurrency', 3)) || 3);

  const config = getConfig({...process.env, LLM_PROVIDER: 'openai'});
  if (config.provider !== 'openai') throw new Error('openai 설정을 만들지 못했다');
  const refData = loadRefData();
  const baseRef = {...refData, synonyms: refData.synonyms.filter((s) => s.id <= BASE_MAX_SYN_ID)};
  const consent = config.devConsent ? undefined : {granted: true, provider: 'openai', version: 'eval-only', healthInfo: true};
  const budget = config.evalBudgetUsd;
  console.log(`model ${config.model} · service_tier ${config.serviceTier ?? 'standard'} · rewrite 제한 ${config.rewriteTimeoutMs}ms · candidateMode ${config.candidateMode} · 예산 $${budget} · 동시 ${concurrency}`);

  let cost = 0;
  let stop = null;
  const report = {createdAt: new Date().toISOString(), model: config.model, serviceTier: config.serviceTier, rewriteTimeoutMs: config.rewriteTimeoutMs, candidateMode: config.candidateMode, sets: {}};

  for (const set of sets) {
    const cases = loadPhrases(set).slice(0, limit);
    const rows = new Array(cases.length);
    let next = 0;
    const worker = async () => {
      while (next < cases.length && !stop) {
        const i = next++;
        const c = cases[i];
        const logs = [];
        const res = await classifySymptomWithRisk({text: c.text, riskText: c.text, consent, requestId: `phr:${set}:${i}`, reason: 'eval'},
          {provider: getProvider({config}), refData, config, log: (e) => logs.push(e)});
        const ev = logs.find((e) => e.event === 'llm.classify_symptom') ?? {};
        const llmGot = res.status === 'confirm' ? (ev.picks ?? []) : [];
        const callCost = estimateCostUsd(res.meta);
        cost += callCost ?? 0;
        if (STOP.includes(res.meta.error)) stop = res.meta.error;
        if (cost > budget) stop = stop ?? 'budget';
        const llmOk = res.meta.error ? false : llmOkFor(c, llmGot, ev.intent ?? null);
        const dictBase = matchSymptoms(c.text, baseRef);
        const dictFull = matchSymptoms(c.text, refData);
        rows[i] = {
          text: c.text, expect: c.expect ?? [], fallback: c.fallback ?? null, intent: c.intent ?? null,
          llm: {status: res.status, reason: res.reason ?? null, intent: ev.intent ?? null, picks: llmGot, ok: llmOk,
            error: res.meta.error, riskSignal: res.riskSignal ?? null, latencyMs: res.meta.latencyMs, attempts: res.meta.attempts,
            symptomPath: res.meta.symptomPath ?? 'full',
            servedTier: res.meta.servedTier ?? null, tokens: res.meta.tokens, costUsd: callCost},
          dictBase, dictFull,
          pipeBase: pipeline(c, dictBase, llmOk),
          pipeFull: pipeline(c, dictFull, llmOk),
        };
      }
    };
    await Promise.all(Array.from({length: concurrency}, worker));
    const done = rows.filter(Boolean);
    const n = done.length;
    const count = (f) => done.filter(f).length;
    const lat = done.map((r) => r.llm.latencyMs);
    const errors = {};
    for (const r of done) if (r.llm.error) errors[r.llm.error] = (errors[r.llm.error] ?? 0) + 1;
    const summary = {
      planned: cases.length, done: n,
      llmOnly: count((r) => r.llm.ok),
      dictBaseOnly: count((r) => okFor(r, r.dictBase)),
      pipeBase: count((r) => r.pipeBase.ok), pipeBaseRecoverable: count((r) => !r.pipeBase.ok && r.pipeBase.recovered),
      pipeFull: count((r) => r.pipeFull.ok), pipeFullRecoverable: count((r) => !r.pipeFull.ok && r.pipeFull.recovered),
      llmCalledBase: count((r) => r.dictBase.length === 0), llmCalledFull: count((r) => r.dictFull.length === 0),
      errors, latencyP50: percentile(lat, 50), latencyP95: percentile(lat, 95), latencyMax: lat.length ? Math.max(...lat) : null,
      riskSignals: done.filter((r) => r.llm.riskSignal && r.llm.riskSignal !== 'none').map((r) => ({text: r.text, signal: r.llm.riskSignal})),
      // 11/18 절충 1 비교용: 길별 수, 호출당 평균 토큰·비용
      paths: done.reduce((a, r) => ({...a, [r.llm.symptomPath]: (a[r.llm.symptomPath] ?? 0) + 1}), {}),
      avgInputTokens: n ? Math.round(done.reduce((a, r) => a + (r.llm.tokens?.input ?? 0), 0) / n) : null,
      avgCachedTokens: n ? Math.round(done.reduce((a, r) => a + (r.llm.tokens?.cachedInput ?? 0), 0) / n) : null,
      avgCostUsd: n ? done.reduce((a, r) => a + (r.llm.costUsd ?? 0), 0) / n : null,
    };
    report.sets[set] = {summary, rows: done};

    console.log(`\n[${set}] ${n}/${cases.length}문장`);
    console.log(`  LLM 단독            ${summary.llmOnly}/${n} (${pct(summary.llmOnly, n)})`);
    console.log(`  사전(기존)만        ${summary.dictBaseOnly}/${n} (${pct(summary.dictBaseOnly, n)})`);
    console.log(`  사전(기존) → LLM    ${summary.pipeBase}/${n} (${pct(summary.pipeBase, n)}) · +한 번 더 묻고 회복 ${summary.pipeBaseRecoverable} · LLM 호출 ${summary.llmCalledBase}`);
    console.log(`  사전(보강) → LLM    ${summary.pipeFull}/${n} (${pct(summary.pipeFull, n)}) · +한 번 더 묻고 회복 ${summary.pipeFullRecoverable} · LLM 호출 ${summary.llmCalledFull}`);
    console.log(`  LLM 오류 ${JSON.stringify(errors)} · 응답 p50 ${summary.latencyP50}ms p95 ${summary.latencyP95}ms 최대 ${summary.latencyMax}ms`);
    console.log(`  길 ${JSON.stringify(summary.paths)} · 호출당 입력 ${summary.avgInputTokens}토큰(캐시 ${summary.avgCachedTokens}) · 호출당 $${summary.avgCostUsd?.toFixed(5)}`);
    const name = (id) => refData.symptoms.get(id)?.nameKo ?? id;
    const miss = done.filter((r) => !r.llm.ok);
    if (miss.length) {
      console.log('  LLM이 놓친 문장:');
      for (const r of miss) console.log(`    ${r.text} → 기대 ${r.intent ? `intent ${r.intent}` : r.fallback ? '후보 없음' : r.expect.map(name).join('|')} / LLM ${r.llm.error ?? r.llm.reason ?? r.llm.intent ?? ''} [${r.llm.picks.map(name).join(', ')}]`);
    }
    if (summary.riskSignals.length) console.log(`  위험 신호: ${summary.riskSignals.map((x) => `${x.text}=${x.signal}`).join(' / ')}`);
    if (stop) break;
  }

  report.costUsd = Math.round(cost * 1e6) / 1e6;
  report.stoppedBy = stop;
  console.log(`\n비용 $${report.costUsd.toFixed(4)}${stop ? ` · 중단: ${stop}` : ''}`);
  mkdirSync(path.join(HERE, 'out'), {recursive: true});
  const file = path.join(HERE, 'out', `symptom_phrases_llm_${report.createdAt.replace(/[-:]/g, '').replace(/\..+/, 'Z')}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`결과 ${path.relative(process.cwd(), file)}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
