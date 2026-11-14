# 7단계: 프론트엔드 확인 → 사용자 DB 설계 (제안)

> 2026-11-14. 인수인계 문서 B 작업의 결과다. **제안 단계**이며 §5의 팀 결정이 끝나면 확정한다.
> 근거 자료: 팀 프론트엔드 `Medical_Helper_AI/frontend/` v0.24.2(README, docs/BACKEND.md, 소스), `6단계_Supabase_1차적재_프롬프트.md`, `기획서.pdf`, 법령·Supabase 문서(§2).
> `.env*` 파일은 읽지 않았다(`.env.example` 포함).

---

## 1. 프론트엔드 현황 (frontend_inventory 요약)

### 1.1 기술 구성
- Next.js 16.4.5(App Router), React 19.3.1, pdfjs-dist(이전 분석서 PDF를 브라우저에서 텍스트로 읽음). 테스트는 node:test와 jsdom.
- 상태는 `app.js`의 단일 상태 객체가 관리하고 React 컴포넌트(`components/*.jsx`)가 화면을 그린다.
- **Supabase 클라이언트, 인증 라이브러리, LLM 호출 코드는 아직 없다.** 백엔드는 브라우저에서 주입하는 어댑터로 연결하게 되어 있다.
  - `connectCare({requestAssistant, rankFacilities, healthNotice, questionnaire, emergencyGuides})`: 문진·대화, 추천 순위, 건강정보 안내, 응급 카드
  - `connectAccount({getSession, logout, favorites})`: 로그인 상태, 로그아웃
  - `connectFavorites({list, set})`: 계정 즐겨찾기
- 서버 API(Next Route Handler): `/api/config`, `/api/public-hours`(운영시간), `/api/route`(길찾기). 지도는 카카오맵 SDK.

### 1.2 화면 흐름
대화 화면이 기본이다. 첫 입력 전에 건강정보 처리 동의 팝업 → 대화 안에서 문진(서버가 질문을 하나씩 보내는 구조, 미연결 시 임시 문진) → 검색 조건 카드 → "지도에서 보기"로 검색·지도 패널. 내 정보(단독 화면)에는 로그인·회원가입, 건강정보, 즐겨찾기, 건강정보 PDF가 있다. 응급 도움은 모달이며 동의·로그인 없이 언제든 열린다.

### 1.3 입력 항목과 현재 저장 위치

| 항목 | 형식 | 현재 저장 | 비고 |
|---|---|---|---|
| 증상 대화 `messages` | 자유 텍스트 배열 | 페이지 메모리 | `requestAssistant`로 서버 전송 예정 |
| 문진 답변 `intake`, `followUpAnswers` | 질문 ID·선택지 ID | 페이지 메모리 | 미응답은 null 유지 |
| 건강정보 `profile` | 만 나이(0~120 정수 문자열), 알레르기·복용약·기저질환(각 500자 텍스트) | 페이지 메모리 | "저장"은 메모리 확정일 뿐 DB 아님 |
| **성별** | **없음** | — | **진료과 필터(산부인과)에 필요한데 입력란이 없다** |
| 이전 분석서 `previousReport` | PDF 추출 텍스트 | 페이지 메모리 | 원본 PDF는 서버로 보내지 않음 |
| 즐겨찾기 | `{id, type, name{ko,en}, address}` 최대 20개 | 페이지 메모리 | 계정 API 연결 지점 준비됨 |
| 검색 설정 | region, preference(distance/open/access) | localStorage(사용자가 고를 때만) | 건강정보는 브라우저 저장소에 넣지 않도록 코드가 막고 있음 |
| 응급 위치 | GPS·직접 입력 | 대화 메모리 | 119·검색에 자동 전달 안 함 |
| 동의 선택 | terms, account, healthProcessing, healthStorage, reportStorage | 페이지 메모리(`persisted:false`) | 서버 동의 기록은 미구현 |

### 1.4 증상 원문이 남을 수 있는 곳 (따로 표시)
1. `requestAssistant` payload의 `messages`: 서버로 가는 원문. **서버 로그·LLM 업체 쪽 보관 여부를 확인해야 한다.**
2. `profileUpdates[].evidence.quote`: 서버가 사용자 문장을 그대로 인용해 돌려준다. 서버 로그에 남지 않게 해야 한다.
3. README 0.24.1 "회원 새로고침 시 진행 중 상담 복원" 방향: 구현하려면 **대화 원문을 서버에 임시 저장**해야 한다(§5-2).
4. 동의서의 `reportStorage`: 분석서와 그 안의 문진 답변을 계정에 저장하는 선택 동의(§5-1).

