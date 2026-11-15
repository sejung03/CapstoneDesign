# 평가 사례 (`eval/cases/`)

## draft_v0.jsonl — 초안

- **가짜 사례 30개**다. 실제 인물·연락처·실제 상담 내용은 없다.
- **정답 라벨은 한 사람이 단 초안(`"label_status":"draft_single"`)이다.** 설계 원칙 3(9-1)에 따라 팀 2인 독립 라벨링 → 일치한 것만 쓰는 정식 평가셋으로 교체한다. 이 파일의 수치로 업체를 고르지 않는다.
- 구성: 사전에 없는 증상 표현 12(`paraphrase`), 사전 표현 3(`dictionary`), 증상 아님 8(약국·병원 찾기 4 `facility`, 약 질문 2 `medication`, 잡담 2 `chitchat`), 응급 표현 3(`emergency`), 건강정보 섞인 문장 3(`profile`), 다른 사람 이야기 1(`other_person`).
- `group`은 설계 9-1 형식에 더한 분류 칸이다(지표를 묶어 보기 위함).

## 한 줄 형식 (설계 9-1)

```json
{"id":"c001","text":"…","gold_symptoms":["D09"],"gold_intent":"symptom","gold_emergency":false,"gold_profile":[{"field":"age","value":"32"}],"label_status":"draft_single","group":"paraphrase"}
```

- `gold_intent`: `symptom` | `facility_search` | `medication_question` | `other`
- `gold_symptoms`: `ref.symptom.symptom_id`(후보 가능한 증상만). 증상이 아니면 `[]`
- `gold_profile`: 사용자 **본인**이 직접 말한 나이·알레르기·복용약·병력만. 다른 사람 이야기는 넣지 않는다.

## 정식 평가셋 만들 때

1. 평가자 2명이 `text`만 보고 각자 라벨을 단다(서로 보지 않음).
2. 두 라벨이 일치한 것만 남기고 `label_status`를 `"agreed"`로 바꾼다. 불일치는 따로 모아 논의한다.
3. 오타·띄어쓰기 오류 사례를 추가한다(설계 9-1 구성).
4. 평가 결과(`eval/out/`)에는 사례 원문을 넣지 않고 case id만 남긴다.
