# 팀원 3 기능 연동 매뉴얼

기존 프론트엔드에 추가한 **행동 온톨로지와 계정별 저장, 카카오 로그인·로그아웃·회원 탈퇴, 5개 언어 UI**를 다른 팀원의 기능과 연결하기 위한 안내입니다. 화면별 구현 설명 대신 연결 위치, 데이터 계약, 설정과 남은 작업을 정리했습니다.

비교 기준은 로컬 `CapstoneDesign`과 `CapstoneDesign-Test`, 역할 기준은 제공된 「기능 분류」 문서입니다. 확인일은 **2026-11-15**입니다. 아래 코드 경로는 저장소 루트 기준입니다. 링크는 이 문서 위치에 맞춰 연결했습니다.

## 1. 기존 기능과 추가 구현 범위

| 구분 | 기존 `CapstoneDesign`에 있던 기반 | `CapstoneDesign-Test`에서 추가·연결한 부분 |
| --- | --- | --- |
| 회원 | 로그인 안내·동의 화면, 계정 연결용 인터페이스 | Supabase 카카오 인증, 최초 가입 동의 저장, 로그인 상태 조회, 로그아웃, 회원 탈퇴 |
| 행동 온톨로지 | 즐겨찾기 UI와 계정별 어댑터 연결 구조 | 명시적 선호 모델·검증·근거 진술·추천용 신호, 실제 Supabase 저장 API와 RLS |
| 다국어 | 한국어·영어 UI | 공통 번역 조회 구조, 중국어 간체·베트남어·우즈베크어 라틴 문자, 언어 선택·유지 |
| 응급·문진·지도·분석서 | 관련 화면, 샘플 동작, 외부 기능 연결 구조 | 기존 기반을 유지하며 인증·즐겨찾기·번역을 연결. 해당 화면 전체를 새로 구현한 것으로 구분하지 않음 |

**팀원 3의 추가 구현 범위는 위 세 기능입니다.** 역할 문서의 응급 신고 요약 생성까지 새로 완성했다는 뜻은 아닙니다. 실제 문진 분기·진료과 판단은 팀원 1, 의료기관 DB·검색·추천 정렬은 팀원 2와 연결해야 합니다.

## 2. 연결 전에 알아야 할 현재 상태

| 항목 | 현재 상태 |
| --- | --- |
| 인증·즐겨찾기 | 실제 Supabase 계정과 연결. 즐겨찾기 추가·해제와 근거 생성은 임시 테스트 계정으로 확인 |
| 개인화 설정·온톨로지 | 내부 API로 제공. 사용자 화면에는 온톨로지나 개인화 설정 패널을 노출하지 않음 |
| 추천 엔진 연결 | 저장된 선호를 반환하는 단계까지 구현. 팀원 2의 실제 추천 엔진이 사용하고 적용 결과를 돌려주는 연결은 남아 있음 |
| 의료기관 검색 | 현재 카카오 API 기반. 추가한 Supabase 테이블은 의료기관 원본 DB가 아님 |
| 건강정보·문진·분석서 | 현재 화면 메모리에서 처리. 계정별 서버 저장 기능은 추가하지 않음. 저장 동의를 기록했다고 해당 저장 기능까지 구현된 것은 아님 |
| 번역·AI | 화면 번역은 정적 파일 사용. 실행 중 Gemini 호출 없음. Gemini 데모는 제거했으며 실제 AI 상담·입력 표준화는 별도 담당 범위 |

## 3. 구현 위치와 저장 위치

