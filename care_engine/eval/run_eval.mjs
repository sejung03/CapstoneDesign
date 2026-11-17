// 평가 실행(설계 9-2). 결과 파일에는 사례 원문·quote·value를 넣지 않고 case id와 ID·숫자만 남긴다.
//
// 사용: node eval/run_eval.mjs --cases eval/cases/draft_v0.jsonl --provider mock --fixtures eval/fixtures/mock_v0.json [--repeat 3]
//   --provider openai 는 실제 API를 부른다(npm run eval:openai, .env 필요). gemini는 not_implemented.
// 비용 안전장치(L4 M4): openai는 실행 전 예상 최대 비용이 LLM_EVAL_BUDGET_USD(기본 2)를 넘으면 실행하지 않고,
//   실행 중 누적 비용이 예산을 넘으면 남은 사례를 실행하지 않는다(stoppedByBudget).
//   auth·quota·bad_request가 나면 그 자리에서 멈춘다(stoppedByError, 재시도 없음).
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {classifySymptom, extractProfileUpdates} from '../llm/index.mjs';
import {getConfig} from '../llm/config.mjs';
import {getProvider} from '../llm/provider.mjs';
import {loadRefData} from '../llm/ref-data.mjs';
import {buildCandidates} from '../llm/candidates.mjs';
import {maskPii} from '../llm/pii.mjs';
import {normalizeTerm, tailChars, INPUT_MAX_CHARS} from '../llm/normalize.mjs';
import {estimateCostUsd, estimateMaxCostUsd} from '../llm/cost.mjs';
import {STOP_ERRORS} from '../llm/errors.mjs';

/** 평가에서 그 자리에서 멈추는 오류: 인증·잔액(진짜 멈춤) + 요청 형식 오류(계속 불러도 같은 결과) */
export const EVAL_STOP_ERRORS = Object.freeze([...STOP_ERRORS, 'bad_request']);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KS = [10, 20, 40, 60];

export function readCases(file) {
  return readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l, i) => {
    const c = JSON.parse(l);
    if (typeof c.id !== 'string' || typeof c.text !== 'string') throw new Error(`cases ${i + 1}행: id·text 필요`);
    return c;
  });
}

/** case id 기준 fixtures → mock이 쓰는 (입력 텍스트 → 응답) 맵. 프롬프트에 case id는 들어가지 않는다. */
export function fixturesToMockMap(cases, fixtures) {
  const map = {symptom_pick_v1: {}, profile_extract_v1: {}};
  for (const c of cases) {
    const f = fixtures.cases?.[c.id];
    if (!f) continue;
    if (f.symptom) map.symptom_pick_v1[c.text] = f.symptom;
    if (f.profile) map.profile_extract_v1[c.text] = f.profile;
  }
  return map;
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}

const ratio = (hit, n) => ({hit, n, value: n === 0 ? null : Math.round((hit / n) * 10000) / 10000});

const addTokens = (a, b) => ({
  input: a.input + (b?.input ?? 0), cachedInput: a.cachedInput + (b?.cachedInput ?? 0),
  output: a.output + (b?.output ?? 0), reasoning: a.reasoning + (b?.reasoning ?? 0),
});
const zeroTokens = () => ({input: 0, cachedInput: 0, output: 0, reasoning: 0});
const round6 = (v) => (v === null ? null : Math.round(v * 1e6) / 1e6);

/**
 * @param {{cases:object[], fixtures?:object, providerName?:string, repeat?:number, config?:object, refData?:object,
 *          budgetUsd?:number, prices?:object, providerFactory?:Function}} opts
 *   providerFactory: 테스트용(기본 getProvider). 반복마다 새로 만든다.
 */
