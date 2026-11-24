// 비용 계산(L4-MVP M4). 가격은 config.mjs의 MODEL_PRICES_USD_PER_1M(공식 가격표)만 쓴다.
// 모르는 모델이면 null(추정하지 않음).
import {MODEL_PRICES_USD_PER_1M, MODEL_PRICES_FAST_USD_PER_1M, FAST_TIERS, OPENAI_MAX_OUTPUT_TOKENS} from './config.mjs';
import {hasProfileSignal} from './profile-trigger.mjs';
import {maskPii} from './pii.mjs';
import {tailChars, INPUT_MAX_CHARS} from './normalize.mjs';
import {buildCandidates, formatCandidatesForPrompt} from './candidates.mjs';
import {symptomPickSchema, profileExtractSchema} from './schemas.mjs';
import symptomPrompt from './prompts/symptom_v2.mjs';
import profilePrompt from './prompts/profile_v1.mjs';

const fin = (v) => (Number.isFinite(v) && v > 0 ? v : 0);

/**
 * 토큰 → USD. meta는 classifySymptom·extractProfileUpdates의 meta({model, tokens:{input,cachedInput,output,reasoning}})
 * 또는 어댑터 meta({model, inputTokens, cachedInputTokens, outputTokens, reasoningTokens}).
 * - 입력 = (입력 − 캐시 입력) × 입력 단가 + 캐시 입력 × 캐시 단가
 * - 출력 = output_tokens × 출력 단가. OpenAI의 output_tokens에는 추론 토큰이 이미 들어 있으므로 따로 더하지 않는다.
 * @returns {number|null}
 */
export function estimateCostUsd(meta, prices = MODEL_PRICES_USD_PER_1M, fastPrices = MODEL_PRICES_FAST_USD_PER_1M) {
  // 11/24: 실제 처리 등급(servedTier, 없으면 요청한 serviceTier)이 fast면 fast 가격. fast 가격을 모르면 추정하지 않는다
  const fast = FAST_TIERS.includes(meta?.servedTier ?? meta?.serviceTier);
  const p = (fast ? fastPrices : prices)?.[meta?.model];
  if (!p) return null;
  const t = meta.tokens ?? {
    input: meta.inputTokens, cachedInput: meta.cachedInputTokens, output: meta.outputTokens, reasoning: meta.reasoningTokens,
  };
  const input = fin(t.input);
  const cached = Math.min(fin(t.cachedInput), input);
  const output = fin(t.output);
  return ((input - cached) * p.input + cached * p.cachedInput + output * p.output) / 1e6;
}

/**
 * 실행 전 "예상 최대 비용"(위로 잡은 값). 사례 × 반복 × 사례당 상한.
 * 사례당 상한 = 호출마다 (입력 문자 수를 토큰 수로 보고 캐시 없이) + 최대 출력 토큰, 재시도 포함 2회.
 *   - 입력 문자 수 = system + user + 스키마 JSON. 한국어는 문자당 토큰이 1보다 작아 위로 잡힌다.
 *   - 증상 분류는 항상, 건강정보 추출은 신호어가 있는 사례만.
 * 모르는 모델이면 null → 호출하는 쪽에서 실행하지 않는다.
 */
export function estimateMaxCostUsd({cases, config, refData, repeat = 1, prices = MODEL_PRICES_USD_PER_1M, maxOutputTokens = OPENAI_MAX_OUTPUT_TOKENS}) {
  const p = (FAST_TIERS.includes(config.serviceTier) ? MODEL_PRICES_FAST_USD_PER_1M : prices)?.[config.model];
  if (!p) return null;
  const callCost = (chars) => 2 * (chars * p.input + maxOutputTokens * p.output) / 1e6;
  let total = 0;
  for (const c of cases) {
    const text = tailChars(maskPii(String(c.text ?? '')).text.trim(), INPUT_MAX_CHARS);
    let cands = buildCandidates(text, refData, {k: config.candidateK, mode: config.candidateMode});
    if (cands.length === 0) cands = buildCandidates(text, refData, {mode: 'all'});
    if (cands.length > 0) {
      const user = symptomPrompt.buildUser({text, candidatesText: formatCandidatesForPrompt(cands, refData)});
      const schema = JSON.stringify(symptomPickSchema(cands.map((x) => x.symptomId)));
      total += callCost(symptomPrompt.system.length + user.length + schema.length);
    }
    if (hasProfileSignal(c.text)) {
      const user = profilePrompt.buildUser({messages: [{index: 0, text}]});
      total += callCost(profilePrompt.system.length + user.length + JSON.stringify(profileExtractSchema()).length);
    }
  }
  return total * Math.max(1, Number(repeat) || 1);
}
