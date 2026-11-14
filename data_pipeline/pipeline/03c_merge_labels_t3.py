"""3단계 S3-5 (1~3): T3 라벨 합치기 → 표준 증상 v2.1, 사전 v3

    python pipeline/03c_merge_labels_t3.py      (03c_label_inputs_t3.py → S3-4 라벨링 뒤에 돌린다)

- 규칙: config/v2_merge.yaml의 T1 규칙을 그대로 쓴다 (새 규칙 없음)
    둘이 같은 코드(NONE·AMBIGUOUS 제외) → agreed / 둘 다 NONE → none
    그 외 → 후보 집합(코드 또는 AMBIGUOUS note의 코드)의 교집합 1개 agreed_partial, 2개 이상 agreed_span, 0개 disagree
  후보 코드 패턴만 config/label_t3.yaml의 merge.code_pattern을 쓴다(하위 코드 D20-01… 때문).
- 새 증상: 채택(agreed*)된 코드가 v2에 없으면 v2.1로 추가한다.
    이름·119 범주는 v2 T2 라벨 합치기 결과(01e와 같은 계산)를 그대로 쓴다. 다른 컬럼도 01e와 같은 방법으로 채운다.
    검증: 같은 함수로 v2의 ICPC 증상 행을 다시 만들어 v2 파일과 비교한다(항목 수에 따라 달라지는 칸 제외).
- 표현 배정: 라벨은 variants의 모든 표기에 적용한다. 하위 코드(D20-01…)로 채택되면 그 하위 증상에 붙인다.
    상위 코드(D20)로 채택되면 config/symptom_subdivision.yaml keywords로 하위에 배정(01e와 같은 방법).
- 출력: config/label_t3.yaml의 merge.output
    term_to_symptom_T3.csv, standard_symptoms_v2_1.csv(v2 행은 그대로 + 추가 행), symptom_synonym_v3.csv
- 멱등: 입력 순서 고정(item_id 순, v2 행 순서 유지), utf-8-sig.
"""
import csv
import importlib.util
import json
import os
import re
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: os.path.join(ROOT, *p)  # noqa: E731
SPECIAL = ("NONE", "AMBIGUOUS")

_spec = importlib.util.spec_from_file_location("merge_v2", J("pipeline", "01e_merge_labels.py"))
m2 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m2)
read_csv, write_csv, load_yaml = m2.read_csv, m2.write_csv, m2.load_yaml
cats, join_cats, norm, to_int = m2.cats, m2.join_cats, m2.norm, m2.to_int


def t2_results(cfg, mc):
    """01e의 T2 합치기(119 범주·이름)를 그대로 계산한다. code → (범주 집합, triage_status, name, name_status, alt)."""
    r1, r2 = cfg["raters"]
    weak, primary = set(cfg["weak_categories"]), cfg["primary_rater"]
    codes = [r["code"] for r in read_csv(J(mc["v2"]["t2_items"]))]
    lab2 = {r: {x["code"]: x for x in read_csv(J(mc["v2"]["labels_dir"], r, "T2.csv"))} for r in (r1, r2)}
    out = {}
    for code in codes:
        a, b = cats(lab2[r1][code]["triage_category"]), cats(lab2[r2][code]["triage_category"])
        final, one = set(), False
        for c in sorted(a | b):
            both = c in a and c in b
            if c in weak and not both:
                continue
            final.add(c)
            one = one or not both
        status = "" if not final else "one_rater" if one else "agreed"
        p1, p2 = (lab2[r][code]["name_ko_proposal"].strip() for r in (r1, r2))
        if p1 == p2:
            name = (p1, "agreed", "")
        else:
            name = (p1, "check", p2) if primary == r1 else (p2, "check", p1)
        out[code] = (final, status) + name
    return codes, out