| 기능 | 주요 코드 | 저장 위치 |
| --- | --- | --- |
| 로그인·계정 상태 | [인증 라우트](../../frontend/app/api/auth/), [Supabase 인증 검증](../../frontend/lib/supabase/auth.js), [브라우저 계정 클라이언트](../../frontend/account-client.mjs) | Supabase Auth의 `auth.users`, 브라우저 쿠키 세션 |
| 가입 동의 | [가입 API](../../frontend/app/api/auth/signup/route.js), [동의 항목](../../frontend/signup-consent.mjs), [가입 화면](../../frontend/app/signup/page.jsx) | `public.capstone_account_consents` |
| 회원 탈퇴 | [탈퇴 API](../../frontend/app/api/auth/account/route.js), [서버 처리](../../frontend/lib/delete-account.mjs), [확인 창](../../frontend/components/delete-account.jsx) | Auth 계정 삭제와 연결된 FK 삭제 |
| 행동 온톨로지 | [모델](../../frontend/lib/behavior/model.js), [서비스](../../frontend/lib/behavior/service.js), [검증](../../frontend/lib/behavior/validation.js) | 별도 그래프 DB 없이 저장값에서 근거 진술 생성 |
| 설정·즐겨찾기 | [DB 저장소](../../frontend/lib/behavior/supabase-repository.js), [행동 API 라우트](../../frontend/app/api/behavior/%5Baction%5D/route.js), [브라우저 클라이언트](../../frontend/behavior-client.mjs) | `public.capstone_search_setting`, `public.capstone_favorite` |
| 다국어 | [공통 번역 함수](../../frontend/i18n.mjs), [기존 문구 키](../../frontend/copy.mjs), [번역 파일](../../frontend/locales/) | `source.json`, `zh.json`, `vi.json`, `uz.json`. 언어 선택은 브라우저의 `medical-language` |

DB 구조와 RLS는 [마이그레이션 SQL](../../frontend/supabase/migrations/202611150001_capstone_behavior.sql)에 있습니다. 기존 팀의 `app.*` 테이블을 변경하지 않도록 `public.capstone_*` 이름을 사용했습니다. 새 환경에 한 번 적용하며, 이미 적용한 DB에 무조건 재실행하지 않습니다.

## 4. 로그인과 계정 API

### 인증 흐름

```text
카카오로 계속하기 → Supabase OAuth → 앱 콜백
→ 최초 이용자는 /signup에서 동의 저장 → 앱 로그인 상태 확정
```

현재 카카오 요청은 이메일·닉네임·사진 scope를 비우고 계정 식별자를 사용합니다. Supabase Kakao 공급자의 **Allow users without an email**을 켜야 합니다. 서비스 사용자 ID는 이메일이나 카카오 원본 ID 대신 **Supabase 사용자 UUID**로 통일합니다.

| 메서드와 경로 | 기능 / 응답 |
| --- | --- |
| `GET /api/auth/kakao` | OAuth 시작. 페이지 이동으로 호출 |
| `GET /api/auth/kakao/callback` | 인증 코드 교환·가입 상태 확인 |
| `GET /api/auth/session` | 가입 완료 시 `{authenticated:true, accountId:"UUID"}`. 미완료 시 `authenticated:false`, `pendingSignup:true` |
| `GET /api/auth/pending` | `{pending:boolean}` — 가입 동의 진행 여부 |
| `POST /api/auth/signup` | `{policyVersion, decisions:[{id,agreed}]}`. 항목 ID와 버전은 `signup-consent.mjs` 기준 |
| `POST /api/auth/logout` | 현재 브라우저 세션 로그아웃 |
| `DELETE /api/auth/account` | `{confirmation:"탈퇴"}` 또는 `{confirmation:"DELETE"}`로 본인 계정 영구 삭제 |

다른 기능에서 로그인 상태가 필요하면 `/api/auth/session`을 조회합니다. 서버에서는 쿠키를 읽은 Supabase 클라이언트의 **`auth.getUser()` 검증**을 사용합니다. 브라우저가 보낸 `accountId`나 `user_id`를 권한 판단에 사용하지 않습니다. 행동 API는 필수 가입 동의까지 완료한 사용자만 허용합니다.

