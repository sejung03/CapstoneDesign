# 행동 온톨로지 — DB 연결 전 프론트엔드 통합 가이드

## 무엇이 구현되었나

- 서버 `lib/behavior/`: GUMO에서 착안한 4개 명시적 선호 진술, 허용목록 검증, 선호 신호, 적용 이유 템플릿.
- 개발 전용 API `/api/behavior-demo/*`: 가짜 계정 A/B, 메모리 기반 `search_setting`/`favorite` 대응 데이터. **실제 인증도 DB도 아닙니다. 운영환경에서는 404**.
- `내 정보 → 행동 온톨로지 · 개인화 설정`: 기본 지역/정렬 저장, 가상 병원 즐겨찾기 추가, 저장 지역 검색창 입력, ON/OFF, 전체 삭제, 관계·근거/시각 표시, 계정 A/B 전환.
- 기존 검색 결과의 별표 클릭도 데모 API의 `favorite`와 연동합니다.
- 개인화 OFF 시 `getPreferenceSignal()`이 `null`. 기존 대화 결과의 일괄 즐겨찾기 앞으로 보내기 동작도 모의 개인화 OFF에서는 중단됩니다.
- 검색창에서 일회성으로 바꾼 지역은 온톨로지 저장값을 변경하지 않습니다.

## 로컬 실행

Node.js 버전은 `package.json` 요구사항(`^22.22.2 || ^24.15.0 || >=26`)을 따르세요.

```bash
cd CapstoneDesign-main/frontend
npm ci
npm run dev
```

브라우저에서 `http://127.0.0.1:3080` → **내 정보(사람 아이콘)**.

1. **가짜 계정 A**에서 기본 정렬=거리/운영 여부/접근성, 기본 지역=가상의 테스트 지역을 입력하고 **기본 설정 저장**.
2. 아래 온톨로지 진술 `hasPreference / sortOrder`, `hasPreference / searchRegion`의 값과 저장 근거를 확인.
3. **가상 병원 즐겨찾기 추가**를 눌러 기존 즐겨찾기 목록과 `hasFavorite / facility` 및 `favoriteIds` 변화를 확인.
4. **개인화 끄기** → 저장 데이터는 그대로, 신호는 없음. **켜기** → 다시 신호 생성.
5. **A→B**로 바꿔 B에는 데이터가 없는지 확인, B에 별개 값 저장 후 A로 돌아와 기존 값이 유지되는지 확인.
6. **검색 설정·즐겨찾기 전체 삭제** 후 해당 가짜 계정의 값만 비워지는지 확인.
7. **저장 지역을 검색창에 입력**을 클릭한 다음, 검색 화면의 입력칸 값 확인. 검색 요청은 **검색 버튼을 눌러야** 시작. 검색 결과는 실제 지도 API 구성에 따라 달라질 수 있습니다.

## 로직 테스트

```bash
node --test tests/behavior-ontology.test.mjs tests/behavior-ui-bridge.test.mjs
npm test
```

`npm run check:next` 및 실제 Next.js 화면 동작은 Node/Next 의존성 설치 후 환경에서 별도로 확인하세요.

## 파일 병합

- **전체본 ZIP**은 원본 프로젝트 + 행동 온톨로지 + UI 연결을 모두 담습니다.
- **패치 ZIP**은 `CapstoneDesign-main/frontend` 폴더 안에 붙여 넣을 변경/추가 파일을 같은 상대 경로로 담았습니다.
- 이미 따로 작업 중인 파일은 무조건 덮어쓰지 말고 비교/백업하세요. 특히 `app.js`, `components/profile.jsx`, `workspace.css`는 수정된 기존 파일입니다.

## 팀원 2 / DB 연결 시 주의사항

- `getPreferenceSignal`의 `applied: []`는 실제 정렬을 실행하기 전의 정상 상태입니다. `reason.ko`는 `rankFacilities`에서 실제 적용한 조건을 넘긴 후에만 생성하세요. `open`·`access` 선호는 현재 프론트 정렬 목록(`recommended/distance/name`)과 별개입니다.
- 기존 `favoriteFirst()`는 일괄 맨 앞으로 보내는 방식이므로, 팀원 2가 최종적으로 **동점 시만 우선**하도록 대체해야 합니다. 개인화 OFF일 때의 해당 우선순위는 이번 통합본에서 비활성화했습니다.
- 현재 `personalization_enabled`는 DB 담당에게 요청한 컬럼입니다. DB 스키마나 RLS를 변경하지 않았습니다.
- 실제 로그인/Cookie 검증과 계정별 RLS는 미구현입니다. 개발 전용 가짜 A/B 분리는 실제 보안 검증이 아닙니다.
- 직접 저장한 값과 기본값을 구분하는 `readExplicitSettings()`는 **모의 저장소 안의 내부 메타데이터**입니다. 실 DB는 현 스키마만으로 `distance` 기본값의 출처를 식별할 수 없습니다.
- 별도 건강정보, 증상, 문진·대화, PDF, 검색어, 조회/클릭·길찾기 기록은 행동 온톨로지의 저장 대상이 아닙니다. **행동 온톨로지 전체 삭제는 건강정보를 삭제하지 않습니다**.
