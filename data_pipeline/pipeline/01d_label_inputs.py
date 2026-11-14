"""v2 P1-3: 라벨링 입력 파일 만들기 (라벨 자체는 하지 않는다) → data/interim/v2/

    python pipeline/01d_label_inputs.py      (01b를 먼저 돌려야 함)

- label_items_T1.csv          : 매핑할 한국어 증상 표현 (step1 후보 222 + v1 added_common 13, term_ko 중복 제거)
- label_options_T1.csv        : excluded=false ICPC 코드 + NONE + AMBIGUOUS
- label_items_T2.csv          : excluded=false ICPC 코드 전체
- label_options_T2_triage.csv : 119 주증상 범주 1~33 + 0(해당 없음)  ← config/triage_119.yaml
- labeling_guide.md           : 라벨링 규칙 전문
- source=held : v1에서 보류(excluded_hold)였지만 표준명 제안이 붙어 있던 후보 (5개여야 함)
- 사용자 원문·표면형(surface_forms)은 넣지 않는다. 증상 이름(term_ko)만 쓴다.
- 멱등: 입력 순서 고정(candidate_id 순 → symptom_id 순), utf-8-sig
- 이 스크립트는 라벨링 입력을 data/interim/v2/에 "만든다". 실제 라벨링에 쓴 입력과 결과는 labels/v2/에 있고,
  합치기(01e)는 labels/v2/를 읽는다.
- step1 후보와 v1 파일은 다시 만들지 않는 고정 입력이라 data/frozen/에서 읽는다.
"""
import csv
import os
import sys

from ruamel.yaml import YAML

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
V2 = os.path.join(ROOT, "data", "interim", "v2")
ICPC = os.path.join(V2, "icpc2_symptoms_all.csv")
FROZEN = os.path.join(ROOT, "data", "frozen")
CANDIDATES = os.path.join(FROZEN, "step1_symptom_candidates.csv")
CAND_MAP = os.path.join(FROZEN, "candidate_to_standard_v1.csv")
STANDARD_V1 = os.path.join(FROZEN, "standard_symptoms_v1.csv")
TRIAGE = os.path.join(ROOT, "config", "triage_119.yaml")
EXPECTED = {"candidates": 222, "added_common": 13, "held": 5, "options": 240, "triage": 33}

GUIDE = """[T1] 한국어 증상 표현 → ICPC-2 코드
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
"""


def read_csv(path):
    if not os.path.exists(path):
        sys.exit(f"입력 파일 없음: {path}")
    for enc in ("utf-8-sig", "cp949"):
        try:
            with open(path, encoding=enc, newline="") as f:
                return list(csv.DictReader(f))
        except UnicodeDecodeError:
            continue
    raise RuntimeError(f"인코딩을 알 수 없음: {path}")


def write_csv(name, cols, rows):
    path = os.path.join(V2, name)
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    print(f"저장: {path} ({len(rows)}행)")


def main():
    icpc = [r for r in read_csv(ICPC) if r["excluded"] == "false"]
    cands = sorted(read_csv(CANDIDATES), key=lambda r: r["candidate_id"])
    cmap = {r["candidate_id"]: r for r in read_csv(CAND_MAP)}
    added = sorted((r for r in read_csv(STANDARD_V1) if r["source"] == "added_common"),
                   key=lambda r: r["symptom_id"])
    with open(TRIAGE, encoding="utf-8") as f:
        triage = YAML(typ="safe", pure=True).load(f)["categories"]

    # ---- T1 items ----
    items, seen, dup = [], set(), []
    for c in cands:
        m = cmap.get(c["candidate_id"], {})
        held = m.get("status") == "excluded_hold" and m.get("standard_name", "").strip()
        items.append((c["name_ko"].strip(), "held" if held else "step1", m.get("symptom_id", "").strip()))
    for s in added:
        items.append((s["name_ko"].strip(), "added_common", s["symptom_id"]))
    t1 = []
    for term, source, sid in items:
        if term in seen:
            dup.append(term)
            continue
        seen.add(term)
        t1.append({"item_id": f"T1-{len(t1) + 1:03d}", "term_ko": term, "source": source, "v1_symptom_id": sid})

    got = {"candidates": len(cands), "added_common": len(added),
           "held": sum(r["source"] == "held" for r in t1), "options": len(icpc), "triage": len(triage)}
    diff = {k: (EXPECTED[k], got[k]) for k in EXPECTED if EXPECTED[k] != got[k]}
    if diff or [t["id"] for t in triage] != list(range(1, 34)):
        sys.exit(f"검증값과 다름 (기대, 실제): {diff}. 파일을 쓰지 않고 멈춤.")

    os.makedirs(V2, exist_ok=True)
    write_csv("label_items_T1.csv", ["item_id", "term_ko", "source", "v1_symptom_id"], t1)

    cols = ["code", "chapter_ko", "preferred", "inclusion", "exclusion"]
    codes = [{k: r[k] for k in cols} for r in icpc]
    special = [
        {"code": "NONE", "chapter_ko": "", "preferred": "증상이 아님/해당 코드 없음", "inclusion": "", "exclusion": ""},
        {"code": "AMBIGUOUS", "chapter_ko": "", "preferred": "둘 이상에 걸쳐 애매함", "inclusion": "", "exclusion": ""},
    ]
    write_csv("label_options_T1.csv", cols, codes + special)
    write_csv("label_items_T2.csv", cols, codes)
    write_csv("label_options_T2_triage.csv", ["triage_category", "group", "name_ko"],
              [{"triage_category": 0, "group": "", "name_ko": "해당 없음"}]
              + [{"triage_category": t["id"], "group": t["group"], "name_ko": t["name"]} for t in triage])

    guide = os.path.join(V2, "labeling_guide.md")
    with open(guide, "w", encoding="utf-8", newline="\n") as f:
        f.write(GUIDE)
    print(f"저장: {guide}")
    print("T1 구성:", {s: sum(r["source"] == s for r in t1) for s in ("step1", "held", "added_common")},
          "/ term_ko 중복으로 뺀 것:", dup or "없음")


if __name__ == "__main__":
    main()
