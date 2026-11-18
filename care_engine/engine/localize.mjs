// 11/17 다국어: 응답 문구를 {ko, en?, zh?, vi?, uz?}로 채운다(care_engine/docs/다국어_설계.md).
// 질문·선택지는 ID로, 응급 안내는 만들 때 기억한 문구 키(EMERGENCY_PARTS)로 번역을 찾는다. 글자로 거꾸로 찾지 않는다.
// 번역은 원문(source_ko)이 지금 한국어와 같을 때만 쓴다(원칙 6). 안전 문구는 숫자 검사 + 프론트의 한국어 원문 병기(원칙 4).
import {translate, translateOne, TRANSLATED_LOCALES} from './i18n.mjs';
import {EMERGENCY_PARTS, EMERGENCY_TEXT, EMERGENCY_UNKNOWN, REFERRAL_ADDONS, NOT_DIAGNOSIS, ENGINE_TEXT} from './templates.mjs';
import {COPY} from '../llm/copy.mjs';
import {KO_TEXT} from './summary.mjs';

/** 엔진 질문 ID → 문구 키 앞부분. RISK_CONFIRM_<n>·SENSITIVE_CHOICE_<n>은 앞부분으로 찾는다. */
function engineQuestionPrefix(id) {
  if (/^RISK_CONFIRM_\d{1,4}$/.test(id)) return 'q.risk_confirm';
  if (/^SENSITIVE_CHOICE_\d{1,4}$/.test(id)) return 'q.sensitive_choice';
  return {SYM_DICT_CONFIRM: 'q.sym_dict_confirm', SYM_NOT_FOUND: 'q.sym_not_found', ASK_START: 'q.ask_start',
    MED_CHOICE: 'q.med_choice', SYM_CONFIRM: 'q.sym_confirm'}[id] ?? null;
}
/** 엔진 질문 선택지 ID → 문구 키 뒷부분. */
const OPTION_SUFFIX = Object.freeze({
  sym_other: 'other', sym_unsure: 'unsure', sym_none: 'none', sym_continue: 'continue',
  find_hospital: 'find_hospital', find_pharmacy: 'find_pharmacy',
  risk_yes: 'yes', risk_no: 'no', risk_unsure: 'unsure', sens_end: 'end', sens_continue: 'continue',
  med_symptom: 'symptom', med_pharmacy: 'pharmacy', med_info: 'info',
});

/** 질문 하나를 번역한다(모르는 질문·선택지는 한국어 그대로). */
export function localizeFollowUp(f, data) {
  if (!f || typeof f !== 'object') return f;
  const index = data.i18n;
  const item = data.itemById?.get(f.id);
  const prefix = item ? null : engineQuestionPrefix(f.id);
  const labelFor = (target, key, label) => (label?.ko ? translate(index, target, key, label.ko) : label);
  const label = item ? labelFor('item', f.id, f.label) : prefix ? labelFor('template', `${prefix}.label`, f.label) : f.label;
  const options = (f.options ?? []).map((o) => {
    let l = o.label;
    if (item) l = labelFor('option', `${f.id}:${o.id}`, o.label);
    else if (prefix && o.id.startsWith('sym_') && !OPTION_SUFFIX[o.id]) l = labelFor('symptom', o.id.slice(4), o.label);
    else if (prefix && OPTION_SUFFIX[o.id]) l = labelFor('template', `${prefix}.${OPTION_SUFFIX[o.id]}`, o.label);
    return {...o, label: l};
  });
  return {...f, label, options};
}

/** 응급 안내 문장 조립(templates.withAddon과 같은 규칙). */
function compose(base, addons, notDiagnosis) {
  let msg = base;
  for (const a of addons) {
    if (msg.includes(a)) continue;
    msg = msg.endsWith(notDiagnosis) ? `${msg.slice(0, msg.length - notDiagnosis.length)}${a} ${notDiagnosis}` : `${msg} ${a}`.trim();
  }
  return msg.slice(0, 1000);
}

/** 응급 안내를 번역한다. 그 언어의 문구가 하나라도 없으면 그 언어는 넣지 않는다(섞지 않음). */
export function localizeEmergency(e, data) {
  const parts = e && EMERGENCY_PARTS.get(e);
  if (!parts || !e.active || !e.title?.ko || !e.message?.ko) return e;
  const src = parts.base === 'unknown' ? EMERGENCY_UNKNOWN : EMERGENCY_TEXT[parts.base];
  if (!src) return e;
  const baseKey = parts.base === 'unknown' ? 'emergency.unknown' : `emergency.${parts.base}`;
  const addonsKo = parts.addons.map((k) => REFERRAL_ADDONS[k]);
  // 기억한 문구로 한국어를 다시 만들어 실제 응답과 같을 때만 번역한다(다르면 조립 규칙이 바뀐 것 → 한국어만)
  if (e.title.ko !== src.title || compose(src.message, addonsKo, NOT_DIAGNOSIS) !== e.message.ko) return e;
  const title = {ko: e.title.ko}, message = {ko: e.message.ko};
  for (const l of TRANSLATED_LOCALES) {
    const t = (key, ko) => translateOne(data.i18n, 'template', key, ko, l);
    const tTitle = t(`${baseKey}.title`, src.title);
    const tBase = t(`${baseKey}.message`, src.message);
    const tNot = t('not_diagnosis', NOT_DIAGNOSIS);
    const tAddons = parts.addons.map((k) => t(`addon.${k}`, REFERRAL_ADDONS[k]));
    if ([tTitle, tBase, tNot, ...tAddons].some((x) => x === null)) continue;
    title[l] = tTitle;
    message[l] = compose(tBase, tAddons, tNot);
  }
  return {...e, title, message};
}

/** 요약을 언어마다 만든다. build(tx) → 문자열|null. 한국어가 null이면 null. */
export function localizedSummary(build, data) {
  const ko = build(KO_TEXT);
  if (ko === null || ko === undefined) return null;
  const out = {ko};
  for (const l of TRANSLATED_LOCALES) {
    const text = build((target, key, k) => translateOne(data.i18n, target, key, k, l));
    if (typeof text === 'string' && text) out[l] = text;
  }
  return out;
}

/** 응답 전체(질문·응급 안내). 요약은 만들 때 localizedSummary로 이미 언어별이다. */
export function localizeResponse(response, data) {
  if (!data?.i18n || data.i18n.size === 0) return response;
  const out = {...response};
  if (out.followUp) out.followUp = localizeFollowUp(out.followUp, data);
  if (out.emergency) out.emergency = localizeEmergency(out.emergency, data);
  return out;
}

// 엔진 문구 키가 실제로 있는지(오타 방지) — 테스트에서 쓴다.
export const ENGINE_QUESTION_KEYS = Object.freeze({ENGINE_TEXT, COPY});
