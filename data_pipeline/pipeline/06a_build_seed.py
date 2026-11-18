"""6·7단계: Supabase ref 스키마 시드 CSV 만들기 → db/seed/<data_version>/*.csv

    python pipeline/06a_build_seed.py                       # 시드 만들기
    python pipeline/06a_build_seed.py --refresh-search-key  # config/dept_search_key.csv를 프론트 목록에서 다시 만든 뒤 시드 만들기

- 설정: config/seed.yaml(입력 경로·출처·app_config), config/recommend.yaml(규칙), config/triage_119.yaml,
        config/department_id.csv(진료과 이름 → dept_id), config/dept_search_key.csv(진료과 이름 → 프론트 key)
- 스키마: db/migrations/001_ref_schema.sql. 시드 CSV 컬럼 순서는 SQL과 같다. 진료과는 이름 대신 dept_id.
- 표준 진료과 목록 = labels/v4/inputs/label_options_dept.csv의 과 이름(DROP·AMBIGUOUS 제외).
  입력에 이 목록에 없는 과 이름이 나오면 멈춘다.
- 보완 A(search_key): ../frontend/departments.mjs의 departmentCatalog에서 name_ko가 keyword 또는 aliases와
  정확히 같으면 그 key. --refresh-search-key일 때만 프론트 파일을 읽고(읽기만), 결과는 config/dept_search_key.csv에 고정.
  symptom_department rec1~rec3와 fallback_department에 나오는 과에 search_key가 없으면 멈춘다.
- 보완 B(symptom_department_variant): 성별(female·male·unknown) × 나이대(child·adult·unknown)마다 추천을 미리 만든다.
    · dept_sex 과(산부인과)는 sex가 그 성별 또는 unknown일 때만 남긴다. 단 성별 제한 증상(sex_restriction)은 원래 결과 그대로.
    · dept_age 과(소아청소년과)는 age_band가 child 또는 unknown일 때만 남긴다.
    · 걸러서 줄면 원래 개수까지 clinic_ranking → hospital_ranking 순으로 보충한다(숨긴 과·이미 있는 과는 건너뜀).
      보충 기준은 step2a_department.recommend와 같다: 결과가 비었으면 의원급 1위는 비율 기준 없이,
      그 밖의 의원급은 clinic_second_min_share 이상, 병원급은 min_share_hospital_fill 이상(미달이면 멈춤).
      후보에도 빌드 때의 제외 과·응급의학과·sex_filter·dept_scope(치과 진료 범위)를 다시 적용한다.
    · dept_rule로 고정한 증상(male_genital·female_genital·dept_override)은 거르기만 하고 보충하지 않는다.
    · fallback 증상·상위 증상(parent)은 행을 만들지 않는다.
    검사: (unknown, unknown) 결과 = symptom_department rec1~rec3 (전 증상).
    검사: variant 행도 없고 fallback도 아닌 증상 = 추천 없는 상위 증상만 허용(함수가 is_fallback 행을 돌려줌). 그 밖은 멈춤.
- 검사: 30자 넘는 term(AI Hub 답변 문장 유입 의심) 목록, 시드 안 FK.
- 멱등: 입력 파일 순서·정렬 고정, 출력 utf-8-sig.
"""
import argparse
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
J = lambda *p: os.path.join(ROOT, *p)  # noqa: E731
csv.field_size_limit(10 ** 8)

sys.path.insert(0, J("pipeline"))
_spec = importlib.util.spec_from_file_location("step2a", J("pipeline", "step2a_department.py"))
s2a = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(s2a)

SEXES = ("female", "male", "unknown")
AGE_BANDS = ("child", "adult", "unknown")
FIXED_RULES = ("male_genital", "female_genital", "dept_override")
MAX_TERM = 30

