/**
 * NON-PERSISTENT in-memory repository for tests / offline development only.
 * Instances contain fake user data only; do not attach to a public route in production.
 */
import {FAVORITES_LIMIT, FACILITY_CHOICE_LIMIT} from './model.js';
import {FavoriteLimitError} from './validation.js';
const clone = value => structuredClone(value);
const byCount = (a, b) => b.count - a.count || String(b.updated_at).localeCompare(String(a.updated_at));

/**
 * departmentConsent(userId) stands in for the DB's health storage consent check (RLS on app.department_choice).
 */
export function createMockBehaviorRepository({now = () => new Date().toISOString(), departmentConsent = () => true} = {}) {
  const userData = new Map();
  const row = id => {
    if (!userData.has(id)) userData.set(id, {setting: null, favorites: new Map(), explicit: {preference:false, personalization:false}, facilityChoices: new Map(), departmentChoices: new Map()});
    return userData.get(id);
  };
  return Object.freeze({
    async readSettings(userId) { return clone(row(userId).setting); },
    // Demo-only provenance. Current app.search_setting has no per-column provenance.
    async readExplicitSettings(userId) { return clone(row(userId).explicit); },
    async patchSettings(userId, patch) {
      const record = row(userId);
      if(Object.hasOwn(patch, "preference"))record.explicit.preference=true;
      if(Object.hasOwn(patch, "personalization_enabled"))record.explicit.personalization=true;
      record.setting = {
        region: '', preference: 'distance', personalization_enabled: true,
        ...record.setting, ...clone(patch), updated_at: now(),
      };
      return clone(record.setting);
    },
    async listFavorites(userId) { return clone([...row(userId).favorites.values()]); },
    async setFavorite(userId, {facility, favorite}) {
      const record = row(userId);
      if (!favorite) { record.favorites.delete(facility.id); return; }
      if (record.favorites.has(facility.id)) return; // stable original created_at
      if (record.favorites.size >= FAVORITES_LIMIT) throw new FavoriteLimitError();
      record.favorites.set(facility.id, {...clone(facility), created_at: now()});
    },
    async deleteAll(userId) {
      const current = userData.get(userId);
      const removed = {favorites: current?.favorites.size ?? 0, search_settings: current?.setting ? 1 : 0, facility_choices: current?.facilityChoices.size ?? 0};
      // Department counts belong to the health consent and are not part of the behavior full delete (same as the DB function).
      const departments = current?.departmentChoices;
      userData.delete(userId);
      if (departments?.size) row(userId).departmentChoices = departments;
      return removed;
    },
    async recordFacilityChoice(userId, facility) {
      const record = row(userId);
      if (record.setting?.personalization_enabled === false) return null;
      const previous = record.facilityChoices.get(facility.id);
      const count = Math.min((previous?.count ?? 0) + 1, 100000);
      record.facilityChoices.delete(facility.id); // re-insert keeps Map order = least recently counted first
      record.facilityChoices.set(facility.id, {...clone(facility), count, updated_at: now()});
      while (record.facilityChoices.size > FACILITY_CHOICE_LIMIT) record.facilityChoices.delete(record.facilityChoices.keys().next().value);
      return count;
    },
    async recordDepartmentChoice(userId, key) {
      if (!departmentConsent(userId)) return null;
      const record = row(userId);
      const count = Math.min((record.departmentChoices.get(key)?.count ?? 0) + 1, 100000);
      record.departmentChoices.set(key, {key, count, updated_at: now()});
      return count;
    },
    async listFacilityChoices(userId) { return clone([...row(userId).facilityChoices.values()].sort(byCount)); },
    async listDepartmentChoices(userId) { return clone([...row(userId).departmentChoices.values()].sort(byCount)); },
    async deleteFacilityChoices(userId) { const record = row(userId), size = record.facilityChoices.size; record.facilityChoices.clear(); return size; },
    async deleteDepartmentChoices(userId) { const record = row(userId), size = record.departmentChoices.size; record.departmentChoices.clear(); return size; },
  });
}