def build_row(code, t2, icpc, link, body, sex_cfg, n_terms, src):
    """01e의 v2 행 만들기와 같은 방법."""
    s, lk = icpc[code], link[code]
    tri, tri_status, name, name_status, alt = t2[code]
    names3 = []
    for r in lk:
        if r["kcd_name_ko_3"] and r["kcd_name_ko_3"] not in names3:
            names3.append(r["kcd_name_ko_3"])
    overrides = body.get("overrides") or {}
    return {
        "symptom_id": code, "icpc2_code": code, "icpc2_preferred": s["preferred"], "chapter": s["chapter"],
        "chapter_ko": s["chapter_ko"], "name_ko": name, "name_status": name_status, "name_ko_alt": alt,
        "body_part_ui": (overrides.get(code) or {}).get("group") or body["chapter_default"][s["chapter"]],
        "sex_restriction": (sex_cfg.get("chapter") or {}).get(s["chapter"], sex_cfg["default"]),
        "icd10_list": s["icd10_list"], "icd10_3_list": s["icd10_3_list"], "kcd_name_ko": "; ".join(names3),
        "hira_has_data": "true" if any(to_int(r["hira_clinic_patients"]) + to_int(r["hira_hospital_patients"]) > 0 for r in lk) else "false",
        "hira_shared_code": lk[0]["hira_shared_code"], "hira_shared_codes": lk[0]["hira_shared_codes"],
        "triage_category": join_cats(tri), "triage_status": tri_status, "n_terms_agreed": n_terms,
        "source": src, "parent_id": "", "is_parent": "false", "note": "",
    }


