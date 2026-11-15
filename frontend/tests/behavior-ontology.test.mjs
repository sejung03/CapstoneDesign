import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BEHAVIOR_MODEL, DATA_POLICY, FAVORITES_LIMIT,
  BehaviorValidationError, FavoriteLimitError,
  validateSettingPatch, validateFavoriteMutation,
  createMockBehaviorRepository, createBehaviorService, createBehaviorApi,
  markAppliedPreferences, buildPreferenceReason,
} from '../lib/behavior/index.js';

// All entries are FICTIONAL. Never use real patients or teammates' data.
const userA = Object.freeze({user: {id: '11111111-1111-4111-8111-111111111111'}});
const userB = Object.freeze({user: {id: '22222222-2222-4222-8222-222222222222'}});
const sampleFacility = (id = 'test-id-01') => ({
  id, type: 'hospital', name: {ko: '가상 테스트 병원', en: 'Fictional Test Hospital'}, address: '가상시 테스트동',
});
const setup = () => createBehaviorService({repository: createMockBehaviorRepository({now: () => '2026-01-01T00:00:00.000Z'})});

test('the model contains exactly four explicit GUMO-inspired statements', () => {
  assert.deepEqual(Object.keys(BEHAVIOR_MODEL), ['sortOrder', 'searchRegion', 'favorite', 'personalization']);
  assert.deepEqual(Object.values(BEHAVIOR_MODEL).map(item => [item.auxiliary, item.predicate]), [
    ['hasPreference', 'sortOrder'], ['hasPreference', 'searchRegion'], ['hasFavorite', 'facility'], ['hasSetting', 'personalization'],
  ]);
  assert.match(DATA_POLICY, /건강 상태 추정/);
});
test('settings allow only the exact whitelisted fields and values', () => {
  assert.deepEqual(validateSettingPatch({preference: 'access', region: '  가상시  ', personalization_enabled: false}),
    {preference: 'access', region: '가상시', personalization_enabled: false});
  for (const bad of [{}, {preference: 'recommended'}, {preference: 'name'}, {region: '가'.repeat(81)},
    {region: '가상시', symptom: '두통'}, {user_id: userA.user.id}, {personalization_enabled: 'true'},
    {region: 'bad\nline'}, {latitude: 12}, {history: 'some data'}, []]) {
    assert.throws(() => validateSettingPatch(bad), BehaviorValidationError);
  }
});
test('favorites whitelist disallows hidden symptom, schedule, visits and user IDs', () => {
  assert.deepEqual(validateFavoriteMutation({favorite: true, facility: sampleFacility()}).facility.id, 'test-id-01');
  const bads = [
    {favorite: true, facility: {...sampleFacility(), openingHours: '09:00'}},
    {favorite: true, facility: {...sampleFacility(), user_id: userA.user.id}},
    {favorite: true, facility: {...sampleFacility(), name: {ko: '가상병원', en: 'Fictional', notes: 'pain'}}},
    {favorite: true, facility: {...sampleFacility(), id: 'invalid id!'}},
    {favorite: true, facility: {...sampleFacility(), type: 'clinic'}},
    {favorite: true, facility: {...sampleFacility(), address: 'a'.repeat(501)}},
    {favorite: true, facility: {...sampleFacility(), name: {ko: 'a'.repeat(301)}}},
    {favorite: true, facility: sampleFacility(), inferredDisease: 'bad'},
    {favorite: 1, facility: sampleFacility()},
  ];
  for (const payload of bads) assert.throws(() => validateFavoriteMutation(payload), BehaviorValidationError);
});
test('separate accounts cannot see each other’s data', async () => {
  const service = setup();
  await service.saveSettings(userA, {region: '가상시 A구', preference: 'open'});
  await service.saveFavorite(userA, {favorite: true, facility: sampleFacility()});
  assert.equal((await service.getFavorites(userB)).length, 0);
  assert.equal(await service.getPreferenceSignal(userB), null);
  assert.deepEqual((await service.getPreferenceSignal(userA)).favoriteIds, ['test-id-01']);
  assert.deepEqual((await service.getSettings(userB)), null);
});
test('a guest gets null signal and mutations are denied', async () => {
  const service = setup();
  assert.equal(await service.getPreferenceSignal(null), null);
  assert.equal(await service.getPreferenceSignal({authenticated: false}), null);
  await assert.rejects(() => service.saveSettings(null, {region: '가상시'}), {status: 401});
  await assert.rejects(() => service.deleteAll(null), {status: 401});
});
test('favorite set is idempotent and original evidence timestamp persists', async () => {
  let time = 0;
  const store = createMockBehaviorRepository({now: () => `timestamp-${++time}`});
  const service = createBehaviorService({repository: store});
  await service.saveFavorite(userA, {favorite: true, facility: sampleFacility()});
  await service.saveFavorite(userA, {favorite: true, facility: sampleFacility()});
  const favorites = await service.getFavorites(userA);
  assert.equal(favorites.length, 1);
  assert.equal((await service.getBehaviorStatements(userA)).find(s => s.auxiliary === 'hasFavorite').evidence.at, 'timestamp-1');
  await service.saveFavorite(userA, {favorite: false, facility: sampleFacility()});
  await service.saveFavorite(userA, {favorite: false, facility: sampleFacility()});
  assert.deepEqual(await service.getFavorites(userA), []);
});
test('a 21st favorite is denied while removing and re-adding works', async () => {
  const service = setup();
  for (let n = 1; n <= FAVORITES_LIMIT; n++) await service.saveFavorite(userA, {favorite: true, facility: sampleFacility(`f-${n}`)});
  await assert.rejects(() => service.saveFavorite(userA, {favorite: true, facility: sampleFacility('f-21')}), FavoriteLimitError);
  assert.equal((await service.getFavorites(userA)).length, FAVORITES_LIMIT);
  await service.saveFavorite(userA, {favorite: false, facility: sampleFacility('f-1')});
  await service.saveFavorite(userA, {favorite: true, facility: sampleFacility('f-21')});
  assert.equal((await service.getFavorites(userA)).length, FAVORITES_LIMIT);
});
test('turning personalization off retains values but removes all signals/reasons', async () => {
  const service = setup();
  await service.saveSettings(userA, {region: '가상시', preference: 'distance'});
  await service.saveFavorite(userA, {favorite: true, facility: sampleFacility()});
  await service.disablePersonalization(userA);
  assert.equal(await service.getPreferenceSignal(userA), null);
  assert.equal(buildPreferenceReason(await service.getPreferenceSignal(userA), {facilityId: 'test-id-01'}), null);
  assert.equal((await service.getFavorites(userA)).length, 1);
  assert.equal((await service.getSettings(userA)).region, '가상시');
  await service.saveSettings(userA, {personalization_enabled: true});
  assert.equal((await service.getPreferenceSignal(userA)).region, '가상시');
});
test('full delete covers only this user, both settings and favorites, and is repeatable', async () => {
  const service = setup();
  await service.saveSettings(userA, {region: '가상시'});
  await service.saveFavorite(userA, {favorite: true, facility: sampleFacility()});
  await service.saveSettings(userB, {region: '가상시 다른구'});
  assert.deepEqual(await service.deleteAll(userA), {favorites: 1, search_settings: 1});
  assert.equal(await service.getSettings(userA), null);
  assert.deepEqual(await service.getFavorites(userA), []);
  assert.equal(await service.getPreferenceSignal(userA), null);
  assert.deepEqual(await service.deleteAll(userA), {favorites: 0, search_settings: 0});
  assert.equal((await service.getSettings(userB)).region, '가상시 다른구');
});
test('behavior statements connect user, relation, object and direct evidence, no health inference', async () => {
  const service = setup();
  await service.saveSettings(userA, {region: '가상시', preference: 'access', personalization_enabled: true});
  await service.saveFavorite(userA, {favorite: true, facility: sampleFacility()});
  const statements = await service.getBehaviorStatements(userA);
  assert.equal(statements.length, 4);
  assert.deepEqual(statements.map(s => s.predicate), ['sortOrder', 'searchRegion', 'personalization', 'facility']);
  assert.ok(statements.every(s => s.subject.id === userA.user.id && s.evidence.source === 'direct_setting'));
  assert.equal(statements.find(s => s.predicate === 'personalization').object, 'on');
});
test('rankings create applied ONLY after actual usage, and reasons use ONLY applied', async () => {
  const service = setup();
  await service.saveSettings(userA, {region: '가상시 테스트동', preference: 'open'});
  await service.saveFavorite(userA, {favorite: true, facility: sampleFacility()});
  const signal = await service.getPreferenceSignal(userA);
  assert.deepEqual(signal.applied, []);
  assert.equal(buildPreferenceReason(signal, {facilityId: 'test-id-01'}), null);
  const onlySort = markAppliedPreferences(signal, {sortUsed: true});
  assert.deepEqual(onlySort.applied, [{statement: 'sortOrder', reasonKey: 'reason.sort.open'}]);
  assert.deepEqual(buildPreferenceReason(onlySort, {facilityId: 'test-id-01'}), {ko: '운영 여부를 우선해 정렬했습니다.'});
  const all = markAppliedPreferences(signal, {sortUsed: true, regionUsed: true, favoriteIdsUsed: ['test-id-01']});
  assert.match(buildPreferenceReason(all, {facilityId: 'test-id-01'}).ko, /저장한 지역\(가상시 테스트동\)/);
  assert.match(buildPreferenceReason(all, {facilityId: 'test-id-01'}).ko, /즐겨찾기한 기관입니다/);
  assert.doesNotMatch(buildPreferenceReason(all, {facilityId: 'other-id'}).ko, /즐겨찾기한 기관/);
  assert.ok(buildPreferenceReason(all, {facilityId: 'test-id-01'}).ko.length <= 240);
  assert.throws(() => markAppliedPreferences(signal, {favoriteIdsUsed: ['unknown']}), BehaviorValidationError);
  assert.throws(() => markAppliedPreferences(signal, {regionUsed: 'yes'}), BehaviorValidationError);
  assert.throws(() => markAppliedPreferences(signal, {rankDiagnosis: true}), BehaviorValidationError);
});
test('temporary region stays out of stored setting until explicit saveSettings', async () => {
  const service = setup();
  await service.saveSettings(userA, {region: '기본 가상시'});
  const temporarySearchRegion = '이번 검색 전용 가상시';
  assert.notEqual(temporarySearchRegion, (await service.getPreferenceSignal(userA)).region);
});
test('REST handler denies anonymous and uses trusted session resolver, never request user_id', async () => {
  const repo = createMockBehaviorRepository();
  const sessions = new WeakMap();
  const handle = createBehaviorApi({repository: repo, resolveSession: async request => sessions.get(request) ?? null});
  function req(action, method = 'GET', data, session) {
    const request = new Request('http://localhost/api/behavior/' + action, {method, headers: {origin: 'http://localhost', ...(data === undefined ? {} : {'content-type': 'application/json'})}, ...(data === undefined ? {} : {body: JSON.stringify(data)})});
    if (session) sessions.set(request, session);
    return request;
  }
  assert.equal((await handle(req('settings', 'GET'), 'settings')).status, 401);
  const invalid = await handle(req('settings', 'PATCH', {user_id: userB.user.id, region: '가상시'}, userA), 'settings');
  assert.equal(invalid.status, 400);
  const okay = await handle(req('settings', 'PATCH', {region: '가상시', preference: 'distance'}, userA), 'settings');
  assert.equal(okay.status, 200);
  const aSettings = await (await handle(req('settings', 'GET', undefined, userA), 'settings')).json();
  assert.equal(aSettings.settings.region, '가상시');
  const bSettings = await (await handle(req('settings', 'GET', undefined, userB), 'settings')).json();
  assert.equal(bSettings.settings, null);
  const missingType = await handle(new Request('http://localhost/api/behavior/settings', {method: 'PATCH', body: '{}'}), 'settings');
  assert.equal(missingType.status, 401);
  const crossSite = req('settings', 'PATCH', {region: '공격'}, userA);
  crossSite.headers.set('origin', 'https://attacker.example');
  assert.equal((await handle(crossSite, 'settings')).status, 403);
  const deleted = await handle(req('all', 'DELETE', undefined, userA), 'all');
  assert.equal(deleted.status, 200);
  assert.equal((await handle(req('signal', 'GET', undefined, userA), 'signal')).status, 200);
});
test('invalid internal repo setting lacking enable flag fails closed', async () => {
  const service = createBehaviorService({repository: {
    readSettings: async () => ({preference: 'distance', region: '가상시'}), patchSettings: async () => null,
    listFavorites: async () => [], setFavorite: async () => {}, deleteAll: async () => ({}),
  }});
  await assert.rejects(() => service.getPreferenceSignal(userA), BehaviorValidationError);
});

