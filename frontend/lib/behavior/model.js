/**
 * GUMO-inspired explicit preference *statement model* (NOT GUMO/OWL implementation).
 * Only these four statements may be stored or interpreted. No inferred behavior.
 * Server-only: never import the repository/service from a browser component.
 */
export const SORT_VALUES = Object.freeze(['distance', 'open', 'access']);
export const FACILITY_TYPES = Object.freeze(['hospital', 'pharmacy']);
export const FAVORITES_LIMIT = 20;
export const REASON_MAX_LENGTH = 240;
export const DATA_POLICY = '사용자가 요청한 설정만 최소로 저장하고, 건강 상태 추정이나 다른 추천 목적에 재사용하지 않는다.';

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