회원 탈퇴는 서버 전용 관리자 키로 Auth 계정을 삭제합니다. 제공한 SQL이 적용돼 있으면 동의·검색 설정·즐겨찾기는 `ON DELETE CASCADE`로 함께 삭제됩니다. **카카오 계정 자체 삭제나 카카오 서비스 연결 해제는 포함하지 않습니다.** 다른 팀의 테이블·Storage 파일이 추가되면 삭제 범위와 FK·소유 파일 처리를 함께 확인해야 합니다. 삭제 실패 시 완료로 표시하지 않습니다.

## 5. 팀원 2와 연결할 행동 온톨로지 계약

### 저장하는 항목

| 항목 | 허용값 / 의미 |
| --- | --- |
| `preference` | `distance`, `open`, `access` — 사용자가 직접 저장한 정렬 선호 |
| `region` | 최대 80자. 일회성 검색 지역과 구분 |
| `personalization_enabled` | 개인화 신호 제공 여부. OFF로 바꿔도 저장값은 유지 |
| 즐겨찾기 | 기관 ID·종류·이름·주소. 계정당 최대 20개 |

이동수단 저장은 현재 모델에 포함되지 않습니다. `walk/traffic/car` 길찾기 상태와 영구 저장 선호를 혼동하지 않습니다. 증상·질병·방문 이력은 행동 저장 API에서 받지 않습니다. 현재 모델은 GUMO에서 착안한 명시적 진술 구조이며 OWL/GUMO 추론 엔진은 아닙니다.

`personalization_enabled`는 적용 여부를 제어하는 값입니다. 가입 시 건강정보 관련 동의와 별개이며, 별도의 개인화 동의·설정 화면은 현재 노출하지 않습니다. 실제 설정을 받는 경로는 검색 화면 담당자와 협의합니다.

### 사용할 API

모두 `/api/behavior` 아래에 있으며, 쿠키 인증을 사용합니다. 변경 요청은 같은 출처에서 JSON으로 보냅니다.

| 메서드와 경로 | 요청 → 응답 |
| --- | --- |
| `GET /settings` | → `{settings: object 또는 null}` |
| `PATCH /settings` | `{region?, preference?, personalization_enabled?}` 중 최소 한 항목 → `{settings}` |
| `GET /favorites` | → `{items:[...]}` |
| `PUT /favorites` | `{facility:{id,type,name:{ko,en},address}, favorite:true 또는 false}` → `{items:[...]}` |
| `GET /statements` | → `{statements:[...]}`. 사용자·관계·대상·근거 출처·시각 |
| `GET /signal` | → `{signal: object 또는 null}`. 추천 엔진이 참고할 저장된 선호 |
| `DELETE /all` | → `{deleted:{favorites,search_settings}}`. 본인의 설정·즐겨찾기만 삭제하며 회원 탈퇴는 아님 |

기관 `type`은 `hospital/pharmacy`, ID는 영문·숫자·`_ : . -`로 된 1~128자 문자열입니다. 현재 카카오 검색 결과는 **`kakao-12345` 형식**을 사용합니다. 팀원 2가 자체 기관 DB를 연결하면 검색 결과·즐겨찾기·추천 후보·상세 조회의 ID를 같은 값으로 맞춰야 합니다. 표시 순서나 기관명으로 ID를 만들지 않습니다.

신호 응답 예시:

```json
{
  "signal": {
    "sort": "distance",
    "region": "가상시",
    "favoriteIds": ["kakao-12345"],
    "applied": []
  }
}
```

**`applied: []`는 아직 추천에 사용하지 않았다는 뜻입니다.** 팀원 2의 서버 정렬 코드가 실제 사용한 조건만 기록해야 합니다. [서비스 함수](../../frontend/lib/behavior/service.js)는 다음처럼 연결합니다.

```js
// 서버 전용. signal과 실제 정렬에 사용한 결과를 전달한다.
const applied = markAppliedPreferences(signal, {
  sortUsed: true,
  regionUsed: false,
  favoriteIdsUsed: []
});
const reason = buildPreferenceReason(applied, {facilityId});
```

