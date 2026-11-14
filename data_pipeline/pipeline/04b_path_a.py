"""4단계 S4-2: 진료과 정리표(alias) → 질환별 진료과 → 경로 A 증상별 진료과

    python pipeline/04b_path_a.py      (04a → S4-2 라벨링 → 03c_match_all.py 결과가 있어야 한다)

- 설정: config/dept_label.yaml의 merge·path_a, config/recommend.yaml의 path_a(min_diseases)
- 1. alias: 두 평가자가 같은 dept → adopted / 둘 다 DROP → drop / 그 외 후보 겹침 규칙(증상 T1과 같음)
     교집합 1개 adopted_partial, 2개 이상 adopted_span(과마다 1/n), 0개 disagree.
     → department_alias.csv (raw_value, dept, status, weight, claude, codex)
     한 답변에서 같은 과는 한 번만, 가장 큰 가중치로 센다.
- 2. 질환별 진료과: "증상" 답변의 department_raw(JSON 배열, 원소를 "\n"으로 다시 나눔)를 alias로 바꿔 센다.
     한 답변에 같은 과가 여러 번 나오면 1번. DROP·미채택 표기는 뺀다.
     share = 그 과가 나온 답변 수 / 그 질환의 (답변, 과) 건수 합 (질환 안에서 합 1)
     rank = n_answers 내림차순 → dept 가나다 순의 순번
     → disease_department.csv (disease_ko, dept, n_answers, n_answers_with_dept, n_symptom_answers, share, rank)
- 3. 경로 A: disease_symptom.csv의 kept 쌍만 쓴다.
     score(증상, 과) = Σ_질환 [증상 share × 과 share] → 증상 안에서 합 1로 정규화
     n_diseases_linked = 그 증상의 kept 질환 수, path_a_ok = n_diseases_linked ≥ min_diseases
     excluded_in_2a = 2A(step2a_department.py) 제외 진료과 규칙에 걸리는지 (참고용. 여기서는 빼지 않는다)
     → symptom_department_path_a.csv
- 4. 교차검증 미리보기(경로 B와 비교)는 화면에만 찍는다. 파일을 고치지 않는다.
- 멱등: 정렬 고정, utf-8-sig.
"""
import csv
import importlib.util
import json
import os
import re
import sys
from collections import Counter, defaultdict

from ruamel.yaml import YAML

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: os.path.join(ROOT, *p)  # noqa: E731
csv.field_size_limit(10 ** 8)

sys.path.insert(0, J("pipeline"))
_spec = importlib.util.spec_from_file_location("step2a", J("pipeline", "step2a_department.py"))
s2a = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(s2a)
SPECIAL = ("DROP", "AMBIGUOUS")


def load_yaml(path):
    with open(path, encoding="utf-8") as f:
        return YAML(typ="safe", pure=True).load(f) or {}


def read_csv(path):
    if not os.path.exists(path):
        sys.exit(f"입력 파일 없음: {path}")
    for enc in ("utf-8-sig", "cp949"):
        try:
            with open(path, encoding=enc, newline="") as f:
                return list(csv.DictReader(f))
        except UnicodeDecodeError:
            continue
    sys.exit(f"인코딩을 알 수 없음: {path}")


