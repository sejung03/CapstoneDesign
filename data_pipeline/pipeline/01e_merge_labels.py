"""v2 P3: 두 평가자 라벨(P2)을 합쳐 표준 증상 v2를 만든다.

    python pipeline/01e_merge_labels.py      (01b → 01c → 01d → P2 라벨링 뒤에 돌린다)

- 입력: data/interim/v2/(01b·01c 결과), labels/v2/inputs/(라벨링 입력), labels/v2/<평가자>/T1.csv·T2.csv,
  data/frozen/(step1 후보, v1 표준 증상)

- 규칙: config/v2_merge.yaml, config/body_part_ui.yaml, config/symptom_exceptions.yaml(있을 때만),
  config/symptom_subdivision.yaml(있을 때만. 하위 증상 D20-01… 추가, 상위는 is_parent=true)
- 출력 (data/processed/v2/)
    term_to_icpc2.csv          T1 합친 결과 (agreed / none / disagree)
    standard_symptoms_v2.csv   표준 증상 v2 (symptom_id = ICPC 코드, 예외는 EX01…)
    symptom_synonym_v2.csv     증상별 표현 (agreed만)
    v1_to_v2_map.csv           v1 symptom_id → v2
- 사람이 볼 목록 (reports/)
    v2_review_name_check.csv, v2_review_one_rater.csv, v2_review_v1_unmapped.csv
- 보고서용 수치: data/interim/v2/v2_build_stats.json
- 멱등: 정렬 고정, utf-8-sig. v1 파일과 data/raw는 읽기만 한다.
"""
import csv
import importlib.util
import json
import os
import re
import sys
import unicodedata
from collections import Counter, defaultdict

from ruamel.yaml import YAML

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: os.path.join(ROOT, *p)
sys.path.insert(0, J("pipeline"))
import icpc_link  # noqa: E402  표준 증상의 ICPC 원본 칸을 data/interim 연결 파일로 나눔
V2_IN = J("data", "interim", "v2")             # 01b·01c 결과, 보고서용 수치
LABELS = J("labels", "v2")                     # inputs/ = 라벨링 입력, <평가자>/ = 라벨 결과
LABEL_IN = os.path.join(LABELS, "inputs")
FROZEN = J("data", "frozen")
OUT_DIR = J("data", "processed", "v2")
REPORTS = J("reports")
SPECIAL = ("NONE", "AMBIGUOUS")


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


