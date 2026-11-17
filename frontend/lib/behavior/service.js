import {BEHAVIOR_MODEL, REASON_MAX_LENGTH} from './model.js';
import {
  requireVerifiedUser, validateFavoriteMutation, validateSettingPatch,
  validateStoredSetting, BehaviorValidationError,
} from './validation.js';

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