export async function runEval({cases, fixtures = {}, providerName = 'mock', repeat = 1, config: baseConfig, refData = loadRefData(),
  budgetUsd, prices, providerFactory}) {
  const config = baseConfig ?? getConfig({...process.env, LLM_PROVIDER: providerName});
  const budget = Number.isFinite(budgetUsd) ? budgetUsd : config.evalBudgetUsd;
  // LLM_DEV_CONSENT=true면 consent를 넘기지 않아 개발용 동의 경로를 쓴다. 아니면 평가 전용 동의 객체.
  const consentFor = (name) => (config.devConsent ? undefined : {granted: true, provider: name, version: 'eval-only', healthInfo: true});
  const makeProvider = providerFactory
    ?? (() => getProvider({config, fixtures: fixturesToMockMap(cases, fixtures), mockOptions: {defaults: fixtures.defaults ?? {}}}));
  const costOf = (meta) => estimateCostUsd(meta, prices);
  const runs = Math.max(1, Number(repeat) || 1);
  const perCase = [];
  let costTotal = 0;
  let costKnown = true;
  let stoppedByBudget = false;
  let stoppedByError = null;

  for (const c of cases) {
    if (stoppedByBudget || stoppedByError) break;
    const runResults = [];
    let caseCost = 0;
    let caseTokens = zeroTokens();
    for (let r = 0; r < runs; r += 1) {
      // 반복마다 새 provider(배열 응답 순서를 처음부터)
      const provider = makeProvider();
      const logs = [];
      const deps = {provider, refData, config, log: (e) => logs.push(e)};
      const consent = consentFor(provider.name);
      const res = await classifySymptom({text: c.text, consent, requestId: `${c.id}#${r + 1}`, reason: 'eval'}, deps);
      const ev = logs.find((e) => e.event === 'llm.classify_symptom') ?? {};
      const picks = res.status === 'confirm'
        ? res.followUp.options.map((o) => o.id).filter((id) => id !== 'sym_none' && id !== 'sym_unsure').map((id) => id.slice(4))
        : [];
      const prof = await extractProfileUpdates({messages: [c.text], consent, requestId: `${c.id}#${r + 1}`, reason: 'eval'}, deps);
      runResults.push({res, ev, picks, prof});
      for (const m of [res.meta, prof.meta]) {
        caseTokens = addTokens(caseTokens, m.tokens);
        const cost = costOf(m);
        if (cost === null) costKnown = false; else caseCost += cost;
      }
      const stopErr = [res.meta.error, prof.meta.error].find((e) => EVAL_STOP_ERRORS.includes(e));
      if (stopErr) { stoppedByError = stopErr; break; }
    }

    const first = runResults[0];
    const gold = c.gold_symptoms ?? [];
    // 후보(5-2) 순위: 파이프라인과 같은 입력(PII 가림 + 500자)
    const llmText = tailChars(maskPii(c.text).text.trim(), INPUT_MAX_CHARS);
    const retrieve = buildCandidates(llmText, refData, {k: Math.max(...KS), mode: 'retrieve'}).map((x) => x.symptomId);
    const goldRankRetrieve = Object.fromEntries(gold.map((g) => [g, retrieve.indexOf(g) >= 0 ? retrieve.indexOf(g) + 1 : null]));
    let sent = buildCandidates(llmText, refData, {k: config.candidateK, mode: config.candidateMode});
    if (sent.length === 0 && config.candidateMode !== 'all') sent = buildCandidates(llmText, refData, {mode: 'all'});
    const sentIds = new Set(sent.map((x) => x.symptomId));

    // profile 비교: field + 정규화 value. 값 자체는 결과에 남기지 않는다.
    const goldProfile = c.gold_profile ?? [];
    const key = (f, v) => `${f}\u0000${normalizeTerm(v)}`;
    const goldKeys = new Set(goldProfile.map((g) => key(g.field, g.value)));
    const extracted = first.prof.items;
    const matched = extracted.filter((it) => goldKeys.has(key(it.field, it.value))).length;

    const sig = (x) => JSON.stringify([x.res.status, x.res.reason ?? null, x.ev.intent ?? null, x.picks]);
    perCase.push({
      id: c.id,
      group: c.group ?? null,
      design: fixtures.cases?.[c.id]?.design ?? null,
      goldIntent: c.gold_intent,
      goldSymptoms: gold,
      goldEmergency: Boolean(c.gold_emergency),
      status: first.res.status,
      reason: first.res.reason ?? null,
      intent: first.ev.intent ?? null,
      picks: first.picks,
      error: first.res.meta.error,
      candidateMode: first.res.meta.candidateMode,
      candidateCount: first.res.meta.candidateCount,
      goldRankRetrieve,
      goldInSent: gold.length ? gold.some((g) => sentIds.has(g)) : null,
      recall10Hit: gold.length ? first.picks.slice(0, 10).some((p) => gold.includes(p)) : null,
      top1Hit: gold.length ? gold.includes(first.picks[0]) : null,
      latencyMs: runResults.map((x) => x.res.meta.latencyMs),
      attempts: first.res.meta.attempts,
      repeatConsistent: runResults.every((x) => sig(x) === sig(first)),
      runs: runResults.length,
      consentSource: first.res.meta.consentSource ?? null,
      costUsd: costKnown ? round6(caseCost) : null,
      tokens: caseTokens,
      providerError: first.res.meta.providerError ?? null,
      profile: {
        called: first.prof.meta.attempts > 0,
        error: first.prof.meta.error,
        extracted: extracted.length,
        fields: extracted.map((it) => it.field),
        matched,
        gold: goldProfile.length,
      },
    });
    costTotal += caseCost;
    if (costKnown && costTotal > budget) stoppedByBudget = true;
  }

  const tokens = perCase.reduce((a, c) => addTokens(a, c.tokens), zeroTokens());
  const sources = [...new Set(perCase.map((c) => c.consentSource))];
  return {
    createdAt: new Date().toISOString(),
    ...summarize(perCase, {config, refData, runs, fixtures}),
    reasoningEffort: config.provider === 'openai' ? config.reasoningEffort : null,
    temperature: config.provider === 'openai' ? config.temperature : null,
    consentSource: sources.length === 1 ? sources[0] : sources,
    casesPlanned: cases.length,
    budgetUsd: budget,
    stoppedByBudget,
    stoppedByError,
    costUsd: {
      total: costKnown ? round6(costTotal) : null,
      perCase: costKnown && perCase.length ? round6(costTotal / perCase.length) : null,
      note: costKnown ? '반복 포함, 증상 분류+건강정보 추출 합계' : '가격표에 없는 모델 — 비용 미계산',
    },
    tokens,
    cacheInputRatio: tokens.input > 0 ? Math.round((tokens.cachedInput / tokens.input) * 10000) / 10000 : null,
    cases: perCase,
  };
}

