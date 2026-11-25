import {FACILITY_TYPES, FAVORITES_LIMIT, SORT_VALUES} from './model.js';
import {departmentCatalog} from '../../departments.mjs';

// 'pharmacy' is a facility type in the catalog, not a department.
export const DEPARTMENT_KEYS = Object.freeze(departmentCatalog.map(item => item.key).filter(key => key !== 'pharmacy'));

export class BehaviorValidationError extends Error {
  constructor(message) { super(message); this.name = 'BehaviorValidationError'; this.status = 400; }
}
export class FavoriteLimitError extends Error {
  constructor() { super(`favorite limit ${FAVORITES_LIMIT}`); this.name = 'FavoriteLimitError'; this.status = 409; }
}

function fail(message) { throw new BehaviorValidationError(message); }
function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be a plain object`);
  return value;
}
function keys(value, permitted, label) {
  object(value, label);
  for (const key of Object.keys(value)) if (!permitted.includes(key)) fail(`${label}: unexpected field ${key}`);
}
function string(value, max, label, {required = false, allowEmpty = false} = {}) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) fail(`${label} must be a string up to ${max} characters`);
  const trimmed = value.trim();
  if (!trimmed && (required || !allowEmpty)) fail(`${label} must not be blank`);
  return trimmed;
}
export function validateSettingPatch(payload) {
  keys(payload, ['region', 'preference', 'personalization_enabled'], 'settings');
  if (!Object.keys(payload).length) fail('settings patch is empty');
  const cleaned = {};
  if (Object.hasOwn(payload, 'region')) cleaned.region = string(payload.region, 80, 'region', {allowEmpty: true});
  if (Object.hasOwn(payload, 'preference')) {
    if (!SORT_VALUES.includes(payload.preference)) fail('preference must be distance, open or access');
    cleaned.preference = payload.preference;
  }
  if (Object.hasOwn(payload, 'personalization_enabled')) {
    if (typeof payload.personalization_enabled !== 'boolean') fail('personalization_enabled must be boolean');
    cleaned.personalization_enabled = payload.personalization_enabled;
  }
  return cleaned;
}

/** The frontend connectFavorites() record shape. Exact allowed fields only. */
export function validateFavorite(facility) {
  keys(facility, ['id', 'type', 'name', 'address'], 'facility');
  const id = string(facility.id, 128, 'facility.id', {required: true});
  if (!/^[A-Za-z0-9_:.-]{1,128}$/.test(id)) fail('facility.id has invalid characters');
  if (!FACILITY_TYPES.includes(facility.type)) fail('facility.type must be hospital or pharmacy');
  keys(facility.name, ['ko', 'en'], 'facility.name');
  const ko = string(facility.name.ko, 300, 'facility.name.ko', {required: true});
  const en = Object.hasOwn(facility.name, 'en') ? string(facility.name.en, 300, 'facility.name.en', {allowEmpty: true}) : ko;
  const address = Object.hasOwn(facility, 'address') ? string(facility.address, 500, 'facility.address', {allowEmpty: true}) : '';
  return {id, type: facility.type, name: {ko, en: en || ko}, address};
}
export function validateFavoriteMutation(payload) {
  keys(payload, ['facility', 'favorite'], 'favorite mutation');
  if (typeof payload.favorite !== 'boolean') fail('favorite must be boolean');
  return {facility: validateFavorite(payload.facility), favorite: payload.favorite};
}

/** One counted action on a facility. Only id, type and name: no address, coordinates or contact details. */
export function validateFacilityChoice(payload) {
  keys(payload, ['facility'], 'facility choice');
  keys(payload.facility, ['id', 'type', 'name'], 'facility');
  const {id, type, name} = validateFavorite(payload.facility);
  return {id, type, name};
}

/** One department applied to a search. Must be a search key from departments.mjs. */
export function validateDepartmentChoice(payload) {
  keys(payload, ['department'], 'department choice');
  if (typeof payload.department !== 'string' || !DEPARTMENT_KEYS.includes(payload.department)) fail('department must be a known search key');
  return payload.department;
}

export function requireVerifiedUser(session) {
  // The object must be built from a server-verified session by the caller.
  // Never construct session from the request body, query, user_id or scope.
  const id = session?.user?.id;
  if (typeof id !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(id)) {
    const error = new Error('Authentication required'); error.name = 'AuthenticationError'; error.status = 401; throw error;
  }
  return id;
}

export function validateStoredSetting(value) {
  if (value === null) return null;
  object(value, 'stored setting');
  // An unavailable personalization column must NOT silently enable personalization.
  if (typeof value.personalization_enabled !== 'boolean') fail('personalization_enabled column not available');
  return {
    region: string(value.region ?? '', 80, 'region', {allowEmpty: true}),
    preference: SORT_VALUES.includes(value.preference) ? value.preference : fail('invalid stored preference'),
    personalization_enabled: value.personalization_enabled,
    updated_at: value.updated_at ?? null,
  };
}
