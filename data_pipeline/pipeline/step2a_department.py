"""2단계 A: 표준 증상별 진료과 추천 (의원급 우선) → config/recommend.yaml의 output_file (지금은 data/processed/v4/symptom_department_path_b.csv)

    python pipeline/step2a_department.py

- 입력: 표준 증상 v2 (경로·코드 컬럼·출력 경로는 config/recommend.yaml), 심평원 의원급·병원급 진료과별 상병 통계
- 기준값: config/recommend.yaml
- 증상 하나에 3자리 코드가 여러 개면 덜 공유된 코드만 골라(code_specificity) 코드별 환자수를 합친다. 쓴 코드는 codes_used.
  환자수·er_share·순위는 모두 codes_used 기준이다.
- hira_indistinct = (1) codes_used가 다른 증상과 완전히 같거나(same_codes) (2) 모두 여러 증상에 공유됨(all_shared).
  (2)이고 쓴 코드 중 여러 장(chapter)의 증상에 공유되는 코드가 있으면 경로 B 추천을 비우고
  dept_rule=await_path_a, path_b_used=false (순위는 참고용으로 남김). 코드별 값은 data/interim/v4/code_chapter_spread.csv.
- 상위 증상(is_parent=true)은 추천을 비우고 dept_rule=parent로 둔다. 추천은 하위 증상 행에 있다.
  이런 증상의 최종 순위는 AI Hub 경로 A를 우선하고, 이 결과(경로 B)는 교차검증 참고로만 쓴다.
- 증상별 규칙(config/recommend.yaml): sex_filter·dept_scope(순위에서 과를 빼고 다시 계산),
  min_share_hospital_fill(병원급 채움 최소 비율, 미달이면 rec2·rec3를 비움), dept_override(path_b_used=false),
  male_genital_rule·female_genital_rule(rec1 고정, rec1_level=rule), pediatric_top 기준. 적용 여부는 dept_rule 컬럼에 남긴다.
- 비율(share)은 0~1 소수. 분모 = 순위 제외 과(아래 상수)와 응급의학과를 뺀 환자수 합계.
- er_share = 병원급 응급의학과 환자수 / 병원급 전체 환자수 (참고용)
- 환자수는 진료과별 집계의 합이라 한 환자가 여러 과·여러 코드에 잡히면 중복된다.
"""
import csv
import json
import os
from collections import defaultdict

from ruamel.yaml import YAML

from common import RAW, ROOT
import icpc_link  # 표준 증상의 ICD-10 연결(icd10_3_list)은 data/interim 연결 파일에 있다

# ---------- 순위에서 빼는 과 (의원급·병원급 공통) ----------
EXCLUDE_EXACT = {
    "일반의", "보건기관의과", "표시과목 없음", "표시과목없음", "사상체질과", "침구과",
    "영상의학과", "병리과", "진단검사의학과", "핵의학과", "방사선종양학과", "예방의학과", "직업환경의학과",
    "의학유전학과",  # 2026-11-13 2A-2: 경로 A(AI Hub)에 나옴. 심평원 통계에는 없음
}
# 이름에 들어 있으면 뺀다 ("진단방사선과,영상의학과"처럼 여러 이름이 붙은 값 포함)
EXCLUDE_KEYWORDS = ["한방", "영상의학과", "진단방사선과"]
ER_DEPT = "응급의학과"
# 병원급 치과 세부과 → '치과'로 묶음
DENTAL_DEPTS = {"치과", "구강내과", "구강병리과", "구강악안면외과", "소아치과", "영상치의학과", "예방치과",
                "치과교정과", "치과보존과", "치과보철과", "치주과", "통합치의학과"}

CONFIG = os.path.join(ROOT, "config", "recommend.yaml")
META = os.path.join(ROOT, "data", "interim", "step2a_meta_v2.json")  # v1 기록(step2a_meta.json)은 덮어쓰지 않는다


def excluded(dept):
    return dept in EXCLUDE_EXACT or any(k in dept for k in EXCLUDE_KEYWORDS)


def to_int(s):
    s = (s or "").replace(",", "").replace(" ", "").strip()
    return int(float(s)) if s else 0


def find_raw(*keywords):
    for fn in sorted(os.listdir(RAW)):
        if fn.lower().endswith(".csv") and all(k in fn for k in keywords):
            return os.path.join(RAW, fn)
    raise FileNotFoundError(f"{RAW}에서 {keywords} 파일을 찾을 수 없음")


