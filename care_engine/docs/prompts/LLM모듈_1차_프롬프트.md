# LLM 모듈 1차 프롬프트: API 없이 만들 수 있는 부분

> 2026-11-15. Claude Code에게 순서대로 붙여 넣는 지시서다. 멈춤 지점은 두 번(L1 후, L3 후).
> 설계 원본: `claude/LLM모듈_설계.md`(저장소에서는 `care_engine/docs/LLM모듈_설계.md`).
> 이번 범위: 제공업체 API 호출을 **뺀** 전부. 업체 어댑터는 "미구현" 자리만 만들고, 실행·테스트·평가는 모두 `mock` 제공업체로 한다. **네트워크 호출, API 키, `.env`는 쓰지 않는다.**

---

## 0. 사람이 먼저 할 일

1. 작업 브랜치를 만든다: `git switch -c llm-module` (main 최신에서)
2. 저장소 루트에 `care_engine/docs/prompts/`를 만들고 두 파일을 넣는다(`data_pipeline/`, `frontend/`와 나란히).
   - `care_engine/docs/LLM모듈_설계.md`
   - `care_engine/docs/prompts/LLM모듈_1차_프롬프트.md` (이 파일)
3. Node 버전 확인: `node -v`가 20 이상이면 된다(프론트와 같은 `node:test` 사용).

---

## L1 — 기반: 데이터 읽기·정규화·개인정보 가리기·후보 생성 (멈춤)

### Claude Code 머리말 (새 채팅일 때)
```
이 저장소는 의료 정보 도우미 앱이야. data_pipeline/은 증상·진료과 DB, frontend/는 팀원이 만든 Next.js 앱이고,
지금은 LLM 모듈을 새 폴더 care_engine/에 만든다(문진 엔진 runCare도 나중에 같은 폴더에 들어간다).
먼저 care_engine/docs/LLM모듈_설계.md, care_engine/docs/prompts/LLM모듈_1차_프롬프트.md, frontend/docs/BACKEND.md
(특히 "요청 함수", "응답", 0.18.0 건강정보 반영 후보, 0.20.0 적응형 문진, "외부 AI 업체 미확정 시 연결 기준")를 읽고 상태를 파악해.
원칙:
- 네트워크 호출 금지. API 키·.env 파일을 만들거나 열지 않는다. 제공업체는 mock만 쓴다.
- frontend/와 data_pipeline/은 읽기만 하고 수정하지 않는다.
- 외부 npm 패키지를 추가하지 않는다(Node 내장 모듈만). 테스트는 node:test.
- 같은 입력이면 같은 결과(정렬 기준을 항상 명시).
- 사용자 원문·quote·value를 로그, 보고서, 테스트 스냅샷 파일 이름에 남기지 않는다(테스트 입력 자체는 가짜 문장이라 괜찮다).
- 진단·질환명을 만들어 내지 않는다. ICPC-2 원문(영어 이름 등)은 쓰지 않는다. 증상 이름은 ref.symptom.name_ko만 쓴다.
- 지시에 없는 판단은 보고에 따로 적는다.
아래 L1을 진행하고 멈춰서 보고해줘.
```

