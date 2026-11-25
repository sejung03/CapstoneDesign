# 행동 온톨로지: 명시적 선호 모델 (DB 연결 전 구현본)

> **정책**: 사용자가 저장한 설정과, 사용자가 길찾기·전화번호 복사를 한 기관 및 검색에 적용한 진료과의 **횟수만** 최소로 저장하고, 건강 상태 추정이나 다른 추천 목적에 재사용하지 않는다. 진료과 횟수는 건강정보 저장 동의가 있을 때만 저장한다. (2026-11-25 변경, §9)
>
> 아래 §1~§8은 처음 설계(명시적 선호 4개만 저장) 기준입니다. "조회/클릭 기록·길찾기 기관·진료과 추천 로그는 수집하지 않는다"는 문장은 §9의 횟수 기록으로 바뀌었습니다. 날짜별 이벤트 로그는 지금도 두지 않습니다.
>
> **상태**: 4개 항목 모델·허용목록·선호 신호·이유 문구와 **개발 전용 모의 API/프론트 화면 연결까지 구현**. 실제 로그인·Supabase DB·팀원 2의 순위 알고리즘은 미연결입니다.

## 1. 범위 및 용어

GUMO(General User Model Ontology)에서 착안한 명시적 선호 **진술 모델**이며 GUMO 규격 그대로 또는 OWL/RDF 온톨로지를 구현한 것은 아닙니다. GUMO의 `subject/auxiliary/predicate/range/object` 관점으로, 사용자와 사용자가 **직접 저장한** 정렬 기준·지역·즐겨찾기·개인화 ON/OFF만 연결합니다. `hasFavorite`, `hasSetting`은 팀 확장 이름입니다. 추론·증상·검색어·대화·조회/클릭 기록·길찾기 기관·진료과 추천 로그는 **수집하거나 저장하지 않습니다**. 즐겨찾기 기관 자체로 건강 상태를 짐작할 수 있으므로 개인정보 민감도를 높게 다룹니다.

