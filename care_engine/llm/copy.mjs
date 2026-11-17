// 사용자에게 보이는 문구 상수(ko 필수, en 선택). 문구는 설계 5-7 그대로.
// en 문구는 설계에 없으므로 만들지 않았다(팀 검토 후 추가).

export const SYM_CONFIRM_ID = 'SYM_CONFIRM';
export const SYM_NONE_ID = 'sym_none';
export const SYM_UNSURE_ID = 'sym_unsure';
export const SYM_OPTION_PREFIX = 'sym_';

export const COPY = Object.freeze({
  symConfirmLabel: Object.freeze({ko: '말씀하신 증상과 가장 가까운 것을 하나 골라 주세요.'}),
  symNone: Object.freeze({ko: '해당하는 것이 없어요'}),
  symUnsure: Object.freeze({ko: '잘 모르겠어요'}),
});

/** 문구 객체를 응답용으로 복사한다. ko는 항상, en은 있을 때만. */
export function localized(text) {
  const out = {ko: text.ko};
  if (typeof text.en === 'string' && text.en) out.en = text.en;
  return out;
}