# 시드 테이블과 컬럼 (001_ref_schema.sql과 같은 순서). 적재 순서도 이 순서(FK 순서)
TABLES = {
    "data_version": ["version", "created_at", "note"],
    "source": ["source_id", "name", "version", "url", "license", "note", "data_version"],
    "department": ["dept_id", "name_ko", "hira_code", "nmc_code", "is_guidable", "sex_only", "max_age",
                   "search_key", "data_version"],
    "triage_category": ["id", "name_ko", "grp", "page_start", "page_end", "data_version"],
    # icpc2_preferred(ICPC 영어 이름)·icd10_3(ICPC의 ICD-10 연결)은 넣지 않는다(004_drop_icpc_text.sql)
    "symptom": ["symptom_id", "parent_id", "is_parent", "icpc2_code", "chapter", "chapter_ko",
                "name_ko", "body_part_ui", "sex_restriction", "triage_category_ids", "is_injury",
                "fallback_group", "source_id", "data_version"],
    "symptom_synonym": ["id", "symptom_id", "term", "term_norm", "term_type", "span_group", "source_id",
                        "data_version"],
    "symptom_department": ["symptom_id", "path_used",
                           "rec1_dept_id", "rec1_level", "rec1_share",
                           "rec2_dept_id", "rec2_level", "rec2_share",
                           "rec3_dept_id", "rec3_level", "rec3_share",
                           "clinic_ranking", "hospital_ranking", "dept_rule", "fallback", "pediatric_top",
                           "er_share", "hira_indistinct", "top_a", "top_b", "agree", "data_version"],
    "symptom_department_variant": ["symptom_id", "sex", "age_band", "rank", "dept_id", "level", "share",
                                   "data_version"],
    "fallback_department": ["grp", "rank", "dept_id", "n_support", "data_version"],
    "app_config": ["key", "value", "note", "data_version"],
}


def load_yaml(path):
    with open(path, encoding="utf-8") as f:
        return YAML(typ="safe", pure=True).load(f) or {}


def read_csv(path):
    if not os.path.exists(path):
        sys.exit(f"입력 파일 없음: {os.path.relpath(path, ROOT)}")
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


def b(x):
    return "true" if x else "false"


def tf(s):
    """'true'/'false'/'' 문자열 → 'true'/'false'/''"""
    s = (s or "").strip().lower()
    return s if s in ("true", "false") else ""


def num(x):
    return "" if x in ("", None) else f"{float(x):.4f}".rstrip("0").rstrip(".")


def pg_array(items):
    items = list(items)
    for x in items:
        if not re.fullmatch(r"[A-Za-z0-9.\-]+", str(x)):
            sys.exit(f"배열 값에 쓸 수 없는 글자: {x!r}")
    return "{" + ",".join(str(x) for x in items) + "}" if items else ""


# ---------- 보완 A: search_key ----------
def refresh_search_key(frontend_path, dept_names, out_path):
    """프론트 departmentCatalog를 읽어(읽기만) name_ko → key 매핑을 config에 고정한다."""
    with open(frontend_path, encoding="utf-8") as f:
        text = f.read()
    m = re.search(r"departmentCatalog\s*=\s*(\[.*?\n\]);", text, re.S)
    if not m:
        sys.exit("departments.mjs에서 departmentCatalog 배열을 찾지 못함")
    catalog = json.loads(m.group(1))
    rows = []
    for name in sorted(dept_names):
        keys = [c["key"] for c in catalog if name == c["keyword"] or name in c.get("aliases", [])]
        if len(keys) > 1:
            sys.exit(f"search_key 후보가 둘 이상: {name} → {keys}")
        rows.append({"name_ko": name, "search_key": keys[0] if keys else ""})
    write_csv(out_path, ["name_ko", "search_key"], rows)
    used = {r["search_key"] for r in rows if r["search_key"]}
    return [c["key"] for c in catalog if c["key"] not in used]


def frontend_only_keys(frontend_path, mapped):
    if not os.path.exists(frontend_path):
        return None
    with open(frontend_path, encoding="utf-8") as f:
        m = re.search(r"departmentCatalog\s*=\s*(\[.*?\n\]);", f.read(), re.S)
    return [c["key"] for c in json.loads(m.group(1)) if c["key"] not in mapped] if m else None


