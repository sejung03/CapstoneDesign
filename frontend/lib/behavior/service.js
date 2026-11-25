import {BEHAVIOR_MODEL, REASON_MAX_LENGTH, FREQUENT_CHOICE_MIN} from './model.js';
import {
  requireVerifiedUser, validateFavoriteMutation, validateSettingPatch,
  validateStoredSetting, BehaviorValidationError,
  validateFacilityChoice, validateDepartmentChoice,
} from './validation.js';

const CHOICE_METHODS = ['recordFacilityChoice', 'recordDepartmentChoice', 'listFacilityChoices', 'listDepartmentChoices', 'deleteFacilityChoices', 'deleteDepartmentChoices'];

const SORT_REASONS = Object.freeze({
  distance: '거리순으로 정렬했습니다',
  open: '운영 여부를 우선해 정렬했습니다',
  access: '접근성 기준으로 정렬했습니다',
});

function statement(userId, model, value, when) {
  return {
    subject: {type: 'user', id: userId},
    auxiliary: model.auxiliary,
    predicate: model.predicate,
    range: model.range,
    object: value,
    evidence: {source: model.evidence.source, at: when ?? null},
    reasonKey: model.reasonKey,
  };
}
const cleanFavoriteList = list => list.map(({id, type, name, address}) => ({id, type, name, address}));

/** Creates a server-side service. Pass the *trusted* user session, never browser-supplied IDs. */
export function createBehaviorService({repository}) {
  if (!repository || ['readSettings', 'patchSettings', 'listFavorites', 'setFavorite', 'deleteAll'].some(k => typeof repository[k] !== 'function')) {
    throw new TypeError('repository must implement the behavior repository contract');
  }
  const choices = () => {
    if (CHOICE_METHODS.some(k => typeof repository[k] !== 'function')) throw new TypeError('repository does not support choice counts');
    return repository;
  };
  // Personalization OFF stops counting. A missing settings row means the default (on).
  const personalizationOn = async userId => validateStoredSetting(await repository.readSettings(userId))?.personalization_enabled !== false;
  return Object.freeze({
    async getSettings(session) {
      const userId = requireVerifiedUser(session);
      return validateStoredSetting(await repository.readSettings(userId));
    },
    async saveSettings(session, body) {
      const userId = requireVerifiedUser(session);
      const patch = validateSettingPatch(body);
      return validateStoredSetting(await repository.patchSettings(userId, patch));
    },
    async disablePersonalization(session) {
      return this.saveSettings(session, {personalization_enabled: false});
    },
    async getFavorites(session) {
      const userId = requireVerifiedUser(session);
      return cleanFavoriteList(await repository.listFavorites(userId));
    },
    async saveFavorite(session, body) {
      const userId = requireVerifiedUser(session);
      const change = validateFavoriteMutation(body);
      await repository.setFavorite(userId, change);
      return cleanFavoriteList(await repository.listFavorites(userId));
    },
    async deleteAll(session) {
      const userId = requireVerifiedUser(session);
      return repository.deleteAll(userId);
    },
    /** Counts one directions view or phone-number copy. Returns {recorded, count}. */
    async recordFacilityChoice(session, body) {
      const userId = requireVerifiedUser(session);
      const facility = validateFacilityChoice(body);
      if (!await personalizationOn(userId)) return {recorded: false, count: null};
      const count = await choices().recordFacilityChoice(userId, facility);
      return {recorded: Number.isInteger(count), count: Number.isInteger(count) ? count : null};
    },
    /** Counts one department applied to a search. Not recorded without health storage consent (DB decides). */
    async recordDepartmentChoice(session, body) {
      const userId = requireVerifiedUser(session);
      const key = validateDepartmentChoice(body);
      if (!await personalizationOn(userId)) return {recorded: false, count: null};
      const count = await choices().recordDepartmentChoice(userId, key);
      return {recorded: Number.isInteger(count), count: Number.isInteger(count) ? count : null};
    },
    /** What the user can see and delete in My info. */
    async listChoices(session) {
      const userId = requireVerifiedUser(session);
      const repo = choices();
      const facilities = (await repo.listFacilityChoices(userId)).map(({id, type, name, count}) => ({id, type, name, count}));
      // The department table may be missing until migration 007 runs; facilities still work.
      let departments = [], departmentsAvailable = true;
      try { departments = (await repo.listDepartmentChoices(userId)).map(({key, count}) => ({key, count})); }
      catch { departmentsAvailable = false; }
      // The screen may reorder only while personalization is on; the records stay visible either way.
      return {facilities, departments, departmentsAvailable, personalization: await personalizationOn(userId)};
    },
    async deleteChoices(session) {
      const userId = requireVerifiedUser(session);
      const repo = choices();
      const facilities = await repo.deleteFacilityChoices(userId);
      let departments = 0;
      try { departments = await repo.deleteDepartmentChoices(userId); } catch { /* table not migrated: nothing stored */ }
      return {facility_choices: facilities, department_choices: departments};
    },
    /**
     * For ranking: facility ID → count, only for facilities used at least FREQUENT_CHOICE_MIN times.
     * null for guests or when personalization is off.
     */
    async getFrequentFacilityCounts(session) {
      if (!session?.user?.id) return null;
      const userId = requireVerifiedUser(session);
      if (!await personalizationOn(userId)) return null;
      const rows = await choices().listFacilityChoices(userId);
      return new Map(rows.filter(row => row.count >= FREQUENT_CHOICE_MIN).map(row => [row.id, row.count]));
    },
    async getBehaviorStatements(session) {
      const userId = requireVerifiedUser(session);
      const setting = validateStoredSetting(await repository.readSettings(userId));
      const favorites = await repository.listFavorites(userId);
      const explicit = typeof repository.readExplicitSettings === 'function'
        ? await repository.readExplicitSettings(userId) : null;
      const statements = [];
      if (setting) {
        // Never label a DB/default distance value a direct user choice without evidence.
        if(explicit?.preference || (!explicit && setting.preference !== 'distance'))
          statements.push(statement(userId, BEHAVIOR_MODEL.sortOrder, setting.preference, setting.updated_at));
        if (setting.region) statements.push(statement(userId, BEHAVIOR_MODEL.searchRegion, setting.region, setting.updated_at));
        if(explicit?.personalization || (!explicit && setting.personalization_enabled === false))
          statements.push(statement(userId, BEHAVIOR_MODEL.personalization, setting.personalization_enabled ? 'on' : 'off', setting.updated_at));
      }
      for (const favorite of favorites) statements.push(statement(userId, BEHAVIOR_MODEL.favorite, favorite.id, favorite.created_at));
      return statements;
    },
    /**
     * Requested Team 2 contract: available preferences only.
     * applied is EMPTY until rankFacilities actually uses a criterion.
     * Use markAppliedPreferences() AFTER ranking for reasons.
     */
    async getPreferenceSignal(session) {
      if (!session?.user?.id) return null; // guest
      const userId = requireVerifiedUser(session);
      const setting = validateStoredSetting(await repository.readSettings(userId));
      if (setting?.personalization_enabled === false) return null;
      const favorites = await repository.listFavorites(userId);
      if (!setting && !favorites.length) return null;
      return {
        sort: setting?.preference ?? 'distance',
        region: setting?.region || null,
        favoriteIds: favorites.map(f => f.id),
        applied: [],
      };
    },
  });
}

