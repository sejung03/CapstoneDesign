# 7단계 프롬프트: DB 마무리 (ref 적재 + 보완 + app 스키마)

> 2026-11-14. Claude Code에게 순서대로 붙여 넣는 지시서다. 멈춤 지점은 세 번(D1 후, D3 후, D5 YAML 후).
> 근거 문서: `docs/prompts/6단계_Supabase_1차적재_프롬프트.md`(ref 스키마), `docs/7단계_사용자DB_설계.md`(app 스키마), 팀 내부 문서(확정사항 및 방법론) 2.3-2·2.3-5·2.3-6(필터·보충 규칙).
>
> 오늘 정한 것: 건강정보는 `health_profile`에 저장(저장 동의가 있을 때만), 이용 연령 만 14세 이상(`age14`, 팀 결정. Gemini 약관의 18세 이용자 조항과 다르지만 실서비스가 아니라 진행), 상담 복원은 보류(DB에 상담 테이블 없음), 행동 온톨로지는 팀원에게 넘김(`favorite`·`search_setting`만 준비).

---

## 0. 사람이 먼저 할 일

1. 이 파일을 `data_pipeline/docs/prompts/`에 넣는다.
2. Supabase 대시보드
   - 프로젝트가 없으면 만든다.
   - Data API 설정의 Exposed schemas에 `ref`, `app` 두 개를 추가한다(`private`는 추가하지 않는다).
3. `data_pipeline/.env`에 세 값이 있는지 확인한다(값은 채팅에 붙이지 않는다).
   - `SUPABASE_DB_URL`: Connect의 Session pooler 문자열(포트 5432)
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`(sb_publishable_…)

---

## D1 — ref 마이그레이션·시드 + 보완 (멈춤)

### Claude Code 머리말 (새 채팅일 때)
```
이 저장소는 의료 정보 도우미 앱의 증상·진료과 DB를 만드는 프로젝트야. 지금은 DB 마무리를 한다.
먼저 README.md, config/, docs/prompts/6단계_Supabase_1차적재_프롬프트.md, docs/prompts/7단계_DB마무리_프롬프트.md를 읽고 상태를 파악해.
원칙: data/raw/는 읽기만, 다시 돌려도 같은 결과, 키·접속 정보는 코드·로그·보고서에 쓰지 않음,
.env 파일은 열어서 내용을 출력하지 않음(코드에서 변수로만 읽음), AI Hub 답변 문장은 시드에 넣지 않음,
../frontend/ 폴더는 읽기만 하고 수정하지 않음, 지시에 없는 판단은 보고에 따로 적기.
아래 D1을 진행하고 멈춰서 보고해줘.
```

### D1 지시
```
D1을 진행한다. DB에는 아직 쓰지 않는다.

