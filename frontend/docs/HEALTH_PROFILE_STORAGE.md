# 회원 건강정보 DB 저장 적용

이 패키지는 personalization 브랜치 b14787320df7c083504efe34813041dfe1c06959 기준입니다.

## 포함 기능

- 회원은 건강정보 저장 동의 후 본인 계정의 app.health_profile에 저장하고 새로고침 시 복원합니다.
- 건강정보 지우기는 healthStorage 동의 철회 이벤트를 기록합니다. 기존 consent_withdrawn DB 트리거가 같은 트랜잭션에서 건강정보를 삭제합니다.
- 비회원은 현재 페이지 메모리에서만 유지하고 새로고침 시 초기화합니다. localStorage/sessionStorage에 건강정보를 기록하지 않습니다.
- 저장/삭제가 실패하면 기존 정보와 입력을 유지하고 오류를 표시합니다. 계정 전환과 늦은 응답으로 정보가 섞이지 않도록 검사합니다.
- 알레르기·복용약·병력의 기존 500자 제한을 유지합니다.
- 가입 동의서 모달 안에서 한국어·영어·중국어·베트남어·우즈베크어를 선택합니다. 기존 번역 파일을 사용하고 언어 변경 시 동의 체크를 초기화하여 다시 검토하게 합니다. 선택 언어는 다음 화면에도 유지합니다. 번역 문구의 의미 검수는 별도입니다.

## 코드 적용

압축의 files 폴더 안 frontend를 저장소 최상위의 frontend와 합치거나, 다음 패치를 사용합니다. 두 방법을 중복 적용하지 않습니다.

```powershell
git switch personalization
git switch -c feature/member-health-storage
git apply --check 회원건강정보_DB저장.patch
git apply 회원건강정보_DB저장.patch
cd frontend
npm ci
npm test
npm run build
npm run dev
```

패치 파일이 다른 폴더에 있다면 실제 경로를 지정하세요. 기준 커밋 이후 코드가 변경되었다면 전체 파일을 덮어쓰기보다 패치를 검토하여 적용하세요. main에는 이 패치가 전제하는 로그인·Supabase 클라이언트가 없을 수 있으므로 personalization의 기존 인증 코드와 함께 반영해야 합니다.

검토 후 GitHub Desktop의 변경 목록 또는 git diff에서 이 패키지의 14개 파일만 확인하고 원하는 브랜치에 커밋·push하세요. 패키지 전체(files 상위 폴더, ZIP, 패치, manifest)를 그대로 저장소 안에 넣는 방식은 권장하지 않습니다.

## DB 전제 조건

기존 data_pipeline/db/migrations/002_app_schema.sql이 적용되어 있어야 합니다. app.account, consent_event, consent_current, health_profile 및 RLS, authenticated 권한, 계정 생성 트리거와 동의 철회 트리거를 사용합니다. 기존 코드에 있는 마이그레이션이므로 패키지에서 다시 만들거나 자동 실행하지 않습니다.

- Supabase Data API에서 app 스키마가 노출되어 있어야 합니다.
- 로그인 계정에 대응하는 app.account 행이 있어야 합니다. 마이그레이션 적용 이전에 생성한 회원은 누락 여부를 확인하세요.
- 인증·기본 가입 동의 검사는 기존 public.capstone_account_consents를 그대로 사용합니다.
- 건강정보 저장 동의는 app.consent_event에 별도로 기록합니다.
- 기존 .env.local의 Supabase URL·publishable 키와 APP_URL을 사용합니다. 서버 secret 키로 RLS를 우회하지 않습니다. 비밀키는 이 패키지에 없습니다.

## 기능 확인

1. 로그인 → 내 정보 → 건강정보 처리 동의 확인.
2. 건강정보 입력 → 계정 저장 동의 선택 → 건강정보 저장.
3. Supabase Table Editor의 app.health_profile에서 본인 행 확인, 새로고침 후 화면 복원 확인.
4. 건강정보 지우기 → 해당 행 삭제 확인. app.consent_event에 healthStorage=false 기록 확인.
5. 로그아웃 후 비회원 입력·저장 → 새로고침 시 초기화 확인.
6. 가입 동의서 창 안의 언어를 바꾸어 동의서 문구 변경과 체크 초기화를 확인합니다. 자동 UI 검사는 frontend에서 node --test tests-next/signup-language-ui.test.mjs로 실행합니다.

API는 /api/health-profile의 GET, PUT, DELETE입니다. 회원 인증과 사용자별 RLS가 적용되며 다른 origin의 쓰기 요청은 차단합니다. X-Account-Scope는 화면과 서버의 계정 불일치 확인용이며 인증 수단이 아닙니다.

## 검증과 한계

건강정보 기능 테스트 8개와 기존 프론트 회귀 테스트를 로컬 통합본에서 검증했습니다. 빌드된 React UI에서도 가상 계정 저장·새 페이지 복원·삭제와 비회원 초기화를 확인했습니다. 이번 패키지는 별도 personalization 원본에 적용하여 건강정보 테스트와 패치 적용을 다시 검사합니다. 실제 로그인 계정의 원격 DB 쓰기·삭제·RLS는 아직 별도 확인이 필요합니다. 원격 DB에 테스트 회원이나 건강정보를 기록하지 않았습니다.

지도 진입 버튼, 모의 LLM·통합 시험 API, 기준 데이터 로더 변경, 시험용 Next 설정과 실행기는 이 패키지에 포함하지 않았습니다. 건강정보가 저장된다는 것 자체가 실제 LLM·개인화 추천 엔진까지 연결되었다는 의미는 아닙니다.
