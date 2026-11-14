# 7단계 app 스키마 적용·RLS 검증

- 마이그레이션: `db/migrations/002_app_schema.sql` (`pipeline/06c_run_migrations.py`). 먼저 실행 후 롤백으로 점검, 적용, 한 번 더 실행해도 오류 없음
- 검증: `pipeline/07a_verify_app.py`. DB 연결 위 한 트랜잭션에서 가짜 사용자 A·B로 확인하고 마지막에 rollback
- 사용자 흉내: `set local role authenticated` + `request.jwt.claims`의 sub
- 접속 정보와 키는 이 보고서에 쓰지 않는다.

## 1. 확인 결과

| 구분 | 확인 | 기대 | 실제 | 통과 |
|---|---|---|---|---|
| 권한 정의 | authenticated의 private.handle_new_user() 실행 권한 | false | false | 예 |
| 권한 정의 | anon의 private.handle_new_user() 실행 권한 | false | false | 예 |
| 권한 정의 | authenticated의 private.has_consent(text) 실행 권한 | true | true | 예 |
| 권한 정의 | anon의 private.has_consent(text) 실행 권한 | false | false | 예 |
| 권한 정의 | authenticated의 private.favorite_limit() 실행 권한 | false | false | 예 |
| 권한 정의 | anon의 private.favorite_limit() 실행 권한 | false | false | 예 |
| 권한 정의 | authenticated의 private.on_consent_withdrawn() 실행 권한 | false | false | 예 |
| 권한 정의 | anon의 private.on_consent_withdrawn() 실행 권한 | false | false | 예 |
| 권한 정의 | authenticated의 private.touch_updated_at() 실행 권한 | false | false | 예 |
| 권한 정의 | anon의 private.touch_updated_at() 실행 권한 | false | false | 예 |
| 권한 정의 | anon의 private 스키마 usage | false | false | 예 |
| 권한 정의 | authenticated의 private 스키마 usage | true | true | 예 |
| 권한 정의 | anon의 app 스키마 usage | false | false | 예 |
| 권한 정의 | authenticated의 app 스키마 usage | true | true | 예 |
| 권한 정의 | handle_new_user의 insert가 on conflict do nothing | 예 | 예 | 예 |
| 권한 정의 | anon의 app 테이블 권한 수 | 0 | 0 | 예 |
| 권한 정의 | RLS 켜진 app 테이블 | 5 / 5 | 5 / 5 | 예 |
| 가입 트리거 | auth.users에 A, B insert → app.account 자동 생성 | 2행 | 2행 | 예 |
| 가입 트리거 | handle_new_user를 같은 사용자(A)에 두 번째 실행 → 오류 없음, account 1행 | 성공 (1) | 성공 (1) | 예 |
| A 사용자(authenticated) | 1. A favorite 추가 | 성공 (F-01) | 성공 (F-01) | 예 |
| A 사용자(authenticated) | 1. A favorite 조회 | 성공 (1) | 성공 (1) | 예 |
| A 사용자(authenticated) | 1. B의 favorite는 0행으로 보임 | 성공 (0) | 성공 (0) | 예 |
| A 사용자(authenticated) | 1. B 행 insert | 실패 42501 | 실패 42501 not your favorite | 예 |
| A 사용자(authenticated) | 1. B가 이미 가진 기관(B-1)을 B 행으로 insert → 존재 여부 노출 없이 거부 | 실패 42501 | 실패 42501 not your favorite | 예 |
| A 사용자(authenticated) | 2. 같은 기관 두 번 insert → 오류 없음, 1행 유지 | 성공 (1) | 성공 (1) | 예 |
| A 사용자(authenticated) | 3. 20개까지 채움 | 성공 (20) | 성공 (20) | 예 |
| A 사용자(authenticated) | 3. 21번째 favorite insert | 실패 23514 favorite limit 20 | 실패 23514 favorite limit 20 | 예 |
| A 사용자(authenticated) | 3. 20개일 때 이미 있는 기관 다시 insert → 오류 없음(멱등) | 성공 (20) | 성공 (20) | 예 |
| A 사용자(authenticated) | 4. healthStorage 동의 없이 health_profile insert | 실패 42501 | 실패 42501 new row violates row-level security policy for table "health_profile" | 예 |
| A 사용자(authenticated) | 5. healthProcessing·healthStorage agreed=true 기록 | 성공 (True) | 성공 (True) | 예 |
| A 사용자(authenticated) | 5. 동의 후 health_profile insert | 성공 (30) | 성공 (30) | 예 |
| A 사용자(authenticated) | 5. age 121로 update → check 실패 | 실패 23514 | 실패 23514 new row for relation "health_profile" violates check constraint "health_profile_age_check" | 예 |
| A 사용자(authenticated) | search_setting insert(updated_at 2000-01-01) 후 update → updated_at 갱신 | 성공 (True) | 성공 (True) | 예 |
| A 사용자(authenticated) | consent_event에 created_at 직접 지정 insert(컬럼 권한 없음) | 실패 42501 | 실패 42501 permission denied for table consent_event | 예 |
| A 사용자(authenticated) | age14가 아닌 age18 항목 insert → check 실패 | 실패 23514 | 실패 23514 new row for relation "consent_event" violates check constraint "consent_event_item_check" | 예 |
| A 사용자(authenticated) | age14 항목 insert | 성공 (age14) | 성공 (age14) | 예 |
| A 사용자(authenticated) | 6. healthStorage agreed=false 기록 → health_profile 행 삭제 | 성공 (False) | 성공 (False) | 예 |
| A 사용자(authenticated) | 6. 철회 뒤 DB의 A health_profile 행(관리자 확인) | 0행 | 0행 | 예 |
| A 사용자(authenticated) | 7. consent_event update | 실패 42501 | 실패 42501 permission denied for table consent_event | 예 |
| A 사용자(authenticated) | 7. consent_event delete | 실패 42501 | 실패 42501 permission denied for table consent_event | 예 |
| A 사용자(authenticated) | consent_current: A의 healthStorage 최신 = false | 성공 (False) | 성공 (False) | 예 |
| anon | anon으로 app.favorite select | 실패 42501 | 실패 42501 permission denied for schema app | 예 |
| anon | anon으로 private.has_consent 실행 | 실패 42501 | 실패 42501 permission denied for schema private | 예 |
| 탈퇴 | auth.users에서 A 삭제 → A의 app 행 전부 삭제 | 모두 0 | account 1→0, consent_event 4→0, favorite 20→0, search_setting 1→0, health_profile 0→0 | 예 |
| 탈퇴 | B의 행은 그대로 | favorite 1행 | favorite 1행 | 예 |
| 정리 | 롤백 뒤 남은 가짜 사용자 | 0 | 0 | 예 |
| REST | publishable 키로 로그인 없이 app.favorite 조회 | 거부(401/403) | HTTP 401 42501 (permission denied for schema app) | 예 |

