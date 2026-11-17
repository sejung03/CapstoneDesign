// OpenAI 스모크(L4-MVP M5). 실제 네트워크를 쓰는 스크립트. `npm test`에서는 부르지 않는다.
// 사용: npm run eval:smoke   (= node --env-file=.env eval/smoke_openai.mjs)
//
// - draft_v0(가짜 사례) 앞 10개만 증상 분류 1회씩. 사례 문장 원문은 출력·저장하지 않는다(case id·ID·숫자만).
// - 첫 1건이 auth·quota·bad_request면 즉시 멈춘다. 그 뒤에도 auth·quota면 멈춘다(재시도 없음).
// - 마지막에 LLM_TEMPERATURE=0으로 1건을 따로 시험해 temperature를 받는지(또는 400인지) 보고한다.
// - 실행 전 예상 최대 비용이 LLM_EVAL_BUDGET_USD를 넘으면 실행하지 않는다. 실행 중 누적 비용이 넘어도 멈춘다.
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {classifySymptom} from '../llm/index.mjs';
import {getConfig} from '../llm/config.mjs';
import {getProvider} from '../llm/provider.mjs';
import {loadRefData} from '../llm/ref-data.mjs';
import {estimateCostUsd, estimateMaxCostUsd} from '../llm/cost.mjs';
import {STOP_ERRORS} from '../llm/errors.mjs';
import {readCases} from './run_eval.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SMOKE_N = 10;
const FIRST_STOP = [...STOP_ERRORS, 'bad_request'];

const round6 = (v) => (v === null ? null : Math.round(v * 1e6) / 1e6);

async function runOne(c, config, refData) {
  const provider = getProvider({config});
  const logs = [];
  const consent = config.devConsent ? undefined : {granted: true, provider: provider.name, version: 'eval-only', healthInfo: true};
  const res = await classifySymptom({text: c.text, consent, requestId: `smoke:${c.id}`, reason: 'smoke'},
    {provider, refData, config, log: (e) => logs.push(e)});
  const ev = logs.find((e) => e.event === 'llm.classify_symptom') ?? {};
  return {
    id: c.id,
    status: res.status,
    reason: res.reason ?? null,
    intent: ev.intent ?? null,
    picks: ev.picks ?? [],
    goldSymptoms: c.gold_symptoms ?? [],
    error: res.meta.error,
    providerError: res.meta.providerError,
    attempts: res.meta.attempts,
    latencyMs: res.meta.latencyMs,
    candidateCount: res.meta.candidateCount,
    tokens: res.meta.tokens,
    costUsd: round6(estimateCostUsd(res.meta)),
    consentSource: res.meta.consentSource,
  };
}

function printRow(r) {
  const t = r.tokens;
  console.log([
    r.id, r.status + (r.reason ? `:${r.reason}` : ''), `intent=${r.intent}`, `picks=[${r.picks.join(',')}]`,
    `gold=[${r.goldSymptoms.join(',')}]`, `${r.latencyMs}ms`, `try=${r.attempts}`,
    `tok in=${t.input} cache=${t.cachedInput} out=${t.output} rsn=${t.reasoning}`, `$${r.costUsd}`,
    r.providerError ? `err=${JSON.stringify(r.providerError)}` : '',
  ].join(' | '));
}

async function main() {
  const config = getConfig({...process.env, LLM_PROVIDER: 'openai'});
  const refData = loadRefData();
  const cases = readCases(path.join(HERE, 'cases', 'draft_v0.jsonl')).slice(0, SMOKE_N);
  console.log(`provider=openai model=${config.model} effort=${config.reasoningEffort} temperature=${config.temperature} mode=${config.candidateMode} devConsent=${config.devConsent} 키=${process.env.OPENAI_API_KEY ? '있음' : '없음'}`);
  if (config.modelWarning) console.log(`⚠ 모델 경고: ${config.modelWarning}`);

  // 10건 + temperature 시험 1건
  const est = estimateMaxCostUsd({cases: [...cases, cases[0]], config, refData, repeat: 1});
  console.log(`예상 최대 비용: ${est === null ? '계산 불가' : `$${est.toFixed(4)}`} / 예산 $${config.evalBudgetUsd}`);
  if (est === null || est > config.evalBudgetUsd) {
    console.log('실행하지 않음: 예상 최대 비용을 알 수 없거나 예산을 넘는다.');
    process.exit(2);
  }

  const rows = [];
  let total = 0;
  let stop = null;
  for (const [i, c] of cases.entries()) {
    const r = await runOne(c, config, refData);
    rows.push(r);
    printRow(r);
    total += r.costUsd ?? 0;
    if ((i === 0 && FIRST_STOP.includes(r.error)) || STOP_ERRORS.includes(r.error)) { stop = r.error; break; }
    if (total > config.evalBudgetUsd) { stop = 'budget'; break; }
  }

  let temperatureTest = null;
  if (!stop) {
    const tcfg = getConfig({...process.env, LLM_PROVIDER: 'openai', LLM_TEMPERATURE: '0'});
    const r = await runOne(cases[0], tcfg, refData);
    printRow(r);
    total += r.costUsd ?? 0;
    temperatureTest = {
      temperature: tcfg.temperature,
      accepted: r.error !== 'bad_request',
      status: r.status, error: r.error, providerError: r.providerError,
      sameAsDefault: r.status === rows[0].status && JSON.stringify(r.picks) === JSON.stringify(rows[0].picks),
    };
    console.log(`temperature=0 시험: ${temperatureTest.accepted ? '받음' : '거절(400)'} ${JSON.stringify(r.providerError ?? {})}`);
    if (STOP_ERRORS.includes(r.error)) stop = r.error;
  }

  const lat = rows.map((r) => r.latencyMs).sort((a, b) => a - b);
  const tok = rows.reduce((a, r) => ({input: a.input + r.tokens.input, cachedInput: a.cachedInput + r.tokens.cachedInput}), {input: 0, cachedInput: 0});
  const summary = {
    createdAt: new Date().toISOString(),
    model: config.model, reasoningEffort: config.reasoningEffort, candidateMode: config.candidateMode,
    consentSource: rows[0]?.consentSource ?? null,
    n: rows.length, stoppedBy: stop,
    statusCounts: rows.reduce((a, r) => { const k = r.status + (r.reason ? `:${r.reason}` : ''); a[k] = (a[k] ?? 0) + 1; return a; }, {}),
    latencyMs: {min: lat[0] ?? null, max: lat.at(-1) ?? null},
    cacheInputRatio: tok.input > 0 ? Math.round((tok.cachedInput / tok.input) * 10000) / 10000 : null,
    totalCostUsd: round6(total),
    temperatureTest,
    rows,
  };
  console.log(`합계: ${rows.length}건, 비용 $${summary.totalCostUsd}, 캐시 입력 비율 ${summary.cacheInputRatio}, 멈춤=${stop}`);
  const outDir = path.join(HERE, 'out');
  mkdirSync(outDir, {recursive: true});
  const file = path.join(outDir, `${summary.createdAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}_smoke_openai.json`);
  writeFileSync(file, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  console.log(`결과: ${path.relative(process.cwd(), file)}`);
  if (stop && stop !== 'budget') process.exitCode = 3;
}

await main();
