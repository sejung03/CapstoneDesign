// 건강정보 추출을 부를지 정한다(설계 6-1, L4-MVP M3). 신호어 패턴에 맞지 않으면 LLM 호출 0회.
// 1차의 "정규화 후 단어 포함"에서 "원문(NFKC) 정규식"으로 바꿨다. 패턴에 \s*가 있어 공백을 지우지 않는다.
import {PROFILE_SIGNAL_PATTERNS} from './config.mjs';

const PATTERNS = Object.values(PROFILE_SIGNAL_PATTERNS).flat();

/** 메시지 하나가 맞는 패턴 종류(age·medication·allergy·history). 없으면 []. */
export function profileSignalKinds(text) {
  if (typeof text !== 'string') return [];
  const t = text.normalize('NFKC');
  if (!t.trim()) return [];
  return Object.entries(PROFILE_SIGNAL_PATTERNS)
    .filter(([, list]) => list.some((re) => re.test(t)))
    .map(([kind]) => kind);
}

/** 메시지 하나에 신호어가 있는가. */
export function hasProfileSignal(text) {
  if (typeof text !== 'string') return false;
  const t = text.normalize('NFKC');
  return t.trim().length > 0 && PATTERNS.some((re) => re.test(t));
}

/** messages(문자열 배열) 중 하나라도 신호어가 있으면 true. */
export function shouldExtractProfile(messages) {
  return Array.isArray(messages) && messages.some((m) => typeof m === 'string' && hasProfileSignal(m));
}