관련 문헌: [Heckmann 외, UserML/GUMO](https://homes.cs.aau.dk/~dolog/dasum/DASUM05.Heckmann.pdf).

| 주체 | 관계 | 술어 | 허용 범위 | DB 대응 | 근거 | 이유 키 |
| --- | --- | --- | --- | --- | --- | --- |
| 사용자 | `hasPreference` | `sortOrder` | `distance`, `open`, `access` | `app.search_setting.preference` | 직접 저장, `updated_at` | `reason.sort.<value>` |
| 사용자 | `hasPreference` | `searchRegion` | 최대 80자 지역명 | `app.search_setting.region` | 직접 저장, `updated_at` | `reason.region` |
| 사용자 | `hasFavorite` | `facility` | ID `[A-Za-z0-9_:.-]` 1~128자 | `app.favorite.facility_id` | 직접 저장, `created_at` | `reason.favorite` |
| 사용자 | `hasSetting` | `personalization` | `on`, `off` | **요청 중인 컬럼** `app.search_setting.personalization_enabled` | 직접 저장, `updated_at` | 없음 |

현재 DB 스키마에 `personalization_enabled`가 없으면 DB 연동 시 읽기 실패하게 설계합니다. 묵시적으로 ON이라고 처리하지 않습니다. 계정에 설정 행이 없는 상태는 `distance` 기본 정렬값만 표시할 수 있지만, **그 사실로 사용자가 직접 선호를 선택했다고 주장하지 않습니다**. `updated_at`은 행 전체의 최근 수정 시각이며 개별 필드 저장 시각은 분리할 수 없습니다(현재 DB 계약의 한계).

## 2. 생성된 파일

| 파일 | 역할 |
| --- | --- |
| `lib/behavior/model.js` | 온톨로지 4개 진술과 허용값·정책·상수 |
| `lib/behavior/validation.js` | 저장 허용목록(추가 필드 거부, 한도·형식 검증), 오류 |
| `lib/behavior/mock-repository.js` | 가짜 계정의 메모리 저장소. 외부 DB 변경 없음 |
| `lib/behavior/service.js` | 진술 생성, 저장/조회, 개인화 ON/OFF, 전체 삭제, 선호 신호·이유 |
| `lib/behavior/api.js` | 인증 검사, JSON 저장 허용목록 검사, HTTP 상태·요청 크기·Origin 검사 |
| `lib/behavior/index.js` | 서버 모듈 export |
| `behavior-client.mjs` | **나중에 라우트가 완성되면** `connectFavorites`와 연결할 브라우저 HTTP 어댑터 |
| `tests/behavior-ontology.test.mjs` | 가짜 데이터 15개 회귀 테스트 |

서버 코드 `lib/behavior/`를 React 클라이언트 번들에 import하지 않습니다. `behavior-client.mjs`만 브라우저에 둡니다.

## 3. DB 없이 바로 실행하는 예시

`frontend`에서:

```bash
node --test tests/behavior-ontology.test.mjs
node scripts/demo-behavior.mjs
```

```js
import {
  createBehaviorService, createMockBehaviorRepository,
  markAppliedPreferences, buildPreferenceReason,
} from './lib/behavior/index.js';

const service = createBehaviorService({repository: createMockBehaviorRepository()});
// 아래는 테스트 전용 "검증됐다고 가정한" 가짜 세션. 브라우저 입력으로 만들면 안 됨.
const session = {user: {id: '11111111-1111-4111-8111-111111111111'}};
await service.saveSettings(session, {region: '가상시 테스트동', preference: 'distance', personalization_enabled: true});
await service.saveFavorite(session, {favorite: true, facility: {
  id: 'facility-test-1', type: 'hospital',
  name: {ko: '가상 테스트 병원', en: 'Fictional Hospital'}, address: '가상시 테스트동',
}});

const signal = await service.getPreferenceSignal(session);
// {sort: 'distance', region: '가상시 테스트동', favoriteIds: ['facility-test-1'], applied: []}
// "실제로" 검색지역·정렬이 적용되고 즐겨찾기 배지가 표시된 경우만 명시:
const applied = markAppliedPreferences(signal, {
  sortUsed: true, regionUsed: true, favoriteIdsUsed: ['facility-test-1'],
});
const reason = buildPreferenceReason(applied, {facilityId: 'facility-test-1'});
// {ko:'거리순으로 정렬했습니다. 저장한 지역(가상시 테스트동) 기준입니다. 즐겨찾기한 기관입니다.'}
await service.disablePersonalization(session);
// await service.getPreferenceSignal(session) === null; 값은 그대로 저장
await service.deleteAll(session);
// app.favorite·app.search_setting에 대응하는 모의 데이터 모두 삭제
```

## 4. 팀원 2 — 순위·이유 문구 인터페이스

1. `await service.getPreferenceSignal(verifiedSession)` → `{sort, region, favoriteIds, applied: []}` 또는 `null`. `session`은 로그인 서버 세션에서만 생성합니다.
2. 팀원 2의 `rankFacilities`가 **진료과 적합성 우선**, 이후 정렬 기준 `distance/open/access`를 실제 사용 가능한 데이터가 있을 때만 적용합니다. 동점 조건에서만 즐겨찾기를 우대하고, 선택된 즐겨찾기에는 배지를 표시할 수 있습니다. 최종 동점은 거리순으로 처리합니다. 근거가 없으면 특정 기관이 운영 중이거나 접근성이 좋다고 가정하지 않습니다.
3. 사용한 항목만 `markAppliedPreferences(signal, {sortUsed, regionUsed, favoriteIdsUsed})`로 표시합니다. 검색에서 임시 선택한 지역은 저장된 지역 사용 근거로 넣지 않습니다. 즐겨찾기 ID 역시 실제 표시하거나 동점 비교에 반영한 후보만 전달합니다.
4. 각 후보에 `buildPreferenceReason(appliedSignal, {facilityId})` 적용. 반환값은 `{ko: '...'}` 또는 `null`, 240자 이하 템플릿이며 LLM 사용 안 함. `applied`에 없는 것은 설명하지 않습니다. 의료적 추천 이유는 별개 데이터입니다. 최종 `recommendations.mjs`의 `reason.ko` 제한(240자)과 합칠 경우 **합친 최종 길이도 검증**해야 합니다.

**중요:** `getPreferenceSignal` 자체는 어떤 검색 화면/후보에 적용됐는지 알 수 없으므로 `applied`를 빈 배열로 반환합니다. 이는 제안된 인터페이스에 대한 의도적인 안전한 해석입니다. `rankFacilities` 결과가 나온 다음 실제 사용을 확정해야 정확한 근거를 표시할 수 있습니다.

## 5. 팀원 3 — 허용목록과 저장·삭제/API

| 동작 | HTTP 공통 계약 (핸들러 수준) | 입력/응답 |
| --- | --- | --- |
| 읽기 | `GET /api/behavior/settings` | `{settings}` (행 없으면 null) |
| 저장 | `PATCH /api/behavior/settings` | `{region?, preference?, personalization_enabled?}` → `{settings}` |
| 즐겨찾기 읽기 | `GET /api/behavior/favorites` | `{items:[{id,type,name:{ko,en},address}]}` |
| 즐겨찾기 설정 | `PUT /api/behavior/favorites` | `{facility:{id,type,name:{ko,en},address}, favorite:boolean}` → `{items}` |
| 신호 | `GET /api/behavior/signal` | `{signal}` 또는 `{signal:null}` |
| 진술 조회 | `GET /api/behavior/statements` | `{statements:[{subject,auxiliary,predicate,range,object,evidence,reasonKey}]}` |
| 전체 삭제 | `DELETE /api/behavior/all` | `{deleted: {favorites:N, search_settings:N}}` (모의 구현) |

실제 **인증 기반** `/api/behavior` Next.js 라우트는 아직 생성하지 않았습니다. 단, **개발 모드에서만 실행되는 별도의** `/api/behavior-demo` 라우트는 추가되어 있습니다. 운영 모드에서는 404를 반환합니다. 이 HTTP 계약은 `createBehaviorApi({repository,resolveSession})`로 독립 테스트가 가능한 상태입니다. 오프라인에서는 모의 저장소를 주입합니다.

```js
// 나중에 로그인 세션과 RLS 테이블이 연결되었을 때 서버 전용 Route Handler에서 호출할 예
const handler = createBehaviorApi({
  repository: repositoryCreatedWithThisRequestAuthenticatedSupabaseClient,
  resolveSession: async () => verifiedSessionFromThisRequest,
});
return handler(request, 'settings');
```

`resolveSession`은 쿠키/토큰을 서버에서 검증해야 하며 요청 JSON에 포함된 `user_id`, UI `scope`, 클라이언트에서 임의 전달한 `accountId`는 **사용하지 않습니다**. 위 예시의 변수는 자리표시자이며 인증 우회용 구현이 아닙니다. Mutating 요청은 같은 출처 `Origin`을 요구합니다. HTTP 인증 실패 401, 허용값 외 필드 400, 즐겨찾기 21개째 409, 위조 출처 403입니다. 몸체 최대 4096바이트. 생산 환경의 추가 rate-limit 등은 서버 담당과 조율하세요.

브라우저 쪽 기존 어댑터는 아래처럼 연결 가능합니다(라우트 구현 **이후**):

```js
import {connectFavorites} from './care-client.mjs';
import {createBehaviorClient} from './behavior-client.mjs';
const behavior = createBehaviorClient();
await connectFavorites(behavior.favorites, {scope: 'account:'+trustedAccountScope});
// 로그아웃/계정 변경 시: await connectFavorites(null, {scope:'guest'});
// 반드시 로그인 확인 후에만 연결하세요. scope는 인증 증명이 아닙니다.
// 기본 지역은 "기본 지역으로 저장" 클릭할 때만:
await behavior.settings.save({region: '가상시 테스트동'});
// 개인화 OFF: await behavior.settings.disable(); (저장한 값 유지)
// 전체 삭제(별도 확인 UI 후): await behavior.settings.deleteAll();
```

## 6. DB 담당에게 연결 전 요청할 사항

- `app.search_setting.personalization_enabled boolean default true` 컬럼 추가 및 로그인 사용자별 RLS 검증. 현재 코드에서 DB 스키마 변경 SQL을 실행하거나 새 컬럼을 만들지 않습니다.
- `app.favorite`는 (user_id,facility_id) 유일성, 최대 20건 제한을 **DB에서도 강제**해야 동시 요청 시 21번째가 들어가지 않습니다. 가짜 저장소는 단일 프로세스 안에서만 보장합니다.
- `search_setting`에는 user_id(PK), region(80), preference(distance/open/access), updated_at; `favorite`에는 user_id, facility_id, facility_type, name_ko, name_en, address, created_at이 필요합니다. SQL은 DB 담당과 협의한 뒤 적용합니다.
- **RLS**: `auth.uid()`와 `user_id` 일치 조건이 SELECT/INSERT/UPDATE/DELETE에서 강제되는지 확인합니다. `service-role`/secret 키로 일반 사용자 CRUD를 수행하지 않습니다. [Supabase RLS 공식 문서](https://supabase.com/docs/guides/database/postgres/row-level-security), [Supabase SSR 세션 가이드](https://supabase.com/docs/guides/auth/server-side).
- 실 DB에서 두 테이블을 **원자적으로 전체 삭제**하려면 DB 담당과 트랜잭션/RPC 설계를 확정해야 합니다. 현재 오프라인 메모리 삭제는 한 번에 완료되지만, Supabase 두 REST 삭제를 연속 호출하는 것만으로 원자성을 보장할 수 없습니다.
- 로그인·즐겨찾기 API 실제 연결, 오류 화면, CSRF 및 인증 검증 이후에만 서버 라우트를 공개합니다. 별도 이벤트 로그·건강정보 추론은 1차 범위 밖입니다. 만 14세 이상 이용 정책은 가입·동의 흐름 담당이 별도로 강제해야 하며 본 모듈은 연령·건강정보를 수집하지 않습니다.

## 7. 테스트 체크리스트

- [x] 가짜 계정 A/B 데이터 격리(메모리 서비스)
- [x] 값과 키 허용목록 거부(건강 데이터·검색/방문 기록 포함)
- [x] 즐겨찾기 추가 멱등/삭제/20개 한도
- [x] OFF 시 신호 null, 저장값 보존, 재활성화
- [x] 전체 삭제 후 빈 데이터, 다른 가짜 계정 유지
- [x] 실제 적용된 진술만 한국어 이유(240자 제한)
- [x] 로그인 없는 HTTP 거부/다른 계정의 user_id 주입 거부/Origin 검사
- [ ] 실제 계정 A/B + Supabase RLS 검증(테이블 적용 이후)
- [ ] 계정별 API/UI 실제 연결, 통합 테스트(로그인 연결 이후)

## 8. 2026-11-14 후속: DB 없는 프론트엔드 연결 완료 (개발 모드)

> 본 문서 상단의 '미연결' 표시는 최초 **코드만** 제공한 버전에 대한 설명입니다. 본 통합 버전에는 **Next.js 개발 전용 모의 API와 기존 화면 연결**이 추가되었습니다. 실제 로그인/Supabase/추천 알고리즘 연결은 여전히 별개의 작업입니다.

### 새로 연결된 부분

- `app/medical-app.jsx`: Next.js `NODE_ENV=development`일 때만 모의 행동 온톨로지 클라이언트를 설치합니다. **운영 빌드에서는 설치되지 않습니다.**
- `app/api/behavior-demo/[action]/route.js` + `lib/behavior/demo-server.js`: 서버 메모리 저장소와 테스트 **가짜 계정 A/B**를 갖춘 개발 전용 HTTP 라우트. 운영 빌드에서는 404입니다. 계정 선택용 HTTP-only 쿠키는 실제 로그인/보안 인증이 아닙니다. 개발 서버 종료·재시작 시 메모리 데이터는 사라집니다.
- `behavior-demo-client.mjs`: 기존 `behavior-client.mjs` 계약을 개발 라우트로 연결. 사용자의 DB 자격 증명이나 Supabase 키를 쓰지 않습니다.
- `app.js`: 기존 `setFavoritesAdapter()`를 사용해 별표 추가·삭제를 모의 저장소에 연결하고, 설정 저장·개인화 OFF/ON·삭제 및 가짜 계정 전환을 제어합니다.
- `components/profile.jsx` + `components/behavior-demo.jsx`: 기존 **내 정보** 화면에 모의 계정 선택, **기본 정렬/기본 지역 저장**, 저장 지역 검색창에 입력, 개인화 ON/OFF, 전체 삭제, 실제 GUMO식 진술의 관계/출처/시각 표시가 추가됩니다.
- `lib/behavior/mock-repository.js`: 시범 구현에서 *직접 사용자가 선택한 정렬 선호*를 기본값과 구분하기 위한 **메모리 내부 근거 정보**를 추가했습니다. DB 스키마는 바꾸지 않았고, 실제 DB에서도 이를 구분하려면 DB 담당과 협의해야 합니다.
- `lib/behavior/api.js` + `behavior-client.mjs`: `GET statements` (주체-관계-값-출처·시각) 읽기 추가. 저장 허용목록은 변경하지 않았습니다.

### 개발 화면 테스트 순서

1. `frontend`에서 `npm ci` 후 `npm run dev` (프로젝트 `package.json`의 Node 버전 요구사항 확인).
2. `http://127.0.0.1:3080` → 우측 상단 **내 정보** → **행동 온톨로지 · 개인화 설정** (실제 로그인과 무관한 개발 전용 섹션).
3. 가짜 계정 A에서 `가상시 테스트동`을 **기본 검색 지역**으로 입력하고 `open` 등 정렬 선호를 선택한 뒤 **기본 설정 저장**. 아래 진술 목록에 `hasPreference/searchRegion`, `hasPreference/sortOrder` 등이 나타나는지 확인.
4. **저장 지역을 검색창에 입력** → 검색 화면에서 지역이 들어간 것을 확인. **검색 버튼을 눌러야 검색이 실행됩니다.** 검색창에서 일회성으로 지역을 바꿔도 온톨로지 저장 값은 변경되지 않습니다. 실제 의료기관 검색 API가 설정되지 않은 경우 별도 검색 결과가 나오지 않을 수 있습니다.
5. **가상 병원 즐겨찾기 추가** 버튼으로 카카오 API 없이도 샘플 기관을 저장할 수 있습니다. 또는 실제 검색 결과의 별표를 눌러 즐겨찾기 등록 → 내 정보의 즐겨찾기 목록 및 선호 신호의 `favoriteIds`와 `hasFavorite/facility` 진술이 갱신되는지 확인. 외부 검색 결과가 없으면 개발 모드의 기존 데모 목록으로 테스트할 수 있습니다.
6. **개인화 끄기** 후 선호 신호가 사라지는지 확인. 저장 설정/즐겨찾기 목록은 그대로 유지. **켜기** 후 신호가 돌아오는지 확인.
7. **가짜 계정 A → B**로 전환 → B 설정·즐겨찾기가 비어 있음을 확인. B에 따로 저장 후 A로 돌아가면 A 값이 복구되는지 확인. **이 검증은 모의 저장소의 행동 설정·즐겨찾기 사용자 구분만 확인하며, 기존 건강정보 UI의 계정별 분리나 실제 Supabase RLS를 검증하지 않습니다.**
8. **검색 설정·즐겨찾기 전체 삭제** 확인창 승인 → 해당 가짜 계정의 `search_setting`, `favorite`에 대응하는 **모의 데이터만** 삭제되는지 확인. 건강정보·문진·PDF나 이미 내려받은 파일은 삭제 대상이 아닙니다.

**검색 순위 관련 경계**: 저장한 `open`/`access` 선호는 선호 신호로 제공하지만, 현 기존 검색 결과의 정렬 컨트롤은 `recommended/distance/name`을 사용합니다. 모의 화면에서 이 값을 직접 `open/access` 정렬로 바꾸거나 의학적인 추천이라고 주장하지 않습니다. `applied`와 실제 추천 이유는 팀원 2가 실제 이용 데이터로 정렬을 완료한 후에만 생성해야 합니다. 따라서 모의 화면에는 **추천에 적용된 이유 없음**을 명시합니다. 기존 `favoriteFirst()`는 즐겨찾기를 일괄 앞으로 보내지만, **개인화 OFF 상태에서는 해당 우선순위를 사용하지 않도록** 모의 화면에 한해 제어했습니다. 개인화 ON에서의 정확한 **동점 우선 처리**는 팀원 2와 합의한 순위 알고리즘으로 교체해야 합니다. 즐겨찾기 별표/목록 자체는 OFF에도 유지됩니다.

### 추가 테스트

```bash
node --test tests/behavior-ontology.test.mjs tests/behavior-ui-bridge.test.mjs
npm test
```

`behavior-ui-bridge.test.mjs`는 브라우저 어댑터→가짜 API→온톨로지 서비스→메모리 저장소, 계정 A/B, OFF/삭제, 기본값 출처, 개발 전용 접근 차단을 테스트합니다. Next.js/React가 설치된 환경에서는 추가로 `npm run check:next`와 실제 브라우저 동작 확인이 필요합니다.

### 실제 DB 연동 시 바꿀 지점

- 개발 전용 `createBehaviorDemoClient()`를 제거하고, **실제 사용자 인증 세션**을 확인하는 `createBehaviorClient()`와 서버 `createBehaviorApi()`를 연결합니다.
- `createMockBehaviorRepository()`를 요청별 사용자 세션 Supabase client를 쓰는 저장소로 교체합니다. service-role 키로 일상적인 개인 설정에 접근하지 않습니다.
- `personalization_enabled` 컬럼 및 RLS, 20개 제한, 전체 삭제 트랜잭션/권한을 DB 담당에게 확인합니다.
- 가짜 A/B 계정은 진짜 인증을 대체하지 않으므로 **실 계정 A/B 권한 분리 테스트**를 다시 합니다.
- 현 DB 구조는 `preference`에 기본 `distance`가 들어갔을 때 사용자가 직접 선택한 값인지 증명할 수 없습니다. 온톨로지의 `direct_setting` 근거 정확도를 위해 DB 담당과 메타데이터 설계를 합의하거나, 해당 근거가 없는 진술은 표시하지 않는 정책을 유지합니다.

**개인정보 정책은 유지**: 클릭 기록·의료 증상·대화·검색어·길찾기 기록은 행동 온톨로지 저장소에 넣지 않으며 사용자가 요청한 4가지 설정과 즐겨찾기만 취급합니다. 가짜 계정 시험에는 가짜 지역·가짜 병원 데이터만 입력하세요.

## 9. 2026-11-25 최소 행동 횟수 기록

신청서의 "이용 행동 기반 재방문 시 선호 우선 제공"을 위해, 행동을 **횟수로만** 쌓는 진술 2개(`CHOICE_MODEL`, `lib/behavior/model.js`)를 더했습니다. 날짜별 이벤트 로그, 조회·클릭 기록, 검색어, 증상은 여전히 저장하지 않습니다.

| 진술 | 언제 1회로 세나 | 저장 위치 | 동의 근거 | 쓰는 곳 |
| --- | --- | --- | --- | --- |
| `hasChoiceCount facility` | 기관의 길찾기를 열거나 전화번호를 복사할 때 | `public.capstone_facility_choice` (기관 ID·종류·이름·횟수, 최대 50곳) | 필수 "개인정보 수집·이용" | 추천 순위: 같은 무리 안에서 2회 이상 쓴 기관을 앞으로, 이유 문구 "이전에 길찾기나 전화번호 복사를 n번 한 곳이에요." |
| `hasChoiceCount department` | 대화가 제안한 병원 검색 조건을 적용할 때(약국 검색 제외) | `app.department_choice` (진료과 검색 키·횟수) | 선택 "건강정보 저장"(healthProcessing + healthStorage). RLS로 강제 | 검색 화면 진료과 목록에서 자주 고른 과를 위로 |

- 같은 기관·진료과는 **페이지를 열 때마다 한 번만** 셉니다(길찾기를 열고 닫기 반복으로 늘지 않음).
- 로그인하고 가입 동의를 마친 계정만 셉니다. 개인화 OFF(`personalization_enabled=false`)면 세지 않고 순위·목록 정렬에도 쓰지 않습니다. 기록은 내 정보에서 계속 볼 수 있습니다.
- 순위 규칙(`lib/care-ranking.mjs`): 진료과 무리(대표 진료과 → 진료 확인) → 횟수 많은 순 → 화면 순서(거리). 다른 진료과의 자주 쓴 기관을 맞는 진료과 기관보다 앞에 두지 않습니다. 진료과 근거가 없는 검색(약국)은 후보 전체가 한 무리입니다. 횟수는 서버가 로그인 세션으로 읽고(`app/api/care/route.js`), 요청 본문의 값은 쓰지 않습니다.
- 삭제: 내 정보 → "자주 찾은 기관과 진료과" → 기록 지우기(두 표 모두). 건강정보 저장 동의 철회·건강정보 지우기 시 진료과 횟수는 DB 트리거가 함께 지웁니다(007). 회원 탈퇴 시 FK cascade로 모두 지워집니다. 행동정보 전체 삭제(`capstone_delete_behavior`)는 기관 횟수까지 지우고, 건강정보에 속한 진료과 횟수는 남깁니다.
- 한계: 진료과 횟수의 동의 확인은 `app.consent_current`를 봅니다. 가입 화면의 건강정보 저장 체크는 `capstone_account_consents`에만 기록되므로, 실제로는 내 정보에서 건강정보를 한 번 저장(동의 이벤트 기록)한 뒤부터 진료과가 세집니다.
- API(`/api/behavior/[action]`): `POST facility-choice {facility:{id,type,name}}`, `POST department-choice {department}`, `GET choices`, `DELETE choices`. 응답 `{recorded, count}`.
- 마이그레이션: `supabase/migrations/202611250001_capstone_facility_choice.sql`(SQL Editor), `../data_pipeline/db/migrations/007_app_department_choice.sql`(06c 스크립트).
- 테스트: `tests/behavior-choices.test.mjs`.