### L1 지시
```
L1을 진행한다.

0. 뼈대
   - care_engine/package.json: {"name":"medical-helper-care-engine","private":true,"type":"module",
     "scripts":{"test":"node --test","eval":"node eval/run_eval.mjs"}}, dependencies 없음
   - 폴더: care_engine/llm/{providers,prompts,__tests__}, care_engine/eval/{cases,fixtures,out}
   - care_engine/eval/out/은 .gitignore에 추가(저장소 루트 .gitignore가 있으면 거기에, 없으면 care_engine/.gitignore)

1. 데이터 읽기 — care_engine/llm/ref-data.mjs
   - 인터페이스: loadRefData() → { dataVersion, symptoms: Map<id, {id, nameKo, sexRestriction, isFallback, ...}>,
     synonyms: [{symptomId, term, termNorm, termType}] }
   - 이번 구현은 CSV 로더 하나: data_pipeline/db/seed/v2.1-20261113/의 symptom.csv, symptom_synonym.csv, data_version.csv
     (UTF-8 BOM 처리, 따옴표 안 쉼표 처리하는 작은 CSV 파서를 직접 작성)
   - 나중에 Supabase 로더로 바꿀 수 있게 loadRefData가 source 옵션을 받도록 두되, 지금은 'csv'만 구현
   - "fallback 증상" 판정은 DB 함수와 같아야 한다. data_pipeline/db/migrations/001b_ref_functions.sql과
     시드를 읽고 ref.recommend_departments가 is_fallback=true를 돌려주는 기준을 그대로 따른다.
     어떤 기준을 썼는지와 해당 symptom_id 목록을 보고한다.
   - is_parent 증상을 후보에 넣을지는 시드·문서를 보고 판단하고 보고에 적는다(근거 포함).
   - 모듈 안에서 한 번만 읽고 캐시(프로세스 단위).

2. 정규화 — normalize.mjs
   - normalizeTerm(s): 사전 term_norm을 만든 파이프라인 규칙과 **똑같이** 구현한다.
     data_pipeline/pipeline/ 아래에서 term_norm을 만드는 코드를 찾아 규칙을 옮긴다.
   - 테스트: 모든 사전 행에서 normalizeTerm(term) === termNorm. 다르면 행 수와 예시 10개를 보고하고,
     규칙을 억지로 맞추지 말고 차이를 설명한다.
   - normalizeInput(s): 사용자 입력용. normalizeTerm + 길이 500자 제한(넘으면 마지막 500자).

3. 개인정보 가리기 — pii.mjs
   - maskPii(s) → { text, masked: {phone, email, rrn, card} 개수 }
   - 한국 휴대폰·일반 전화(하이픈·공백·점 변형), 이메일, 주민등록번호(6-7), 카드번호(4-4-4-4) 정규식
   - 나이("32살", "만 40세"), 약 용량("500mg"), 날짜("3일 전")는 가리지 않는다 — 테스트로 확인
   - 대체 문자열: [전화번호] [이메일] [주민번호] [카드번호]

4. 후보 생성 — candidates.mjs
   - buildCandidates(inputText, refData, {k=40, mode='retrieve', sex=null}) → [{symptomId, score}]
   - retrieve 방식(설계 5-2):
     · 입력·동의어 모두 normalizeTerm
     · 동의어 termNorm이 입력의 부분 문자열이면 점수 1.0
     · 아니면 문자 2-gram Dice 계수 (문자열 길이 1이면 1-gram)
     · symptomId별 최고 점수 → 점수 내림차순, 같으면 symptomId 오름차순 → 상위 k
     · 점수 0인 후보는 넣지 않는다
   - mode='all': fallback 증상을 뺀 전체를 symptomId 오름차순으로(score는 null)
   - 두 방식 모두 fallback 증상은 넣지 않는다
   - sex가 'female'|'male'이면 sexRestriction이 다른 증상을 뺀다. null·'unknown'이면 빼지 않는다
     (sex_restriction 값 표기는 시드에서 확인해 맞춘다)
   - formatCandidatesForPrompt(candidates, refData): 줄마다 "ID | name_ko | 동의어 최대 3개"
     동의어는 사전 id 오름차순 앞 3개(term 원형), name_ko와 같은 것은 건너뜀

5. 후보 생성 자체 평가 — eval/candidate_loo.mjs (LLM 없음, 정답 라벨 없이 가능)
   - 사전 leave-one-out: 동의어 한 행을 색인에서 빼고 그 term을 입력으로 넣었을 때,
     그 행의 symptomId가 상위 k 안에 있는 비율
   - k = 10, 20, 40, 60에 대해 Recall@k, 그리고 term_type별 Recall@40
   - 같은 증상의 다른 동의어와 글자가 겹치지 않아 놓친 예시 20개(term과 정답 ID만)
   - 결과는 care_engine/eval/out/candidate_loo.json, 요약은 care_engine/docs/reports/llm_L1.md
   - 주의: 이 값은 "사전과 글자가 비슷한 표현"에 대한 대리 지표다. 바꿔 말한 표현의 재현율은
     팀 평가셋으로 다시 재야 한다는 점을 보고서에 적는다.

6. 테스트 — __tests__/ 에 1~4 단위 테스트. npm test 전부 통과.

보고:
- 파일 목록, 테스트 수·결과
- fallback 판정 기준과 목록, is_parent 처리 판단
- normalizeTerm 일치 검사 결과
- leave-one-out Recall@k 표, 놓친 예시 경향
- 지시에 없던 판단
여기서 멈춘다.
```

---

## L2 — 스키마·프롬프트·검사·확인 질문·건강정보 추출 (연속 진행)

