// 건강정보 추출을 부를지 정한다(설계 6-1). 신호어가 없으면 LLM 호출 0회.
import {PROFILE_SIGNAL_WORDS} from './config.mjs';
import {normalizeTerm} from './normalize.mjs';

const SIGNALS = PROFILE_SIGNAL_WORDS.map(normalizeTerm);

/** 메시지 하나에 신호어가 있는가. */
export function hasProfileSignal(text) {
  const n = normalizeTerm(text);
  return n.length > 0 && SIGNALS.some((w) => n.includes(w));
}

/** messages(문자열 배열) 중 하나라도 신호어가 있으면 true. */
export function shouldExtractProfile(messages) {
  return Array.isArray(messages) && messages.some((m) => typeof m === 'string' && hasProfileSignal(m));
}