### 1.5 인증
카카오 로그인 UI와 동의 흐름(약관 → "카카오로 계속하기")만 있고 실제 OAuth는 연결 전이다. 개발 빌드에서만 `medicalDev.login()` 모의 로그인이 있다. 프론트 문서는 "인증 토큰을 브라우저 JS에 보관하지 않고 서버 세션 쿠키로 확인"을 전제로 한다.

### 1.6 ref와 연결될 지점
- 증상 입력 → 사전 매칭(`ref.symptom_synonym`)
- 검색 조건의 `department`: 프론트는 **영문 키 29개**(`departments.mjs`: internal, family, pediatrics, ent, ophthalmology, dermatology, orthopedics, obgyn, urology, psychiatry, … , pharmacy)를 쓴다. `ref.department.dept_id`와 짝을 맞춰야 한다.
- 응급 버튼: 프론트는 이미 항상 표시. 응급 카드 콘텐츠는 `emergencyGuides`(topicId: cpr, aed, choking, bleeding, burns, seizure)로 주입하므로 2차 적재와 형식을 맞춘다.
- 추천 순위 `rankFacilities`: 후보 기관의 `departments`와 진료과 추천을 비교하는 곳.

---

## 2. 조사 결과 (설계 근거)

| 주제 | 내용 | 설계에 주는 의미 |
|---|---|---|
| 민감정보(개인정보보호법 제23조) | 건강 정보는 민감정보로 처리가 원칙적으로 금지되고, 별도 동의나 법령 근거가 있을 때만 처리할 수 있다 | 건강정보 처리 동의는 다른 동의와 분리. 저장은 또 별도 동의 |
| 최소 수집(제16조) | 목적에 필요한 최소한만 수집하고, 최소라는 입증책임은 처리자가 진다 | 필터에 필요한 성별·나이도 "저장"까지 필요한지 따져야 함 |
| 파기(제21조) | 목적 달성 시 지체 없이 파기 | 저장 동의 철회·탈퇴 시 즉시 삭제(cascade) |
| 만 14세 미만(제22조의2) | 법정대리인 동의를 받고 동의 여부를 확인해야 한다 | 프론트 나이 입력은 0세부터 허용. 가입 연령과 아이 대리 상담을 정해야 함 |
| 안전성 확보조치 기준 | 2025-10-31 개정 시행. 접근권한·접속기록 등은 1년 유예 후 적용 | 운영 단계에서 접근권한 관리·접속기록 기준 점검 필요(캡스톤 범위에선 기록만) |
| 기획서 원칙 | 증상 원문은 저장하지 않고 서비스에 필요한 비민감 행동·선호 데이터만 관리 | 이 문서의 기본값 |
| Supabase Auth | Kakao를 기본 OAuth 제공자로 지원(`signInWithOAuth({provider:'kakao'})`), 서버 측은 PKCE 코드 교환 | 별도 인증 서버 없이 Supabase Auth 사용 가능 |
| Supabase RLS | 정책은 `to authenticated`로 역할을 지정하고 `(select auth.uid()) = user_id`처럼 감싸면 행마다 재계산하지 않는다. security definer 함수는 API에 노출되지 않는 스키마에 둔다 | 정책 작성 규칙 |
| Supabase 암호화 | 프로젝트는 기본적으로 저장 시 암호화되고, pgsodium 열 암호화는 사용 중단 예정이라 권하지 않는다 | 열 단위 암호화는 쓰지 않고, 저장 자체를 줄이는 쪽으로 |

---

## 3. 설계 결정 (제안)

