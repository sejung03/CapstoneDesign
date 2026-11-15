import {
  createBehaviorService, createMockBehaviorRepository,
  markAppliedPreferences, buildPreferenceReason,
} from '../lib/behavior/index.js';

const service = createBehaviorService({repository: createMockBehaviorRepository({now: () => '2026-01-01T00:00:00.000Z'})});
const session = {user: {id: '11111111-1111-4111-8111-111111111111'}}; // fake test account
await service.saveSettings(session, {region: '가상시 테스트동', preference: 'distance', personalization_enabled: true});
await service.saveFavorite(session, {favorite: true, facility: {
  id: 'test-facility-01', type: 'hospital', name: {ko: '가상 테스트 병원', en: 'Fictional Test Hospital'}, address: '가상시 테스트동',
}});
console.log('1. 명시적 진술:', JSON.stringify(await service.getBehaviorStatements(session), null, 2));
const signal = await service.getPreferenceSignal(session);
console.log('2. 사용 가능한 선호 신호:', JSON.stringify(signal, null, 2));
const applied = markAppliedPreferences(signal, {sortUsed: true, regionUsed: true, favoriteIdsUsed: ['test-facility-01']});
console.log('3. 실제 적용 이유:', buildPreferenceReason(applied, {facilityId: 'test-facility-01'}));
await service.disablePersonalization(session);
console.log('4. 개인화 OFF 신호:', await service.getPreferenceSignal(session));
await service.deleteAll(session);
console.log('5. 전체 삭제 후 설정/즐겨찾기:', await service.getSettings(session), await service.getFavorites(session));
