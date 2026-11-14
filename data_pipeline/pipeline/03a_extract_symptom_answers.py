"""3단계 S3-1: AI Hub "증상" 답변 추출 + 질환별 표본

    python pipeline/03a_extract_symptom_answers.py

- 입력: data/raw/의 AI Hub VL (VL.zip.part0 …). 읽기만 한다.
- intention == "증상" 인 답변(HC-A-*)만 뽑는다. 기대값(EXPECTED)과 다르면 경고를 찍는다.
- 출력 (둘 다 data/interim/v3/ — 답변 본문이 들어 있으므로 커밋하지 않는다. DB에도 넣지 않는다)
    symptom_answers.csv  answer_key, disease_ko, disease_en, disease_category, department_raw(JSON), text
    sample_answers.csv   sample_id(S0001…), answer_key, disease_ko, text
      질환마다 SAMPLE_PER_DISEASE개씩 무작위(seed 고정). 그보다 적은 질환은 전부.
- answer_key = fileName + "|" + disease_name.kor (fileName이 질환 간에 겹치는 경우가 있다)
- 멱등: answer_key 순으로 정렬해서 쓰고, 표본은 정렬된 목록에서 seed 고정으로 뽑는다.
- 수치: data/interim/v3/s3_1_stats.json
"""
import csv
import json
import os
import random
from collections import Counter, defaultdict

from common import INTERIM, RAW, answer_text, dname, is_symptom_answer, iter_json, load

OUT_DIR = os.path.join(INTERIM, "v3")
EXPECTED = {"answers": 28886, "diseases": 562}
SAMPLE_PER_DISEASE = 5
SEED = 42


def write_csv(path, cols, rows):
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    print(f"저장: {path} ({len(rows)}행)")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    rows, n_json = {}, 0
    dup_keys = Counter()
    for _, raw in iter_json(RAW):
        n_json += 1
        d = load(raw)
        if not isinstance(d, dict) or not is_symptom_answer(d):
            continue
        dn = d.get("disease_name") or {}
        dept = d.get("department")
        key = f"{str(d.get('fileName') or '').strip()}|{dname(d)}"
        if key in rows:
            dup_keys[key] += 1
            continue
        rows[key] = {
            "answer_key": key, "disease_ko": dname(d),
            "disease_en": (dn.get("eng") or "").strip() if isinstance(dn, dict) else "",
            "disease_category": str(d.get("disease_category") or "").strip(),
            "department_raw": json.dumps(dept if isinstance(dept, list) else ([] if dept is None else [dept]),
                                         ensure_ascii=False),
            "text": answer_text(d),
        }
    answers = [rows[k] for k in sorted(rows)]
    write_csv(os.path.join(OUT_DIR, "symptom_answers.csv"),
              ["answer_key", "disease_ko", "disease_en", "disease_category", "department_raw", "text"], answers)

    by_disease = defaultdict(list)
    for r in answers:
        by_disease[r["disease_ko"]].append(r)
    rng = random.Random(SEED)
    sample = []
    for dis in sorted(by_disease):
        pool = by_disease[dis]  # answer_key 순
        picked = pool if len(pool) <= SAMPLE_PER_DISEASE else rng.sample(pool, SAMPLE_PER_DISEASE)
        sample += sorted(picked, key=lambda r: r["answer_key"])
    sample_rows = [{"sample_id": f"S{i:04d}", "answer_key": r["answer_key"], "disease_ko": r["disease_ko"], "text": r["text"]}
                   for i, r in enumerate(sample, 1)]
    write_csv(os.path.join(OUT_DIR, "sample_answers.csv"), ["sample_id", "answer_key", "disease_ko", "text"], sample_rows)

    n_ans = len(answers) + sum(dup_keys.values())
    stats = {
        "json_read": n_json, "symptom_answers": n_ans, "unique_answer_keys": len(answers),
        "duplicate_answer_keys": sum(dup_keys.values()), "diseases": len(by_disease),
        "expected": EXPECTED,
        "matches_expected": n_ans == EXPECTED["answers"] and len(by_disease) == EXPECTED["diseases"],
        "empty_text": sum(not r["text"].strip() for r in answers),
        "answers_per_disease": {"min": min(map(len, by_disease.values())), "max": max(map(len, by_disease.values())),
                                "under_sample_size": sum(len(v) < SAMPLE_PER_DISEASE for v in by_disease.values())},
        "sample": {"per_disease": SAMPLE_PER_DISEASE, "seed": SEED, "rows": len(sample_rows)},
        "text_length": {"min": min(len(r["text"]) for r in answers), "max": max(len(r["text"]) for r in answers),
                        "mean": round(sum(len(r["text"]) for r in answers) / len(answers), 1)},
        "disease_category": dict(Counter(r["disease_category"] for r in answers).most_common()),
    }
    with open(os.path.join(OUT_DIR, "s3_1_stats.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(stats, f, ensure_ascii=False, indent=1)
    print(json.dumps(stats, ensure_ascii=False))
    if not stats["matches_expected"]:
        print(f"[경고] 기대값과 다름: 답변 {n_ans} (기대 {EXPECTED['answers']}), 질환 {len(by_disease)} (기대 {EXPECTED['diseases']})")


if __name__ == "__main__":
    main()
