"""4단계 S4-1: AI Hub "증상" 답변의 진료과 표기를 모으고 라벨링 입력을 만든다

    python pipeline/04a_dept_label_inputs.py

- 설정: config/dept_label.yaml
- 표기 모으기: department_raw(JSON 배열)의 각 원소를 split_chars("\n")로 다시 나눠 각각 센다.
    값은 손대지 않는다(앞뒤 공백·NBSP도 그대로. 정리는 라벨링에서 한다). 빈 값은 뺀다.
    n_answers = 그 표기가 나온 서로 다른 답변 수, n_diseases = 그 답변들의 질환 수
    → data/interim/v4/dept_raw_values.csv (raw_value, n_answers, n_diseases)
- 선택지: 심평원 의원급 표시과목(data/raw, 읽기만) - clinic_not_dept, clinic_rename 적용, + extra_depts, + DROP·AMBIGUOUS
    excluded_in_2a = 2A(step2a_department.py)의 제외 진료과 규칙에 걸리는지
    → data/interim/v4/label_options_dept.csv (dept, source, excluded_in_2a, note)
- 라벨링 규칙 → data/interim/v4/labeling_guide_dept.md
- 멱등: 출력은 n_answers 내림차순 → raw_value 순, 선택지는 의원급(가나다) → 추가 과 → 특수값 순. utf-8-sig.
"""
import csv
import importlib.util
import json
import os
import re
import sys
from collections import defaultdict

from ruamel.yaml import YAML

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: os.path.join(ROOT, *p)  # noqa: E731
csv.field_size_limit(10 ** 8)

sys.path.insert(0, J("pipeline"))
_spec = importlib.util.spec_from_file_location("step2a", J("pipeline", "step2a_department.py"))
s2a = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(s2a)


def load_yaml(path):
    with open(path, encoding="utf-8") as f:
        return YAML(typ="safe", pure=True).load(f) or {}


def write_csv(path, cols, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    print(f"저장: {os.path.relpath(path, ROOT)} ({len(rows)}행)")


GUIDE = """[DEPT] AI Hub 진료과 표기 → 표준 진료과
- 각 raw_value에 대해 label_options_dept.csv 안의 dept 하나만 고른다. 목록에 없는 값은 쓰지 않는다.
- 오타·옛 이름은 해당 표준 과로 고른다
  (예: 비뇨기과 → 비뇨의학과, 정신과 → 정신건강의학과, 일반외과 → 외과, 흉부외과 → 심장혈관흉부외과).
- 세부 분과는 상위 과로 고른다 (예: 소화기내과·순환기내과 → 내과).
- 진료과가 아닌 값(질환명, "안경" 등)은 DROP.
- 진단계 과(영상의학과, 영상진단의학과, 방사선과, 병리과, 진단검사의학과, 핵의학과)와 의학유전학과는 해당 과로 고른다.
  2A의 제외 진료과 규칙으로 추천에서 빠진다는 점은 note에 적지 않아도 된다(규칙이 처리).
- 둘 이상에 걸치면 AMBIGUOUS. 억지로 고르지 않는다. note에 후보를 모두 적는다(예: AMBIGUOUS (소아청소년과, 정신건강의학과)).
- raw_value는 파일에 있는 그대로 옮긴다(앞뒤 공백 포함). 고치지 않는다.
- 출력 컬럼: raw_value, dept, note(한 줄, 선택)
"""


def main():
    cfg = load_yaml(J("config", "dept_label.yaml"))
    out = cfg["output"]

    # 1. 표기 모으기
    split_re = re.compile("|".join(map(re.escape, cfg["split_chars"])))
    with open(J(cfg["input"]["answers"]), encoding="utf-8-sig", newline="") as f:
        answers = sorted(csv.DictReader(f), key=lambda r: r["answer_key"])
    ans, dis = defaultdict(set), defaultdict(set)
    n_multi = 0
    for a in answers:
        vals = json.loads(a["department_raw"] or "[]")
        if not isinstance(vals, list):
            sys.exit(f"department_raw가 JSON 배열이 아님: {a['answer_key']}")
        parts = [p for v in vals for p in split_re.split(str(v)) if p.strip()]
        n_multi += len(set(parts)) > 1
        for p in parts:
            ans[p].add(a["answer_key"])
            dis[p].add(a["disease_ko"])
    rows = sorted(({"raw_value": p, "n_answers": len(ans[p]), "n_diseases": len(dis[p])} for p in ans),
                  key=lambda r: (-r["n_answers"], r["raw_value"]))
    write_csv(J(out["raw_values"]), ["raw_value", "n_answers", "n_diseases"], rows)

    # 2. 선택지
    _, clinic_rows = s2a.read_csv(s2a.find_raw(*cfg["clinic_file_keywords"]))
    clinic = sorted({r[cfg["clinic_dept_column"]].strip() for r in clinic_rows})
    rename = cfg.get("clinic_rename") or {}
    opts = []
    for d in clinic:
        if d in cfg["clinic_not_dept"]:
            continue
        name = rename.get(d, d)
        opts.append({"dept": name, "source": "clinic", "excluded_in_2a": str(s2a.excluded(name)).lower(),
                     "note": f"의원급 표시과목 '{d}'" if name != d else ""})
    for d, why in cfg["extra_depts"].items():
        if any(o["dept"] == d for o in opts):
            sys.exit(f"extra_depts의 {d}가 이미 의원급 목록에 있음")
        opts.append({"dept": d, "source": "extra", "excluded_in_2a": str(s2a.excluded(d)).lower(), "note": why})
    for d, why in cfg["special_options"].items():
        opts.append({"dept": d, "source": "special", "excluded_in_2a": "", "note": why})
    write_csv(J(out["options"]), ["dept", "source", "excluded_in_2a", "note"], opts)

    # 3. 라벨링 규칙
    with open(J(out["guide"]), "w", encoding="utf-8", newline="\n") as f:
        f.write(GUIDE)
    print(f"저장: {out['guide']}")

    print(f"\n답변 {len(answers)} / 표기가 둘 이상인 답변 {n_multi} / 고유 표기 {len(rows)}")
    print(f"선택지 {len(opts)} (의원급 {sum(o['source'] == 'clinic' for o in opts)} + 추가 "
          f"{sum(o['source'] == 'extra' for o in opts)} + 특수 {sum(o['source'] == 'special' for o in opts)})")
    print("2A 제외 규칙에 걸리는 선택지:", [o["dept"] for o in opts if o["excluded_in_2a"] == "true"])
    for i, r in enumerate(rows[:30], 1):
        print(f"{i:2d}\t{r['raw_value']!r}\t{r['n_answers']}\t{r['n_diseases']}")


if __name__ == "__main__":
    main()