### D1. 성별·나이는 **상담 대상** 값으로 매번 받고, 저장하지 않는다
- 필터에 필요한 것은 계정 주인이 아니라 **이번 상담 대상**의 성별·나이다. 부모가 아이 증상을 묻는 경우가 흔하다(fallback의 "아기 증상" 규칙도 같은 이유).
- 대화 시작 때(또는 문진 첫 질문으로) "누구의 증상인가요? 본인 / 아이 / 다른 사람" + 성별(여/남/모름) + 나이(만 나이 또는 모름)를 받는다. 이 값은 추천 조회 인자로만 쓰고 DB에 넣지 않는다.
- 내 정보에 저장한 만 나이가 있으면 "본인" 선택 시 기본값으로만 채운다.
- 모름 처리(제안): 성별 모름 → 산부인과를 숨기지 않음, 나이 모름 → 소아청소년과를 숨기지 않음. 숨겨서 놓치는 쪽이 더 위험하다고 봤다. **팀 내부 문서(확정사항 및 방법론) 2.3-6과 대조 필요.**
- 프론트에는 성별 입력이 없으므로 문진 화면 담당(팀원 1)에게 질문 추가를 요청한다.

### D2. 로그인은 Supabase Auth(Kakao)로, 비회원도 핵심 기능은 모두 쓴다
- 비회원: 증상 안내, 진료과 추천, 병원 찾기, 응급 도움. 서버 저장 없음(프론트 현재 동작과 같음).
- 회원: 즐겨찾기, 검색 설정, 동의 기록. 건강정보 저장은 §5-1 결정에 따름.
- 가입은 만 14세 이상만 받는다(동의 항목 `age14` 추가). 아이의 증상은 보호자 계정에서 "아이" 대상으로 상담하되 아이 정보는 저장하지 않는다.

### D3. 사용자 데이터는 `app` 스키마, 내부 함수는 `private` 스키마
- `app`: `authenticated`에만 usage. `anon`에는 아무 권한도 주지 않는다. Data API의 Exposed schemas에 `app`을 추가한다.
- `private`: 노출하지 않는다. 트리거·security definer 함수만 둔다(`search_path=''`).
- 모든 테이블 RLS on, 정책은 `to authenticated` + `(select auth.uid()) = user_id`.
- 계정 삭제(탈퇴)는 서버 Route Handler에서 비밀 키로 `auth.admin.deleteUser` → `on delete cascade`로 `app` 전체 삭제. 비밀 키는 서버 환경변수에만 둔다.

### D4. 저장하지 않는 것 (스키마에 칸을 만들지 않음)
대화 원문, 문진 답변, 증상, 이전 분석서, 응급 위치, 상담 대상 성별·나이, **조회한 진료과·추천 결과**.
- 진료과 조회 기록은 기획서의 "행동 데이터" 후보지만, 산부인과·정신건강의학과·비뇨의학과 조회처럼 건강 상태를 짐작하게 하므로 민감정보에 가깝다고 보고 1차에서는 저장하지 않는다(§5-4).

---

## 4. 스키마 초안 (`app`)

```sql
create schema if not exists app;
create schema if not exists private;
revoke all on schema app from public, anon;
grant usage on schema app to authenticated;

-- 계정: auth.users 1:1. 카카오 회원번호는 auth.identities에 이미 있으므로 복제하지 않는다
create table app.account (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 동의 기록: 추가만(append-only). 철회는 agreed=false 행을 새로 넣는다
create table app.consent_event (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references app.account(user_id) on delete cascade,
  policy_version text not null,                       -- 예: signup-policy-1
  item           text not null check (item in
                   ('terms','account','age14','healthProcessing','healthStorage','reportStorage')),
  agreed         boolean not null,
  created_at     timestamptz not null default now()
);
create index on app.consent_event (user_id, item, created_at desc);

create view app.consent_current with (security_invoker = true) as
select distinct on (user_id, item) user_id, item, agreed, policy_version, created_at
from app.consent_event
order by user_id, item, created_at desc;

-- 즐겨찾기: 프론트 connectFavorites 계약 그대로. 운영 상태·시간표·방문 이력은 넣지 않는다
create table app.favorite (
  user_id       uuid not null references app.account(user_id) on delete cascade,
  facility_id   text not null check (facility_id ~ '^[A-Za-z0-9_:.\-]{1,128}$'),
  facility_type text not null check (facility_type in ('hospital','pharmacy')),
  name_ko       text not null check (char_length(name_ko) between 1 and 300),
  name_en       text check (char_length(name_en) <= 300),
  address       text check (char_length(address) <= 500),
  created_at    timestamptz not null default now(),
  primary key (user_id, facility_id)
);

-- 검색 설정: 지금 localStorage에 있는 값. 회원은 계정에도 둘 수 있게
create table app.search_setting (
  user_id    uuid primary key references app.account(user_id) on delete cascade,
  region     text check (char_length(region) <= 80),
  preference text not null default 'distance' check (preference in ('distance','open','access')),
  updated_at timestamptz not null default now()
);
```

