[T3] 한국어 증상 표현 → ICPC-2 코드
- 각 item에 대해 label_options_T3.csv 안의 code 하나만 고른다. 목록에 없는 코드는 쓰지 않는다.
- 판단 기준은 preferred, inclusion, exclusion 문구다. exclusion에 해당하면 그 코드를 고르지 않는다.
- 같은 증상의 부위·성격이 표현에 드러나면 더 구체적인 코드를 고른다
  (예: "명치 통증" → D02, "배 아픔" → D01).
- 질병명·검사·약 이름 등 증상이 아니면 NONE.
- 두 코드 이상에 똑같이 걸치면 AMBIGUOUS. 억지로 고르지 않는다.
- AMBIGUOUS를 고를 때는 note에 후보 코드를 반드시 모두 적는다(예: AMBIGUOUS (R21, L01)).
- 입·혀·입술 관련 표현은 D20 대신 하위 코드(D20-01~D20-04)를 고른다.
- 출력 컬럼: item_id, icpc2_code, confidence(high/low), note(한 줄, 선택)

D20 하위 코드 (입·혀·입술 관련 표현은 D20 대신 아래에서 고른다)
- D20-01 혀
- D20-02 입술·입안
- D20-03 입냄새
- D20-04 입마름