def main():
    cfg = load_yaml(J("config", "v2_merge.yaml"))
    t3 = load_yaml(J("config", "label_t3.yaml"))
    mc, out = t3["merge"], t3["merge"]["output"]
    body = load_yaml(J("config", "body_part_ui.yaml"))
    subdivisions = load_yaml(J("config", "symptom_subdivision.yaml"), required=False).get("subdivisions") or {}
    r1, r2 = cfg["raters"]

    items = read_csv(J(mc["items"]))
    options = {r["code"] for r in read_csv(J(mc["options"]))}
    real_codes = options - set(SPECIAL)
    lab, note = {}, {}
    for rater in (r1, r2):
        rows = read_csv(J(mc["labels_dir"], rater, "T3.csv"))
        ids = [r["item_id"] for r in rows]
        lab[rater] = {r["item_id"]: r["icpc2_code"].strip() for r in rows}
        note[rater] = {r["item_id"]: r.get("note") or "" for r in rows}
        if len(ids) != len(set(ids)) or set(ids) != {i["item_id"] for i in items} or not set(lab[rater].values()) <= options:
            sys.exit(f"{rater}/T3.csv: item이 빠졌거나 겹치거나 선택지에 없는 코드가 있음. 멈춤.")

    # ---------- 1. T3 합치기 (01e T1 규칙) ----------
    overlap = cfg.get("t1_candidate_overlap") or {}
    code_re = re.compile(mc["code_pattern"])

    def candidates(rater, iid):
        code = lab[rater][iid]
        if code == "AMBIGUOUS":
            return {c for c in code_re.findall(note[rater][iid]) if c in real_codes}
        return {code} if code in real_codes else set()

    term_rows, finals_of = [], {}
    for it in items:
        iid = it["item_id"]
        a, b = lab[r1][iid], lab[r2][iid]
        finals = []
        if a == b == "NONE":
            status = "none"
        elif a == b and a not in SPECIAL:
            status, finals = "agreed", [a]
        else:
            common = sorted(candidates(r1, iid) & candidates(r2, iid)) if overlap.get("enabled") else []
            status = "disagree" if not common else "agreed_partial" if len(common) == 1 else "agreed_span"
            finals = common
        finals_of[iid] = (finals, status)
        term_rows.append({"item_id": iid, "phrase": it["phrase"], "variants": it["variants"], "source": it["source"],
                          "n_answers": it["n_answers"], f"code_{r1}": a, f"code_{r2}": b,
                          "final_code": "; ".join(finals), "status": status, "symptom_ids": ""})

    # ---------- 2. 표준 증상 v2.1 ----------
    # 표준 증상 v2 + data/interim의 ICPC 연결 파일(01e가 씀)을 합쳐 예전과 같은 행으로 읽는다
    v2 = m2.icpc_link.load_full(J(mc["v2"]["standard"]), read_csv)
    cols = list(v2[0].keys())
    v2_ids = {r["symptom_id"] for r in v2}
    icpc = {r["code"]: r for r in read_csv(J(mc["v2"]["icpc"]))}
    link = defaultdict(list)
    for r in read_csv(J(mc["v2"]["kcd_link"])):
        link[r["code"]].append(r)
    t2_codes, t2 = t2_results(cfg, mc)

    # 검증: v2의 ICPC 증상(하위·예외 제외)을 같은 함수로 다시 만들어 비교
    skip = {"n_terms_agreed", "source", "note", "is_parent", "triage_status", "triage_category"}
    mism = []
    for r in v2:
        if r["icpc2_code"] and not r["parent_id"]:
            rb = build_row(r["symptom_id"], t2, icpc, link, body, cfg["sex_restriction"], 0, "")
            mism += [(r["symptom_id"], k) for k in cols if k not in skip and str(rb[k]) != r[k]]
            # 119 범주는 force_triage가 걸린 코드만 다를 수 있다
            if join_cats(t2[r["symptom_id"]][0]) != r["triage_category"] and "강제 연결" not in r["note"]:
                mism.append((r["symptom_id"], "triage_category"))
    if mism:
        sys.exit(f"v2 행 재현 실패(01e와 계산이 다름): {mism[:10]}")

    child_of = {c["id"]: pid for pid, s in subdivisions.items() for c in s["children"]}
    adopted = defaultdict(list)   # code → [item]
    for it in items:
        for c in finals_of[it["item_id"]][0]:
            adopted[c].append(it)
    new_codes = sorted(c for c in adopted if c not in v2_ids)
    for c in new_codes:
        if c not in icpc or c in child_of:
            sys.exit(f"새 증상 {c}: ICPC 증상 목록에 없음. 멈춤.")
    new_rows = []
    for c in new_codes:
        tri = t2[c][0]
        row = build_row(c, t2, icpc, link, body, cfg["sex_restriction"], len(adopted[c]),
                        ";".join(["t3"] + (["triage"] if tri else [])))
        row["note"] = "v2.1 추가 (S3-5, AI Hub T3)"
        new_rows.append(row)
    std = v2 + new_rows

    # ---------- 2b. 이름 확정 (config/name_final_v2_1.csv) ----------
    renamed = {}   # symptom_id → (옛 이름, 새 이름)
    if mc.get("name_final"):
        primary = cfg["primary_rater"]
        other = r2 if primary == r1 else r1
        by_id = {r["symptom_id"]: r for r in std}
        fin = read_csv(J(mc["name_final"]))
        ids = [f["symptom_id"] for f in fin]
        if len(ids) != len(set(ids)):
            sys.exit("name_final: symptom_id 중복. 멈춤.")
        for f in fin:
            s = by_id.get(f["symptom_id"])
            new = f["name_ko_final"].strip()
            # 이름 확정표에는 ICPC 영어 이름을 두지 않는다(저작권 대응) → id와 두 평가자 제안 이름으로 맞춘다
            if not s or not new \
                    or (s["name_ko"], s["name_ko_alt"]) != (f[f"name_{primary}"], f[f"name_{other}"]):
                sys.exit(f"name_final {f['symptom_id']}: v2.1과 맞지 않음(id·제안 이름). 멈춤.")
            renamed[s["symptom_id"]] = (s["name_ko"], new)
            s["name_ko"], s["name_status"] = new, "final"
        names = Counter(r["name_ko"] for r in std)
        if any(v > 1 for v in names.values()):
            sys.exit(f"이름 확정 뒤 같은 이름이 둘 이상: {[k for k, v in names.items() if v > 1]}")
    m2.icpc_link.write(J(out["standard"]), m2.icpc_link.link_path_for(J(out["standard"])), std, write_csv)

    # ---------- 3. 사전 v3 ----------
    name_of = {r["symptom_id"]: r["name_ko"] for r in std}
    sex_of = {r["symptom_id"]: r["sex_restriction"] for r in std}
    syn = read_csv(J(mc["v2"]["synonyms"]))
    syn_cols = list(syn[0].keys())
    seen = {(r["symptom_id"], r["term"]) for r in syn}
    sub_assign, n_dup = [], 0
    for it, row in zip(items, term_rows):
        finals, status = finals_of[it["item_id"]]
        sids = []
        for c in finals:
            sid = c
            if c in subdivisions:   # 상위 코드로 채택 → keywords로 하위 배정 (01e와 같은 방법)
                hits = [ch["id"] for ch in subdivisions[c]["children"]
                        for k in ch.get("keywords") or [] if norm(k) in norm(it["phrase"])]
                sid = hits[0] if hits else c
                sub_assign.append((it["item_id"], it["phrase"], c, sid))
            sids.append(sid)
        row["symptom_ids"] = "; ".join(sids)
        for sid in sids:
            for v in it["variants"].split("; "):
                if (sid, v) in seen:
                    n_dup += 1
                    continue
                seen.add((sid, v))
                syn.append({"symptom_id": sid, "term": v, "term_norm": norm(v),
                            "term_type": "span" if status == "agreed_span" else "대표" if v == name_of[sid] else "동의어",
                            "sex_restriction": sex_of[sid], "source": mc["term_source"], "status": status})
    # 이름 확정 반영: 옛 이름이 대표 표현이면 → 동의어로, 새 이름을 대표로
    n_rep_added = n_rep_switched = 0
    for sid, (old, new) in sorted(renamed.items()):
        if old == new or not any(r["symptom_id"] == sid and r["term"] == old and r["term_type"] == "대표" for r in syn):
            continue
        for r in syn:
            if r["symptom_id"] == sid and r["term"] == old and r["term_type"] == "대표":
                r["term_type"] = "동의어"
        hit = [r for r in syn if r["symptom_id"] == sid and r["term"] == new]
        if hit:
            for r in hit:
                r["term_type"] = "대표"
            n_rep_switched += 1
        else:
            syn.append({"symptom_id": sid, "term": new, "term_norm": norm(new), "term_type": "대표",
                        "sex_restriction": sex_of[sid], "source": mc["name_final_source"], "status": mc["name_final_source"]})
            n_rep_added += 1
    write_csv(J(out["terms"]), list(term_rows[0].keys()), term_rows)
    write_csv(J(out["synonyms"]), syn_cols, syn)

    stats = {
        "t3": {"total": len(term_rows), **Counter(r["status"] for r in term_rows)},
        "new_symptoms": [{"symptom_id": r["symptom_id"], "name_ko": r["name_ko"], "name_status": r["name_status"],
                          "chapter": r["chapter"], "body_part_ui": r["body_part_ui"], "sex_restriction": r["sex_restriction"],
                          "triage_category": r["triage_category"], "n_terms": r["n_terms_agreed"],
                          "terms": [it["phrase"] for it in adopted[r["symptom_id"]]]} for r in new_rows],
        "standard": {"v2": len(v2), "v2_1": len(std)},
        "synonyms": {"v2": len(syn) - sum(r["source"] == mc["term_source"] for r in syn),
                     "v3": len(syn), "added": sum(r["source"] == mc["term_source"] for r in syn), "skipped_dup": n_dup},
        "adopted_items": sum(bool(f[0]) for f in finals_of.values()),
        "name_final": {"listed": len(renamed), "changed": sum(o != n for o, n in renamed.values()),
                       "rep_added": n_rep_added, "rep_switched": n_rep_switched,
                       "status": dict(Counter(r["name_status"] for r in std)),
                       "changed_list": {s: [o, n] for s, (o, n) in sorted(renamed.items()) if o != n}},
        "subdivision_assign": sub_assign,
        "by_symptom_added": dict(sorted(Counter(r["symptom_id"] for r in syn if r["source"] == mc["term_source"]).items())),
    }
    with open(J(out["stats"]), "w", encoding="utf-8", newline="\n") as f:
        json.dump(stats, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps({k: stats[k] for k in ("t3", "standard", "synonyms", "adopted_items", "subdivision_assign", "name_final")},
                     ensure_ascii=False))
    for r in stats["new_symptoms"]:
        print("새 증상:", r)


if __name__ == "__main__":
    main()
