[T1] 한국어 증상 표현 → ICPC-2 코드
- 각 item에 대해 label_options_T1.csv 안의 code 하나만 고른다. 목록에 없는 코드는 쓰지 않는다.
- 판단 기준은 preferred, inclusion, exclusion 문구다. exclusion에 해당하면 그 코드를 고르지 않는다.
- 같은 증상의 부위·성격이 표현에 드러나면 더 구체적인 코드를 고른다
  (예: "명치 통증" → D02, "배 아픔" → D01).
- 질병명·검사·약 이름 등 증상이 아니면 NONE.
- 두 코드 이상에 똑같이 걸치면 AMBIGUOUS. 억지로 고르지 않는다.
- 출력 컬럼: item_id, icpc2_code, confidence(high/low), note(한 줄, 선택)

[T2] ICPC-2 코드마다 두 가지
(a) triage_category: label_options_T2_triage.csv에서 그 증상이 주증상인 119 범주를 고른다.
    여러 개면 ";"로 나열한다. 없으면 0.
(b) name_ko_proposal: 일반인이 이해하는 짧은 한국어 증상명(예: "명치 통증", "콧물·코막힘").
    진단명처럼 들리는 말은 쓰지 않는다.
- 출력 컬럼: code, triage_category, name_ko_proposal, note