def read_csv(path):
    for enc in ("cp949", "utf-8-sig", "euc-kr"):
        try:
            with open(path, encoding=enc) as f:
                return enc, list(csv.DictReader(f))
        except UnicodeDecodeError:
            continue
    raise RuntimeError(f"인코딩을 알 수 없음: {path}")


def load_stats(path, dept_col, group_dental):
    """{코드: {진료과: 환자수}}"""
    enc, rows = read_csv(path)
    out = defaultdict(lambda: defaultdict(int))
    for r in rows:
        d = r[dept_col].strip()
        if group_dental and d in DENTAL_DEPTS:
            d = "치과"
        out[r["주상병코드"].strip().upper()[:3]][d] += to_int(r["환자수"])
    depts = sorted({r[dept_col].strip() for r in rows})
    return {"file": os.path.basename(path), "encoding": enc, "columns": list(rows[0].keys()),
            "rows": len(rows), "departments": depts}, out


def ranking(stats, codes, drop=()):
    """증상의 코드들을 합쳐 (전체 환자수, 응급의학과 환자수, [{dept, share, patients}])

    drop = 이 증상의 순위에서 빼는 과(sex_filter·dept_scope). 뺀 뒤 비율을 다시 계산한다.
    전체 환자수와 응급의학과 환자수는 빼기 전 값이다.
    """
    agg = defaultdict(int)
    for c in codes:
        for d, n in stats.get(c, {}).items():
            agg[d] += n
    total = sum(agg.values())
    er = agg.get(ER_DEPT, 0)
    ranked = sorted(((n, d) for d, n in agg.items()
                     if n > 0 and d != ER_DEPT and not excluded(d) and d not in drop),
                    key=lambda x: (-x[0], x[1]))
    denom = sum(n for n, _ in ranked)
    return total, er, [{"dept": d, "share": round(n / denom, 4), "patients": n} for n, d in ranked]


def dropped_depts(symptom, cfg):
    """sex_filter·dept_scope에 따라 이 증상의 추천·순위에서 빼는 과"""
    drop = set((cfg.get("sex_filter") or {}).get(symptom.get("sex_restriction", ""), []))
    for dept, scope in (cfg.get("dept_scope") or {}).items():
        if symptom.get("body_part_ui", "") not in scope["body_part_ui"]:
            drop.add(dept)
    return drop


def pick_codes(codes, share_count, clinic_stats, spec):
    """덜 공유된 코드부터 고른다. 의원급 환자 합이 기준 미만이면 다음 share_count 단계까지 넣는다."""
    if not spec.get("enabled"):
        return codes
    used = [c for c in codes if share_count[c] < spec["max_share_count"]]
    while True:
        rest = [c for c in codes if c not in used]
        if used and (not rest or sum(r["patients"] for r in ranking(clinic_stats, used)[2]) >= spec["min_clinic_patients"]):
            break
        tier = min(share_count[c] for c in rest)
        used += [c for c in rest if share_count[c] == tier]
    return [c for c in codes if c in used]


def recommend(clinic, hospital, cfg, fixed=None, fill_rest=True):
    """fixed = rec1로 고정하는 과(생식기 규칙). fill_rest면 나머지는 그 과를 뺀 순위에서 고르고, 아니면 비운다."""
    k = cfg["max_recommendations"]
    c_min, h_min = cfg["clinic_second_min_share"], cfg.get("min_share_hospital_fill", 0)
    recs = []
    if fixed:
        share = next((c["share"] for c in clinic if c["dept"] == fixed), "")
        recs.append(("rule", {"dept": fixed, "share": share}))
        if not fill_rest:
            return recs, False
        for c in [c for c in clinic if c["dept"] != fixed][:k - 1]:
            if c["share"] < c_min:
                break
            recs.append(("clinic", c))
    elif clinic:
        recs.append(("clinic", clinic[0]))
        if len(clinic) > 1 and clinic[1]["share"] >= c_min:
            recs.append(("clinic", clinic[1]))
    for h in hospital:  # 병원급 1순위부터, 이미 있는 과는 건너뛰며 채운다. 최소 비율 미달이면 멈춘다(비워 둠)
        if len(recs) >= k or h["share"] < h_min:
            break
        if h["dept"] not in {r[1]["dept"] for r in recs}:
            recs.append(("hospital", h))
    if recs:
        return recs[:k], False
    return [("fallback", {"dept": d, "share": ""}) for d in cfg["fallback_departments"][:k]], True


