# Supabase 로그인·행동 온톨로지 연결

## 현재 상태

- `.env.local`의 프로젝트 URL에서 잘못 붙은 `/rest/v1/`을 제거했습니다.
- 앱은 Supabase Auth의 카카오 OAuth + PKCE + 쿠키 세션을 사용합니다. 기존 로컬 SQLite 로그인 데이터는 자동 이관하지 않습니다.
- 내 정보에서 로그인, 로그아웃, 사용자별 즐겨찾기를 사용할 수 있도록 연결했습니다. 행동 온톨로지·개인화 설정·근거는 내부 API로 제공하며 사용자 화면에 표시하지 않습니다.
- 정렬, 지역, 개인화 ON/OFF, 즐겨찾기만 행동 정보로 저장합니다. 건강정보·문진·분석서 저장과 실제 추천 엔진 반영은 이번 변경에 포함하지 않습니다.
- 기존 `app` 스키마는 익명 접근 시 권한 오류가 발생합니다. 기존 테이블 구조를 확인할 수 없어 팀 DB를 변경하는 대신 `public.capstone_*` 이름으로 독립된 마이그레이션을 준비했습니다.
- **원격 DB SQL은 아직 적용하지 않았고, 카카오 공급자도 비활성 상태입니다. 로그인 후 저장·재조회와 계정 간 RLS 분리는 원격 설정 완료 후 검증해야 합니다.**

## 대시보드에서 필요한 작업

1. Supabase SQL Editor에서 `supabase/migrations/202611150001_capstone_behavior.sql` 전체를 실행합니다. 새 테이블 3개, 사용자 소유 RLS 정책, 원자적 설정 변경·동의 저장·행동정보 삭제 함수와 즐겨찾기 20개 제한을 생성합니다. 기존 테이블은 수정하지 않습니다. 재실행 시 이미 존재한다는 오류가 나도록 구성했습니다.
2. Authentication → Sign In / Providers → Kakao에서 공급자를 활성화하고 카카오 REST API 키 및 Client Secret을 등록합니다. 기존 `.env`에 카카오 키가 있어도 Supabase 설정으로 자동 반영되지는 않습니다. 키를 채팅에 붙이지 마세요.
3. Kakao Developers → 카카오 로그인 → Redirect URI에 다음을 등록합니다.

   `https://rwzfajynhtwaczpsigdv.supabase.co/auth/v1/callback`

4. Supabase Authentication → URL Configuration에서 Site URL을 `http://127.0.0.1:3080`, Redirect URLs를 `http://127.0.0.1:3080/api/auth/kakao/callback`로 등록합니다.
5. `.env.local`의 `APP_URL`도 동일한 로컬 주소여야 합니다. 포트나 `localhost`를 바꾸면 Supabase 허용 URL도 함께 바꿉니다.

기존 카카오 직접 콜백 주소와 Supabase 콜백은 다릅니다. Supabase에는 **앱 콜백**, 카카오에는 **Supabase 콜백**을 등록합니다. 서비스 역할 키와 DB 비밀번호는 필요하지 않습니다.

## 실행 및 확인

### 이메일 없이 카카오 로그인

카카오 로그인 요청은 `queryParams.scope: ''`로 추가 개인정보 동의항목을 비웁니다. 이메일·닉네임·프로필 사진을 요청하지 않습니다. Supabase 기본 목록에 추가하는 `options.scopes`와 다르므로 이를 바꾸지 마세요.

- Kakao Developers에서 이메일·닉네임·프로필 사진을 **사용 안 함**으로 둡니다.
- Supabase → Authentication → Sign In / Providers → Kakao에서 **Allow users without an email**을 켜고 저장합니다.
- 개발 서버를 다시 시작한 후 앱에서 카카오 로그인을 새로 시작합니다. 이미 열려 있는 오류 페이지를 새로고침하면 이전 이메일 요청이 반복될 수 있습니다.
- 회원 식별과 사용자별 DB 접근은 기존처럼 Supabase 사용자 ID를 사용합니다.

```powershell
cd C:\Users\sejeo\CapstoneDesign-Test\frontend
node --env-file=.env.local scripts/check-supabase.mjs
npm run dev
```

Node shim이 `Node.js v^22... is not installed` 오류를 내면 설치된 Node 24 실행 경로가 PATH에서 먼저 오도록 설정해야 합니다. 이번 작업의 검증은 Codex에 포함된 Node 24.22.1로 실행했습니다.

1. `http://127.0.0.1:3080` → 내 정보 → 로그인·회원가입 → 카카오로 계속하기.
2. 최초 인증 후 `/signup`에서 필수 동의 두 항목을 확인하고 가입을 완료합니다. 이 동의는 Supabase에 저장됩니다. 앱의 가입 동의 문구는 기존처럼 개발용이며 `operationalReady:false`이므로 프로덕션 신규 가입은 막혀 있습니다.
3. 개발 테스트에서는 인증된 세션으로 `/api/behavior/settings`에 PATCH 요청을 보내 가상의 지역·정렬을 저장하고, GET 요청으로 저장값과 `/api/behavior/statements`의 근거를 확인합니다. 이 정보는 사용자 화면에 노출하지 않습니다.
4. 실제 검색 결과를 즐겨찾기에 추가하고 새로고침 후 유지되는지 확인합니다.
5. 로그아웃 후 다른 테스트 계정으로 로그인하여 이전 계정의 설정과 즐겨찾기가 노출되지 않는지 확인합니다. 익명 API는 401이어야 합니다.
6. 개발 테스트에서 `/api/behavior/settings`로 `{"personalization_enabled":false}`를 PATCH한 후 `/api/behavior/signal`이 `{"signal":null}`을 반환하는지 확인합니다.

