// 사용자에게 보이는 엔진 문구(템플릿). 지시서 "문구 초안" 그대로 — 팀 검토 전 draft.
// LLM을 쓰지 않는다. 사용자 원문·질환명·진단 표현을 넣지 않는다.
export const TEMPLATE_VERSION = 'templates-v8'; // LC1: 민감 안내 선택 추가 / 11/18 v7: 되묻기(SYM_RETRY·SYM_AREA_PICK) 문구 / v8: 문진 재설계(증상 이름 자리, 요약 줄)

// ---- 엔진 질문(설계 §4-4) ----
export const ENGINE_Q = Object.freeze({
  SYM_DICT_CONFIRM: 'SYM_DICT_CONFIRM',
  SYM_CONFIRM: 'SYM_CONFIRM',
  SYM_NOT_FOUND: 'SYM_NOT_FOUND',
  ASK_START: 'ASK_START',
  MED_CHOICE: 'MED_CHOICE',
  RISK_CONFIRM: 'RISK_CONFIRM', // 11/17 RF2: 실제 질문 ID는 RISK_CONFIRM_<메시지 수>(constants.mjs)
  SYM_RETRY: 'SYM_RETRY', // 11/18: 실제 질문 ID는 SYM_RETRY_<메시지 수>(constants.mjs)
  SYM_AREA_PICK: 'SYM_AREA_PICK', // 11/18: 되묻기에서 고른 부위의 흔한 증상
  SYM_REWRITE_CONFIRM: 'SYM_REWRITE_CONFIRM', // 11/18 절충 1: 고쳐 쓰기 → 사전 후보 확인(llm/confirm-question.mjs)
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
  riskYes: 'risk_yes',
  riskNo: 'risk_no',
  riskUnsure: 'risk_unsure',
  sensEnd: 'sens_end',
  sensContinue: 'sens_continue',
});

/**
 * 11/17 다국어: 엔진 문구를 키로 모은다(한국어 원본). 번역은 ref.text_i18n(target='template')에 이 키로 둔다.
 * 문구를 바꾸면 그 키의 번역은 원문이 달라져 쓰이지 않는다(care_engine/docs/다국어_설계.md 원칙 6).
 */