def main():
    yaml = YAML(typ="safe", pure=True)
    with open(CONFIG, encoding="utf-8") as f:
        cfg = yaml.load(f)
    clinic_meta, clinic_stats = load_stats(find_raw("의원급", "표시과목"), "표시과목", group_dental=False)
    hosp_meta, hosp_stats = load_stats(find_raw("병원급", "진료과목"), "진료과목", group_dental=True)

    symptoms_path = os.path.join(ROOT, *cfg["symptoms_file"].split("/"))
    out_path = os.path.join(ROOT, *cfg["output_file"].split("/"))
    code_col, code_sep = cfg["symptom_code_column"], cfg["symptom_code_separator"].strip()
    symptoms = icpc_link.load_full(symptoms_path, lambda p: list(csv.DictReader(open(p, encoding="utf-8-sig"))))
    # ICD-10 연결에서 나온 칸(codes_used, 증상 코드 칸)은 커밋되는 결과 파일이 아니라 data/interim에 따로 쓴다
    codes_path = os.path.join(ROOT, "data", "interim", "v4", "symptom_department_path_b_codes.csv")
    codes_cols = ["symptom_id", "codes_used", code_col]

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    cols = ["symptom_id", "name_ko"]
    for i in (1, 2, 3):
        cols += [f"rec{i}_dept", f"rec{i}_level", f"rec{i}_share"]
    cols += ["clinic_ranking", "hospital_ranking", "er_share", "clinic_patients", "hospital_patients",
             "pediatric_top", "requires_triage", "fallback", "hira_indistinct", "hira_indistinct_reason",
             "path_b_used", "dept_rule",
             "parent_id", "is_parent"]
    overrides = cfg.get("dept_override") or {}
    fixed_rules = [(name, cfg[key]) for name, key in (("male_genital", "male_genital_rule"),
                                                      ("female_genital", "female_genital_rule")) if cfg.get(key)]
    ped = cfg.get("pediatric_top") or {"dept": "소아청소년과", "top_n": 1, "min_share": 0}
    spec = cfg.get("code_specificity") or {}
    split = lambda s: list(dict.fromkeys(c.strip().upper() for c in s[code_col].split(code_sep) if c.strip()))
    is_parent = lambda s: (s.get("is_parent") or "").strip().lower() == "true"
    share_count = defaultdict(int)  # 3자리 코드 → 그 코드를 가진 v2 증상 수 (상위 증상 제외)
    code_users = defaultdict(list)  # 3자리 코드 → [(증상 id, 장)]
    for s in symptoms:
        if not is_parent(s):
            for c in split(s):
                share_count[c] += 1
                code_users[c].append((s["symptom_id"], s.get("chapter") or "EX"))
    spread = {c: len({ch for _, ch in u}) for c, u in code_users.items()}  # chapter_spread
    used_by = {s["symptom_id"]: pick_codes(split(s), share_count, clinic_stats, spec)
               for s in symptoms if not is_parent(s)}
    same_set = defaultdict(int)  # codes_used 집합 → 그 집합을 쓰는 증상 수
    for codes in used_by.values():
        same_set[frozenset(codes)] += 1
    out_rows, missing_codes = [], defaultdict(list)
    for s in symptoms:
        all_codes = split(s)
        if is_parent(s):  # 추천은 하위 증상 기준
            row = {"symptom_id": s["symptom_id"], "name_ko": s["name_ko"]}
            for i in (1, 2, 3):
                row.update({f"rec{i}_dept": "", f"rec{i}_level": "", f"rec{i}_share": ""})
            row.update({"clinic_ranking": "[]", "hospital_ranking": "[]", "er_share": "",
                        "clinic_patients": "", "hospital_patients": "", "pediatric_top": "false",
                        "requires_triage": str(bool(s["triage_category"].strip())).lower(), "fallback": "false",
                        "hira_indistinct": "", "hira_indistinct_reason": "", "path_b_used": "false", "dept_rule": "parent",
                        "parent_id": "", "is_parent": "true", "codes_used": "",
                        code_col: cfg["symptom_code_separator"].join(all_codes)})
            out_rows.append(row)
            continue
        codes = used_by[s["symptom_id"]]
        for c in codes:
            if c not in clinic_stats:
                missing_codes["clinic"].append(c)
            if c not in hosp_stats:
                missing_codes["hospital"].append(c)
        drop = dropped_depts(s, cfg)
        c_total, _, c_rank = ranking(clinic_stats, codes, drop)
        h_total, h_er, h_rank = ranking(hosp_stats, codes, drop)
        sid, dept_rule = s["symptom_id"], ""
        reasons = []
        if spec.get("enabled"):
            if same_set[frozenset(codes)] > 1:
                reasons.append("same_codes")
            if all(share_count[c] >= spec["max_share_count"] for c in codes):
                reasons.append("all_shared")
        elif (s.get("hira_shared_code") or "").strip().lower() == "true":
            reasons.append("shared_code")
        await_a = "all_shared" in reasons and any(spread[c] >= spec.get("await_min_chapter_spread", 1) for c in codes)
        rule = next(((n, r) for n, r in fixed_rules if s.get("chapter") in r["chapters"]
                     and sid not in (r.get("exclude_symptoms") or [])), None)
        if sid in overrides:  # 경로 B를 쓰지 않고 직접 지정
            recs, fb, dept_rule = [("override", {"dept": overrides[sid]["dept"], "share": ""})], False, "dept_override"
        elif rule:
            recs, fb = recommend(c_rank, h_rank, cfg, fixed=rule[1]["rec1"],
                                 fill_rest=rule[1].get("fill_rest", True) and not await_a)
            dept_rule = rule[0]
        elif await_a:
            recs, fb = [], False
        else:
            recs, fb = recommend(c_rank, h_rank, cfg)
        if await_a:
            dept_rule = ";".join(filter(None, [dept_rule, "await_path_a"]))
        row = {"symptom_id": s["symptom_id"], "name_ko": s["name_ko"]}
        for i in range(3):
            lv, r = recs[i] if i < len(recs) else ("", {"dept": "", "share": ""})
            row.update({f"rec{i+1}_dept": r["dept"], f"rec{i+1}_level": lv, f"rec{i+1}_share": r["share"]})
        row.update({
            "clinic_ranking": json.dumps([{k: v for k, v in r.items()} for r in c_rank], ensure_ascii=False),
            "hospital_ranking": json.dumps(h_rank, ensure_ascii=False),
            "er_share": round(h_er / h_total, 4) if h_total else "",
            "clinic_patients": c_total, "hospital_patients": h_total,
            "pediatric_top": str(sid not in overrides and not await_a and any(
                r["dept"] == ped["dept"] and r["share"] >= ped["min_share"] for r in c_rank[:ped["top_n"]])).lower(),
            "requires_triage": str(bool(s["triage_category"].strip())).lower(),
            "fallback": str(fb).lower(),
            "hira_indistinct": str(bool(reasons)).lower(), "hira_indistinct_reason": ";".join(reasons),
            "path_b_used": str(sid not in overrides and not await_a).lower(), "dept_rule": dept_rule,
            "parent_id": s.get("parent_id", ""), "is_parent": "false",
            "codes_used": cfg["symptom_code_separator"].join(codes),
            code_col: cfg["symptom_code_separator"].join(all_codes),
        })
        out_rows.append(row)

    with open(out_path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(out_rows)
    os.makedirs(os.path.dirname(codes_path), exist_ok=True)
    with open(codes_path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=codes_cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(out_rows)

    # 코드별 공유 수·장 수(ICD-10 연결표를 거꾸로 펼친 것) → data/interim (커밋하지 않음)
    spread_path = os.path.join(ROOT, "data", "interim", "v4", "code_chapter_spread.csv")
    with open(spread_path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["icd10_3", "share_count", "chapter_spread", "chapters", "symptom_ids"])
        for c in sorted(code_users):
            w.writerow([c, share_count[c], spread[c], "; ".join(sorted({ch for _, ch in code_users[c]})),
                        "; ".join(sid for sid, _ in code_users[c])])

    meta = {"clinic": clinic_meta, "hospital": hosp_meta, "config": cfg,
            "clinic_excluded": [d for d in clinic_meta["departments"] if excluded(d)],
            "hospital_excluded": [d for d in hosp_meta["departments"] if excluded(d)] + [ER_DEPT + "(er_share로만 기록)"],
            "hospital_dental_grouped": [d for d in hosp_meta["departments"] if d in DENTAL_DEPTS],
            "codes_missing": {k: sorted(set(v)) for k, v in missing_codes.items()},
            "share_count": dict(sorted(share_count.items())),
            "chapter_spread": dict(sorted(spread.items()))}
    with open(META, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    print(f"저장: {out_path} ({len(out_rows)}개, hira_indistinct {sum(r['hira_indistinct'] == 'true' for r in out_rows)}개)")
    print(json.dumps({k: v for k, v in meta.items() if k not in ("clinic", "hospital")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
