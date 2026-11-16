// 사용자에게 보이는 엔진 문구(템플릿). 지시서 "문구 초안" 그대로 — 팀 검토 전 draft.
// LLM을 쓰지 않는다. 사용자 원문·질환명·진단 표현을 넣지 않는다.
export const TEMPLATE_VERSION = 'templates-v1';

// ---- 엔진 질문(설계 §4-4) ----
export const ENGINE_Q = Object.freeze({
  SYM_DICT_CONFIRM: 'SYM_DICT_CONFIRM',
  SYM_CONFIRM: 'SYM_CONFIRM',
  SYM_NOT_FOUND: 'SYM_NOT_FOUND',
  ASK_START: 'ASK_START',
  MED_CHOICE: 'MED_CHOICE',
});
export const OPT = Object.freeze({
  symPrefix: 'sym_',
  symOther: 'sym_other',
  symUnsure: 'sym_unsure',
  symNone: 'sym_none',
  symContinue: 'sym_continue',
  findHospital: 'find_hospital',
  findPharmacy: 'find_pharmacy',
  medSymptom: 'med_symptom',
  medPharmacy: 'med_pharmacy',
  medInfo: 'med_info',
});

const q = (id, ko, options) => ({id, type: 'singleChoice', required: true, label: {ko}, options: options.map(([oid, oko]) => ({id: oid, label: {ko: oko}}))});

/** 사전 후보 확인 질문. @param {Array<{id:string, nameKo:string}>} symptoms 최대 5개 */
export function symDictConfirmQuestion(symptoms) {
  return q(ENGINE_Q.SYM_DICT_CONFIRM, '말씀하신 증상이 이 중에 있나요?', [
    ...symptoms.map((s) => [`${OPT.symPrefix}${s.id}`, s.nameKo]),
    [OPT.symOther, '다른 증상이에요'],
    [OPT.symUnsure, '잘 모르겠어요'],
  ]);
}
export function symNotFoundQuestion() {
  return q(ENGINE_Q.SYM_NOT_FOUND, '말씀하신 증상을 목록에서 찾지 못했어요. 몇 가지 질문에 답해 주시면 진료과를 안내해 드릴게요.', [
    [OPT.symContinue, '질문에 답할게요'],
  ]);
}
export function askStartQuestion() {
  return q(ENGINE_Q.ASK_START, '어디가 어떻게 불편한지 대화창에 적어 주세요. 병원이나 약국만 찾으려면 아래에서 골라 주세요.', [
    [OPT.findHospital, '병원 찾기'],
    [OPT.findPharmacy, '약국 찾기'],
  ]);
}
export function medChoiceQuestion() {
  return q(ENGINE_Q.MED_CHOICE, '어떤 도움이 필요하세요?', [
    [OPT.medSymptom, '증상·부작용 상담'],
    [OPT.medPharmacy, '약국 위치 찾기'],
    [OPT.medInfo, '복용법 등 약 정보 문의'],
  ]);
}

// ---- 응급 안내(message_key → title / message) ----
const URGENT_TITLE = '바로 도움이 필요할 수 있어요';
const URGENT_TAIL = '지금 119에 연락하거나 가까운 응급실로 가세요. 이 서비스는 진단을 하지 않아요.';
export const EMERGENCY_TEXT = Object.freeze({
  emergency_call_119: {
    title: '지금 119에 연락하세요',
    // 11/17 EF(G2): 끝에 "이 서비스는 진단을 하지 않아요." (URGENT 문구와 같게)
    message: '응급 상황이라고 답하셨어요. 바로 119에 전화하세요. 아래 질문은 119에 알릴 내용을 정리하는 데만 쓰여요. 답하지 않아도 괜찮아요. 이 서비스는 진단을 하지 않아요.',
  },
  urgent_notice_consciousness: {title: URGENT_TITLE, message: `의식이 또렷하지 않거나 잘 모르겠다고 답하셨어요. ${URGENT_TAIL}`},
  urgent_notice_breathing: {title: URGENT_TITLE, message: `숨쉬기가 힘들거나 잘 모르겠다고 답하셨어요. ${URGENT_TAIL}`},
  urgent_notice_red_flags: {
    title: URGENT_TITLE,
    message: `갑작스러운 마비, 말하기 어려움, 심한 가슴 통증, 멈추지 않는 출혈 중 하나가 있거나 잘 모르겠다고 답하셨어요. ${URGENT_TAIL}`,
  },
});
const EMERGENCY_UNKNOWN = Object.freeze({title: URGENT_TITLE, message: '지금 119에 연락하거나 가까운 응급실로 가세요.'});

