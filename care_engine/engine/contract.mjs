// 응답 계약 검사(설계 §8-5). 프론트 normalizeAssistantResponse(frontend/assistant.mjs)와
// normalizeIntakeQuestionnaire·normalizeEmergency·normalizeHealthUpdates 규칙을 옮겼다(프론트 파일은 import하지 않는다).
// 엔진은 프론트보다 조금 더 엄격하다: 허용 필드 밖 금지, followUpQuestionId 금지, emergency의 topicId·videos·instructions 금지(설계 §6).
import {checkFollowUpContract} from '../llm/confirm-question.mjs';

/**
 * 프론트 departmentCatalog의 key 목록(frontend/departments.mjs). 테스트가 프론트 파일을 읽어 같은지 확인한다.
 */
export const FRONTEND_DEPARTMENT_KEYS = Object.freeze([
  'internal', 'family', 'pediatrics', 'ent', 'ophthalmology', 'dermatology', 'orthopedics', 'neurosurgery', 'neurology',
  'psychiatry', 'obgyn', 'urology', 'surgery', 'thoracic', 'plastic', 'pain', 'rehabilitation', 'emergency', 'radiology',
  'radiation', 'pathology', 'laboratory', 'occupational', 'nuclear', 'preventive', 'tuberculosis', 'dental', 'korean', 'pharmacy',
]);
const TRAVEL_MODES = ['walk', 'traffic', 'car'];
const SEARCH_KEYS = ['region', 'type', 'department', 'openOnly', 'mode'];
const RESPONSE_KEYS = ['summary', 'followUp', 'search', 'emergency', 'profileUpdates'];
const ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;
const HEALTH_FIELDS = ['age', 'allergies', 'medications', 'history'];
const EVIDENCE_KINDS = ['message', 'intake', 'intakeNote', 'followup'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function checkText(v, max, at, errors, {trim = false} = {}) {
  if (!isObj(v) || typeof v.ko !== 'string' || !v.ko.trim() || (trim ? v.ko.trim() : v.ko).length > max) { errors.push(`${at}.ko`); return; }
  if (v.en !== undefined && (typeof v.en !== 'string' || v.en.length > max)) errors.push(`${at}.en`);
  for (const k of Object.keys(v)) if (k !== 'ko' && k !== 'en') errors.push(`${at}: '${k}' 허용 안 함`);
}

function normalizeAge(value) {
  const text = String(value ?? '').trim();
  return /^\d{1,3}$/.test(text) && Number(text) <= 120 ? String(Number(text)) : '';
}

function checkFollowUp(f, errors) {
  const c = checkFollowUpContract(f);
  for (const e of c.errors) errors.push(`followUp: ${e}`);
  if (!isObj(f)) return;
  // 프론트 normalizeIntakeQuestionnaire: type은 singleChoice만, required는 boolean 필수
  if (f.type !== 'singleChoice') errors.push('followUp: type은 singleChoice');
  if (typeof f.required !== 'boolean') errors.push('followUp: required 필수(boolean)');
  if (typeof f.id === 'string' && !ID_RE.test(f.id)) errors.push('followUp: id 형식');
}

function checkSearch(s, errors) {
  if (!isObj(s)) { errors.push('search: 객체 아님'); return; }
  const keys = Object.keys(s);
  if (keys.length === 0) errors.push('search: 비어 있음');
  for (const k of keys) if (!SEARCH_KEYS.includes(k)) errors.push(`search: '${k}' 허용 안 함`);
  if ('region' in s && (typeof s.region !== 'string' || s.region.length > 80)) errors.push('search.region');
  if ('type' in s && !['all', 'hospital', 'pharmacy'].includes(s.type)) errors.push('search.type');
  if ('department' in s) {
    if (s.department !== 'all' && !FRONTEND_DEPARTMENT_KEYS.includes(s.department)) errors.push('search.department: 프론트 목록에 없음');
    else if (s.department !== 'all') {
      const type = s.department === 'pharmacy' ? 'pharmacy' : 'hospital';
      if ('type' in s && s.type !== type) errors.push('search: type과 department 불일치');
    }
  }
  if ('openOnly' in s && typeof s.openOnly !== 'boolean') errors.push('search.openOnly');
  if ('mode' in s && !TRAVEL_MODES.includes(s.mode)) errors.push('search.mode');
}

function checkEmergency(e, errors) {
  if (!isObj(e) || typeof e.active !== 'boolean') { errors.push('emergency: active 필수'); return; }
  for (const k of Object.keys(e)) if (!['active', 'title', 'message'].includes(k)) errors.push(`emergency: '${k}' 엔진은 넣지 않음`);
  if (!e.active) return;
  if (e.title != null) checkText(e.title, 120, 'emergency.title', errors, {trim: true});
  if (e.message != null) checkText(e.message, 1000, 'emergency.message', errors, {trim: true});
}

function checkProfileUpdates(list, errors) {
  if (!Array.isArray(list) || list.length > 4) { errors.push('profileUpdates: 배열 0~4개'); return; }
  const ids = new Set();
  const fields = new Set();
  list.forEach((item, i) => {
    const at = `profileUpdates[${i}]`;
    if (!isObj(item) || typeof item.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(item.id) || ids.has(item.id)) errors.push(`${at}.id`);
    if (!HEALTH_FIELDS.includes(item?.field) || fields.has(item?.field)) errors.push(`${at}.field`);
    if (!['set', 'clear'].includes(item?.operation)) errors.push(`${at}.operation`);
    if (typeof item?.value !== 'string' || item.value.length > 500 || (item.operation === 'clear' ? item.value !== '' : !item.value.trim())) errors.push(`${at}.value`);
    if (item?.operation === 'set' && item?.field === 'age' && normalizeAge(item.value) === '') errors.push(`${at}.value: 나이`);
    const ev = item?.evidence;
    if (!isObj(ev) || !EVIDENCE_KINDS.includes(ev.kind) || typeof ev.quote !== 'string' || !ev.quote.trim() || ev.quote.length > 500) errors.push(`${at}.evidence`);
    else if (ev.kind === 'message' && (!Number.isInteger(ev.index) || ev.index < 0 || ev.index > 10000)) errors.push(`${at}.evidence.index`);
    else if ((ev.kind === 'intake' || ev.kind === 'followup') && (typeof ev.questionId !== 'string' || !ev.questionId || ev.questionId.length > 80)) errors.push(`${at}.evidence.questionId`);
    ids.add(item?.id);
    fields.add(item?.field);
  });
}

/**
 * @param {object} response runCare가 내보낼 응답
 * @returns {{ok:boolean, errors:string[]}}
 */
export function checkResponseContract(response) {
  const errors = [];
  if (!isObj(response)) return {ok: false, errors: ['응답 객체 아님']};
  for (const k of Object.keys(response)) if (!RESPONSE_KEYS.includes(k)) errors.push(`'${k}' 허용 안 함`);
  if (response.summary != null) checkText(response.summary, 2000, 'summary', errors);
  if (response.followUp != null) checkFollowUp(response.followUp, errors);
  if (response.search != null) checkSearch(response.search, errors);
  if (response.emergency != null) checkEmergency(response.emergency, errors);
  if (response.profileUpdates != null) checkProfileUpdates(response.profileUpdates, errors);
  const hasAny = response.summary != null || response.followUp != null || response.search != null || response.emergency != null
    || (Array.isArray(response.profileUpdates) && response.profileUpdates.length > 0);
  if (!hasAny) errors.push('필드가 하나도 없음');
  return {ok: errors.length === 0, errors};
}