## 2. 정책

| 테이블 | 정책 | 명령 | 역할 |
|---|---|---|---|
| app.account | own select | SELECT | authenticated |
| app.consent_event | own insert | INSERT | authenticated |
| app.consent_event | own select | SELECT | authenticated |
| app.favorite | own delete | DELETE | authenticated |
| app.favorite | own insert | INSERT | authenticated |
| app.favorite | own select | SELECT | authenticated |
| app.health_profile | own delete with consent | DELETE | authenticated |
| app.health_profile | own insert with consent | INSERT | authenticated |
| app.health_profile | own select with consent | SELECT | authenticated |
| app.health_profile | own update with consent | UPDATE | authenticated |
| app.search_setting | own delete | DELETE | authenticated |
| app.search_setting | own insert | INSERT | authenticated |
| app.search_setting | own select | SELECT | authenticated |
| app.search_setting | own update | UPDATE | authenticated |

## 3. app 테이블·뷰 컬럼 (증상·대화 원문 컬럼 없음 확인)

- `app.account`: user_id, created_at
- `app.consent_current`: user_id, item, agreed, policy_version, created_at
- `app.consent_event`: id, user_id, policy_version, item, agreed, created_at
- `app.favorite`: user_id, facility_id, facility_type, name_ko, name_en, address, created_at
- `app.health_profile`: user_id, age, allergies, medications, history, confirmed_at, updated_at
- `app.search_setting`: user_id, region, preference, updated_at

증상·대화·문진 답변·분석서·응급 위치·상담 대상 성별·나이·조회한 진료과를 담는 컬럼은 없다. `health_profile`의 allergies·medications·history는 healthStorage 동의가 있을 때만 읽고 쓴다.

## 결과

확인 47개 중 통과 47개. 문제 없음.