`check-supabase.mjs`는 키를 출력하지 않고 연결·카카오 설정·익명 접근 거부를 확인합니다. 이 검사만으로 로그인이나 사용자 간 데이터 분리가 검증되는 것은 아닙니다.

## 연결된 API

| 경로 | 용도 |
| --- | --- |
| GET `/api/auth/kakao` | Supabase 카카오 인증 시작 |
| GET `/api/auth/kakao/callback` | 인증 코드 교환 및 가입 상태 확인 |
| GET `/api/auth/session` | 서버 검증된 앱 로그인 상태 |
| POST `/api/auth/signup` | 항목별 동의 기록 |
| POST `/api/auth/logout` | 현재 브라우저 로그아웃 |
| GET/PATCH `/api/behavior/settings` | 사용자 설정 조회/저장 |
| GET/PUT `/api/behavior/favorites` | 사용자 즐겨찾기 |
| GET `/api/behavior/statements` | 직접 저장 근거의 온톨로지 진술 |
| GET `/api/behavior/signal` | 추천 엔진에 전달할 선호 신호 |
| DELETE `/api/behavior/all` | 본인의 설정과 즐겨찾기만 삭제 |

원본 수정 파일은 `.local-data/pre-supabase-20261115/`에 백업했습니다. 환경변수 백업도 포함되므로 외부 공유하지 마세요. 데모 API는 개발용으로 남겼지만 앱에서 자동 연결하지 않습니다.

## 지도 키 우선순위 수정

`.env`에 등록한 `KAKAO_JAVASCRIPT_KEY`와 `KAKAO_REST_API_KEY`가 `.env.local`의 빈 동일 이름 설정에 덮여 지도가 미설정으로 처리되고 있었습니다. `.env.local`에서 빈 두 줄을 제거했습니다. 서버를 다시 시작하면 `.env`의 키를 사용합니다. 지도 SDK 요청이 HTTP 200으로 응답하고 앱 `/api/config`의 `map.configured`가 true인 것을 확인했습니다. 실제 브라우저 지도 타일 표시는 별도 확인이 필요합니다. 브라우저 주소와 Kakao Developers JavaScript 키의 허용 도메인도 일치해야 합니다.

## 회원 탈퇴

내 정보 하단의 **회원 탈퇴** → 삭제 안내 확인 → **탈퇴** 입력 → **계정 영구 삭제**를 누릅니다. 로그인된 본인의 ID를 서버에서 검증한 뒤 Supabase Auth 공식 관리자 삭제 API로 처리합니다. 브라우저가 지정한 사용자 ID는 받지 않습니다. 삭제 성공 시 현재 브라우저 세션과 로컬 검색 설정을 정리하고 첫 화면으로 돌아갑니다.

**현재 관리자 키가 없어 실제 삭제는 미검증이며, 아래 서버 설정 전에는 탈퇴 요청이 503으로 실패합니다.** `.env.local`에 Supabase 프로젝트의 서버 전용 Secret API 키를 다음 이름으로 등록하고 서버를 재시작합니다.

```dotenv
SUPABASE_SECRET_KEY=여기에_서버_전용_Secret_API_키
```

`NEXT_PUBLIC_` 접두사를 붙이거나 키를 채팅·브라우저 코드에 넣지 마세요. 기존 `SUPABASE_SERVICE_ROLE_KEY` 환경변수도 지원합니다. 공개 publishable 키로는 관리자 계정 삭제를 실행할 수 없습니다.

`DELETE /api/auth/account`는 동일 출처, 로그인, 명시적 삭제 확인을 요구합니다. Auth 계정 삭제에 성공하면 이번 마이그레이션의 `ON DELETE CASCADE`에 따라 동의·즐겨찾기·설정이 삭제됩니다. 선행해서 앱 데이터를 지우지 않으므로 Auth 삭제가 실패했는데 앱 데이터만 먼저 삭제되는 상황을 피합니다. 사용자 소유 Storage 파일이나 다른 팀 테이블의 FK 제약이 있으면 Supabase가 삭제를 거부할 수 있습니다. 이 경우 완료로 표시하지 않습니다. 현재 앱은 건강정보·문진·원본 PDF를 서버에 저장하지 않습니다.

카카오 계정 자체는 삭제하지 않으며 카카오 측 연결 해제 API는 이번 탈퇴 기능에 포함하지 않습니다. 카카오 연결도 해제하려면 카카오 계정의 연결된 서비스 관리에서 별도로 해제할 수 있습니다.

구현 참고: [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs), [Kakao OAuth](https://supabase.com/docs/guides/auth/social-sign-in/auth-kakao).