function summarize(perCase, {config, refData, runs, fixtures}) {
  const sym = perCase.filter((c) => c.goldSymptoms.length > 0);
  const nonSym = perCase.filter((c) => c.goldSymptoms.length === 0);
  const candidateRecall = Object.fromEntries(KS.map((k) => [`R@${k}`, ratio(
    sym.filter((c) => Object.values(c.goldRankRetrieve).some((r) => r !== null && r <= k)).length, sym.length)]));
  const failures = {};
  for (const c of perCase) if (c.error) failures[c.error] = (failures[c.error] ?? 0) + 1;
  const profFailures = {};
  for (const c of perCase) if (c.profile.error) profFailures[c.profile.error] = (profFailures[c.profile.error] ?? 0) + 1;
  const extracted = perCase.reduce((a, c) => a + c.profile.extracted, 0);
  const matched = perCase.reduce((a, c) => a + c.profile.matched, 0);
  const goldTotal = perCase.reduce((a, c) => a + c.profile.gold, 0);
  const lat = perCase.flatMap((c) => c.latencyMs);
  const designCounts = {};
  for (const c of perCase) if (c.design) designCounts[c.design] = (designCounts[c.design] ?? 0) + 1;
  const statusCounts = {};
  for (const c of perCase) {
    const k = c.status === 'fallback' ? `fallback:${c.reason}` : c.status === 'route' ? `route:${c.intent}` : c.status;
    statusCounts[k] = (statusCounts[k] ?? 0) + 1;
  }

  return {
    providerName: config.provider,
    model: config.model,
    versions: config.versions,
    dataVersion: refData.dataVersion,
    candidateMode: config.candidateMode,
    candidateK: config.candidateK,
    repeat: runs,
    caseCount: perCase.length,
    fixtureDesign: fixtures.cases ? designCounts : null,
    metrics: {
      candidateRecall,
      candidateSentRecall: ratio(sym.filter((c) => c.goldInSent).length, sym.length),
      recallAt10: ratio(sym.filter((c) => c.recall10Hit).length, sym.length),
      top1: ratio(sym.filter((c) => c.top1Hit).length, sym.length),
      noMatchAccuracy: ratio(nonSym.filter((c) => c.picks.length === 0).length, nonSym.length),
      intentAccuracy: ratio(perCase.filter((c) => c.intent === c.goldIntent).length, perCase.length),
      emergencyMissRate: {value: '미측정', note: '안전 규칙 엔진이 아직 없음. gold_emergency 사례 수만 기록', goldEmergencyCases: perCase.filter((c) => c.goldEmergency).length},
      profilePrecision: ratio(matched, extracted),
      profileRecall: ratio(matched, goldTotal),
      profileCalls: perCase.filter((c) => c.profile.called).length,
      profileFailures: profFailures,
      failureRate: ratio(Object.values(failures).reduce((a, b) => a + b, 0), perCase.length),
      failuresByReason: failures,
      latencyMs: {p50: percentile(lat, 50), p95: percentile(lat, 95), samples: lat.length},
      repeatAgreement: ratio(perCase.filter((c) => c.repeatConsistent).length, perCase.length),
    },
    statusCounts,
  };
}

