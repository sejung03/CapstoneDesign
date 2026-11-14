"""3단계 S3-3: 후보 구절에서 라벨링 입력(T3)을 만든다

    python pipeline/03c_label_inputs_t3.py

- 설정: config/label_t3.yaml
- 라벨링 대상: known=false, source가 claude_read 또는 both, n_answers >= 10
    → data/interim/v3/label_items_T3.csv (item_id, phrase, source, n_answers, n_diseases, example)
- 같은 조건에서 n_answers < 10인 구절 → data/interim/v3/phrases_rare.csv
- 선택지: label_options_T1.csv(ICPC 240 + NONE + AMBIGUOUS) + D20 하위 코드 → label_options_T3.csv
- 라벨링 규칙: labeling_guide.md의 [T1]을 복사하고 줄을 덧붙여 labeling_guide_T3.md
- 멱등: 입력 순서(n_answers 내림차순 → phrase)를 그대로 쓰고 item_id를 그 순서로 준다.
- 출력은 모두 data/interim/ (커밋하지 않는다). CSV는 utf-8-sig.
"""
import csv
import os
import sys
from collections import Counter

from ruamel.yaml import YAML

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: os.path.join(ROOT, *p)  # noqa: E731


def load_yaml(path):
    if not os.path.exists(path):
        sys.exit(f"설정 파일 없음: {path}")
    with open(path, encoding="utf-8") as f:
        return YAML(typ="safe", pure=True).load(f) or {}


def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        r = csv.DictReader(f)
        return r.fieldnames, list(r)


def write_csv(path, fields, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


def t1_section(guide_text):
    """[T1]부터 다음 [T..] 앞까지 (끝 빈 줄 제외)."""
    lines = guide_text.splitlines()
    start = next(i for i, l in enumerate(lines) if l.startswith("[T1]"))
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("[T")), len(lines))
    sec = lines[start:end]
    while sec and not sec[-1].strip():
        sec.pop()
    return sec


SRC_PARTS = {"script": {"script"}, "claude_read": {"claude_read"}, "both": {"script", "claude_read"}}


def merge_variants(rows, sep):
    """공백을 뺀 문자열이 같은 구절을 한 item으로 합친다.
    대표 표기: n_answers가 큰 것 → (같으면) 공백이 많은 것 → phrase 순.
    source: 표기들의 출처를 합친다(script와 claude_read가 다 있으면 both).
    example·n_answers·n_diseases: 대표 표기의 값. 정렬: n_answers 내림차순 → 대표 phrase 순."""
    groups = {}
    for r in rows:
        groups.setdefault(r["phrase"].replace(" ", ""), []).append(r)
    merged = []
    for g in groups.values():
        rep = sorted(g, key=lambda r: (-int(r["n_answers"]), -r["phrase"].count(" "), r["phrase"]))[0]
        parts = set().union(*(SRC_PARTS[r["source"]] for r in g))
        src = next(k for k, v in SRC_PARTS.items() if v == parts)
        variants = [rep["phrase"]] + sorted(r["phrase"] for r in g if r is not rep)
        merged.append({**rep, "source": src, "variants": sep.join(variants)})
    merged.sort(key=lambda r: (-int(r["n_answers"]), r["phrase"]))
    return merged


def main():
    cfg = load_yaml(J("config", "label_t3.yaml"))
    inp, out, tg = cfg["input"], cfg["output"], cfg["target"]

    # 1·2. 라벨링 대상 / rare
    fields, rows = read_csv(J(inp["phrases"]))
    need = {"phrase", "source", "n_answers", "n_diseases", "known", "example"}
    if not need <= set(fields):
        sys.exit(f"candidate_phrases.csv 컬럼 부족: {need - set(fields)}")
    pool = [r for r in rows if r["known"] == tg["known"] and r["source"] in tg["sources"]]
    items = [r for r in pool if int(r["n_answers"]) >= tg["min_n_answers"]]
    rare = [r for r in pool if int(r["n_answers"]) < tg["min_n_answers"]]

    n_before = len(items)
    items = merge_variants(items, cfg["variants_sep"])

    pf, wd = cfg["item_id"]["prefix"], cfg["item_id"]["width"]
    item_fields = ["item_id", "phrase", "variants", "source", "n_answers", "n_diseases", "example"]
    write_csv(J(out["items"]), item_fields,
              [{"item_id": f"{pf}{i:0{wd}d}", **{k: r[k] for k in item_fields[1:]}}
               for i, r in enumerate(items, 1)])
    rare_fields = ["phrase", "source", "n_answers", "n_diseases", "example"]
    write_csv(J(out["rare"]), rare_fields, [{k: r[k] for k in rare_fields} for r in rare])

    # 3. 선택지
    ofields, opts = read_csv(J(inp["options_t1"]))
    _, std = read_csv(J(inp["standard"]))
    desc = cfg["subcode_desc"]
    new_opts = []
    for o in opts:
        new_opts.append(o)
        if o["code"] in cfg["subdivided_parents"]:
            for s in (s for s in std if s["parent_id"] == o["code"]):
                if s["symptom_id"] not in desc:
                    sys.exit(f"subcode_desc에 설명 없음: {s['symptom_id']}")
                new_opts.append({"code": s["symptom_id"], "chapter_ko": s["chapter_ko"],
                                 "preferred": s["name_ko"], "inclusion": desc[s["symptom_id"]],
                                 "exclusion": ""})
    write_csv(J(out["options"]), ofields, new_opts)

    # 4. 라벨링 규칙
    with open(J(inp["guide_v2"]), encoding="utf-8") as f:
        sec = t1_section(f.read())
    sec[0] = sec[0].replace("[T1]", "[T3]", 1)
    sec = [l.replace("label_options_T1.csv", "label_options_T3.csv") for l in sec]
    out_i = next(i for i, l in enumerate(sec) if "출력 컬럼" in l)
    sec[out_i:out_i] = [f"- {x}" for x in cfg["guide_extra_rules"]]
    sec += ["", "D20 하위 코드 (입·혀·입술 관련 표현은 D20 대신 아래에서 고른다)"]
    sec += [f"- {k} {v}" for k, v in desc.items()]
    with open(J(out["guide"]), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(sec) + "\n")

    # 보고 (화면만)
    print(f"띄어쓰기 표기 합치기: {n_before} → {len(items)}")
    print(f"라벨링 대상: {len(items)}  source별: {dict(sorted(Counter(r['source'] for r in items).items()))}")
    print(f"phrases_rare: {len(rare)}  source별: {dict(sorted(Counter(r['source'] for r in rare).items()))}")
    print(f"선택지: {len(new_opts)} (T1 {len(opts)} + 하위 {len(new_opts) - len(opts)})")
    print("상위 30:")
    for i, r in enumerate(items[:30], 1):
        print(f"  {pf}{i:0{wd}d}\t{r['phrase']}\t{r['source']}\t{r['n_answers']}\t{r['n_diseases']}")


if __name__ == "__main__":
    main()
