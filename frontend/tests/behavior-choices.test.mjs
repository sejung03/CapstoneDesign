import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHOICE_MODEL, DATA_POLICY, FACILITY_CHOICE_LIMIT, FREQUENT_CHOICE_MIN,
  BehaviorValidationError, validateFacilityChoice, validateDepartmentChoice,
  createMockBehaviorRepository, createBehaviorService, createBehaviorApi,
} from '../lib/behavior/index.js';
import {rankFacilities} from '../lib/care-ranking.mjs';
import {createCareHandler} from '../lib/care-engine-server.mjs';
import {normalizeChoices, orderedDepartments, choiceFacility, isChoiceDepartment} from '../choices.mjs';
import {departmentCatalog} from '../departments.mjs';

// All entries are FICTIONAL.
const userA = Object.freeze({user: {id: '11111111-1111-4111-8111-111111111111'}});
const userB = Object.freeze({user: {id: '22222222-2222-4222-8222-222222222222'}});
const facility = (id = 'test-id-01', type = 'hospital') => ({id, type, name: {ko: '가상 테스트 병원', en: 'Fictional Test Hospital'}});
const setup = (options = {}) => {
  const repository = createMockBehaviorRepository({now: () => '2026-01-01T00:00:00.000Z', ...options});
  return {repository, service: createBehaviorService({repository})};
};

test('choice model stores counts only, with the consent item that allows each', () => {
  assert.deepEqual(Object.keys(CHOICE_MODEL), ['facilityChoice', 'departmentChoice']);
  assert.equal(CHOICE_MODEL.facilityChoice.consent, 'account');
  assert.equal(CHOICE_MODEL.departmentChoice.consent, 'healthStorage');
  assert.match(DATA_POLICY, /건강정보 저장 동의가 있을 때만/);
  assert.equal(FREQUENT_CHOICE_MIN, 2);
});

test('facility choice accepts only id, type and name; department choice only known search keys', () => {
  assert.deepEqual(validateFacilityChoice({facility: facility()}), facility());
  for (const bad of [
    {facility: {...facility(), address: '가상시'}}, {facility: {...facility(), phone: '000'}},
    {facility: facility(), user_id: userA.user.id}, {facility: {...facility(), id: 'bad id'}}, {},
  ]) assert.throws(() => validateFacilityChoice(bad), BehaviorValidationError);
  assert.equal(validateDepartmentChoice({department: 'internal'}), 'internal');
  for (const bad of [{department: 'pharmacy'}, {department: 'all'}, {department: '두통'}, {department: 'internal', symptom: 'x'}])
    assert.throws(() => validateDepartmentChoice(bad), BehaviorValidationError);
});

test('counts add up per user and are listed most used first', async () => {
  const {service} = setup();
  await service.recordFacilityChoice(userA, {facility: facility('a')});
  await service.recordFacilityChoice(userA, {facility: facility('b')});
  assert.deepEqual(await service.recordFacilityChoice(userA, {facility: facility('b')}), {recorded: true, count: 2});
  await service.recordDepartmentChoice(userA, {department: 'ent'});
  const list = await service.listChoices(userA);
  assert.deepEqual(list.facilities.map(f => [f.id, f.count]), [['b', 2], ['a', 1]]);
  assert.deepEqual(list.departments, [{key: 'ent', count: 1}]);
  assert.deepEqual((await service.listChoices(userB)).facilities, []);
  assert.deepEqual([...await service.getFrequentFacilityCounts(userA)], [['b', 2]]);
  assert.equal(await service.getFrequentFacilityCounts({}), null);
});

test('department counts need health storage consent; facility counts do not', async () => {
  const {service} = setup({departmentConsent: () => false});
  assert.deepEqual(await service.recordDepartmentChoice(userA, {department: 'internal'}), {recorded: false, count: null});
  assert.deepEqual(await service.recordFacilityChoice(userA, {facility: facility()}), {recorded: true, count: 1});
  assert.deepEqual((await service.listChoices(userA)).departments, []);
});