**트리거·함수 (`private`)**
- `private.handle_new_user()`: `auth.users` insert 후 `app.account` 행 생성(Supabase 표준 방식).
- `private.favorite_limit()`: insert 전에 `app.account` 행을 `for update`로 잠그고, 같은 기관이면 `return null`(멱등), 20개 이상이면 오류. 동시 요청에도 20개를 넘지 않게 한다.
- `private.has_consent(item text) returns boolean`: `consent_current`에서 본인 최신 값. 건강정보 테이블을 만들 경우 정책에서 사용.

**권한과 정책**

| 테이블 | authenticated 권한 | 정책 |
|---|---|---|
| account | select | 본인 행만 |
| consent_event | select, insert | 본인 행만, insert는 `with check (user_id = (select auth.uid()))`. update·delete 없음 |
| favorite | select, insert, delete | 본인 행만 |
| search_setting | select, insert, update, delete | 본인 행만 |

**동의 처리 순서와 남는 문제**
- 프론트는 약관 동의를 카카오 이동 **전에** 받는다. 콜백에서 세션이 생기면 서버가 그 선택을 `consent_event`에 넣는다.
- 카카오 인증만 하고 동의 저장 전에 이탈하면 `auth.users`만 남는다 → terms 동의가 없는 계정은 일정 시간 뒤 삭제하는 정리 작업이 필요하다(기간은 팀 결정).
- `healthStorage`는 `healthProcessing`이 있어야 한다는 의존 관계는 서버에서 검사한다.
- 탈퇴 시 동의 기록도 함께 지워진다. 동의 증빙을 탈퇴 후에도 보관해야 하는지는 확인되지 않았다(§5-6).

**선택: 건강정보 저장을 하기로 결정할 경우에만** (§5-1 안 B)
```sql
create table app.health_profile (
  user_id      uuid primary key references app.account(user_id) on delete cascade,
  age          smallint check (age between 0 and 120),
  allergies    text check (char_length(allergies)   <= 500),
  medications  text check (char_length(medications) <= 500),
  history      text check (char_length(history)     <= 500),
  confirmed_at timestamptz,   -- 마지막 확인일(나이 재확인용)
  updated_at   timestamptz not null default now()
);
-- 정책: 본인 행 + (select private.has_consent('healthStorage'))일 때만 select/insert/update
-- healthStorage 철회 행이 들어오면 트리거로 이 행을 즉시 삭제
```

---

## 5. 팀 결정이 필요한 것 (원칙 충돌 포함)

1. **건강정보·분석서 서버 저장 여부.** 프론트 동의서에는 `healthStorage`(만 나이·알레르기·복용약·기저질환 저장)와 `reportStorage`(분석서와 문진 답변 저장)가 이미 있다. 기획서는 "증상 원문과 불필요한 건강 정보는 저장하지 않음"이다.
   - 안 A (권장): 1차에서는 저장하지 않는다. 두 선택 동의는 화면에서 숨기고 PDF 내려받기로 대신한다.
   - 안 B: `health_profile`만 저장(§4 선택안). `reportStorage`는 문진 답변이 포함돼 원문 비저장 원칙과 충돌하므로 제외.
2. **회원 상담 새로고침 복원(README 0.24.1).** 서버에 대화 원문을 임시 저장해야 하므로 원칙과 충돌한다. 권장: 구현하지 않고 "새로고침하면 대화가 지워집니다" 안내로 대신한다.
3. **성별·나이 입력 위치**: D1 안(상담 대상으로 매번)을 받을지. 받으면 문진 첫 질문 형식을 팀원 1과 정한다.
4. **행동 데이터(개인화)**: 진료과 조회 기록을 저장하지 않는 D4에 동의하는지. 저장한다면 건강정보 처리 동의 범위에 넣어야 한다.
5. **AI 제공업체**: 기획서는 Gemini, 프론트 문서는 OpenAI를 후보로 적어 두었다. 하나로 정해야 동의문(제공·위탁·국외이전)을 쓸 수 있다.
6. **동의 증빙 보관**: 탈퇴 후에도 동의·철회 기록을 남길지(남긴다면 근거·기간).
7. **진료과 키**: 프론트 영문 키(29개) ↔ `ref.department.dept_id` ↔ 팀원 2 병원 데이터 코드(심평원/NMC). 6단계 `ref.department`에 `search_key`(프론트 키) 칸을 추가하는 것을 제안한다.
8. **14세 미만 정책**: 가입 연령 제한(D2)으로 갈지.