`markAppliedPreferences`와 `buildPreferenceReason`는 위 서비스 모듈에서 가져옵니다. 사용 여부를 브라우저가 임의로 지정하게 하지 않습니다. 저장된 선호보다 현재 사용자가 명시한 검색 조건을 우선하는 규칙은 팀원 2와 합의합니다. 기본 거리순 값을 사용자가 직접 저장한 근거로 간주하지 않습니다.

`statements`는 현재 저장값을 바탕으로 만든 근거이며 전체 행동 이력 로그가 아닙니다. 설정 시각은 행의 `updated_at`, 즐겨찾기는 `created_at`을 사용합니다. 온톨로지·근거 디버그 화면은 노출하지 않으며, 실제 추천 이유의 사용자 표시 위치는 연동 시 협의합니다.

**남은 연결:** 개인화 OFF에서는 서버 `signal`이 `null`이 됩니다. 현재 채팅 카드에 남아 있는 즐겨찾기 우선 배치 로직은 이 서버 신호와 자동 동기화되지 않았으므로, 팀원 2가 추천을 통합할 때 OFF 처리까지 함께 연결해야 합니다. 이유 생성 함수는 현재 한국어를 반환합니다.

## 6. 팀원 1과 팀원 2의 기존 프론트엔드 연결 지점

기존 [care-client.mjs](../../frontend/care-client.mjs)의 `connectCare()`에 팀별 요청 함수와 데이터를 주입합니다. 호출 위치는 [app/medical-app.jsx](../../frontend/app/medical-app.jsx)의 화면 마운트 이후이며, 현재 설치된 계정 어댑터는 유지합니다. 별도 인증 상태나 즐겨찾기 어댑터를 중복 설치하지 않습니다.

| 전달 항목 | 담당 / 주의사항 |
| --- | --- |
| `requestAssistant(payload,{signal})` | 팀원 1. `locale`, 입력·문진·검색 문맥을 받아 요약·추가 질문·검색 조건 등을 반환 |
| `questionnaire`, `followUpQuestionnaire` | 팀원 1. 질문·선택지 ID를 고정하고 `intake-data.mjs` 계약을 따름 |
| `emergencyGuides` | 팀원 1의 긴급 경로 결정과 팀원 3의 검토된 안내 콘텐츠 연결. 화면이 임의로 응급 판단하지 않음 |
| `rankFacilities(payload,{signal})` | 팀원 2. 실제 검색 후보의 `facilityId`만 반환하고 `resultSetId`를 그대로 돌려줌 |
| `healthNotice` | 실제 외부 처리에 맞춘 안내. 없으면 외부 상담·추천 요청을 허용하지 않음. 이전 분석서 전송은 `allowReportImport:true`일 때만 가능 |

현재 기관 검색을 팀원 2의 자체 DB API로 바꾸는 작업은 `connectCare()` 호출만으로 완료되지 않습니다. [live-data.mjs](../../frontend/live-data.mjs)·[kakao-client.mjs](../../frontend/kakao-client.mjs)·`app.js`의 검색 데이터 흐름에 맞춰 별도 어댑터를 합의해야 합니다.

기존 [BACKEND.md](../../frontend/docs/BACKEND.md)는 문진·추천 요청 계약을 참고할 수 있지만, 첫머리의 로그인 미연결 설명 등은 과거 상태입니다. **인증·행동 저장의 현재 기준은 이 README와 실제 라우트 코드**입니다.

## 7. 다국어를 추가 화면에 적용하는 방법

언어 코드는 **`ko/en/zh/vi/uz`**로 통일합니다. 고정 UI는 `phrase(locale, 영어원문)` 또는 기존 `t(의미키)`로 조회합니다. `{0}` 같은 자리표시자와 동의 항목의 ID는 번역하지 않습니다.

```js
// locales/source.json에 "Reservation inquiry": "예약 문의" 등록 후 사용
phrase(locale, 'Reservation inquiry');
```