test('personalization off stops counting and stops ranking use, but records stay visible', async () => {
  const {service} = setup();
  await service.recordFacilityChoice(userA, {facility: facility()});
  await service.recordFacilityChoice(userA, {facility: facility()});
  await service.saveSettings(userA, {personalization_enabled: false});
  assert.deepEqual(await service.recordFacilityChoice(userA, {facility: facility()}), {recorded: false, count: null});
  assert.deepEqual(await service.recordDepartmentChoice(userA, {department: 'internal'}), {recorded: false, count: null});
  assert.equal(await service.getFrequentFacilityCounts(userA), null);
  const list = await service.listChoices(userA);
  assert.equal(list.personalization, false);
  assert.equal(list.facilities[0].count, 2);
});

test('only the most recently counted facilities are kept', async () => {
  let clock = 0;
  const repository = createMockBehaviorRepository({now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString()});
  const service = createBehaviorService({repository});
  for (let i = 0; i <= FACILITY_CHOICE_LIMIT; i++) await service.recordFacilityChoice(userA, {facility: facility('f' + i)});
  const ids = (await service.listChoices(userA)).facilities.map(f => f.id);
  assert.equal(ids.length, FACILITY_CHOICE_LIMIT);
  assert.ok(!ids.includes('f0'));
});

test('deleting choices removes both kinds for this user only; full behavior delete keeps department counts', async () => {
  const {service} = setup();
  await service.recordFacilityChoice(userA, {facility: facility()});
  await service.recordDepartmentChoice(userA, {department: 'internal'});
  await service.recordFacilityChoice(userB, {facility: facility()});
  assert.deepEqual(await service.deleteChoices(userA), {facility_choices: 1, department_choices: 1});
  assert.deepEqual((await service.listChoices(userA)).facilities, []);
  assert.equal((await service.listChoices(userB)).facilities.length, 1);
  await service.recordFacilityChoice(userA, {facility: facility()});
  await service.recordDepartmentChoice(userA, {department: 'ent'});
  assert.deepEqual(await service.deleteAll(userA), {favorites: 0, search_settings: 0, facility_choices: 1});
  assert.deepEqual((await service.listChoices(userA)).departments, [{key: 'ent', count: 1}]);
});

