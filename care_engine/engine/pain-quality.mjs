// 11/18 문진 재설계: 통증 양상(P3)을 사용자가 이미 말했으면 묻지 않고 채운다(통증증상 PQ 메모: 아픔 → 어디 → 어떻게 → 얼마나).
// 결정적 규칙. 한 갈래에만 맞을 때만 채운다(두 갈래 이상이면 사용자에게 묻는다). 진료과 추천·응급 판단에는 쓰지 않는다(요약에만).
// 입력은 normalizeTerm(NFKC·소문자·공백 제거)한 사용자 메시지 전체.
import {normalizeTerm} from '../llm/normalize.mjs';

export const PAIN_QUALITY_ITEM_ID = 'P3';

/** 양상 코드(intake_v1.yaml P3 선택지) → 표현. 어간 위주로 적어 활용형("욱신거려요", "욱신욱신")을 함께 잡는다. */
export const PAIN_QUALITY_CUES = Object.freeze({
  pq_stabbing: Object.freeze(['찌르', '찔리', '콕콕', '쿡쿡', '콕찌']),
  pq_throbbing: Object.freeze(['욱신', '욱씬', '지끈', '쑤시', '쑤셔', '쑤심']),
  pq_squeezing: Object.freeze(['쥐어짜', '쥐어짤', '조이는', '조여', '조인다', '짓누르', '짓눌', '압박감']),
  pq_burning: Object.freeze(['화끈', '타는듯', '타는것같', '따가', '따끔', '쓰라', '쓰려']),
  pq_dull: Object.freeze(['뻐근', '묵직', '결리', '결려', '뻑뻑']),
  pq_tingling: Object.freeze(['저리', '저려', '저림', '찌릿', '찌릿찌릿', '전기가오']),
});

/**
 * @param {string[]} messages 사용자 메시지
 * @returns {string|null} 한 갈래에만 맞으면 그 코드, 아니면 null
 */
export function painQualityFromMessages(messages) {
  const text = (Array.isArray(messages) ? messages : []).map((m) => normalizeTerm(String(m ?? ''))).join('\n');
  if (!text) return null;
  const hits = Object.entries(PAIN_QUALITY_CUES).filter(([, cues]) => cues.some((c) => text.includes(c))).map(([code]) => code);
  return hits.length === 1 ? hits[0] : null;
}