export const ENGINE_TEXT = Object.freeze({
  'q.sym_dict_confirm.label': '말씀하신 증상이 이 중에 있나요?',
  'q.sym_dict_confirm.other': '다른 증상이에요',
  'q.sym_dict_confirm.unsure': '잘 모르겠어요',
  'q.sym_not_found.label': '말씀하신 증상을 목록에서 찾지 못했어요. 몇 가지 질문에 답해 주시면 진료과를 안내해 드릴게요.',
  'q.sym_not_found.continue': '질문에 답할게요',
  // 11/18 되묻기: 사전·LLM이 증상을 못 찾았을 때 한 번 더 말해 달라고 한다(부위 버튼은 빠른 답장)
  'q.sym_retry.label': '말씀하신 내용만으로는 증상을 정확히 찾지 못했어요. 어디가 어떻게 불편한지 대화창에 조금만 더 자세히 적어 주세요. (예: "어제부터 오른쪽 아랫배가 콕콕 쑤셔요") 아래에서 불편한 곳을 골라도 돼요.',
  'q.sym_retry.continue': '잘 모르겠어요 (질문에 답할게요)',
  'q.sym_retry.area_head': '머리·어지럼증',
  'q.sym_retry.area_eye_ear': '눈·귀',
  'q.sym_retry.area_nose_throat': '코·목·기침',
  'q.sym_retry.area_chest': '가슴·두근거림',
  'q.sym_retry.area_belly': '배·소화',
  'q.sym_retry.area_mouth': '입·치아',
  'q.sym_retry.area_bone': '목·어깨·허리·팔다리',
  'q.sym_retry.area_skin': '피부·상처',
  'q.sym_retry.area_urine': '소변·생식기·임신',
  'q.sym_retry.area_mind': '마음·잠',
  'q.sym_retry.area_body': '열·피로 등 온몸',
  'q.sym_area_pick.label': '이 중에 가까운 증상이 있나요?',
  'q.sym_area_pick.other': '여기 없어요',
  // 11/18 문진 재설계: 질문 문구의 {symptom} 자리에 증상을 모를 때 넣는 말("지금 불편한 증상은 언제부터 있었나요?")
  'q.symptom_unknown': '지금 불편한',
  'q.ask_start.label': '어디가 어떻게 불편한지 대화창에 적어 주세요. 병원이나 약국만 찾으려면 아래에서 골라 주세요.',
  'q.ask_start.find_hospital': '병원 찾기',
  'q.ask_start.find_pharmacy': '약국 찾기',
  'q.risk_confirm.label': '앞에서 말씀하신 일이 오늘 실제로 있었던 일인가요? (본인이나 함께 있는 분에게, 지금은 괜찮아졌어도)',
  'q.risk_confirm.yes': '예, 오늘 있었어요',
  'q.risk_confirm.no': '아니요 (예전 일이거나 실제 일이 아니에요)',
  'q.risk_confirm.unsure': '잘 모르겠어요',
  'q.sensitive_choice.label': '안내를 확인해 주세요. 증상 상담이 필요하시면 계속할 수 있습니다.',
  'q.sensitive_choice.end': '안내만 보고 마치겠습니다',
  'q.sensitive_choice.continue': '증상 상담을 계속하겠습니다',
  'q.med_choice.label': '어떤 도움이 필요하세요?',
  'q.med_choice.symptom': '증상·부작용 상담',
  'q.med_choice.pharmacy': '약국 위치 찾기',
  'q.med_choice.info': '복용법 등 약 정보 문의',
});
const T = ENGINE_TEXT;

const q = (id, ko, options) => ({id, type: 'singleChoice', required: true, label: {ko}, options: options.map(([oid, oko]) => ({id: oid, label: {ko: oko}}))});

/** 사전 후보 확인 질문. @param {Array<{id:string, nameKo:string}>} symptoms 최대 5개 */
export function symDictConfirmQuestion(symptoms) {
  return q(ENGINE_Q.SYM_DICT_CONFIRM, T['q.sym_dict_confirm.label'], [
    ...symptoms.map((s) => [`${OPT.symPrefix}${s.id}`, s.nameKo]),
    [OPT.symOther, T['q.sym_dict_confirm.other']],
    [OPT.symUnsure, T['q.sym_dict_confirm.unsure']],
  ]);
}
export function symNotFoundQuestion() {
  return q(ENGINE_Q.SYM_NOT_FOUND, T['q.sym_not_found.label'], [
    [OPT.symContinue, T['q.sym_not_found.continue']],
  ]);
}
/**
 * 11/18 되묻기. @param {string} id SYM_RETRY_<n> @param {ReadonlyArray<{id:string}>} areas symptom-areas.mjs SYMPTOM_AREAS
 * 부위 문구는 ENGINE_TEXT('q.sym_retry.<부위 ID>')에서 읽는다(번역 키와 같게).
 */