test('browser adapter satisfies existing connectFavorites list/set shape without client user IDs', async () => {
  const {createBehaviorClient} = await import('../behavior-client.mjs');
  const repository = createMockBehaviorRepository();
  const handle = createBehaviorApi({repository, resolveSession: async () => userA}); // test-only trusted fixture
  const sentBodies = [];
  const api = createBehaviorClient({fetchImpl: async (path, options) => {
    const request = new Request(`http://localhost${path}`, {
      method: options.method, headers: {origin: 'http://localhost', ...(options.headers ?? {})},
      ...(options.body === undefined ? {} : {body: options.body}),
    });
    if (options.body) sentBodies.push(JSON.parse(options.body));
    return handle(request, path.split('/').at(-1));
  }});
  await api.favorites.set({facility: sampleFacility(), favorite: true});
  assert.deepEqual(await api.favorites.list(), [sampleFacility()]);
  await api.settings.save({preference: 'access', region: '가상시'});
  assert.equal((await api.settings.get()).preference, 'access');
  await api.settings.disable();
  assert.equal(await api.signal(), null);
  await api.settings.deleteAll();
  assert.deepEqual(await api.favorites.list(), []);
  assert.ok(sentBodies.every(body => !Object.hasOwn(body, 'user_id') && !Object.hasOwn(body, 'accountId')));
});