새 문구는 `source.json`과 `zh/vi/uz.json`에 함께 추가하고, 기존 `t()`를 쓰는 화면이라면 `copy.mjs`의 한국어·영어 의미 키도 맞춥니다. 번역 파일을 직접 수정할 수 있습니다. 개발용 `scripts/translate-locales.mjs`는 직접 실행할 때만 Gemini를 사용하며 앱 실행에는 필요하지 않습니다.

기관명·주소·사용자 입력은 원문을 보존합니다. API의 문진 질문·요약은 `{ko, en?, zh?, vi?, uz?}` 텍스트 객체를 지원하며 현재 한국어 필드는 필요합니다. **추천 이유는 `recommendations.mjs` 검증이 아직 `ko/en`만 보존**하므로 팀원 2가 5개 언어 이유를 제공할 때 이 검증도 함께 확장해야 합니다. 고정 UI 번역과 실시간 AI 답변 번역은 별개입니다.

## 8. 환경 설정과 병합 순서

`frontend/.env.example`을 최초 설치 시 `frontend/.env.local`로 복사해 설정합니다. 로컬 설정은 `.env.local` 하나로 통합했습니다. 실제 키 파일과 `.local-data/` 백업은 공유·커밋하지 않으며, GitHub에는 `.env.example`만 올립니다.

| 설정 | 필요한 기능 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | 프로젝트 기본 URL. `/rest/v1/`을 붙이지 않음 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 브라우저·사용자 세션용 공개 키 |
| `APP_URL` | 앱 출처. 기본 `http://127.0.0.1:3080`; 변경 API의 Origin 검사에도 사용 |
| `SUPABASE_SECRET_KEY` | 회원 탈퇴 전용 서버 관리자 키. `SUPABASE_SERVICE_ROLE_KEY`도 지원. `NEXT_PUBLIC_` 접두사 금지 |
| `KAKAO_JAVASCRIPT_KEY` | 지도·기관 검색. 카카오 공급자 설정에 넣는 OAuth REST 키와 구분 |

카카오 로그인은 카카오에 **Supabase 콜백** `https://<project-ref>.supabase.co/auth/v1/callback`, Supabase 허용 Redirect URL에 **앱 콜백** `<APP_URL>/api/auth/kakao/callback`을 등록합니다. `.env.local`의 빈 값도 `.env`의 키를 덮어쓰므로 중복 빈 설정을 두지 않습니다.

병합할 때는 다음 순서로 진행합니다.

1. `package.json`·잠금 파일의 Supabase 의존성과 `lib/supabase`, 인증 라우트, `proxy.js`의 세션 갱신을 함께 반영합니다.
2. 새 DB에는 마이그레이션을 적용하고 카카오 공급자·콜백을 설정합니다. 기존 기관 DB 테이블과는 분리합니다.
3. `app/medical-app.jsx`의 계정 연결, `app.js`의 계정·즐겨찾기 처리, 관련 컴포넌트와 CSS를 병합합니다.
4. `lib/behavior`·행동 API·번역 파일 및 공통 번역 함수를 반영한 뒤 팀별 검색·문진 어댑터를 연결합니다.
5. 두 폴더의 테스트 구성이 다르므로 **원본의 `tests/`를 통째로 삭제·대체하지 않고 기존 회귀 테스트를 유지**합니다. 다수 화면 파일의 차이는 번역 치환도 포함하므로 전체 파일 차이를 모두 새 기능으로 해석하지 않습니다.

`lib/auth-server.mjs`의 SQLite 로그인과 `/api/behavior-demo/*`, `medicalDev.login()`은 이전·개발용 코드입니다. 실제 로그인·DB 연동 검증에 사용하지 않습니다. 배포 전에는 가입 정책의 `operationalReady:false`에 따른 신규 가입 차단과 운영 약관 정비가 필요합니다.

## 9. 팀 연동 확인 항목

