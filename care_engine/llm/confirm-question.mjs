// 증상 후보 → 확인 질문(followUp). 설계 5-7, BACKEND.md 0.20.0 계약.
import {COPY, localized, SYM_CONFIRM_ID, SYM_NONE_ID, SYM_UNSURE_ID, SYM_OPTION_PREFIX} from './copy.mjs';
import {MAX_PICKS} from './config.mjs';

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const TEXT_MAX = 300;

/**
 * @param {string[]} picks  검사를 마친 symptomId(LLM 순서)
 * @param {object} refData
 * @param {'ko'|'en'} [locale]  v1은 name_ko만 있으므로 문구는 ko(+copy에 en이 있으면 en)
 * @returns {object|null}  선택지로 쓸 증상이 하나도 없으면 null(호출 쪽이 fallback)
 */
export function buildSymptomConfirm(picks, refData, locale = 'ko') { // eslint-disable-line no-unused-vars
  const options = [];
  const seen = new Set();
  for (const sid of picks ?? []) {
    if (options.length >= MAX_PICKS) break;
    const s = refData.symptoms.get(sid);
    const optionId = `${SYM_OPTION_PREFIX}${sid}`;
    if (!s || !s.isCandidate || seen.has(sid) || !ID_RE.test(optionId)) continue;
    const name = String(s.nameKo ?? '').trim();
    if (!name || name.length > TEXT_MAX) continue;
    seen.add(sid);
    options.push({id: optionId, label: {ko: name}});
  }
  if (options.length === 0) return null;
  options.push({id: SYM_NONE_ID, label: localized(COPY.symNone)});
  options.push({id: SYM_UNSURE_ID, label: localized(COPY.symUnsure)});
  return {
    id: SYM_CONFIRM_ID,
    type: 'singleChoice',
    required: true,
    label: localized(COPY.symConfirmLabel),
    options,
  };
}

/**
 * 다음 요청의 followUpAnswers에서 확인 질문 답을 읽는다.
 * @returns {{status:'confirmed', symptomId:string} | {status:'fallback', reason:'none'|'unsure'|'invalid'} | {status:'absent'}}
 */
export function parseSymptomConfirm(followUpAnswers, refData) {
  const answers = Array.isArray(followUpAnswers) ? followUpAnswers.filter((a) => a && a.questionId === SYM_CONFIRM_ID) : [];
  if (answers.length === 0) return {status: 'absent'};
  const value = answers[answers.length - 1].value; // 같은 질문 ID는 교체되므로 마지막 것
  if (value === null || value === undefined) return {status: 'absent'};
  if (value === SYM_NONE_ID) return {status: 'fallback', reason: 'none'};
  if (value === SYM_UNSURE_ID) return {status: 'fallback', reason: 'unsure'};
  if (typeof value === 'string' && value.startsWith(SYM_OPTION_PREFIX)) {
    const sid = value.slice(SYM_OPTION_PREFIX.length);
    const s = refData.symptoms.get(sid);
    if (s && s.isCandidate) return {status: 'confirmed', symptomId: sid};
  }
  return {status: 'fallback', reason: 'invalid'};
}

/** 11/17 다국어: 프론트(frontend/i18n.mjs locales)와 같은 언어. ko 필수, 나머지는 선택. */
export const LABEL_LOCALES = Object.freeze(['ko', 'en', 'zh', 'vi', 'uz']);

function checkText(label, at, errors) {
  if (label === null || typeof label !== 'object' || Array.isArray(label)) { errors.push(`${at}: label 객체 없음`); return; }
  for (const k of Object.keys(label)) if (!LABEL_LOCALES.includes(k)) errors.push(`${at}: 허용하지 않는 언어 '${k}'`);
  if (typeof label.ko !== 'string' || !label.ko.trim()) errors.push(`${at}.ko: 필수`);
  else if (label.ko.length > TEXT_MAX) errors.push(`${at}.ko: ${TEXT_MAX}자 초과`);
  for (const k of LABEL_LOCALES.slice(1)) {
    if (k in label && (typeof label[k] !== 'string' || label[k].length > TEXT_MAX)) errors.push(`${at}.${k}: 문자열 ${TEXT_MAX}자 이하`);
  }
}

/** 프론트 followUp 계약 검사(BACKEND.md 0.20.0). @returns {{ok:boolean, errors:string[]}} */
export function checkFollowUpContract(followUp) {
  const errors = [];
  if (followUp === null || typeof followUp !== 'object' || Array.isArray(followUp)) {
    return {ok: false, errors: ['followUp 객체 없음']};
  }
  if (typeof followUp.id !== 'string' || !ID_RE.test(followUp.id)) errors.push('id 형식');
  if (typeof followUp.type !== 'string' || !followUp.type) errors.push('type 없음');
  if ('required' in followUp && typeof followUp.required !== 'boolean') errors.push('required는 boolean');
  checkText(followUp.label, 'label', errors);
  const opts = followUp.options;
  if (!Array.isArray(opts) || opts.length < 1 || opts.length > 12) {
    errors.push('선택지는 1~12개');
  } else {
    const ids = new Set();
    opts.forEach((o, i) => {
      if (o === null || typeof o !== 'object') { errors.push(`options[${i}] 객체 아님`); return; }
      if (typeof o.id !== 'string' || !ID_RE.test(o.id)) errors.push(`options[${i}].id 형식`);
      else if (ids.has(o.id)) errors.push(`options[${i}].id 중복`);
      else ids.add(o.id);
      checkText(o.label, `options[${i}].label`, errors);
    });
  }
  return {ok: errors.length === 0, errors};
}
