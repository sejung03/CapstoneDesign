/**
 * GUMO-inspired explicit preference *statement model* (NOT GUMO/OWL implementation).
 * BEHAVIOR_MODEL: the four statements the user sets directly. CHOICE_MODEL: two action COUNTS
 * (no event log, no per-action timestamps). Nothing else may be stored or interpreted. No inferred behavior.
 * Server-only: never import the repository/service from a browser component.
 */
export const SORT_VALUES = Object.freeze(['distance', 'open', 'access']);
export const FACILITY_TYPES = Object.freeze(['hospital', 'pharmacy']);
export const FAVORITES_LIMIT = 20;
export const REASON_MAX_LENGTH = 240;
/** Facilities kept per user; the least recently counted ones are dropped (DB function enforces the same). */
export const FACILITY_CHOICE_LIMIT = 50;
/** A facility counts as "frequently used" from this many counted actions. */
export const FREQUENT_CHOICE_MIN = 2;
export const DATA_POLICY = '사용자가 저장한 설정과, 사용자가 길찾기·전화번호 복사를 한 기관 및 검색에 적용한 진료과의 횟수만 최소로 저장하고, 건강 상태 추정이나 다른 추천 목적에 재사용하지 않는다. 진료과 횟수는 건강정보 저장 동의가 있을 때만 저장한다.';

export const BEHAVIOR_MODEL = Object.freeze({
  sortOrder: Object.freeze({
    subject: 'user', auxiliary: 'hasPreference', predicate: 'sortOrder',
    range: SORT_VALUES, storage: 'public.capstone_search_setting.preference',
    evidence: Object.freeze({source: 'direct_setting', timestamp: 'updated_at'}),
    reasonKey: 'reason.sort.<value>', privacy: 'high',
  }),
  searchRegion: Object.freeze({
    subject: 'user', auxiliary: 'hasPreference', predicate: 'searchRegion',
    range: '0..80 characters', storage: 'public.capstone_search_setting.region',
    evidence: Object.freeze({source: 'direct_setting', timestamp: 'updated_at'}),
    reasonKey: 'reason.region', privacy: 'high',
  }),
  favorite: Object.freeze({
    subject: 'user', auxiliary: 'hasFavorite', predicate: 'facility',
    range: 'facility ID: [A-Za-z0-9_:.-], length 1..128',
    storage: 'public.capstone_favorite.facility_id',
    evidence: Object.freeze({source: 'direct_setting', timestamp: 'created_at'}),
    reasonKey: 'reason.favorite', privacy: 'high',
  }),
  personalization: Object.freeze({
    subject: 'user', auxiliary: 'hasSetting', predicate: 'personalization',
    range: Object.freeze(['on', 'off']),
    storage: 'public.capstone_search_setting.personalization_enabled',
    evidence: Object.freeze({source: 'direct_setting', timestamp: 'updated_at'}),
    reasonKey: null, privacy: 'high',
  }),
});

/**
 * Action counts. Counted only for signed-in users with personalization on.
 * consent: which signup consent item is the legal basis (signup-consent.mjs).
 */
export const CHOICE_MODEL = Object.freeze({
  facilityChoice: Object.freeze({
    subject: 'user', auxiliary: 'hasChoiceCount', predicate: 'facility',
    range: 'facility ID: [A-Za-z0-9_:.-], length 1..128; count 1..100000',
    storage: 'public.capstone_facility_choice.choice_count',
    evidence: Object.freeze({source: 'directions_or_phone_copy', timestamp: 'updated_at'}),
    consent: 'account', reasonKey: 'reason.frequent', privacy: 'high',
  }),
  departmentChoice: Object.freeze({
    subject: 'user', auxiliary: 'hasChoiceCount', predicate: 'department',
    range: 'departments.mjs key; count 1..100000',
    storage: 'app.department_choice.choice_count',
    evidence: Object.freeze({source: 'search_condition_applied', timestamp: 'updated_at'}),
    consent: 'healthStorage', reasonKey: null, privacy: 'sensitive',
  }),
});