---

## 6. 앱이 `ref`를 읽는 방식

### 6.1 시작 때 한 번 불러오기
- `ref.symptom_synonym`(term_norm, symptom_id, term_type, span_group), `ref.symptom`(symptom_id, parent_id, name_ko, sex_restriction, is_injury, fallback_group), `ref.department`, `ref.app_config`를 공개 키(anon)로 읽어 캐시한다. 사전은 약 1,200행이라 한 번에 받아도 된다.
- `ref.data_version`의 최신 값이 캐시와 다를 때만 다시 받는다.

### 6.2 매칭은 브라우저에서 (제안, 팀원 1과 협의)
입력을 공백 제거로 정규화 → `term_norm` 긴 표현부터 찾기 → span_group 묶음 처리. 매칭에 성공하면 증상 원문이 서버로 가지 않는다. 매칭되지 않은 문장만 동의가 있을 때 LLM으로 보낸다. 원문 비저장 원칙을 지키기 가장 쉬운 구조다.

### 6.3 진료과 추천 조회
- 함수 하나로 규칙을 모은다(제안): `ref.recommend_departments(p_symptom_id text, p_sex text default null, p_age int default null)`, `stable`, `security invoker`.
  1. `ref.symptom_department`의 rec1~rec3 순서
  2. `ref.department.sex_only`가 있고 `p_sex`가 다르면 제외, `max_age`가 있고 `p_age`가 더 크면 제외(값이 null이면 제외하지 않음, D1)
  3. 모자라면 `clinic_ranking` → `hospital_ranking` 순으로 보충(보충 기준은 팀 내부 문서(확정사항 및 방법론) 2.3-6)
  4. 결과 상위 3개와 `fallback` 여부 반환
- `fallback = true`면 앱이 되묻기(부위·외상 여부·같이 있는 증상) 후 `ref.fallback_department`(injury/pediatric/general)를 쓴다.
- 성별·나이는 RPC 인자(POST 본문)로만 넘기고 저장하지 않는다.
- 응급 버튼은 `app_config`와 관계없이 프론트가 항상 표시한다(이미 그렇게 구현됨).

### 6.4 프론트 연결 지점
- 추천 진료과 → `search.department`(프론트 키)로 바꿔 검색 조건 카드에 전달.
- `rankFacilities` 후보의 `departments`와 추천 진료과 순위를 비교해 순서를 정한다.

---

## 7. 다음 작업 (Claude Code)

§5 결정 후 아래 순서로 진행한다.
1. S6 보완: `ref.department.search_key` 추가, `ref.recommend_departments` 함수(마이그레이션 `001b`).
2. S7-1: `db/migrations/002_app_schema.sql` 작성(§4, 결정에 따라 health_profile 포함 여부) → 멈춤.
3. S7-2: 적용 후 검증 — 두 테스트 계정으로 서로의 행을 읽기·쓰기 시도해 실패하는지, anon으로 `app` 접근이 막히는지, 즐겨찾기 21번째 insert가 막히는지, 탈퇴 시 cascade 삭제되는지.
4. 프론트 연결(팀원 3): `connectAccount`·`connectFavorites`를 Supabase로 구현. Supabase SSR 세션 쿠키 방식이 프론트 문서의 "토큰을 브라우저 JS에 두지 않음" 조건을 만족하는지 먼저 확인한다.

## 참고
- 개인정보 보호법 제16·21·22조의2·23조, 개인정보의 안전성 확보조치 기준(2025-10-31 시행)
- Supabase: Sign in with Kakao, RLS Performance and Best Practices, pgsodium(pending deprecation)
- 프론트: `frontend/README.md`, `frontend/docs/BACKEND.md`, `signup-consent.mjs`, `profile.mjs`, `departments.mjs`
