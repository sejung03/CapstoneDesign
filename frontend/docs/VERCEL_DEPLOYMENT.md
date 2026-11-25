# Vercel 배포 준비

## 프로젝트 설정

- Git 저장소 전체를 연결하고 Root Directory를 `frontend`로 설정합니다.
- Root Directory 설정의 **Include source files outside of the Root Directory in the Build Step** 옵션을 켭니다. `care_engine`과 `data_pipeline`이 빌드에 필요합니다.
- 필요한 환경변수와 `APP_URL`은 사용할 배포 환경에 등록합니다. 실제 비밀 파일은 저장소나 배포 파일에 추가하지 않습니다.
- STT 설정은 `VOICE_PREVIEW.md`, 배포 후 점검은 `RELEASE_SMOKE_TEST.md`를 참고합니다.

## 문진 엔진 포함 방식

`next.config.mjs`의 `outputFileTracingRoot`는 저장소 루트입니다. `/api/care`의 파일 목록에 엔진과 LLM 모듈(`.mjs`), 위험 표현·기관 검색 규칙(`.json`), `v2.1-20261113` 기준 데이터(`.csv`)를 명시적으로 포함합니다. 엔진 폴더 전체를 복사하지 않으므로 비밀 파일과 평가 자료는 포함 대상이 아닙니다.

엔진 위치는 실행 폴더의 상위 `care_engine`, 실행 폴더 안의 `care_engine` 순서로 검사합니다. 다른 배치를 사용하는 경우 서버 환경변수 `CARE_ENGINE_DIR`로 경로를 지정할 수 있습니다. 엔진과 `data_pipeline`의 상대 디렉터리 구조는 유지해야 합니다.

빌드 후 `.next/server/app/api/care/route.js.nft.json`에서 위 파일들이 포함되는지 확인합니다. Supabase 기준 데이터 로딩이 실패하면 기존처럼 CSV를 사용합니다. 실제 배포에서는 `/api/care`가 `engine_unavailable`을 반환하지 않고 첫 질문과 위험 표현 판정을 처리하는지 확인합니다.

## 회원가입

회원가입 API는 배포 환경이나 `operationalReady` 값으로 가입을 차단하지 않습니다. 별도 시연 스위치나 화면 안내는 없습니다. 카카오 인증, 요청 출처 검사, 정책 버전·필수 동의·선택 항목 의존성 검사와 Supabase 동의 기록 저장은 유지합니다. `operationalReady`는 정책 문서의 준비 상태를 나타내는 값으로 남겨 둡니다.