function parseArgs(argv) {
  const out = {provider: 'mock', repeat: 1};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--cases') out.cases = next();
    else if (a === '--provider') out.provider = next();
    else if (a === '--fixtures') out.fixtures = next();
    else if (a === '--repeat') out.repeat = Number(next());
    else if (a === '--out') out.out = next();
    else throw new Error(`알 수 없는 인자 ${a}`);
  }
  return out;
}

function fmt(r) {
  return r && typeof r === 'object' && 'hit' in r ? `${r.hit}/${r.n} (${r.value})` : String(r?.value ?? r);
}

export function printSummary(result) {
  const m = result.metrics;
  const rows = {
    ...Object.fromEntries(Object.entries(m.candidateRecall).map(([k, v]) => [`후보 ${k}`, fmt(v)])),
    '실제 보낸 후보에 정답': fmt(m.candidateSentRecall),
    'Recall@10': fmt(m.recallAt10),
    'Top-1': fmt(m.top1),
    'no_match 정확도': fmt(m.noMatchAccuracy),
    '의도 정확도': fmt(m.intentAccuracy),
    '응급 놓친 비율': m.emergencyMissRate.value,
    'profile 정밀도': fmt(m.profilePrecision),
    'profile 재현율': fmt(m.profileRecall),
    '실패율': fmt(m.failureRate),
    '실패 사유': JSON.stringify(m.failuresByReason),
    '지연 p50/p95(ms)': `${m.latencyMs.p50} / ${m.latencyMs.p95}`,
    '반복 일치율': fmt(m.repeatAgreement),
    '총비용(USD)': result.costUsd?.total ?? 'null',
    '사례당 비용(USD)': result.costUsd?.perCase ?? 'null',
    '캐시 입력 비율': result.cacheInputRatio ?? 'null',
  };
  console.log(`provider=${result.providerName} model=${result.model} effort=${result.reasoningEffort} data=${result.dataVersion} mode=${result.candidateMode} K=${result.candidateK} 사례=${result.caseCount}/${result.casesPlanned} 반복=${result.repeat} 동의=${JSON.stringify(result.consentSource)}`);
  if (result.stoppedByBudget) console.log(`⚠ 예산 $${result.budgetUsd} 초과로 남은 사례를 실행하지 않음`);
  if (result.stoppedByError) console.log(`⚠ ${result.stoppedByError} 오류로 멈춤(재시도 안 함)`);
  if (result.fixtureDesign) console.log('fixture 구성:', JSON.stringify(result.fixtureDesign));
  console.table(Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, {값: v}])));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.cases) throw new Error('--cases 가 필요하다');
  const cases = readCases(args.cases);
  const fixtures = args.fixtures ? JSON.parse(readFileSync(args.fixtures, 'utf8')) : {};
  const config = getConfig({...process.env, LLM_PROVIDER: args.provider});
  let maxCostEstimateUsd = null;
  if (config.provider === 'openai') {
    maxCostEstimateUsd = estimateMaxCostUsd({cases, config, refData: loadRefData(), repeat: args.repeat});
    console.log(`예상 최대 비용: ${maxCostEstimateUsd === null ? '계산 불가(가격표에 없는 모델)' : `$${maxCostEstimateUsd.toFixed(4)}`} / 예산 $${config.evalBudgetUsd}`);
    if (maxCostEstimateUsd === null || maxCostEstimateUsd > config.evalBudgetUsd) {
      console.log('실행하지 않음: 예상 최대 비용을 알 수 없거나 예산을 넘는다.');
      process.exit(2);
    }
  }
  const result = await runEval({cases, fixtures, providerName: args.provider, repeat: args.repeat, config});
  result.maxCostEstimateUsd = maxCostEstimateUsd === null ? null : round6(maxCostEstimateUsd);
  result.casesFile = path.basename(args.cases);
  result.fixturesFile = args.fixtures ? path.basename(args.fixtures) : null;
  const outDir = args.out ?? path.join(HERE, 'out');
  mkdirSync(outDir, {recursive: true});
  const stamp = result.createdAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const file = path.join(outDir, `${stamp}_${result.providerName}.json`);
  writeFileSync(file, JSON.stringify(result, null, 2) + '\n', 'utf8');
  printSummary(result);
  console.log(`결과: ${path.relative(process.cwd(), file)}`);
  if (result.stoppedByError) process.exitCode = 3;
}