/** @returns {{emergency:{active:true, title:{ko}, message:{ko}}, warning:string|null}} 모르는 키는 일반 긴급 문구 + warning */
export function emergencyNotice(messageKey) {
  const t = Object.hasOwn(EMERGENCY_TEXT, messageKey) ? EMERGENCY_TEXT[messageKey] : null;
  const use = t ?? EMERGENCY_UNKNOWN;
  return {
    emergency: {active: true, title: {ko: use.title}, message: {ko: use.message}},
    warning: t ? null : 'unknown_message_key',
  };
}

// ---- 요약(설계 §8-2·§8-4) ----
export const SUMMARY = Object.freeze({
  header: '입력한 답을 정리한 참고용 내용이에요. 진단이 아니에요.',
  target: '상담 대상',
  symptom: '주된 증상',
  symptomUnknown: '목록에서 찾지 못함',
  onset: '시작',
  course: '경과',
  pain: (v) => `통증: ${v}점 (0~10)`,
  departments: '참고할 진료과',
  unchecked: '복용 중인 약, 기존 질환, 함께 있는 다른 증상은 확인하지 않았어요. 해당되면 진료 때 꼭 알려 주세요.',
  safetyUnanswered: '응급 확인 질문에 답하지 않았어요. 의식이 흐리거나 숨쉬기 힘들거나, 갑작스러운 마비·말하기 어려움·심한 가슴 통증·멈추지 않는 출혈이 있으면 지금 119에 연락하세요.',
  footer: '증상이 갑자기 심해지면 119에 연락하세요.',
  emergencyHeader: '119에 알릴 내용이에요(참고용).',
  medInfo: '약의 복용법이나 함께 먹어도 되는지 같은 질문은 약사나 의사에게 확인하는 것이 가장 정확해요. 가까운 약국을 찾아볼 수 있어요. (참고용 안내)',
});

/**
 * 경과 줄에서 예/아니요 답만으로는 뜻이 안 보이는 slot의 짧은 이름. [판단] 지시서 초안은 표시 문구만 쉼표로
 * 잇는 형태였으나 "예, 아니요"만 남아 읽을 수 없어서 slot 이름을 앞에 붙인다(문항 ID가 아니라 slot 키 기준).
 */
export const COURSE_SLOT_LABELS = Object.freeze({
  'detail.continuous': '계속 나타남',
  'detail.worsening': '점점 심해짐',
});

/** 119 정리 요약 줄의 짧은 이름(E1~E9-1 문항 문구를 줄인 것, card slot 키 기준). 없는 키는 문항 문구를 쓴다. */
export const CARD_SLOT_LABELS = Object.freeze({
  'card.is_self': '환자가 본인',
  'card.with_patient': '환자와 함께 있음',
  'card.location_known': '위치를 앎',
  'card.consciousness': '의식·반응 있음',
  'card.breathing': '정상 호흡',
  'card.bleeding': '심한 출혈',
  'card.injury': '넘어짐·사고',
  'card.patient_count': '환자 수',
  'card.onset': '증상 시작',
});

/** 결과 매핑이 선택지 code가 아닌 값을 넣을 때의 표시(예: E8=아니요 → count_1). */
export const DERIVED_VALUE_LABELS = Object.freeze({
  count_1: '1명',
  unknown: '모름',
  none: '없음',
});