# ---------- 보완 B: 성별·나이 경우별 추천 ----------
def variant_recs(base, sym, b_row, cfg, sex, age_band):
    """base = [(dept, level, share)] (symptom_department rec1~3, 이름). 경우별 결과를 같은 모양으로 돌려준다."""
    hidden = set()
    if sym["sex_restriction"] not in ("male", "female"):   # 성별 제한 증상은 원래 결과 그대로
        for dept, only in (cfg.get("dept_sex") or {}).items():
            if sex not in (only, "unknown"):
                hidden.add(dept)
    for dept in (cfg.get("dept_age") or {}):
        if age_band == "adult":
            hidden.add(dept)
    out = [r for r in base if r[0] not in hidden]
    if len(out) == len(base) or any(r in (b_row.get("dept_rule") or "") for r in FIXED_RULES):
        return out
    target = len(base)
    c_min, h_min = cfg["clinic_second_min_share"], cfg.get("min_share_hospital_fill", 0)
    block = hidden | s2a.dropped_depts(sym, cfg) | {r[0] for r in base}
    ok = lambda d: d not in block and d != s2a.ER_DEPT and not s2a.excluded(d)  # noqa: E731
    have = lambda: {r[0] for r in out}  # noqa: E731
    for c in json.loads(b_row["clinic_ranking"] or "[]"):
        if len(out) >= target:
            break
        if not ok(c["dept"]) or c["dept"] in have():
            continue
        if out and c["share"] < c_min:
            break
        out.append((c["dept"], "clinic", c["share"]))
    for h in json.loads(b_row["hospital_ranking"] or "[]"):
        if len(out) >= target or h["share"] < h_min:
            break
        if ok(h["dept"]) and h["dept"] not in have():
            out.append((h["dept"], "hospital", h["share"]))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh-search-key", action="store_true",
                    help="../frontend/departments.mjs에서 config/dept_search_key.csv를 다시 만든다")
    args = ap.parse_args()

    seed = load_yaml(J("config", "seed.yaml"))
    cfg = load_yaml(J("config", "recommend.yaml"))
    triage = load_yaml(J("config", "triage_119.yaml"))["categories"]
    inp = seed["inputs"]
    ver = seed["data_version"]
    out_dir = J(seed["seed_dir"])
    if not seed["seed_dir"].rstrip("/").endswith(ver):
        sys.exit("seed_dir 폴더 이름이 data_version과 다름")
    m = re.search(r"(\d{4})(\d{2})(\d{2})$", ver)
    created_at = f"{m.group(1)}-{m.group(2)}-{m.group(3)} 00:00:00+09"
    stop = []   # 멈춰야 하는 문제

    # ---------- 진료과 ----------
    dept_names = [r["dept"] for r in read_csv(J(inp["dept_options"])) if r["dept"] not in ("DROP", "AMBIGUOUS")]
    id_rows = read_csv(J(inp["dept_id"]))
    dept_id = {r["name_ko"]: r["dept_id"] for r in id_rows}
    if sorted(dept_id) != sorted(dept_names) or len(set(dept_id.values())) != len(dept_id):
        sys.exit(f"config/department_id.csv와 표준 진료과 목록이 다름: "
                 f"목록에만 {sorted(set(dept_names) - set(dept_id))}, id표에만 {sorted(set(dept_id) - set(dept_names))}")
    sk_path = J(inp["search_key"])
    fe_path = os.path.normpath(J(inp["frontend_departments"]))
    if args.refresh_search_key:
        refresh_search_key(fe_path, dept_names, sk_path)
    sk_rows = read_csv(sk_path)
    search_key = {r["name_ko"]: r["search_key"] for r in sk_rows if r["search_key"]}
    if set(r["name_ko"] for r in sk_rows) - set(dept_names):
        sys.exit(f"dept_search_key.csv에 표준 목록 밖 이름: {sorted(set(r['name_ko'] for r in sk_rows) - set(dept_names))}")
    unknown_names = set()

    def did(name, where):
        if not name:
            return ""
        if name not in dept_id:
            unknown_names.add((name, where))
            return ""
        return dept_id[name]

    dept_sex, dept_age = cfg.get("dept_sex") or {}, cfg.get("dept_age") or {}
    dep_rows = [{"dept_id": dept_id[n], "name_ko": n, "hira_code": "", "nmc_code": "",
                 "is_guidable": b(not s2a.excluded(n) and n != s2a.ER_DEPT),
                 "sex_only": dept_sex.get(n, ""), "max_age": (dept_age.get(n) or {}).get("max_age", ""),
                 "search_key": search_key.get(n, ""), "data_version": ver}
                for n in sorted(dept_names, key=lambda n: dept_id[n])]
    if (dept_age and any((v or {}).get("max_age") != seed_child_max(seed) for v in dept_age.values())):
        sys.exit("dept_age.max_age가 app_config child_max_age(나이대 child 기준)와 다름. variant 나이대를 다시 정할 것")

    # ---------- 출처·버전·119 ----------
    dv_rows = [{"version": ver, "created_at": created_at, "note": seed.get("data_version_note", "")}]
    src_rows = [{**{k: s.get(k, "") for k in TABLES["source"][:-1]}, "data_version": ver} for s in seed["sources"]]
    src_ids = {s["source_id"] for s in src_rows}
    tri_rows = [{"id": c["id"], "name_ko": c["name"], "grp": c["group"], "page_start": "", "page_end": "",
                 "data_version": ver} for c in triage]

    # ---------- 증상 ----------
    std = read_csv(J(inp["standard"]))
    final = {r["symptom_id"]: r for r in read_csv(J(inp["final"]))}
    pb = {r["symptom_id"]: r for r in read_csv(J(inp["path_b"]))}
    if not ({s["symptom_id"] for s in std} == set(final) == set(pb)):
        sys.exit("표준 증상·최종 추천·경로 B 결과의 증상 목록이 다름. step2a → 04b → step2c를 먼저 돌릴 것")
    ss = seed["symptom_source"]
    sym_rows = []
    for s in std:
        f = final[s["symptom_id"]]
        cats = [int(c) for c in re.split(r"[;,]", s["triage_category"]) if c.strip()]
        sym_rows.append({
            "symptom_id": s["symptom_id"], "parent_id": s["parent_id"], "is_parent": tf(s["is_parent"]) or "false",
            "icpc2_code": s["icpc2_code"], "chapter": s["chapter"],
            "chapter_ko": s["chapter_ko"], "name_ko": s["name_ko"], "body_part_ui": s["body_part_ui"],
            "sex_restriction": s["sex_restriction"] if s["sex_restriction"] in ("female", "male") else "",
            "triage_category_ids": pg_array(sorted(set(cats))),
            "is_injury": tf(f["is_injury"]), "fallback_group": f["fallback_group"],
            "source_id": ss.get(s["source"], ss["default"]), "data_version": ver})

    # ---------- 사전 ----------
    syn = read_csv(J(inp["synonym"]))
    # 11/18 일상 표현(config/synonym_everyday_v1.csv): 라벨링 사전에 없는 생활 표현("발목을 접질렀어요"의 "발목").
    # 시나리오 care_engine/eval/symptom_phrases_v*.json으로 찾은 것. 같은 (증상, 정규화 표현)이 이미 있으면 넣지 않는다.
    if inp.get("synonym_everyday"):
        std_ids = {r["symptom_id"] for r in std}
        have = {(r["symptom_id"], r["term_norm"]) for r in syn}
        bad = []
        for r in read_csv(J(inp["synonym_everyday"])):
            term = r["term"].strip()
            norm = "".join(ch for ch in unicodedata.normalize("NFKC", term).lower() if not ch.isspace())
            if r["symptom_id"] not in std_ids or not norm:
                bad.append((r["symptom_id"], term))
                continue
            if (r["symptom_id"], norm) in have:
                continue
            have.add((r["symptom_id"], norm))
            syn.append({"symptom_id": r["symptom_id"], "term": term, "term_norm": norm, "term_type": "동의어",
                        "sex_restriction": "", "source": "everyday", "status": "added"})
        if bad:
            sys.exit(f"synonym_everyday: 없는 증상 ID·빈 표현 {bad}")
    span_norms = sorted({r["term_norm"] for r in syn if r["term_type"] == "span"})
    span_group = {t: i for i, t in enumerate(span_norms, 1)}
    syn_rows, long_terms, syn_src_missing = [], [], set()
    for i, r in enumerate(syn, 1):
        if r["source"] not in seed["synonym_source"]:
            syn_src_missing.add(r["source"])
        if len(r["term"]) > MAX_TERM:
            long_terms.append((r["symptom_id"], r["term"], len(r["term"])))
        syn_rows.append({"id": i, "symptom_id": r["symptom_id"], "term": r["term"], "term_norm": r["term_norm"],
                         "term_type": r["term_type"], "span_group": span_group.get(r["term_norm"], "")
                         if r["term_type"] == "span" else "",
                         "source_id": seed["synonym_source"].get(r["source"], ""), "data_version": ver})
    if syn_src_missing:
        sys.exit(f"config/seed.yaml synonym_source에 없는 source: {sorted(syn_src_missing)}")
    single_span = [t for t in span_norms if sum(1 for r in syn if r["term_norm"] == t and r["term_type"] == "span") < 2]

    # ---------- 증상별 진료과 ----------
    rule_rec1 = {n: cfg[k]["rec1"] for n, k in (("male_genital", "male_genital_rule"),
                                                ("female_genital", "female_genital_rule")) if cfg.get(k)}
    sd_rows, base_recs = [], {}
    for s in std:
        sid, f, pr = s["symptom_id"], final[s["symptom_id"]], pb[s["symptom_id"]]
        clinic = json.loads(pr["clinic_ranking"] or "[]")
        hosp = json.loads(pr["hospital_ranking"] or "[]")
        c_names = {c["dept"] for c in clinic}
        rule_dept = next((d for n, d in rule_rec1.items() if n in f["dept_rule"]), None)
        recs = []
        for i in (1, 2, 3):
            d = f[f"rec{i}"]
            if not d:
                continue
            if f["path_used"] == "rule":
                lv = pr[f"rec{i}_level"] or "override"
            elif f["path_used"] == "B":       # 경로 B 그대로 → 2A의 level
                if pr[f"rec{i}_dept"] != d:
                    sys.exit(f"{sid}: path_used=B인데 rec{i}가 경로 B 결과와 다름")
                lv = pr[f"rec{i}_level"]
            elif i == 1 and rule_dept == d:
                lv = "rule"
            elif f["path_used"] == "A":
                lv = "path_a"
            else:                              # B+A, none: share를 가져온 순위
                lv = "clinic" if d in c_names else "hospital"
            recs.append((d, lv, f[f"rec{i}_share"]))
        base_recs[sid] = recs
        row = {"symptom_id": sid, "path_used": f["path_used"]}
        for i in range(3):
            d, lv, sh = recs[i] if i < len(recs) else ("", "", "")
            row.update({f"rec{i + 1}_dept_id": did(d, f"{sid} rec{i + 1}"), f"rec{i + 1}_level": lv,
                        f"rec{i + 1}_share": num(sh)})
        conv = lambda lst, w: json.dumps([{"dept_id": did(x["dept"], w), "share": x["share"],  # noqa: E731
                                           "patients": x["patients"]} for x in lst], ensure_ascii=False)
        row.update({"clinic_ranking": conv(clinic, f"{sid} clinic_ranking"),
                    "hospital_ranking": conv(hosp, f"{sid} hospital_ranking"),
                    "dept_rule": f["dept_rule"], "fallback": tf(f["fallback"]), "pediatric_top": tf(f["pediatric_top"]) or "false",
                    "er_share": num(f["er_share"]), "hira_indistinct": tf(pr["hira_indistinct"]),
                    "top_a": did(f["top_a"], f"{sid} top_a"), "top_b": did(f["top_b"], f"{sid} top_b"),
                    "agree": tf(f["agree"]), "data_version": ver})
        sd_rows.append(row)

    # ---------- fallback 진료과 ----------
    fb_rows = [{"grp": r["group"], "rank": r["rank"], "dept_id": did(r["dept"], f"fallback {r['group']}"),
                "n_support": r["n_symptoms"], "data_version": ver} for r in read_csv(J(inp["fallback"]))]

    # ---------- 보완 B: variant ----------
    sym_by = {s["symptom_id"]: s for s in std}
    var_rows, diff = [], defaultdict(list)
    uu_mismatch, empty_cases = [], []
    for s in std:
        sid, f = s["symptom_id"], final[s["symptom_id"]]
        if f["fallback"] == "true" or f["path_used"] == "parent":
            continue
        base = base_recs[sid]
        if not base:
            continue
        for sex in SEXES:
            for ab in AGE_BANDS:
                vr = variant_recs(base, sym_by[sid], {**pb[sid], "dept_rule": f["dept_rule"]}, cfg, sex, ab)
                if not vr:
                    empty_cases.append((sid, sex, ab))
                if (sex, ab) == ("unknown", "unknown") and vr != base:
                    uu_mismatch.append(sid)
                if [r[0] for r in vr] != [r[0] for r in base]:
                    diff[(sex, ab)].append((sid, base, vr))
                for k, (d, lv, sh) in enumerate(vr, 1):
                    var_rows.append({"symptom_id": sid, "sex": sex, "age_band": ab, "rank": k,
                                     "dept_id": did(d, f"{sid} variant"), "level": lv, "share": num(sh),
                                     "data_version": ver})

    # ---------- app_config ----------
    name_to_id = lambda v: (dept_id.get(v, v) if isinstance(v, str) else  # noqa: E731
                            {dept_id.get(k, k): name_to_id(x) for k, x in v.items()} if isinstance(v, dict) else
                            [name_to_id(x) for x in v] if isinstance(v, list) else v)

    def get_path(d, path):
        for p in path.split("."):
            d = d[p]
        return d
    cfg_rows = [{"key": c["key"], "value": json.dumps(name_to_id(get_path(cfg, c["from"]) if "from" in c else c["value"]),
                                                      ensure_ascii=False, sort_keys=True),
                 "note": c.get("note", ""), "data_version": ver} for c in seed["app_config"]]

    if unknown_names:
        stop.append("표준 진료과 목록에 없는 이름: " + ", ".join(f"{n}({w})" for n, w in sorted(unknown_names)))

    # ---------- 보완 A 검사: 추천·fallback 과에 search_key ----------
    used_dept = {r[f"rec{i}_dept_id"] for r in sd_rows for i in (1, 2, 3) if r[f"rec{i}_dept_id"]}
    used_dept |= {r["dept_id"] for r in fb_rows} | {r["dept_id"] for r in var_rows}
    sk_by_id = {r["dept_id"]: r["search_key"] for r in dep_rows}
    no_key = sorted(d for d in used_dept if not sk_by_id.get(d))
    if no_key:
        stop.append(f"search_key가 없는 추천·fallback 과: {no_key}")
    if uu_mismatch:
        stop.append(f"(unknown, unknown) 결과가 symptom_department와 다른 증상: {uu_mismatch}")
    # variant 행도 없고 fallback도 아닌 증상: 함수가 is_fallback 행을 돌려준다.
    # 추천이 없는 상위 증상(parent)만 허용하고, 그 밖이 나오면 멈춘다.
    var_ids = {r["symptom_id"] for r in var_rows}
    no_variant = [r["symptom_id"] for r in sd_rows if r["fallback"] != "true" and r["symptom_id"] not in var_ids]
    bad_no_variant = [s for s in no_variant
                      if not (final[s]["path_used"] == "parent" and not base_recs[s])]
    if bad_no_variant:
        stop.append(f"variant 행도 없고 fallback도 아닌 증상(상위 증상 아님): {bad_no_variant}")

    if stop:
        for s in stop:
            print("멈춤:", s)
        sys.exit(1)

    tables = {"data_version": dv_rows, "source": src_rows, "department": dep_rows, "triage_category": tri_rows,
              "symptom": sym_rows, "symptom_synonym": syn_rows, "symptom_department": sd_rows,
              "symptom_department_variant": var_rows, "fallback_department": fb_rows, "app_config": cfg_rows}
    for t, rows in tables.items():
        write_csv(os.path.join(out_dir, f"{t}.csv"), TABLES[t], rows)

    # ---------- 요약 ----------
    fo = frontend_only_keys(fe_path, set(search_key.values()))
    n_var_sym = len({r["symptom_id"] for r in var_rows})
    stats = {
        "data_version": ver,
        "rows": {t: len(r) for t, r in tables.items()},
        "long_terms": long_terms,
        "max_term_len": max(len(r["term"]) for r in syn),
        "search_key": {"mapped": {n: search_key[n] for n in sorted(search_key)},
                       "unmapped": sorted(set(dept_names) - set(search_key)),
                       "frontend_only": fo},
        "span_groups": len(span_group), "span_single_row": single_span,
        "variant": {
            "symptoms": n_var_sym,
            "uu_match": not uu_mismatch,
            "no_variant_not_fallback": no_variant,
            "empty_cases": empty_cases,
            "diff_count": {f"{sx},{ab}": len(diff[(sx, ab)]) for sx in SEXES for ab in AGE_BANDS},
            "diff_examples": {f"{sx},{ab}": [{"symptom_id": sid, "name_ko": sym_by[sid]["name_ko"],
                                              "base": [d for d, _, _ in bs], "variant": [d for d, _, _ in vr]}
                                             for sid, bs, vr in diff[(sx, ab)][:5]]
                              for sx in SEXES for ab in AGE_BANDS if diff[(sx, ab)]},
        },
    }
    stats_path = J(seed["stats"])
    os.makedirs(os.path.dirname(stats_path), exist_ok=True)
    with open(stats_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(stats, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps(stats, ensure_ascii=False, indent=1))


def seed_child_max(seed):
    return next((c["value"] for c in seed["app_config"] if c["key"] == "child_max_age"), 18)


if __name__ == "__main__":
    main()
