"""v2.1 이름 점검 목록: name_status=check인 증상과 사전 v3 동의어 상위 3개

    python pipeline/03d_name_check_v2_1.py      (03c_match_all.py 뒤에 돌린다)

- 입력: data/processed/v3/standard_symptoms_v2_1.csv, symptom_synonym_v3.csv, data/interim/v3/symptom_answers.csv
- name_claude / name_codex: v2 T2 이름 제안. primary_rater(config/v2_merge.yaml)의 제안이 name_ko, 다른 평가자 제안이 name_ko_alt
- synonyms_top3: 그 증상의 사전 v3 동의어 중 증상 답변에서 매칭된 답변 수가 많은 3개
    매칭은 03c_match_all.py와 같은 방법(공백 무시, 왼쪽 경계, 한 글자 규칙, 긴 표현 우선, 문맥 제외 뒤)
    답변 수가 같으면 동의어 파일 순서. 공백만 다른 표기는 동의어 파일에 먼저 나온 표기 하나로 쓴다.
- 출력: reports/name_check_v2_1.csv (symptom_id, icpc2_preferred, name_claude, name_codex, synonyms_top3)
    답변 문장은 넣지 않는다(사전 표현만).
- 멱등: 증상은 standard 파일 순서, utf-8-sig.
"""
import csv
import importlib.util
import os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: os.path.join(ROOT, *p)  # noqa: E731

_spec = importlib.util.spec_from_file_location("match_all", J("pipeline", "03c_match_all.py"))
ma = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ma)
_spec_l = importlib.util.spec_from_file_location("icpc_link", J("pipeline", "icpc_link.py"))
icpc_link = importlib.util.module_from_spec(_spec_l)   # 영어 이름은 data/interim 연결 파일에 있다
_spec_l.loader.exec_module(icpc_link)


def main():
    cfg = ma.load_yaml(J("config", "match_all.yaml"))
    merge_cfg = ma.load_yaml(J("config", "v2_merge.yaml"))
    r1, r2 = merge_cfg["raters"]
    primary = merge_cfg["primary_rater"]
    other = r2 if primary == r1 else r1
    dc = cfg["dictionaries"]["v3"]

    matcher = ma.Matcher(ma.load_yaml(J("config", "symptom_match.yaml")), ma.load_yaml(J("config", "symptom_exclusion.yaml")))
    d = ma.Dictionary(J(dc["synonyms"]), J(dc["standard"]), cfg["span_weight"])
    answers = sorted(ma.read_csv(J(cfg["answers"])), key=lambda r: r["answer_key"])
    n_key = defaultdict(int)   # 공백을 뺀 표현 → 매칭된 답변 수
    for a in answers:
        ms = matcher.find(a["text"], d)
        for key in {m[2] for m in ms if not matcher.excluded(a["text"], m, ms)}:
            n_key[key] += 1

    syn = defaultdict(list)    # symptom_id → [(key, 표기)] 동의어 파일 순서, key 중복 제거
    for r in ma.read_csv(J(dc["synonyms"])):
        key = ma.WS.sub("", r["term"])
        if key not in {k for k, _ in syn[r["symptom_id"]]}:
            syn[r["symptom_id"]].append((key, r["term"]))

    rows = []
    for s in icpc_link.load_full(J(dc["standard"]), ma.read_csv):
        if s["name_status"] != "check":
            continue
        ranked = sorted(enumerate(syn[s["symptom_id"]]), key=lambda x: (-n_key.get(x[1][0], 0), x[0]))
        rows.append({"symptom_id": s["symptom_id"], "icpc2_preferred": s["icpc2_preferred"],
                     f"name_{primary}": s["name_ko"], f"name_{other}": s["name_ko_alt"],
                     "synonyms_top3": "; ".join(t for _, (_, t) in ranked[:3])})
    ma.write_csv(J("reports", "name_check_v2_1.csv"),
                 ["symptom_id", "icpc2_preferred", f"name_{primary}", f"name_{other}", "synonyms_top3"], rows)


if __name__ == "__main__":
    main()