```
L1 확인 결과를 반영해 L2를 진행한다. 설계 문서 4~6절을 그대로 따른다.

1. schemas.mjs — 두 업체 공통 부분집합(설계 4절 "공통 스키마 규칙")
   - symptomPickSchema(candidateIds): 설계 5-4. picks.items.enum = candidateIds
   - profileExtractSchema(): 설계 6-2
   - assertPortableSchema(schema): 허용 키워드(type, properties, required, enum, items, additionalProperties)
     밖의 키워드가 있거나, object의 properties가 모두 required가 아니거나, additionalProperties가 false가 아니면 오류.
     두 스키마 함수의 결과에 항상 이 검사를 건다(테스트 포함).

2. prompts/symptom_v1.mjs, prompts/profile_v1.mjs
   - export { id: 'symptom_v1', system: string, buildUser(input) }
   - 문구는 설계 5-5, 6-3 그대로. 바꾼 곳이 있으면 보고
   - 프롬프트 id와 스키마 이름은 로그·평가 결과에 남긴다

3. validate.mjs
   - validateSymptomPick(raw, candidateIds, refData) → {ok, intent, status, picks, dropped:{unknownId, duplicate, overLimit}}
     설계 5-6 표 그대로. matched인데 picks 0 → no_match. 최대 10개
   - validateProfileItems(raw, messages) → {items(프론트 계약 형식), dropped: {사유별 개수}}
     설계 6-4 표 그대로. 출력은 BACKEND.md 0.18.0 형식
     {id:'<field>-1', field, operation:'set', value, evidence:{kind:'message', index, quote}}
     검사용 정규화는 normalizeTerm을 쓴다. 항목 하나가 틀리면 그 항목만 버린다

4. confirm-question.mjs
   - buildSymptomConfirm(picks, refData, locale) → followUp 객체 (설계 5-7)
   - 선택지: 증상 최대 10개(LLM 순서) + sym_none + sym_unsure (항상 마지막)
   - parseSymptomConfirm(followUpAnswers, refData) → {status:'confirmed', symptomId} | {status:'fallback', reason:'none'|'unsure'} | {status:'absent'}
     답의 symptomId가 refData에 없거나 fallback 증상이면 fallback 처리
   - 계약 검사 함수 checkFollowUpContract(followUp): id·선택지 ID 정규식 ^[A-Za-z0-9_-]{1,80}$,
     문구 ko 필수 300자 이하, 선택지 1~12개, ID 중복 없음. 모든 테스트에서 이 검사를 건다
   - 문구 상수는 copy.mjs 한 곳에 둔다(ko 필수, en 선택). 문구는 설계 문서 그대로

5. profile-trigger.mjs
   - shouldExtractProfile(messages): 신호어 목록(설계 6-1)이 하나라도 있으면 true
   - 신호어 목록은 config 상수로 따로 두고 보고에 목록을 적는다

6. 테스트 추가. 특히:
   - 없는 ID, 중복, 11개 이상, 형식 깨진 JSON
   - quote가 메시지에 없음, value가 quote에 없음, age 121·"서른", 공백 value, field 중복, 5개 이상
   - 확인 질문이 후보 1개·10개·15개일 때 계약 통과
이어서 L3로 넘어간다.
```

---

## L3 — 제공업체 자리·공개 함수·평가 틀 (멈춤)