test('choice API requires login and same origin, and never takes a user ID from the body', async () => {
  const repository = createMockBehaviorRepository();
  const handle = createBehaviorApi({repository, resolveSession: async request => request.headers.get('x-test-user') === 'a' ? userA : null});
  const req = (action, method, body, user = 'a', origin = 'http://localhost') => new Request(`http://localhost/api/behavior/${action}`, {
    method, headers: {origin, 'content-type': 'application/json', ...(user ? {'x-test-user': user} : {})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  assert.equal((await handle(req('facility-choice', 'POST', {facility: facility()}, null), 'facility-choice')).status, 401);
  assert.equal((await handle(req('facility-choice', 'POST', {facility: facility()}, 'a', 'http://evil.example'), 'facility-choice')).status, 403);
  assert.equal((await handle(req('facility-choice', 'POST', {facility: facility(), user_id: userB.user.id}), 'facility-choice')).status, 400);
  assert.deepEqual(await (await handle(req('facility-choice', 'POST', {facility: facility()}), 'facility-choice')).json(), {recorded: true, count: 1});
  assert.equal((await handle(req('department-choice', 'POST', {department: 'internal'}), 'department-choice')).status, 200);
  const listed = await (await handle(req('choices', 'GET'), 'choices')).json();
  assert.equal(listed.facilities[0].count, 1);
  assert.deepEqual(listed.departments, [{key: 'internal', count: 1}]);
  assert.deepEqual(await (await handle(req('choices', 'DELETE'), 'choices')).json(), {deleted: {facility_choices: 1, department_choices: 1}});
});

const candidates = items => ({resultSetId: 'results-1', items});
const open = (facilityId, displayOrder, department, departments = [department]) => ({facilityId, displayOrder, department, departments, status: 'open', type: 'hospital'});

test('frequent places move up only inside their department group', () => {
  const items = [open('near-ent', 0, 'ent'), open('far-internal', 1, 'internal'), open('mid-internal', 2, 'internal'), open('also-internal', 3, 'family', ['family', 'internal'])];
  const counts = new Map([['mid-internal', 3], ['near-ent', 9], ['also-internal', 5]]);
  const r = rankFacilities({search: {department: 'internal', type: 'hospital'}, candidates: candidates(items)}, {frequentCounts: counts});
  // group 0 (internal is the main department): mid-internal (3 times) before far-internal; group 1 after it even with 5 times.
  assert.deepEqual(r.items.map(i => i.facilityId), ['mid-internal', 'far-internal', 'also-internal']);
  assert.match(r.items[0].reason.ko, /3번 한 곳/);
  assert.doesNotMatch(r.items[1].reason.ko, /번 한 곳/);
  // A frequently used place in another department is not promoted ahead of matching ones.
  assert.ok(!r.items.some(i => i.facilityId === 'near-ent'));
});

test('without a department (pharmacies) frequent places come first by count, others keep their order', () => {
  const items = [open('p1', 0, 'pharmacy'), open('p2', 1, 'pharmacy'), open('p3', 2, 'pharmacy')];
  const r = rankFacilities({search: {department: 'pharmacy', type: 'pharmacy'}, candidates: candidates(items)}, {frequentCounts: new Map([['p3', 2], ['p2', 4]])});
  assert.deepEqual(r.items.map(i => i.facilityId), ['p2', 'p3']);
  assert.deepEqual(rankFacilities({search: {department: 'pharmacy', type: 'pharmacy'}, candidates: candidates(items)}).items, []);
});

test('same-group results with a frequent place now have a reason to reorder', () => {
  const items = [open('a', 0, 'internal'), open('b', 1, 'internal')];
  assert.deepEqual(rankFacilities({search: {department: 'internal'}, candidates: candidates(items)}).items, []);
  const r = rankFacilities({search: {department: 'internal'}, candidates: candidates(items)}, {frequentCounts: new Map([['b', 2]])});
  assert.deepEqual(r.items.map(i => i.facilityId), ['b', 'a']);
});

test('care handler reads counts from the server dependency, never from the request body', async () => {
  const items = [open('p1', 0, 'pharmacy'), open('p2', 1, 'pharmacy')];
  const body = {reason: 'recommendations', search: {department: 'pharmacy', type: 'pharmacy'}, candidates: candidates(items), frequentCounts: {p1: 99}};
  const request = () => new Request('http://localhost/api/care', {method: 'POST', headers: {origin: 'http://localhost', 'content-type': 'application/json'}, body: JSON.stringify(body)});
  const guest = createCareHandler({sameOrigin: () => true});
  assert.deepEqual((await (await guest(request())).json()).items, []);
  const member = createCareHandler({sameOrigin: () => true, frequentCounts: async () => new Map([['p2', 2]])});
  assert.deepEqual((await (await member(request())).json()).items.map(i => i.facilityId), ['p2']);
  const broken = createCareHandler({sameOrigin: () => true, frequentCounts: async () => { throw new Error('db down'); }});
  assert.equal((await broken(request())).status, 200);
});

test('browser helpers send no address and reorder departments only while personalization is on', () => {
  assert.deepEqual(choiceFacility({...facility(), address: '가상시', phone: '000'}), facility());
  assert.ok(!isChoiceDepartment('pharmacy') && isChoiceDepartment('internal'));
  const data = normalizeChoices({facilities: [{...facility(), count: 2}], departments: [{key: 'ent', count: 3}, {key: 'internal', count: 1}]});
  assert.deepEqual(orderedDepartments(departmentCatalog, data).slice(0, 2).map(d => d.key), ['ent', 'internal']);
  assert.equal(orderedDepartments(departmentCatalog, {...data, personalization: false}), departmentCatalog);
  assert.throws(() => normalizeChoices({facilities: [], departments: [{key: 'pharmacy', count: 1}]}));
  assert.throws(() => normalizeChoices({facilities: [{...facility(), count: 0}], departments: []}));
});