- 계정 A/B 사이에 설정·즐겨찾기가 섞이지 않고 비로그인 행동 API가 `401`인지 확인합니다.
- 즐겨찾기를 저장·해제한 뒤 DB와 `/statements`의 근거가 일치하는지 확인합니다. 잘못된 값은 `400`, 다른 출처 변경 요청은 `403`, 21번째 즐겨찾기는 `409`입니다.
- 개인화 OFF에서 신호가 `null`인지, 실제 추천 엔진도 이를 따르는지 확인합니다. 사용하지 않은 조건에 대한 적용 이유를 만들지 않습니다.
- 탈퇴는 삭제 가능한 테스트 계정으로 Auth 계정·관련 데이터·로그아웃을 확인합니다. 실제 사용자 계정은 테스트 대상으로 사용하지 않습니다.
- 5개 언어 전환·입력 유지·기관 원문·문진 ID·모바일 줄바꿈을 확인합니다. 현재 추천 이유의 언어 지원 한계는 별도로 점검합니다.

실행은 `frontend`에서 `npm ci`, `npm run dev` 후 `http://127.0.0.1:3080`에 접속합니다. Node 버전은 `frontend/package.json`의 `engines`를 따릅니다.

추가한 검증은 `tests/behavior-ontology.test.mjs`, `behavior-origin.test.mjs`, `supabase-repository.test.mjs`, `delete-account.test.mjs`, `i18n.test.mjs`와 `tests-next`의 계정·다국어 UI 검사입니다. Windows 로컬 환경에서는 운영 빌드 중 `EPERM` 폴더 생성 오류가 남아 있어, 개발 서버 검증과 별개로 **통합 환경의 운영 빌드·실제 회원 탈퇴는 다시 검증**해야 합니다.

설정 상세: [Supabase 안내](../../frontend/docs/SUPABASE.md) · [다국어 안내](../../frontend/docs/I18N.md)

## 10. 공유 ZIP의 data_pipeline DB와 통합할 때

공유 ZIP의 `data_pipeline/db/migrations/002_app_schema.sql`에는 이미 `app.account`, `app.consent_event`, `app.consent_current`, `app.favorite`, `app.search_setting`, `app.health_profile`이 있다. 현재 프론트엔드는 `public.capstone_*`를 사용하므로 파일 병합과 DB 연동을 구분한다.

| 구분 | 현재 프론트엔드 | data_pipeline | 통합 시 결정할 내용 |
| --- | --- | --- | --- |
| 동의 | `capstone_account_consents`: 버전·항목별 저장 | `consent_event`에 추가 기록, `consent_current`로 최신값 조회 | 가입 완료 판정·철회·정책 버전의 기준 통일. `age14` 항목도 협의 |
| 즐겨찾기 | `type`, `name:{ko,en}` | `facility_type`, `name_ko`, `name_en` | 저장소에서 필드 변환. 현재 API의 facility 형태는 유지 가능 |
| 검색 설정 | 개인화 ON/OFF·명시적 저장 플래그 포함 | `region`, `preference`, `updated_at` | OFF·근거 출처 필드를 보완하고 원자적 저장·삭제 함수를 합의 |
| 건강정보 | 현재 세션 메모리만 사용 | `health_profile`와 동의 기반 RLS·철회 시 삭제 트리거 | 별도의 계정별 건강정보 API 연결 여부·담당자 결정 |

최종 스키마를 먼저 합의하고 `supabase-repository.js`, `lib/supabase/auth.js`, 가입 API를 함께 조정한다. `app.*`를 쓰기로 하면 단순히 스키마명만 바꾸면 안 된다. 회원 식별자는 양쪽 모두 `auth.users.id`로 맞출 수 있다. `ref`의 표준 증상·진료과와 행동 선호는 별도 데이터이며, 진료과 매핑은 `data_pipeline/config/dept_search_key.csv`와 `frontend/departments.mjs`를 함께 확인한다. 이번 파일 업로드에는 DB 자동 이관이나 pipeline 변경을 포함하지 않는다.