def write_csv(path, cols, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    print(f"저장: {os.path.relpath(path, ROOT)} ({len(rows)}행)")


def load_yaml(path, required=True):
    if not os.path.exists(path):
        if required:
            sys.exit(f"설정 파일 없음: {path}")
        return {}
    with open(path, encoding="utf-8") as f:
        return YAML(typ="safe", pure=True).load(f) or {}


def cats(value):
    """'14;27' → {14, 27}. 0(해당 없음)은 뺀다."""
    return {int(t) for t in value.replace(",", ";").split(";") if t.strip() and int(t) != 0}


def join_cats(s):
    return ";".join(str(c) for c in sorted(s))


def norm(term):
    return "".join(unicodedata.normalize("NFKC", term).lower().split())


def to_int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def main():
    cfg = load_yaml(J("config", "v2_merge.yaml"))
    body = load_yaml(J("config", "body_part_ui.yaml"))
    exceptions = load_yaml(J("config", "symptom_exceptions.yaml"), required=False).get("exceptions") or []
    subdivisions = load_yaml(J("config", "symptom_subdivision.yaml"), required=False).get("subdivisions") or {}
    r1, r2 = cfg["raters"]
    weak = set(cfg["weak_categories"])
    primary = cfg["primary_rater"]

    icpc = {r["code"]: r for r in read_csv(os.path.join(V2_IN, "icpc2_symptoms_all.csv"))}
    link = defaultdict(list)
    for r in read_csv(os.path.join(V2_IN, "icpc2_kcd_link.csv")):
        link[r["code"]].append(r)
    items = read_csv(os.path.join(LABEL_IN, "label_items_T1.csv"))
    options = {r["code"] for r in read_csv(os.path.join(LABEL_IN, "label_options_T1.csv"))}
    t2_codes = [r["code"] for r in read_csv(os.path.join(LABEL_IN, "label_items_T2.csv"))]
    valid_triage = {int(r["triage_category"]) for r in read_csv(os.path.join(LABEL_IN, "label_options_T2_triage.csv"))}
    cands = {r["name_ko"].strip(): r for r in read_csv(os.path.join(FROZEN, "step1_symptom_candidates.csv"))}
    v1 = read_csv(os.path.join(FROZEN, "standard_symptoms_v1.csv"))
    v1_name = {r["symptom_id"]: r["name_ko"] for r in v1}

    lab1, lab2, note1 = {}, {}, {}
    for rater in (r1, r2):
        t1_raw = read_csv(os.path.join(LABELS, rater, "T1.csv"))
        a = {r["item_id"]: r["icpc2_code"].strip() for r in t1_raw}
        note1[rater] = {r["item_id"]: r.get("note") or "" for r in t1_raw}
        b = {r["code"]: r for r in read_csv(os.path.join(LABELS, rater, "T2.csv"))}
        if set(a) != {i["item_id"] for i in items} or not set(a.values()) <= options:
            sys.exit(f"{rater}/T1.csv: item이 빠졌거나 선택지에 없는 코드가 있음. 멈춤.")
        if set(b) != set(t2_codes) or any(not cats(r["triage_category"]) <= valid_triage for r in b.values()):
            sys.exit(f"{rater}/T2.csv: 코드가 빠졌거나 없는 119 범주가 있음. 멈춤.")
        lab1[rater], lab2[rater] = a, b

    # ---------- T1 ----------
    overlap = cfg.get("t1_candidate_overlap") or {}
    code_re = re.compile(overlap.get("code_pattern", "[A-Z][0-9]{2}"))
    real_codes = options - set(SPECIAL)

    def candidates(rater, item_id):
        code = lab1[rater][item_id]
        if code == "AMBIGUOUS":
            return {c for c in code_re.findall(note1[rater][item_id]) if c in real_codes}
        return {code} if code in real_codes else set()

    t1_rows, agreed_terms, term_status = [], defaultdict(list), {}  # code → [item] / item_id → status
    for it in items:
        a, b = lab1[r1][it["item_id"]], lab1[r2][it["item_id"]]
        finals = []
        if a == b == "NONE":
            status = "none"
        elif a == b and a not in SPECIAL:
            status, finals = "agreed", [a]
        else:
            common = sorted(candidates(r1, it["item_id"]) & candidates(r2, it["item_id"])) if overlap.get("enabled") else []
            status = "disagree" if not common else "agreed_partial" if len(common) == 1 else "agreed_span"
            finals = common
        for c in finals:
            agreed_terms[c].append(it)
        term_status[it["item_id"]] = status
        t1_rows.append({"item_id": it["item_id"], "term_ko": it["term_ko"], "source": it["source"],
                        f"code_{r1}": a, f"code_{r2}": b, "final_code": "; ".join(finals), "status": status})
    t1_by_term = {r["term_ko"]: r for r in t1_rows}
    write_csv(os.path.join(OUT_DIR, "term_to_icpc2.csv"),
              ["item_id", "term_ko", "source", f"code_{r1}", f"code_{r2}", "final_code", "status"], t1_rows)

    # ---------- T2: 119 범주 ----------
    triage, one_rater_rows, dropped_weak, forced_note = {}, [], [], {}
    n_link_both = n_link_one = 0
    for code in t2_codes:
        a, b = cats(lab2[r1][code]["triage_category"]), cats(lab2[r2][code]["triage_category"])
        final = set()
        for c in sorted(a | b):
            both = c in a and c in b
            if c in weak and not both:
                dropped_weak.append((code, c, r1 if c in a else r2))
                continue
            final.add(c)
            if both:
                n_link_both += 1
            else:
                n_link_one += 1
                one_rater_rows.append({"code": code, "preferred": icpc[code]["preferred"], "triage_category": c,
                                       "rater": r1 if c in a else r2})
        status = "" if not final else "one_rater" if any(r["code"] == code for r in one_rater_rows) else "agreed"
        triage[code] = [final, status]
    for term, forced in (cfg.get("force_triage") or {}).items():
        row = t1_by_term.get(term)
        if row and row["status"].startswith("agreed") and "; " not in row["final_code"]:
            code = row["final_code"]
            added = set(forced) - triage[code][0]
            triage[code][0] |= set(forced)
            triage[code][1] = triage[code][1] or "forced"
            forced_note[code] = f"'{term}' → 119 범주 {join_cats(forced)} 강제 연결" + ("(라벨에 없어 추가)" if added else "(라벨에도 있음)")
        elif not any(term in (e.get("v1_terms") or []) and set(forced) <= set(e["triage_category"]) for e in exceptions):
            sys.exit(f"force_triage '{term}': agreed 코드가 없고 예외 증상에도 없음. config/symptom_exceptions.yaml에 추가할 것.")

    # ---------- name_ko ----------
    def freq_key(it):
        c = cands.get(it["term_ko"], {})
        return (-to_int(c.get("n_answers")), -to_int(c.get("n_diseases")), it["item_id"])

    def pick_name(code):
        """T1 표현은 이름에 쓰지 않는다(동의어로만). 두 평가자 제안이 같으면 agreed, 다르면 primary 제안 + check."""
        p1, p2 = (lab2[r][code]["name_ko_proposal"].strip() for r in (r1, r2))
        if p1 == p2:
            return p1, "agreed", ""
        mine, other = (p1, p2) if primary == r1 else (p2, p1)
        return mine, "check", other

    # ---------- v2에 넣을 코드 ----------
    overrides = body.get("overrides") or {}
    sex_cfg = cfg["sex_restriction"]
    sex_of = lambda chapter: (sex_cfg.get("chapter") or {}).get(chapter, sex_cfg["default"])
    cols = icpc_link.FULL_COLS   # 쓸 때 ICPC 원본 칸은 data/interim 연결 파일로 나눈다(pipeline/icpc_link.py)
    v2 = []
    for code in t2_codes:
        terms, (tri, tri_status) = agreed_terms.get(code, []), triage[code]
        if not terms and not tri:
            continue
        s, lk = icpc[code], link[code]
        name, name_status, alt = pick_name(code)
        names3 = []
        for r in lk:
            if r["kcd_name_ko_3"] and r["kcd_name_ko_3"] not in names3:
                names3.append(r["kcd_name_ko_3"])
        src = (["t1"] if terms else []) + (["added_common"] if any(t["source"] == "added_common" for t in terms) else []) \
            + (["triage"] if tri else [])
        v2.append({
            "symptom_id": code, "icpc2_code": code, "icpc2_preferred": s["preferred"], "chapter": s["chapter"],
            "chapter_ko": s["chapter_ko"], "name_ko": name, "name_status": name_status, "name_ko_alt": alt,
            "body_part_ui": (overrides.get(code) or {}).get("group") or body["chapter_default"][s["chapter"]],
            "sex_restriction": sex_of(s["chapter"]),
            "icd10_list": s["icd10_list"], "icd10_3_list": s["icd10_3_list"], "kcd_name_ko": "; ".join(names3),
            "hira_has_data": "true" if any(to_int(r["hira_clinic_patients"]) + to_int(r["hira_hospital_patients"]) > 0 for r in lk) else "false",
            "hira_shared_code": lk[0]["hira_shared_code"], "hira_shared_codes": lk[0]["hira_shared_codes"],
            "triage_category": join_cats(tri), "triage_status": tri_status, "n_terms_agreed": len(terms),
            "source": ";".join(src), "note": forced_note.get(code, ""),
        })

    # ---------- 예외 증상 (EX01…) ----------
    if exceptions:
        spec = importlib.util.spec_from_file_location("kcd_link", J("pipeline", "01c_icpc2_kcd_link.py"))
        k = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(k)
        master = k.load_master()
        clinic = k.load_patients(k.find_raw("의원급", "표시과목"))
        hospital = k.load_patients(k.find_raw("병원급", "진료과목"))
        used3 = defaultdict(list)  # 3자리 코드 → v2에 들어간 ICPC 코드
        for r in v2:
            for c3 in filter(None, r["icd10_3_list"].split("; ")):
                used3[c3].append(r["symptom_id"])
        for e in sorted(exceptions, key=lambda e: e["id"]):
            if not e["id"].startswith("EX") or e["id"] in icpc:
                sys.exit(f"예외 id 형식 오류: {e['id']}")
            c3s = [str(c) for c in e.get("icd10_3") or []]
            shared = [c for c in c3s if used3.get(c)]
            v2.append({
                "symptom_id": e["id"], "icpc2_code": "", "icpc2_preferred": "", "chapter": "", "chapter_ko": "",
                "name_ko": e["name_ko"], "name_status": "exception", "name_ko_alt": "",
                "body_part_ui": e["body_part_ui"], "sex_restriction": sex_cfg["default"],
                "icd10_list": "", "icd10_3_list": "; ".join(c3s),
                "kcd_name_ko": "; ".join(master.get(c, "") for c in c3s),
                "hira_has_data": "true" if any(clinic.get(c, 0) + hospital.get(c, 0) > 0 for c in c3s) else "false",
                "hira_shared_code": "true" if shared else "false", "hira_shared_codes": "; ".join(shared),
                "triage_category": join_cats(set(e.get("triage_category") or [])),
                "triage_status": "exception" if e.get("triage_category") else "",
                "n_terms_agreed": 0, "source": "exception", "note": f"v1 {e.get('v1_symptom_id', '')}. {e['reason']}",
            })
    # ---------- 하위 구분 (config/symptom_subdivision.yaml) ----------
    term_child, sub_assign = {}, []  # (상위 코드, item_id) → 하위 id / 보고용 배정 목록
    out = []
    for r in v2:
        r["parent_id"], r["is_parent"] = "", "false"
        out.append(r)
        spec_sub = subdivisions.get(r["symptom_id"])
        if not spec_sub:
            continue
        pid, r["is_parent"] = r["symptom_id"], "true"
        children = spec_sub["children"]
        n_child = Counter()
        for it in sorted(agreed_terms.get(pid, []), key=lambda x: x["item_id"]):
            hits = [(c["id"], k) for c in children for k in c.get("keywords") or [] if norm(k) in norm(it["term_ko"])]
            target = hits[0][0] if hits else pid
            if hits:
                term_child[(pid, it["item_id"])] = target
                n_child[target] += 1
            sub_assign.append({"parent_id": pid, "term": it["term_ko"], "assigned_to": target,
                               "keyword": hits[0][1] if hits else "",
                               "also_matched": "; ".join(sorted({h[0] for h in hits} - {target}))})
        parent_c3 = r["icd10_3_list"].split("; ")
        for c in children:
            c3s = [str(x) for x in c["icd10_3"]]
            if c["id"] in icpc or any(x not in parent_c3 for x in c3s):
                sys.exit(f"하위 구분 {c['id']}: id가 ICPC 코드와 겹치거나 상위에 없는 3자리 코드가 있음. 멈춤.")
            lk = [x for x in link[pid] if x["icd10_3"] in c3s]
            names3 = list(dict.fromkeys(x["kcd_name_ko_3"] for x in lk if x["kcd_name_ko_3"]))
            shared = [x3 for x3 in c3s if any(x["icd10_3"] == x3 and x["icd10_3_shared_with"].strip() for x in lk)]
            out.append({**r, "symptom_id": c["id"], "name_ko": c["name_ko"], "name_status": "subdivision", "name_ko_alt": "",
                        "icd10_list": "; ".join(x["icd10"] for x in lk), "icd10_3_list": "; ".join(c3s),
                        "kcd_name_ko": "; ".join(names3),
                        "hira_has_data": "true" if any(to_int(x["hira_clinic_patients"]) + to_int(x["hira_hospital_patients"]) > 0 for x in lk) else "false",
                        "hira_shared_code": "true" if shared else "false", "hira_shared_codes": "; ".join(shared),
                        "n_terms_agreed": n_child[c["id"]], "source": "subdivision", "parent_id": pid, "is_parent": "false",
                        "note": f"{pid} 하위 구분. triage_category 등은 상위 값을 물려받음"})
    missing_parents = set(subdivisions) - {r["symptom_id"] for r in v2}
    if missing_parents:
        sys.exit(f"하위 구분의 상위 증상이 v2에 없음: {sorted(missing_parents)}")
    v2 = out
    std_path = os.path.join(OUT_DIR, "standard_symptoms_v2.csv")
    icpc_link.write(std_path, icpc_link.link_path_for(std_path), v2, write_csv)
    v2_ids = {r["symptom_id"] for r in v2}

    # ---------- 동의어 ----------
    name_of = {r["symptom_id"]: r["name_ko"] for r in v2}
    sex_by_id = {r["symptom_id"]: r["sex_restriction"] for r in v2}
    syn = []
    for code in t2_codes:
        for it in sorted(agreed_terms.get(code, []), key=lambda x: x["item_id"]):
            sid = term_child.get((code, it["item_id"]), code)  # 하위 구분이 있으면 키워드로 배정된 하위 id
            syn.append({"symptom_id": sid, "term": it["term_ko"], "term_norm": norm(it["term_ko"]),
                        "term_type": "span" if term_status[it["item_id"]] == "agreed_span"
                        else "대표" if it["term_ko"] == name_of[sid] else "동의어",
                        "sex_restriction": sex_by_id[sid],
                        "source": it["source"], "status": term_status[it["item_id"]]})
        for c in (subdivisions.get(code) or {}).get("children", []) if code in v2_ids else []:
            if not any(x["symptom_id"] == c["id"] and x["term"] == c["name_ko"] for x in syn):  # 이름이 표현에 없으면 대표로 추가
                syn.append({"symptom_id": c["id"], "term": c["name_ko"], "term_norm": norm(c["name_ko"]),
                            "term_type": "대표", "sex_restriction": sex_by_id[c["id"]],
                            "source": "subdivision", "status": "subdivision"})
    for e in sorted(exceptions, key=lambda e: e["id"]):
        syn.append({"symptom_id": e["id"], "term": e["name_ko"], "term_norm": norm(e["name_ko"]),
                    "term_type": "대표", "sex_restriction": sex_by_id[e["id"]], "source": "exception", "status": "exception"})
    write_csv(os.path.join(OUT_DIR, "symptom_synonym_v2.csv"),
              ["symptom_id", "term", "term_norm", "term_type", "sex_restriction", "source", "status"], syn)

    # ---------- v1 → v2 ----------
    ex_by_v1 = {e.get("v1_symptom_id"): e["id"] for e in exceptions}
    v1_codes, v1_detail = {}, {}
    for s in v1:
        members = [m.strip() for m in s["members"].split(";") if m.strip()] or [s["name_ko"].strip()]
        codes, ok, rest = [], [], []
        for m in members:
            row = t1_by_term.get(m)
            if row and row["status"].startswith("agreed"):
                ok.append(f"{m}→{row['final_code'].replace('; ', '+')}")
                codes += [c for c in row["final_code"].split("; ") if c not in codes]
            else:
                rest.append(f"{m}({row['status'] if row else 'T1에 없음'})")
        if not codes and s["symptom_id"] in ex_by_v1:
            codes = [ex_by_v1[s["symptom_id"]]]
        v1_codes[s["symptom_id"]], v1_detail[s["symptom_id"]] = sorted(codes), (ok, rest)
    target_count = Counter(c for codes in v1_codes.values() for c in codes)
    map_rows, unmapped_rows = [], []
    for s in v1:
        sid, codes = s["symptom_id"], v1_codes[s["symptom_id"]]
        ok, rest = v1_detail[sid]
        if not codes:
            kind = "unmapped"
            unmapped_rows.append({"v1_symptom_id": sid, "v1_name_ko": s["name_ko"], "v1_kcd_codes": s["kcd_codes"],
                                  "v1_triage_category": s["triage_category"], "members_not_agreed": "; ".join(rest),
                                  "all_members_none": "true" if all(x.endswith("(none)") for x in rest) else "false"})
        elif len(codes) > 1:
            kind = "split"
        elif target_count[codes[0]] > 1:
            kind = "merged"
        else:
            kind = "one_to_one"
        map_rows.append({"v1_symptom_id": sid, "v1_name_ko": s["name_ko"], "map_type": kind,
                         "v2_symptom_ids": "; ".join(codes), "members_agreed": "; ".join(ok),
                         "members_not_agreed": "; ".join(rest),
                         "note": "예외 증상" if codes and codes[0].startswith("EX") else ""})
    write_csv(os.path.join(OUT_DIR, "v1_to_v2_map.csv"),
              ["v1_symptom_id", "v1_name_ko", "map_type", "v2_symptom_ids", "members_agreed", "members_not_agreed", "note"],
              map_rows)

    # ---------- 사람이 볼 목록 ----------
    other = r2 if primary == r1 else r1
    write_csv(os.path.join(REPORTS, "v2_review_name_check.csv"),
              ["symptom_id", "icpc2_preferred", f"name_{primary}", f"name_{other}", "synonyms_top3"],
              [{"symptom_id": r["symptom_id"], "icpc2_preferred": r["icpc2_preferred"],
                f"name_{primary}": r["name_ko"], f"name_{other}": r["name_ko_alt"],
                "synonyms_top3": "; ".join(it["term_ko"] for it in sorted(agreed_terms.get(r["symptom_id"], []), key=freq_key)[:3])}
               for r in v2 if r["name_status"] == "check"])
    write_csv(os.path.join(REPORTS, "v2_review_subdivision_terms.csv"),
              ["parent_id", "term", "assigned_to", "keyword", "also_matched"], sub_assign)
    write_csv(os.path.join(REPORTS, "v2_review_one_rater.csv"), ["code", "preferred", "triage_category", "rater"], one_rater_rows)
    write_csv(os.path.join(REPORTS, "v2_review_v1_unmapped.csv"),
              ["v1_symptom_id", "v1_name_ko", "v1_kcd_codes", "v1_triage_category", "members_not_agreed", "all_members_none"],
              unmapped_rows)

    # ---------- 수치 ----------
    icpc_rows = [r for r in v2 if r["icpc2_code"] and not r["parent_id"]]
    stats = {
        "t1": {"total": len(t1_rows), **Counter(r["status"] for r in t1_rows)},
        "t2": {"codes": len(t2_codes), "links_both": n_link_both, "links_one_rater": n_link_one,
               "dropped_weak": len(dropped_weak), "dropped_weak_by": dict(Counter(f"{r}:{c}" for _, c, r in dropped_weak)),
               "codes_with_triage": sum(bool(t[0]) for t in triage.values())},
        "v2": {"total": len(v2), "icpc": len(icpc_rows), "exceptions": sum(r["source"] == "exception" for r in v2),
               "subdivision_children": sum(bool(r["parent_id"]) for r in v2),
               "subdivision_parents": sum(r["is_parent"] == "true" for r in v2),
               "by_chapter": dict(sorted(Counter(r["chapter"] for r in icpc_rows).items())),
               "by_source": dict(Counter(r["source"] for r in v2)),
               "name_status": dict(Counter(r["name_status"] for r in v2)),
               "hira_shared_true": sum(r["hira_shared_code"] == "true" for r in v2),
               "triage_status": dict(Counter(r["triage_status"] or "none" for r in v2))},
        "v1_map": dict(Counter(r["map_type"] for r in map_rows)),
        "synonyms": len(syn),
    }
    with open(os.path.join(V2_IN, "v2_build_stats.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(stats, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps(stats, ensure_ascii=False))
    assert v2_ids and len(v2_ids) == len(v2)


if __name__ == "__main__":
    main()
