/**
 * NON-PERSISTENT in-memory repository for tests / offline development only.
 * Instances contain fake user data only; do not attach to a public route in production.
 */
import {FAVORITES_LIMIT} from './model.js';
import {FavoriteLimitError} from './validation.js';
const clone = value => structuredClone(value);

export function createMockBehaviorRepository({now = () => new Date().toISOString()} = {}) {
  const userData = new Map();
  const row = id => {
    if (!userData.has(id)) userData.set(id, {setting: null, favorites: new Map(), explicit: {preference:false, personalization:false}});
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
      const removed = {favorites: current?.favorites.size ?? 0, search_settings: current?.setting ? 1 : 0};
      userData.delete(userId);
      return removed;
    },
  });
}