```
1. provider.mjs + providers/
   - 설계 4절 인터페이스. getProvider()는 환경변수 LLM_PROVIDER를 읽되 기본값 'mock'
   - providers/gemini.mjs, providers/openai.mjs: generateStructured가 항상
     {ok:false, error:'not_implemented', meta:{...}}를 돌려주는 자리만. 파일 상단 주석에 연결할 때 할 일(설계 4절 1~4)을 적는다.
     import나 fetch 등 네트워크 코드는 넣지 않는다
   - providers/mock.mjs:
     · createMockProvider(fixtures): 입력 user 문자열의 키(테스트용 case id를 프롬프트에 넣지 말고,
       mock 생성 시 넘긴 (입력 텍스트 → 응답) 맵)로 응답을 찾는다
     · 응답 대신 {error:'timeout'|'rate_limit'|'server'|'network'|'blocked'|'bad_json'} 지정 가능
     · delayMs 지정 가능(시간 초과 테스트용), signal abort 존중
   - error 값에 'not_implemented', 'no_consent'를 추가하고 설계 5-8 표의 fallback 경로를 따른다

2. config.mjs
   - 설계 8절 값들. 환경변수가 없으면 기본값. 키 관련 변수는 읽지 않는다(이번 범위 밖)
   - versions: {promptSymptom, promptProfile, schemaSymptom, schemaProfile}

3. index.mjs — 공개 함수
   classifySymptom({text, sex, consent, signal, deadlineAt}, deps={provider, refData, config, log})
     → {status:'confirm', followUp, meta} | {status:'fallback', reason, meta} | {status:'route', intent, meta}
     순서: 동의 확인 → maskPii → buildCandidates(후보 0개면 mode='all'로 한 번 더) → 스키마·프롬프트 →
           provider 호출(시간 예산·재시도 규칙 설계 5-9) → validate → intent가 symptom이 아니면 route →
           picks 있으면 confirm, 없으면 fallback
   extractProfileUpdates({messages, consent, signal, deadlineAt}, deps) → {items, meta}
     신호어 없으면 provider 호출 없이 items:[]
     오류·시간 초과면 items:[]
   - 재시도: rate_limit·server·network만 1회, 남은 시간 ≥ 3000ms일 때만. bad_json·blocked은 재시도 안 함
   - meta: {provider, model, promptId, schemaId, dataVersion, candidateCount, candidateMode, latencyMs, attempts, error}
   - log(event): 설계 7절의 "남기는 것"만. 원문·quote·value가 들어가지 않는지 테스트로 확인
     (테스트용 문장에 고유 표지 문자열을 넣고 log 출력 전체에서 그 문자열이 없는지 검사)

4. 평가 틀 — eval/
   - eval/cases/draft_v0.jsonl: 가짜 사례 30개. 설계 9-1 형식 + "label_status":"draft_single"
     구성: 사전에 없는 증상 표현 12, 사전 표현 3, 증상 아님(약국·병원 찾기 4, 약 질문 2, 잡담 2),
           응급 표현 3, 건강정보 섞인 문장 3, 다른 사람 이야기 1
     실제 인물·연락처를 쓰지 않는다. 정답 라벨은 초안이며 팀 2인 독립 라벨링으로 교체될 것이라고 파일 옆 README에 적는다
   - eval/fixtures/mock_v0.json: 위 사례별 mock 응답(일부러 틀린 것·오류 섞기: 정답 포함 20, 정답 없음 4, 형식 위반 2, timeout 2, 엉뚱한 ID 2)
     → 이 평가는 "LLM 성능"이 아니라 "파이프라인이 지표를 맞게 계산하고 실패를 맞게 처리하는지" 확인용이다
   - eval/run_eval.mjs --cases <file> --provider mock --fixtures <file> [--repeat 3]
     설계 9-2 지표 계산: 후보 Recall@K(K=10,20,40,60), Recall@10, Top-1, no_match 정확도, 의도 정확도,
     profile 정밀도·재현율, 실패율(사유별), 지연 p50·p95, 반복 일치율
     응급 놓친 비율은 지금 안전 규칙 엔진이 없으므로 "미측정"으로 표시(자리만)
   - 결과: eval/out/<타임스탬프>_<provider>.json + 콘솔 표. 사례 원문은 결과 파일에 넣지 않고 case id만
   - eval/compare.mjs a.json b.json: 두 결과를 나란히(나중에 gemini vs openai)

5. 문서
   - care_engine/README.md: 폴더 구조, npm test, npm run eval 사용법, mock으로만 동작한다는 점,
     업체 연결 시 바꿀 파일 2개와 체크리스트(설계 4절)
   - care_engine/docs/reports/llm_L1.md에 L2·L3 결과를 이어서 적는다(llm_L1-L3.md로 이름 변경 가능)

보고:
- 파일 목록, 테스트 수·결과
- mock 평가 결과 표(지표가 fixtures 설계대로 나오는지: 예를 들어 실패율 = 4/30, 사유별 개수 일치)
- 로그에 원문이 남지 않는지 검사 결과
- 설계 문서와 다르게 한 곳과 이유, 지시에 없던 판단
여기서 멈춘다. commit은 하되 push하지 않는다.
```

---

## 완료 후 사람이 할 일
- 보고 확인 후 `care_engine/` commit을 main에 합쳐 push(`.env`, `eval/out/` 제외 확인)
- 팀원 2·3에게: 평가셋 형식(`care_engine/eval/cases/` JSONL)과 2인 독립 라벨링 방식 공유
- 업체 결정(약관 확인 포함) 후 L4 프롬프트(어댑터 연결 + 실제 평가)