def write_csv(path, cols, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    print(f"저장: {os.path.relpath(path, ROOT)} ({len(rows)}행)")


def main():
    cfg = load_yaml(J("config", "dept_label.yaml"))
    pa_cfg, out = cfg["path_a"], cfg["path_a"]["output"]
    min_dis = load_yaml(J("config", "recommend.yaml"))["path_a"]["min_diseases"]
    r1, r2 = cfg["merge"]["raters"]

    # ---------- 1. alias ----------
    raw = read_csv(J(cfg["merge"]["raw_values"]))
    opts = {r["dept"] for r in read_csv(J(cfg["merge"]["options"]))}
    lab, note = {}, {}
    for rt in (r1, r2):
        rows = read_csv(J(cfg["merge"]["labels_dir"], rt, "dept.csv"))
        lab[rt] = {r["raw_value"]: r["dept"].strip() for r in rows}
        note[rt] = {r["raw_value"]: r.get("note") or "" for r in rows}
        if len(rows) != len(lab[rt]) or set(lab[rt]) != {r["raw_value"] for r in raw} or not set(lab[rt].values()) <= opts:
            sys.exit(f"{rt}/dept.csv: 표기가 빠졌거나 겹치거나 선택지에 없는 값이 있음. 멈춤.")
    real = opts - set(SPECIAL)
    tok_re = re.compile("[" + re.escape(cfg["merge"]["note_split_chars"]) + r"\s]+")

    def candidates(rt, v):
        d = lab[rt][v]
        if d == "AMBIGUOUS":
            return {t for t in tok_re.split(note[rt][v]) if t in real}
        return {d} if d in real else set()

    alias_rows, alias = [], {}   # alias: 표기 → {과: 가중치}
    for r in raw:
        v = r["raw_value"]
        a, b = lab[r1][v], lab[r2][v]
        if a == b and a not in SPECIAL:
            status, depts = "adopted", [a]
        elif a == b == "DROP":
            status, depts = "drop", []
        else:
            common = sorted(candidates(r1, v) & candidates(r2, v)) if cfg["merge"].get("candidate_overlap") else []
            status = "disagree" if not common else "adopted_partial" if len(common) == 1 else "adopted_span"
            depts = common
        if depts:
            alias[v] = {d: 1 / len(depts) for d in depts}
        alias_rows.append({"raw_value": v, "dept": "; ".join(depts), "status": status,
                           "weight": f"{1 / len(depts):.4g}" if depts else "", r1: a, r2: b})
    write_csv(J(out["alias"]), ["raw_value", "dept", "status", "weight", r1, r2], alias_rows)

    # ---------- 2. 질환별 진료과 ----------
    split_re = re.compile("|".join(map(re.escape, cfg["split_chars"])))
    answers = sorted(read_csv(J(cfg["input"]["answers"])), key=lambda r: r["answer_key"])
    n_ans, n_with = Counter(), Counter()
    cnt = defaultdict(lambda: defaultdict(float))
    for a in answers:
        dis = a["disease_ko"]
        n_ans[dis] += 1
        depts = {}   # 한 답변에서 같은 과는 한 번(가장 큰 가중치)
        for v in json.loads(a["department_raw"] or "[]"):
            for p in split_re.split(str(v)):
                for d, w in alias.get(p, {}).items():
                    depts[d] = max(w, depts.get(d, 0))
        n_with[dis] += bool(depts)
        for d, w in depts.items():
            cnt[dis][d] += w
    dd_rows, dshare = [], defaultdict(dict)
    for dis in sorted(n_ans):
        tot = sum(cnt[dis].values())
        for i, (d, n) in enumerate(sorted(cnt[dis].items(), key=lambda x: (-x[1], x[0])), 1):
            dshare[dis][d] = n / tot
            dd_rows.append({"disease_ko": dis, "dept": d, "n_answers": f"{n:g}", "n_answers_with_dept": n_with[dis],
                            "n_symptom_answers": n_ans[dis], "share": f"{n / tot:.4f}", "rank": i})
    write_csv(J(out["disease_department"]),
              ["disease_ko", "dept", "n_answers", "n_answers_with_dept", "n_symptom_answers", "share", "rank"], dd_rows)
    zero_dept = [d for d in sorted(n_ans) if not cnt[d]]

    # ---------- 3. 경로 A ----------
    name_of = {r["symptom_id"]: r["name_ko"] for r in read_csv(J(pa_cfg["standard"]))}
    linked = defaultdict(list)   # 증상 → [(질환, 증상 share)]
    for r in read_csv(J(pa_cfg["disease_symptom"])):
        if r["kept"] == "true":
            linked[r["symptom_id"]].append((r["disease_ko"], float(r["share"])))
    sa_rows, top_a = [], {}
    for sid in sorted(linked):
        raw_score = defaultdict(float)
        n_used = 0
        for dis, s_share in linked[sid]:
            n_used += bool(dshare.get(dis))
            for d, d_share in dshare.get(dis, {}).items():
                raw_score[d] += s_share * d_share
        tot = sum(raw_score.values())
        if not tot:
            continue
        ranked = sorted(raw_score.items(), key=lambda x: (-x[1], x[0]))
        top_a[sid] = ranked
        for i, (d, sc) in enumerate(ranked, 1):
            sa_rows.append({"symptom_id": sid, "name_ko": name_of.get(sid, ""), "dept": d,
                            "score": f"{sc / tot:.4f}", "rank": i,
                            "n_diseases_linked": len(linked[sid]), "n_diseases_with_dept": n_used,
                            "path_a_ok": "true" if len(linked[sid]) >= min_dis else "false",
                            "excluded_in_2a": str(s2a.excluded(d)).lower()})
    write_csv(J(out["symptom_department"]),
              ["symptom_id", "name_ko", "dept", "score", "rank", "n_diseases_linked", "n_diseases_with_dept",
               "path_a_ok", "excluded_in_2a"], sa_rows)
    ok_ids = sorted(s for s in top_a if len(linked[s]) >= min_dis)

    # ---------- 4. 교차검증 미리보기 (화면만) ----------
    _, clinic_rows = s2a.read_csv(s2a.find_raw("의원급", "표시과목"))
    clinic_depts = {r["표시과목"].strip() for r in clinic_rows}

    def a_first(sid, eligible_only):
        for d, sc in top_a[sid]:
            if not eligible_only or (d in clinic_depts and not s2a.excluded(d)):
                return d, sc / sum(x for _, x in top_a[sid])
        return "", 0

    pb = read_csv(J(pa_cfg["path_b"]))
    comp = []
    for r in pb:
        if r["path_b_used"] != "true" or not r["rec1_dept"] or r["symptom_id"] not in top_a:
            continue
        cr = json.loads(r["clinic_ranking"] or "[]")
        if not cr:
            continue
        comp.append((r["symptom_id"], r["name_ko"], cr[0]["dept"], cr[0]["share"], len(linked[r["symptom_id"]])))
    n_b = sum(1 for r in pb if r["path_b_used"] == "true" and r["rec1_dept"])
    res = {}
    for label, elig in (("raw", False), ("clinic_eligible", True)):
        for scope in ("all", "path_a_ok"):
            rows = [c for c in comp if scope == "all" or c[4] >= min_dis]
            same = sum(a_first(c[0], elig)[0] == c[2] for c in rows)
            res[f"{label}/{scope}"] = (same, len(rows))
    diff = [c for c in comp if c[4] >= min_dis and a_first(c[0], True)[0] != c[2]]
    diff.sort(key=lambda c: (-c[4], c[0]))

    stats = {
        "alias": dict(Counter(r["status"] for r in alias_rows)),
        "alias_answers": {s: sum(int(r["n_answers"]) for r, a in zip(raw, alias_rows) if a["status"] == s)
                          for s in sorted({a["status"] for a in alias_rows})},
        "diseases": len(n_ans), "diseases_zero_dept": zero_dept,
        "answers_without_dept": sum(n_ans.values()) - sum(n_with.values()),
        "symptoms_with_path_a": len(top_a), "path_a_ok": len(ok_ids),
        "path_a_rank1": dict(Counter(top_a[s][0][0] for s in ok_ids).most_common()),
        "path_b_with_rec": n_b, "compared": len(comp),
        "cross_check": {k: {"same": v[0], "n": v[1]} for k, v in res.items()},
    }
    os.makedirs(os.path.dirname(J(out["stats"])), exist_ok=True)
    with open(J(out["stats"]), "w", encoding="utf-8", newline="\n") as f:
        json.dump(stats, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps(stats, ensure_ascii=False, indent=1))
    print(f"\n다른 증상 (path_a_ok, A는 의원급 순위에 나올 수 있는 과 중 1위) 상위 {pa_cfg['top_n_diff']} / 전체 {len(diff)}")
    for c in diff[:pa_cfg["top_n_diff"]]:
        d, sc = a_first(c[0], True)
        d0, sc0 = a_first(c[0], False)
        print(f"{c[0]}\t{c[1]}\t질환 {c[4]}\tA {d}({sc:.2f})" + (f" [원래 1위 {d0}({sc0:.2f})]" if d0 != d else "")
              + f"\tB {c[2]}({c[3]:.2f})")


if __name__ == "__main__":
    main()