/**
 * Called by Team 2 *after* ranking with actual applied conditions.
 * Never accept usage from a public request: these are ranking engine decisions.
 * `favoriteIdsUsed` must contain only IDs actually displayed/badged/tie-broken.
 */
export function markAppliedPreferences(signal, usage = {}) {
  if (signal === null) return null;
  const keys = Object.keys(usage);
  if (keys.some(k => !['sortUsed', 'regionUsed', 'favoriteIdsUsed'].includes(k))) throw new BehaviorValidationError('Unexpected usage field');
  const {sortUsed = false, regionUsed = false, favoriteIdsUsed = []} = usage;
  if (typeof sortUsed !== 'boolean' || typeof regionUsed !== 'boolean' || !Array.isArray(favoriteIdsUsed)) throw new BehaviorValidationError('Invalid usage');
  if (favoriteIdsUsed.some(id => typeof id !== 'string' || !signal.favoriteIds.includes(id))) throw new BehaviorValidationError('Favorite was not saved');
  const applied = [];
  if (sortUsed) applied.push({statement: 'sortOrder', reasonKey: `reason.sort.${signal.sort}`});
  if (regionUsed) {
    if (!signal.region) throw new BehaviorValidationError('Saved search region is absent');
    applied.push({statement: 'searchRegion', reasonKey: 'reason.region'});
  }
  if (favoriteIdsUsed.length) applied.push({statement: 'favorite', reasonKey: 'reason.favorite'});
  // Keep displayed favorite provenance scoped to the actually used IDs.
  return {...signal, applied, appliedFavoriteIds: [...new Set(favoriteIdsUsed)]};
}

/** Static, non-LLM reason; only statements in applied can produce text. */
export function buildPreferenceReason(signal, {facilityId = null} = {}) {
  if (signal === null) return null;
  const parts = [];
  const applied = Array.isArray(signal.applied) ? signal.applied : [];
  for (const item of applied) {
    if (item.statement === 'sortOrder' && item.reasonKey === `reason.sort.${signal.sort}` && SORT_REASONS[signal.sort]) parts.push(SORT_REASONS[signal.sort]);
    if (item.statement === 'searchRegion' && item.reasonKey === 'reason.region' && signal.region) parts.push(`저장한 지역(${signal.region}) 기준입니다`);
    if (item.statement === 'favorite' && item.reasonKey === 'reason.favorite' &&
        facilityId && (signal.appliedFavoriteIds ?? []).includes(facilityId) && signal.favoriteIds.includes(facilityId)) parts.push('즐겨찾기한 기관입니다');
  }
  if (!parts.length) return null;
  const message = parts.join('. ') + '.';
  if (message.length > REASON_MAX_LENGTH) throw new BehaviorValidationError('Reason exceeded length limit');
  return {ko: message};
}