1. 6단계 문서의 S6-1을 그대로 수행한다.
   (db/migrations/001_ref_schema.sql, db/seed/v2.1-20261113/*.csv, pipeline/06a_build_seed.py, pipeline/06b_load_supabase.py --dry-run 지원)

2. 보완 A — 프론트 진료과 키 search_key
   - ref.department에 search_key text NULL UNIQUE 컬럼을 추가한다(001_ref_schema.sql 안에서).
   - ../frontend/departments.mjs의 departmentCatalog(key, keyword, aliases)를 읽어,
     ref.department.name_ko가 keyword 또는 aliases 중 하나와 정확히 같으면 그 key를 넣는다.
   - 매핑 결과를 config/dept_search_key.csv(name_ko, search_key)로 고정 저장하고, 시드는 이 파일에서 만든다.
   - 검사: symptom_department의 rec1~rec3와 fallback_department에 나오는 모든 dept_id에 search_key가 있어야 한다.
     하나라도 없으면 그 목록을 보고하고 멈춘다(임의로 짝짓지 않는다).

3. 보완 B — 성별·나이 필터를 미리 계산한 추천 표
   런타임에 SQL로 규칙을 다시 구현하지 않는다. 파이프라인에서 기존 규칙 코드를 재사용해 경우별 결과를 미리 만든다.
   - 새 테이블 ref.symptom_department_variant(
       symptom_id FK, sex text check (sex in ('female','male','unknown')),
       age_band text check (age_band in ('child','adult','unknown')),   -- child = 만 18세 이하
       rank int check (rank between 1 and 3), dept_id FK, level text, share numeric,
       data_version, primary key (symptom_id, sex, age_band, rank))
   - 경우마다 규칙(팀 내부 문서(확정사항 및 방법론) 2.3-2·2.3-6):
     · 산부인과는 sex='female' 또는 'unknown'일 때만 남긴다(dept_sex). sex_restriction=male 증상은 원래 결과 그대로.
     · 소아청소년과는 age_band='child' 또는 'unknown'일 때만 남긴다(dept_age, 나이를 모르면 모두 보여준다).
     · 걸러서 모자라면 clinic_ranking → hospital_ranking 순서로 보충한다.
       보충 후보에도 빌드 때와 같은 규칙(제외 과, 치과 진료 범위, 병원급 최소 비율 등 config/recommend.yaml)을 적용한다.
     · dept_rule로 고정한 증상(남성 생식기 → 비뇨의학과 하나만 등)은 보충하지 않는다.
     · fallback 증상은 이 표에 행을 만들지 않는다(앱이 되묻기 후 ref.fallback_department를 쓴다).
   - 생성은 pipeline/06a_build_seed.py 안에서, 같은 입력이면 같은 결과.
   - 검사: (unknown, unknown) 결과가 ref.symptom_department의 rec1~rec3와 같은지 전 증상 비교.

4. 보완 C — 조회 함수
   db/migrations/001b_ref_functions.sql:
   ref.recommend_departments(p_symptom_id text, p_sex text default 'unknown', p_age int default null)
     returns table(rank int, dept_id text, name_ko text, search_key text, level text, share numeric, is_fallback boolean)
   - language sql, stable, security invoker, set search_path = ''
   - p_age → age_band(null이면 unknown, 18 이하면 child, 그 외 adult). p_sex가 허용값이 아니면 unknown.
   - fallback 증상이면 행 1개(is_fallback=true, 나머지 null)를 돌려준다.
   - grant execute to anon, authenticated.

보고:
- 테이블별 시드 행 수, FK 검사 결과, 30자 넘는 term 목록, 표준 과 목록에 없던 이름
- search_key 매핑 결과(매핑된 과 / 매핑 안 된 과 / 프론트에만 있는 키)
- variant 표: 경우별로 결과가 (unknown, unknown)과 달라지는 증상 수와 예시 5개
- (unknown, unknown) 일치 검사 결과
- 지시에 없던 판단
```

---

## D2 — ref 적재·검증 (연속 진행)

```
D1 산출물로 적재하고 검증한다. 6단계 문서의 S6-2를 그대로 수행하고 아래를 더한다.

1. 마이그레이션 실행 순서: 001_ref_schema.sql → 001b_ref_functions.sql. 다시 실행해도 오류 없이 같은 상태가 되게 한다.
2. 06b_load_supabase.py --dry-run → 실제 적재(variant 표 포함, 한 트랜잭션).
3. 검증을 reports/step6_load.md에 추가:
   - publishable 키로 RPC 호출(rest/v1/rpc/recommend_departments, Accept-Profile/Content-Profile: ref):
     · 성별 제한 없는 증상 중 산부인과가 순위에 있는 것 1개: female/male 결과 비교
     · 소아청소년과가 1위인 증상 1개(예: 오한·발진): age 5 / age 30 / null 비교
     · fallback 증상 1개: is_fallback=true 확인
   - publishable 키로 ref 테이블 insert 시도 → 실패 확인
4. 키와 접속 정보는 보고서에 쓰지 않는다.
이어서 D3로 넘어간다.
```

---

## D3 — app 스키마 마이그레이션 작성 (멈춤)

```
docs/7단계_사용자DB_설계.md §4를 기준으로(나이 14세·결정 미정 부분은 이 지시서가 우선) db/migrations/002_app_schema.sql을 만든다. 아직 실행하지 않는다.
다시 실행해도 같은 상태가 되게 쓴다(create ... if not exists, drop policy if exists 후 create, create or replace function).

스키마
- create schema app; create schema private;
- revoke all on schema app from public, anon; grant usage on schema app to authenticated;
- private 스키마에는 anon·authenticated에 usage를 주지 않는다(트리거·security definer 함수 전용).

테이블 (설계 문서 §4 그대로, 아래만 바꾼다)
- app.account(user_id uuid PK → auth.users on delete cascade, created_at)
- app.consent_event: item check 목록을
  ('terms','account','age14','healthProcessing','healthStorage','reportStorage')로 한다.
  index (user_id, item, created_at desc)
- app.consent_current 뷰: with (security_invoker = true), 항목별 최신 행
- app.favorite: PK(user_id, facility_id), facility_id 정규식 ^[A-Za-z0-9_:.\-]{1,128}$,
  facility_type hospital|pharmacy, name_ko 1~300자, name_en ≤300, address ≤500
- app.search_setting: user_id PK, region ≤80, preference distance|open|access
- app.health_profile: user_id PK, age smallint 0~120, allergies·medications·history 각 ≤500자, confirmed_at, updated_at

함수·트리거 (전부 private, security definer, set search_path = '')
- private.handle_new_user(): auth.users insert 후 app.account 행 생성
- private.has_consent(p_item text) returns boolean: (select auth.uid())의 consent_current 최신 agreed
- private.favorite_limit(): insert 전 app.account 해당 행 for update 잠금 → 같은 facility_id면 return null(멱등)
  → 이미 20개면 오류(SQLSTATE 지정, 메시지 'favorite limit 20')
- private.on_consent_withdrawn(): consent_event에 healthStorage 또는 healthProcessing이 agreed=false로 들어오면
  해당 user의 app.health_profile 행 삭제
- private.touch_updated_at(): search_setting·health_profile update 시 updated_at 갱신
- 함수 실행 권한: public·anon에서 revoke. has_consent만 authenticated에 grant(정책에서 쓰므로).

권한과 RLS (모든 app 테이블 enable row level security)
- 정책은 모두 to authenticated, 조건은 (select auth.uid()) = user_id
- account: select
- consent_event: select, insert(with check). update·delete 정책 없음
- favorite: select, insert(with check), delete
- search_setting: select, insert, update, delete
- health_profile: select·insert·update·delete 모두 본인 행 AND (select private.has_consent('healthStorage'))
  (insert·update는 with check에도 같은 조건)
- grant: 위 정책에 맞는 명령만 authenticated에 grant. anon에는 app 테이블 권한 없음.

동의 의존 관계(healthStorage는 healthProcessing 필요)는 DB에서 강제하지 않고 서버 담당 몫으로 보고에 적는다.

보고: SQL 요약(테이블·정책·함수 목록), 설계 문서와 다르게 한 부분과 이유. 여기서 멈춘다.
```

---

## D4 — app 스키마 적용·RLS 검증 (연속 진행)

```
002_app_schema.sql을 실행하고 검증한다. 결과는 reports/step7_app_schema.md.

검증은 DB 연결(SUPABASE_DB_URL) 위에서 한 트랜잭션 안에서 하고 마지막에 rollback한다(실제 계정·데이터를 남기지 않는다).
- auth.users에 가짜 사용자 A, B를 넣는다 → app.account가 자동 생성되는지 확인
- set local role authenticated; set_config('request.jwt.claims', '{"sub":"<A>","role":"authenticated"}', true)로 A가 되어:
  1. A가 favorite 추가·조회 가능, B의 행은 0행으로 보이고 B 행 insert는 실패
  2. 같은 기관 두 번 insert → 오류 없이 1행 유지(멱등)
  3. 21번째 favorite insert → 'favorite limit 20' 오류
  4. healthStorage 동의 없이 health_profile insert → 실패
  5. healthStorage agreed=true 넣은 뒤 insert → 성공, age 121 → check 실패
  6. healthStorage agreed=false 넣으면 health_profile 행 삭제됨
  7. consent_event update·delete → 실패
- role anon으로 app.favorite select → 권한 오류
- auth.users에서 A 삭제 → A의 app 행 전부 cascade 삭제
- publishable 키로 REST 조회(Accept-Profile: app) → 로그인 없이 거부되는지
- 모든 app 테이블의 컬럼 이름 목록(증상·대화 원문 컬럼이 없는지 확인용)

마이그레이션은 두 번 실행해도 오류가 없는지 확인한다.
키와 접속 정보는 보고서에 쓰지 않는다.
끝나면 README.md에 DB 구성(ref, app, private 스키마와 마이그레이션 실행 순서)을 짧게 추가한다.
```

---

## D5 — 문진 구조화: 문항 / 안전 규칙 / 결과 매핑 / 질문 주제 (YAML 작성 후 멈춤 → 확인 후 적재)

원본: `data/raw/응급 및 비응급 공통 문진.pdf`(팀 작성, 5쪽). 질문 문구는 PDF 그대로 쓴다.

**설계 기준** (11/14 ChatGPT 교차 검토 반영)
- 팀 정의: 문진 온톨로지 = "질문·정보·규칙·안내 근거를 연결"(공통 협업 기준). 그래서 한 표에 모든 의미를 몰지 않고 네 부분으로 나눈다.
  1. **문항 정의**: 질문, 선택지, 보이는 조건, 순서
  2. **안전 규칙**: 조건, 우선순위, 결과(응급 중단·긴급 안내), 근거
  3. **결과 매핑**: 답 값·규칙 결과 → 119 신고 카드·분석서·진료과 필터의 어느 칸
  4. **질문 주제**: 질문이 어떤 증상·119 범주를 다루는지(주제일 뿐, "사용자에게 그 증상이 있다"는 뜻이 아님)
- 문항 정의는 **HL7 FHIR R4 Questionnaire를 참조한 제한된 스키마**다. FHIR 준수라고 부르지 않는다.
  지원 범위: item type `choice` | `string` | `display`, `answerOption`, `required`, `enableWhen`(operator `=`, `!=`, `exists`), `enableBehavior`(`all` | `any`, 한 단계만).
  중첩 그룹, 반복 문항, 복수 선택, 조건식은 지원하지 않으며 **검사에서 거부**한다.
- 응급 판단은 질문 항목에 달지 않는다. 엔진이 **답이 들어올 때마다 안전 규칙부터** 평가한다(엔진은 다음 단계 작업).

**프론트 제약**: 서버가 보내는 질문은 선택형만 그려지고, 선택지 1~12개, ID는 영문·숫자·밑줄·하이픈 1~80자, 문구 ko 필수·en 선택 300자 이하(frontend/docs/BACKEND.md 0.20.0). `string` 문항은 대화 메시지로 받는다. 프론트 기존 기능이 처리하는 문항은 `ui: frontend`로 표시한다.

```
D5를 진행한다. 먼저 YAML만 만들고 멈춘다.

1. config/intake_v1.yaml 작성 (사람이 읽고 고치는 원본). 네 구역으로 나눈다.

   [questionnaire] id, version(intake-v1), title, source(팀 문진 PDF)

   [items] 문항 정의
   - link_id, order(정수, 명시적 순서), text(ko), text_en(선택), type(choice|string|display), required
   - answer_options: [{code, display}] — code는 정규화 값(yes|no|unknown, pain_7, onset_today 등)
   - enable_when: [{question(link_id), operator(=|!=|exists), answer(code 또는 boolean)}], enable_behavior(all|any)
   - flow: start | emergency | safety | target | detail | pain | fallback (구분용)
   - ui: frontend (해당할 때만), source: team_pdf | added, todo: true (선택지 미정일 때만)

   [safety_rules] 안전 규칙 (결정표)
   - rule_id, priority(작을수록 먼저), conditions: [{question, operator(=|in), answer 또는 answers}], combine(all|any)
   - result: EMERGENCY_STOP | URGENT_NOTICE, terminal: true|false(이후 진료과 추천 금지 여부)
   - triage_category_id(해당하면), message_key
   - evidence: {source(team_pdf|manual_119), page, note}, review_status: draft | team_reviewed
   - 1차 규칙은 문진 PDF에 있는 것만 만든다:
     · Q0 = yes → EMERGENCY_STOP, terminal
     · N1 in (no, unknown) → URGENT_NOTICE
     · N2 in (no, unknown) → URGENT_NOTICE
     · N3 in (yes, unknown) → URGENT_NOTICE
     · URGENT_NOTICE의 terminal 값은 PDF("긴급 안내")만으로 정해지지 않으므로 true로 두고 보고에 판단으로 적는다
   - 자유 입력의 위험 표현 규칙은 다음 작업(위험 표현 사전)에서 추가한다. 지금은 만들지 않는다.

   [output_mappings] 결과 매핑
   - from: answer | rule, question 또는 rule_id, when(answer code 또는 any), slot, value(선택)
   - slot 이름은 아래 목록에서만 고른다:
     card.*(119 신고 요약): is_self, with_patient, location_known, consciousness, breathing, bleeding, injury, patient_count, onset
     report.*(분석서, 프론트 필드명): symptom, onset, notes
     filter.*(진료과 필터): sex, age_band(child|adult|unknown), infant(true|false)
     detail.*: continuous, worsening, prior_episode, aggravating, relieving, self_treatment, daily_impact, related_condition, pain_score, pain_site, pain_quality
     flow.*: emergency_stop, urgent_notice

   [item_topics] 질문 주제
   - question, system(icpc2 | symptom_id | triage_119), system_version(예: ICPC-2e v7.0 / v2.1-20261113), code
   - 주제가 분명한 질문만 넣는다(예: E5 호흡 → 관련 119 범주). 없으면 비운다.

   PDF 질문 변환 규칙
   - Q0: E1~E9는 enable_when Q0 = yes, N1 이후는 enable_when Q0 = no
   - E1~E9: 예/아니요/확인 불가는 PDF 그대로. E3 위치는 ui frontend(프론트 응급 모달 위치 기능).
     E8 환자 수: 1명 / 2명 / 3명 이상 / 모름. E9 시작 시각: 1시간 이내 / 1~6시간 / 6~24시간 / 하루 이상 / 모름
   - N1~N3: PDF 그대로 + '잘 모르겠어요' 선택지 추가(PDF: 확인 불가는 안전하다고 판단하지 않음)
   - N4 증상: type string, 결과 매핑 report.symptom (사전 매칭 대상)
   - N5~N13: PDF 처리 그대로. 하위 확인은 부모 답에 enable_when을 건 choice 문항
     · 시작 시점: 1시간 이내 / 오늘 / 1~3일 전 / 4~7일 전 / 1~4주 전 / 1달 이상 / 모름
     · N6 빈도: 하루 여러 번 / 하루 한 번 / 며칠에 한 번 / 가끔 / 모름
     · N12 영역: 수면 / 식사 / 보행 / 업무·학업 / 기타 (PDF 항목). 복수 선택이 필요하면 지원하지 않으므로 '가장 불편한 것 하나'로 묻는다
     · N11 효과: 좋아짐 / 그대로 / 나빠짐 / 모름. 약·처치 이름과 N13 질환명은 type string
   - 통증: 통증 강도 0~10(선택지 11개), 부위는 config/body_part_ui.yaml의 화면 그룹(12개 넘으면 보고), 양상은 '선택지 없음' 규칙
   추가 문항(source: added)
   - T1 누구의 증상인가요: 본인 / 아이 / 다른 사람
   - T2 성별: 여성 / 남성 / 모름 → filter.sex
   - T3 나이: 1세 미만 / 1~12세 / 13~18세 / 19~64세 / 65세 이상 / 모름
     → filter.age_band(18세 이하 child), 1세 미만은 filter.infant=true
   - 순서: N1~N3 → T1~T3 → N4 → 상세
   - fallback 되묻기 F1~F3(flow fallback): 엔진이 증상이 fallback일 때만 낸다(enable_when이 아니라 엔진 조건, YAML에 그 사실을 적는다).
     F1 부위(body_part_ui 그룹), F2 다쳐서 생긴 건가요(예/아니요/모름), F3 같이 있는 다른 증상(string)

   선택지 없음 규칙: PDF에 선택지 목록이 없는 항목(N9 악화 요인, N10 완화 요인, 통증 양상)은 지어내지 않는다.
   answer_options를 비우고 todo: true로 표시한 뒤, 보고에 후보 목록만 따로 제안한다.

2. 검사 (스크립트로)
   - 지원 범위 밖 기능(중첩, 반복, 복수 선택, 다른 operator, 2단계 조건)이 있으면 실패
   - link_id·rule_id 유일, order 중복 없음
   - enable_when.question이 존재하고 자기보다 앞 순서인지, 순환 없음, 어떤 답 조합으로도 안 보이는 문항 없음
   - 선택지 1~12개, ID 형식, 문구 300자 이하
   - 안전 규칙: 조건이 가리키는 문항·선택지 code가 실제로 있는지, evidence 필수
   - Q0 = yes와 N1~N3 위험 답(모름 포함)이 모두 어떤 안전 규칙에 걸리는지
   - 결과 매핑 slot이 목록 안에 있는지, item_topics의 code가 ref 데이터에 실제로 있는지

보고: 문항 수(flow별), 안전 규칙 목록, 변환하며 바꾼 점(PDF 문구와 다른 곳은 전부), todo 항목과 후보 제안,
지시에 없던 판단(URGENT_NOTICE terminal 포함), 검사 결과. 여기서 멈춘다.
```

YAML 확인 후 이어서:

```
D5 적재를 진행한다.
1. db/migrations/003_ref_intake.sql (모두 ref 스키마, data_version 컬럼 포함)
   questionnaire(id PK, version, title, source)
   questionnaire_item(link_id PK, questionnaire_id FK, order_no UNIQUE, text_ko, text_en, item_type check(choice|string|display),
                      required, enable_behavior NULL check(all|any), flow, ui NULL, source, todo)
   questionnaire_answer_option(link_id FK, code, order_no, display_ko, display_en, PK(link_id, code))
   questionnaire_enable_when(id PK, link_id FK, question FK→questionnaire_item, operator check(=|!=|exists), answer text)
   safety_rule(rule_id PK, priority, combine check(all|any), result check(EMERGENCY_STOP|URGENT_NOTICE), terminal,
               triage_category_id NULL FK, message_key, evidence_source, evidence_page NULL, evidence_note, review_status)
   safety_rule_condition(id PK, rule_id FK, question FK, operator check(=|in), answers text[])
   output_mapping(id PK, from_type check(answer|rule), question NULL FK, rule_id NULL FK, when_code NULL, slot, value NULL)
     check: from_type=answer이면 question 필수, rule이면 rule_id 필수
   item_topic(id PK, question FK, system check(icpc2|symptom_id|triage_119), system_version, code)
   RLS·권한은 다른 ref 테이블과 같게(anon·authenticated select만)
2. pipeline/06d_build_intake_seed.py: intake_v1.yaml → db/seed/<data_version>/ 아래 CSV, 같은 입력이면 같은 결과. D5 검사도 여기서 다시 돌린다.
   (선택) 문항 정의만 FHIR R4 Questionnaire JSON으로도 내보낸다(questionnaire_fhir.json). 우리 전용 정보는 정의된 URL을 가진 extension으로 넣고,
   안전 규칙·결과 매핑은 FHIR 렌더러가 실행하지 않는다는 점을 파일 상단 설명에 적는다.
3. 06b_load_supabase.py에 위 테이블 추가 → dry-run → 적재
4. 검증(reports/step7_intake.md): 테이블별 행 수 = 시드, publishable 키로 Q0·선택지·안전 규칙 조회, D5 검사 재실행 결과
```

---

## 완료 후 사람이 할 일
- `db/`, `pipeline/06*.py`, `config/dept_search_key.csv`, `config/intake_v1.yaml`, `reports/step6_load.md`, `reports/step7_app_schema.md`, `reports/step7_intake.md`를 commit·push(.env, data/raw 제외 확인)
- 팀원(행동 온톨로지·백엔드)을 Supabase 조직 멤버로 초대
