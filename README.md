# Personalization — 팀원 3 추가 기능

카카오 로그인·로그아웃·회원 탈퇴, 행동 온톨로지와 계정별 저장, 5개 언어 UI를 추가한 파일이다.

아래 구조에는 공유 ZIP과 비교해 **새로 추가하거나 내용이 변경된 파일만** 표시했다. 총 99개이며 신규 55개, 기존 파일 수정 44개다.

## 구성 방식

이 폴더는 독립 실행 앱이 아니라 기존 프론트엔드에 반영할 추가·수정 파일 묶음입니다. GitHub의 `personalization` 브랜치에서는 아래 파일을 저장소 루트의 동일 경로에 반영합니다. 별도의 `personalization/frontend/` 앱을 만들지 않습니다.

| 기능 | 구현 위치 |
| --- | --- |
| 인증·계정 | `frontend/app/api/auth/`, `frontend/lib/supabase/`, 계정 화면 컴포넌트 |
| 행동 온톨로지·개인화 | `frontend/lib/behavior/`, `frontend/app/api/behavior/` |
| 다국어 UI | `frontend/i18n.mjs`, `frontend/locales/`, `frontend/components/use-language.js` |
| 공통 화면 연결 | `frontend/app/`, `frontend/components/`, 기존 화면 모듈 |

Next.js 라우트와 상대 import가 기존 프론트엔드 구조를 사용하므로 실제 코드 경로는 유지합니다. `data_pipeline/` 및 `care_engine/`은 각각 담당 팀원의 모듈로 유지합니다. 상세 API·DB 연동 내용은 [팀원 3 연동 매뉴얼](frontend/docs/TEAM3_INTEGRATION.md)에 있습니다.

## 파일 구조

```text
├── .gitignore
├── README.md
└── frontend/
    ├── .env.example
    ├── .gitignore
    ├── README.md
    ├── account-client.mjs
    ├── app.js
    ├── app/
    │   ├── api/
    │   │   ├── auth/
    │   │   │   ├── account/
    │   │   │   │   └── route.js
    │   │   │   ├── kakao/
    │   │   │   │   ├── callback/
    │   │   │   │   │   └── route.js
    │   │   │   │   └── route.js
    │   │   │   ├── logout/
    │   │   │   │   └── route.js
    │   │   │   ├── pending/
    │   │   │   │   └── route.js
    │   │   │   ├── session/
    │   │   │   │   └── route.js
    │   │   │   └── signup/
    │   │   │       └── route.js
    │   │   ├── behavior-demo/
    │   │   │   └── [action]/
    │   │   │       └── route.js
    │   │   └── behavior/
    │   │       └── [action]/
    │   │           └── route.js
    │   ├── medical-app.jsx
    │   └── signup/
    │       └── page.jsx
    ├── assistant.mjs
    ├── behavior-client.mjs
    ├── behavior-demo-client.mjs
    ├── care-context.mjs
    ├── components/
    │   ├── account-dialog.jsx
    │   ├── app-view.jsx
    │   ├── assistant-result.jsx
    │   ├── behavior-demo.jsx
    │   ├── chat.jsx
    │   ├── conversation-workspace.jsx
    │   ├── delete-account.jsx
    │   ├── emergency-card.jsx
    │   ├── emergency-location-picker.jsx
    │   ├── explore.jsx
    │   ├── facility-workspace.jsx
    │   ├── facility.jsx
    │   ├── favorites.jsx
    │   ├── health-consent.jsx
    │   ├── health-update-review.jsx
    │   ├── intake.jsx
    │   ├── profile.jsx
    │   ├── report-import.jsx
    │   ├── report.jsx
    │   ├── routing.jsx
    │   └── use-language.js
    ├── copy.mjs
    ├── docs/
    │   ├── BEHAVIOR_INTEGRATION_GUIDE.md
    │   ├── BEHAVIOR_ONTOLOGY.md
    │   ├── I18N.md
    │   ├── SETUP.md
    │   ├── SUPABASE.md
    │   └── TEAM3_INTEGRATION.md
    ├── emergency-resources.mjs
    ├── emergency.mjs
    ├── facilities.mjs
    ├── i18n.mjs
    ├── intake-data.mjs
    ├── integrate_kakao.py
    ├── lib/
    │   ├── auth-server.mjs
    │   ├── behavior/
    │   │   ├── api.js
    │   │   ├── demo-server.js
    │   │   ├── index.js
    │   │   ├── mock-repository.js
    │   │   ├── model.js
    │   │   ├── service.js
    │   │   ├── supabase-repository.js
    │   │   └── validation.js
    │   ├── delete-account.mjs
    │   ├── gemini.mjs
    │   └── supabase/
    │       ├── auth.js
    │       ├── client.js
    │       ├── config.js
    │       └── server.js
    ├── live-data.mjs
    ├── locales/
    │   ├── source.json
    │   ├── uz.json
    │   ├── vi.json
    │   └── zh.json
    ├── package-lock.json
    ├── package.json
    ├── proxy.js
    ├── report-import.mjs
    ├── report.mjs
    ├── routing.mjs
    ├── scripts/
    │   ├── check-supabase.mjs
    │   ├── demo-behavior.mjs
    │   └── translate-locales.mjs
    ├── server.mjs
    ├── signup-consent.mjs
    ├── supabase/
    │   └── migrations/
    │       └── 202611150001_capstone_behavior.sql
    ├── tests-next/
    │   ├── delete-account-ui.test.mjs
    │   ├── i18n-ui.test.mjs
    │   ├── profile-account-ui.test.mjs
    │   ├── react-ui.test.mjs
    │   └── supabase-http.test.mjs
    ├── tests/
    │   ├── behavior-ontology.test.mjs
    │   ├── behavior-origin.test.mjs
    │   ├── delete-account.test.mjs
    │   ├── i18n.test.mjs
    │   └── supabase-repository.test.mjs
    └── workspace.css
```