export function symRetryQuestion(id, areas) {
  return q(id, T['q.sym_retry.label'], [
    ...areas.map((a) => [a.id, T[`q.sym_retry.${a.id}`]]),
    [OPT.symContinue, T['q.sym_retry.continue']],
  ]);
}
/** 11/18 부위의 흔한 증상 고르기. @param {Array<{id:string, nameKo:string}>} symptoms */
export function symAreaPickQuestion(symptoms) {
  return q(ENGINE_Q.SYM_AREA_PICK, T['q.sym_area_pick.label'], [
    ...symptoms.map((s) => [`${OPT.symPrefix}${s.id}`, s.nameKo]),
    [OPT.symOther, T['q.sym_area_pick.other']],
  ]);
}
export function askStartQuestion() {
  return q(ENGINE_Q.ASK_START, T['q.ask_start.label'], [
    [OPT.findHospital, T['q.ask_start.find_hospital']],
    [OPT.findPharmacy, T['q.ask_start.find_pharmacy']],
  ]);
}
/** 11/17 RF2 → RG1: 위험 표현 확인 질문. 기준을 '지금'에서 '오늘'로(멎은 경련·끝난 토혈은 예, 작년 일은 아니요). @param {string} id RISK_CONFIRM_<n> */
export function riskConfirmQuestion(id) {
  return q(id, T['q.risk_confirm.label'], [
    [OPT.riskYes, T['q.risk_confirm.yes']],
    [OPT.riskNo, T['q.risk_confirm.no']],
    [OPT.riskUnsure, T['q.risk_confirm.unsure']],
  ]);
}
export function sensitiveChoiceQuestion(id) {
  return q(id, T['q.sensitive_choice.label'], [
    [OPT.sensEnd, T['q.sensitive_choice.end']],
    [OPT.sensContinue, T['q.sensitive_choice.continue']],
  ]);
}
export function medChoiceQuestion() {
  return q(ENGINE_Q.MED_CHOICE, T['q.med_choice.label'], [
    [OPT.medSymptom, T['q.med_choice.symptom']],
    [OPT.medPharmacy, T['q.med_choice.pharmacy']],
    [OPT.medInfo, T['q.med_choice.info']],
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
  // 11/17 R: 자유 입력 위험 표현 규칙(engine/rules/free_text_v1.json)의 message_key. 지시서 R3 초안 그대로(draft).
  freetext_emergency_119: {
    title: '지금 119에 연락하세요',
    message: '생명이 위험할 수 있는 상황으로 보여요. 바로 119에 전화하세요. 이 서비스는 진단을 하지 않아요.',
  },
  freetext_urgent: {
    title: URGENT_TITLE,
    message: '응급 진료가 필요할 수 있는 증상으로 보여요. 119에 연락하거나 가까운 응급실로 가세요. 이 서비스는 진단을 하지 않아요.',
  },
  // 11/17 RF3: 민감 안내(상담하지 않고, 내용을 모으지 않고, 바로 연결). 지시서 초안 그대로. 해바라기센터는 번호를 넣지 않는다.
  threat_notice_112: {
    title: '지금은 안전이 먼저예요',
    message: '누군가 다치거나 위험해질 수 있는 상황으로 보여요. 지금 위험하다면 바로 112에 신고하세요. 다친 사람이 있으면 119에 연락하세요. 이 서비스는 이런 상황에 대한 상담은 하지 않아요.',
  },
  violence_notice_1366: {
    title: '도움받을 수 있는 곳이 있어요',
    message: '여성긴급전화 1366에서 24시간 상담받을 수 있고, 경찰·의료기관 연결도 도와줘요. 가까운 해바라기센터에서는 치료와 상담을 함께 받을 수 있어요. 지금 위험하다면 112, 다쳤다면 119에 연락하세요. 이 서비스는 이런 상황에 대한 상담은 하지 않아요.',
  },
  crisis_notice_109: {
    title: '혼자 견디지 않아도 돼요',
    message: '지금 많이 힘드신 것 같아요. 자살예방 상담전화 109에서 24시간 이야기를 들어 드려요. 지금 위험한 상황이라면 바로 119에 연락하세요. 이 서비스는 진단을 하지 않아요.',
  },
});
/**
 * 11/17 R6(검토 I5): 자해·자살 생각 규칙(crisis_notice_109)이 함께 걸렸는데 더 앞선 규칙의 문구가 나갈 때
 * 109가 사라지지 않게 덧붙이는 한 문장. 진단 아님 문장 앞에 넣는다.
 */
export const CRISIS_109_ADDON = '마음이 힘들다면 자살예방 상담전화 109에서도 24시간 이야기를 들어 드려요.';
export const NOT_DIAGNOSIS = '이 서비스는 진단을 하지 않아요.';

/** 11/17 RF6(검토 I4): 앞선 안내(EMERGENCY_STOP 등)에 함께 걸린 민감 안내의 기관을 한 문장으로 덧붙인다. */
export const REFERRAL_ADDONS = Object.freeze({
  crisis_notice_109: CRISIS_109_ADDON,
  threat_notice_112: '안전이 위협받는 상황이면 112에도 신고하세요.',
  // 11/17 RG2: 본문과 같은 표현(서비스가 연결해 주는 것처럼 읽히지 않게, 검토 G6)
  violence_notice_1366: '폭력 피해가 있다면 여성긴급전화 1366에서 24시간 상담받을 수 있고, 경찰·의료기관 연결도 도와줘요.',
});
/**
 * 11/17 다국어: 응급 안내 객체가 어떤 문구(기본 message_key + 덧붙인 문장 키)로 만들어졌는지 기억한다(응답에는 넣지 않음).
 * 번역(engine/localize.mjs)은 이것으로 언어마다 같은 순서로 다시 조립한다.
 */
export const EMERGENCY_PARTS = new WeakMap();
const ADDON_KEY_BY_TEXT = new Map(Object.entries(REFERRAL_ADDONS).map(([k, v]) => [v, k]));
function registerAddon(from, to, sentence) {
  const parts = EMERGENCY_PARTS.get(from);
  const key = ADDON_KEY_BY_TEXT.get(sentence);
  if (parts && key) EMERGENCY_PARTS.set(to, {base: parts.base, addons: [...parts.addons, key]});
  return to;
}

/** emergency 객체에 문장 하나를 진단 아님 문장 앞에 덧붙인다(이미 있으면 그대로). */
export function withAddon(emergency, sentence) {
  const ko = emergency?.message?.ko ?? '';
  if (!sentence || ko.includes(sentence)) return emergency;
  const msg = ko.endsWith(NOT_DIAGNOSIS)
    ? `${ko.slice(0, ko.length - NOT_DIAGNOSIS.length)}${sentence} ${NOT_DIAGNOSIS}`
    : `${ko} ${sentence}`.trim();
  return registerAddon(emergency, {...emergency, message: {...emergency.message, ko: msg.slice(0, 1000)}}, sentence);
}

/** emergency 객체에 109 한 문장을 덧붙인 새 객체(이미 109가 있으면 그대로). */
export function withCrisis109(emergency) {
  const ko = emergency?.message?.ko ?? '';
  if (ko.includes('109')) return emergency;
  const msg = ko.endsWith(NOT_DIAGNOSIS)
    ? `${ko.slice(0, ko.length - NOT_DIAGNOSIS.length)}${CRISIS_109_ADDON} ${NOT_DIAGNOSIS}`
    : `${ko} ${CRISIS_109_ADDON}`.trim();
  return registerAddon(emergency, {...emergency, message: {...emergency.message, ko: msg.slice(0, 1000)}}, CRISIS_109_ADDON);
}

export const EMERGENCY_UNKNOWN = Object.freeze({title: URGENT_TITLE, message: '지금 119에 연락하거나 가까운 응급실로 가세요.'});

/** @returns {{emergency:{active:true, title:{ko}, message:{ko}}, warning:string|null}} 모르는 키는 일반 긴급 문구 + warning */
export function emergencyNotice(messageKey) {
  const t = Object.hasOwn(EMERGENCY_TEXT, messageKey) ? EMERGENCY_TEXT[messageKey] : null;
  const use = t ?? EMERGENCY_UNKNOWN;
  const emergency = {active: true, title: {ko: use.title}, message: {ko: use.message}};
  EMERGENCY_PARTS.set(emergency, {base: t ? messageKey : 'unknown', addons: []});
  return {emergency, warning: t ? null : 'unknown_message_key'};
}

// ---- 요약(설계 §8-2·§8-4) ----
/** 11/17 다국어: 값이 들어가는 요약 문구는 자리 표시({0}, {1})가 있는 형식으로 둔다(번역도 같은 자리 표시를 쓴다). */
export const SUMMARY_FORMAT = Object.freeze({
  pain: '통증: {0}점 (0~10)',
  departmentRank: '{0}순위 {1}',
});
/** '{0}' 자리 표시를 값으로 바꾼다. */
export function fillText(format, values) {
  return String(format).replace(/\{(\d)\}/g, (m, i) => (values[Number(i)] === undefined ? m : String(values[Number(i)])));
}
export const SUMMARY = Object.freeze({
  // 11/17 요약 말투: 최종 안내는 '~습니다'체(사람 결정 문구 그대로). 이름표·footer는 그대로
  header: '입력하신 답을 정리한 참고용 내용입니다. 진단이 아닙니다.',
  target: '상담 대상',
  symptom: '주된 증상',
  symptomUnknown: '목록에서 찾지 못함',
  onset: '시작',
  course: '경과',
  pain: (v) => fillText(SUMMARY_FORMAT.pain, [v]),
  departments: '참고할 진료과',
  /** 진료과 순위 표기(2개 이상일 때). 1개뿐이면 순위 없이 이름만. */
  departmentRank: (i, name) => fillText(SUMMARY_FORMAT.departmentRank, [i, name]),
  // 진료과 줄 바로 다음 순위 설명(경로별). recommend()의 group이 null이면 stats, 아니면 fallback
  deptNoteStats: '같은 증상으로 진료받는 사람이 많은 진료과 순서입니다. 병원 찾기는 1순위 진료과로 먼저 보여 드립니다.',
  deptNoteFallback: '증상에 맞는 통계가 없어 일반적으로 먼저 찾는 진료과를 안내합니다. 병원 찾기는 1순위 진료과로 먼저 보여 드립니다.',
  unchecked: '복용 중인 약, 기존 질환, 함께 있는 다른 증상은 확인하지 않았습니다. 해당되면 진료 때 꼭 알려 주세요.',
  // 11/18 문진 재설계: 상세 줄(통증 양상 P3, 일상생활 불편 정도 N12)과 저장한 건강정보(본인 상담, 사용자가 저장한 값 그대로)
  painQuality: '통증 양상',
  dailyImpact: '일상생활',
  profileMedications: '복용 중인 약(저장한 건강정보)',
  profileHistory: '기존 질환(저장한 건강정보)',
  profileAllergies: '알레르기(저장한 건강정보)',
  uncheckedWithProfile: '저장한 건강정보 말고는 복용 중인 약, 기존 질환, 함께 있는 다른 증상을 확인하지 않았습니다. 해당되면 진료 때 꼭 알려 주세요.',
  // 11/17 RF2·RG1: 확인 질문에 '잘 모르겠어요'(또는 2번 무응답, 확인 전 skip)일 때 요약 첫 줄(risk_unconfirmed)
  riskUnconfirmed: '응급 증상인지 확인하지 못했습니다. 증상이 심해지거나 걱정되면 바로 119에 연락하거나 응급실로 가세요.',
  safetyUnanswered: '응급 확인 질문에 답하지 않았습니다. 의식이 흐리거나 숨쉬기 힘들거나, 갑작스러운 마비·말하기 어려움·심한 가슴 통증·멈추지 않는 출혈이 있으면 지금 119에 연락하세요.',
  footer: '증상이 갑자기 심해지면 119에 연락하세요.',
  emergencyHeader: '119에 알릴 내용입니다(참고용).',
  medInfo: '약의 복용법이나 함께 먹어도 되는지 같은 질문은 약사나 의사에게 확인하는 것이 가장 정확합니다. 가까운 약국을 찾아볼 수 있습니다. (참고용 안내)',
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