## 포함 내용

| 구분 | 파일·폴더 | 내용 |
| --- | --- | --- |
| 회원 인증 | `app/api/auth/`, `lib/supabase/`, `account-client.mjs`, `app/signup/` | 카카오 인증, 가입 동의 저장, 세션 확인, 로그아웃 |
| 회원 탈퇴 | `app/api/auth/account/`, `lib/delete-account.mjs`, `components/delete-account.jsx` | 탈퇴 확인 창과 본인 계정 삭제 처리 |
| 행동 온톨로지 | `lib/behavior/`, `app/api/behavior/`, `behavior-client.mjs` | 직접 저장한 선호·즐겨찾기의 검증, 계정별 저장·조회·삭제, 근거 진술과 추천용 신호 |
| 다국어 | `i18n.mjs`, `locales/`, `copy.mjs`, `components/use-language.js` | 한국어·영어·중국어 간체·베트남어·우즈베크어 UI와 언어 선택 유지 |
| 기존 화면 연결 | `app.js`, `app/medical-app.jsx`, `components/`, 관련 화면 모듈·`workspace.css` | 기존 문진·검색·지도·응급·분석서 화면에 인증·즐겨찾기·번역을 연결한 수정 |
| DB 정의 | `supabase/migrations/` | 현재 계정별 동의·검색 설정·즐겨찾기 테이블, RLS와 저장 함수 |
| 설정·의존성 | `.env.example`, `.gitignore`, `package.json`, `package-lock.json`, `proxy.js` | 설정 변수 예제, 제외 규칙, Supabase 의존성, 세션 갱신 |
| 점검·개발 보조 | `scripts/`, `lib/gemini.mjs`, behavior-demo 관련 파일 | DB 연결 점검, 수동 번역 파일 갱신, 개발용 모의 동작 |
| 이전 구현 보조 | `lib/auth-server.mjs`, `integrate_kakao.py` | 이전 SQLite 인증·카카오 화면 통합 보조 코드 |
| 테스트 | `tests/`, `tests-next/`의 표시된 파일 | 온톨로지·접근 출처·저장소·탈퇴·번역·계정 화면 검증 |
| 문서 | `README.md`, `frontend/README.md`, `frontend/docs/`의 표시된 파일 | 추가 기능의 구현 위치·API 계약·설정·연동 내용 |

표에서 별도 접두사가 없는 코드 경로는 `frontend/` 기준이다.

## 로컬 한국어 음성 기능

Windows 로컬 음성 서버 설치 및 프런트엔드 연결은 [음성 모듈 실행 가이드](voice_service/README.md)를 참고하세요.
