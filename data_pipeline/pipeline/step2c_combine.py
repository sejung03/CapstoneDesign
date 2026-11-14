"""2A-2: 경로 A(AI Hub) + 경로 B(심평원) → 최종 진료과 추천

    python pipeline/step2c_combine.py
    (step2a_department.py(v2.1, 경로 B) → 04b_path_a.py(경로 A) 뒤에 돌린다)

- 규칙: config/recommend.yaml의 combine·fallback 절, 그리고 2A 규칙(제외 진료과·치과 범위·성별·생식기·직접 지정)
    "경로 B가 후보를 정하고, 경로 A는 순서만 정한다"
    path_used
      rule : dept_override(직접 지정) → 2A 결과 그대로
      B    : path_b_used=true 이고 (hira_indistinct=false 또는 path_a_ok=false이면서 await_path_a 아님) → 2A 결과 그대로
      B+A  : (hira_indistinct=true 또는 await_path_a) 이고 path_a_ok 이고 경로 B 순위가 있음
             후보 = B 의원급 share ≥ 0.05 ∪ 병원급 share ≥ 0.10 (B 순위 JSON은 이미 제외 과·성별·치과 범위를 뺀 것)
             경로 A 점수 순으로 정렬, A 점수 0인 후보는 B 순서(의원급 순위 → 병원급에만 있는 과)대로 뒤에
             rec1 = 맨 앞(단 B 의원급 share < rec1_change_min_clinic_share이면 경로 B 1위 유지), rec2·rec3 = B share 최소 비율(의원급 ≥ clinic_second_min_share 또는 병원급 ≥ min_share_hospital_fill)을
             넘는 후보 (못 넘으면 건너뜀). rec_share = B 의원급 share(없으면 병원급 share)
      A    : 경로 B 순위가 없고 path_a_ok → 경로 A 단독(후처리 뒤 점수), rec2·rec3는 path_a_min_share 이상
      none : 그 밖 → 추천 비움, fallback=true
      parent: 하위로 나뉜 상위 증상(D20) → 추천 없음
    생식기 고정 규칙의 rec1은 어느 경로든 유지(fill_rest=false면 rec2·rec3 비움)
- 경로 A 후처리: 2A 제외 진료과, 응급의학과, sex_filter, dept_scope(치과) 과를 빼고 비율을 다시 맞춘다
- 교차검증: top_a(후처리 뒤 A 1위), top_b(B 의원급 1위, 없으면 병원급 1위), agree(둘 다 있을 때)
- is_injury: 119 손상 범주 또는 ICPC S12~S19 (config/recommend.yaml의 fallback 절). 모든 증상에 계산
- 소아 fallback 그룹: config/pediatric_fallback.yaml의 증상 id (ICPC 영어 이름의 infant/child 판정 결과를 2026-11-14 고정)
- 출력: data/processed/v4/symptom_department_final.csv, fallback_departments.csv, reports/2A2_build.md
- 멱등: 증상은 standard 파일 순서, 정렬 고정, utf-8-sig.
"""
import csv
import importlib.util
import json
import os
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: os.path.join(ROOT, *p)  # noqa: E731
sys.path.insert(0, J("pipeline"))
_spec = importlib.util.spec_from_file_location("step2a", J("pipeline", "step2a_department.py"))
s2a = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(s2a)
from ruamel.yaml import YAML  # noqa: E402


def load_yaml(path):
    with open(path, encoding="utf-8") as f:
        return YAML(typ="safe", pure=True).load(f) or {}


def read_csv(path):
    if not os.path.exists(path):
        sys.exit(f"입력 파일 없음: {path}")
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def write_csv(path, cols, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    print(f"저장: {os.path.relpath(path, ROOT)} ({len(rows)}행)")


def fmt(x):
    return "" if x in ("", None) else f"{float(x):.4f}"


def main():
    cfg = load_yaml(J("config", "recommend.yaml"))
    cc, fb_cfg = cfg["combine"], cfg["fallback"]
    k = cfg["max_recommendations"]
    c_min, h_min = cfg["clinic_second_min_share"], cfg.get("min_share_hospital_fill", 0)
    ped = cfg.get("pediatric_top") or {}
    triage = load_yaml(J("config", "triage_119.yaml"))["categories"]
    injury_ids = {c["id"] for c in triage if c["group"] == "손상"}
    if not set(fb_cfg["injury_triage_categories"]) <= injury_ids:
        sys.exit(f"fallback.injury_triage_categories에 손상 그룹({sorted(injury_ids)}) 밖 범주가 있음")
    injury_ids = set(fb_cfg["injury_triage_categories"])

    std = read_csv(J(cfg["symptoms_file"]))
    ped_fb_ids = set(load_yaml(J("config", "pediatric_fallback.yaml"))["symptom_ids"] or [])
    if ped_fb_ids - {s["symptom_id"] for s in std}:
        sys.exit(f"config/pediatric_fallback.yaml에 표준 증상에 없는 id: {sorted(ped_fb_ids - {s['symptom_id'] for s in std})}")
    pb = {r["symptom_id"]: r for r in read_csv(J(cc["path_b_file"]))}
    pa_raw, pa_ok, pa_n = {}, {}, {}
    for r in read_csv(J(cc["path_a_file"])):
        pa_raw.setdefault(r["symptom_id"], []).append((r["dept"], float(r["score"])))
        pa_ok[r["symptom_id"]] = r["path_a_ok"] == "true"
        pa_n[r["symptom_id"]] = int(r["n_diseases_linked"])
    if set(pb) != {s["symptom_id"] for s in std}:
        sys.exit("경로 B 결과와 표준 증상 목록이 다름. step2a_department.py를 먼저 돌릴 것")
    fixed_rules = [(n, cfg[key]) for n, key in (("male_genital", "male_genital_rule"),
                                                 ("female_genital", "female_genital_rule")) if cfg.get(key)]

    def a_post(s):
        """경로 A 후처리: 제외 과·응급의학과·성별·치과 범위를 빼고 비율을 다시 맞춘다."""
        drop = s2a.dropped_depts(s, cfg)
        keep = [(d, sc) for d, sc in pa_raw.get(s["symptom_id"], [])
                if sc > 0 and not s2a.excluded(d) and d != s2a.ER_DEPT and d not in drop]
        tot = sum(sc for _, sc in keep)
        return [(d, sc / tot) for d, sc in keep] if tot else []

    def is_injury(s):
        cats = {int(c) for c in s["triage_category"].replace(",", ";").split(";") if c.strip()}
        return bool(cats & injury_ids) or s["icpc2_code"] in fb_cfg["injury_icpc_codes"]

    rows, detail = [], {}
    for s in std:
        sid, b = s["symptom_id"], pb[s["symptom_id"]]
        clinic = json.loads(b["clinic_ranking"] or "[]")
        hosp = json.loads(b["hospital_ranking"] or "[]")
        has_b = bool(clinic or hosp)
        a_list = a_post(s)
        a_ok = pa_ok.get(sid, False) and bool(a_list)
        indistinct = b["hira_indistinct"] == "true"
        await_a = "await_path_a" in b["dept_rule"]
        rule = next(((n, r) for n, r in fixed_rules if s.get("chapter") in r["chapters"]
                     and sid not in (r.get("exclude_symptoms") or [])), None)
        c_share = {c["dept"]: c["share"] for c in clinic}
        h_share = {h["dept"]: h["share"] for h in hosp}
        b_share = lambda d: c_share.get(d, h_share.get(d, ""))  # noqa: E731
        recs, fallback, b_only_rec1 = [], False, ""
        if has_b:  # B 단독일 때의 rec1 (await 규칙 없이 2A recommend로 계산) — 보고용
            r0, _ = s2a.recommend(clinic, hosp, cfg, fixed=rule[1]["rec1"] if rule else None,
                                  fill_rest=rule[1].get("fill_rest", True) if rule else True)
            b_only_rec1 = r0[0][1]["dept"] if r0 else ""

        if b["is_parent"] == "true":
            path = "parent"
        elif "dept_override" in b["dept_rule"]:
            path = "rule"
            recs = [(b[f"rec{i}_dept"], b[f"rec{i}_share"]) for i in (1, 2, 3) if b[f"rec{i}_dept"]]
        elif b["path_b_used"] == "true" and (not indistinct or (not a_ok and not await_a)):
            path = "B"   # 결정 1: hira_indistinct=true여도 path_a_ok=false이고 await가 아니면 B 그대로
            recs = [(b[f"rec{i}_dept"], b[f"rec{i}_share"]) for i in (1, 2, 3) if b[f"rec{i}_dept"]]
        elif (indistinct or await_a) and a_ok and has_b:
            path = "B+A"
            order = [c["dept"] for c in clinic if c["share"] >= cc["candidate_min_clinic_share"]]
            order += [h["dept"] for h in hosp if h["share"] >= cc["candidate_min_hospital_share"] and h["dept"] not in order]
            a_score = dict(a_list)
            b_pos = {d: i for i, d in enumerate(order)}
            order.sort(key=lambda d: (0 if a_score.get(d, 0) > 0 else 1, -a_score.get(d, 0), b_pos[d]))
            qualifies = lambda d: c_share.get(d, 0) >= c_min or h_share.get(d, 0) >= h_min  # noqa: E731
            b_top = clinic[0]["dept"] if clinic else hosp[0]["dept"]
            if rule:
                recs = [(rule[1]["rec1"], c_share.get(rule[1]["rec1"], ""))]
                rest = [d for d in order if d != rule[1]["rec1"]] if rule[1].get("fill_rest", True) else []
            elif order and c_share.get(order[0], 0) >= cc["rec1_change_min_clinic_share"]:
                recs = [(order[0], b_share(order[0]))]
                rest = order[1:]
            else:   # 결정 3: A 1위가 B 의원급 share 기준 미달 → rec1은 B 1위, A 순서는 rec2·rec3에만
                recs = [(b_top, b_share(b_top))]
                rest = [d for d in order if d != b_top]
                detail.setdefault(sid, {})["kept_b_top"] = order[0] if order else ""
            for d in rest:
                if len(recs) >= k:
                    break
                if qualifies(d):
                    recs.append((d, b_share(d)))
            detail.setdefault(sid, {}).update({"candidates": order, "a_score": a_score})
        elif not has_b and a_ok:
            path = "A"
            if rule:
                recs = [(rule[1]["rec1"], dict(a_list).get(rule[1]["rec1"], ""))]
                rest = [x for x in a_list if x[0] != rule[1]["rec1"]] if rule[1].get("fill_rest", True) else []
            else:
                recs, rest = a_list[:1], a_list[1:]
            for d, sc in rest:
                if len(recs) >= k or sc < cc["path_a_min_share"]:
                    break
                recs.append((d, sc))
        else:
            path = "none"
            if rule:   # 생식기 규칙의 rec1은 경로와 관계없이 유지
                recs = [(rule[1]["rec1"], c_share.get(rule[1]["rec1"], ""))]
            else:
                fallback = True

        top_a = a_list[0][0] if a_list else ""
        top_b = clinic[0]["dept"] if clinic else hosp[0]["dept"] if hosp else ""
        if path == "B":
            pt = b["pediatric_top"]
        elif path == "B+A":
            pt = str(any(c["dept"] == ped["dept"] and c["share"] >= ped["min_share"] for c in clinic[:ped["top_n"]])).lower()
        elif path == "A":
            pt = str(any(d == ped["dept"] and sc >= ped["min_share"] for d, sc in a_list[:ped["top_n"]])).lower()
        elif path == "rule":
            pt = b["pediatric_top"]
        else:
            pt = "false"
        row = {"symptom_id": sid, "name_ko": s["name_ko"], "path_used": path}
        for i in range(3):
            d, sh = recs[i] if i < len(recs) else ("", "")
            row[f"rec{i + 1}"] = d
            row[f"rec{i + 1}_share"] = fmt(sh)
        inj = is_injury(s)
        if not fallback:
            group = ""
        elif inj:
            group = "injury"
        elif sid in ped_fb_ids:   # config/pediatric_fallback.yaml (ICPC 이름 기준 판정, 2026-11-14 고정)
            group = "pediatric"
        else:
            group = "general"
        row.update({"top_a": top_a, "top_b": top_b, "agree": str(top_a == top_b).lower() if top_a and top_b else "",
                    "dept_rule": b["dept_rule"], "fallback": str(fallback).lower(), "fallback_group": group,
                    "pediatric_top": pt, "er_share": b["er_share"], "is_injury": str(inj).lower()})
        rows.append(row)
        detail.setdefault(sid, {}).update({"b_only_rec1": b_only_rec1, "b_rec": [b[f"rec{i}_dept"] for i in (1, 2, 3)],
                                           "a_ok": pa_ok.get(sid, False), "n_dis": pa_n.get(sid, 0),
                                           "indistinct": indistinct, "await": await_a, "has_b": has_b})
    cols = ["symptom_id", "name_ko", "path_used", "rec1", "rec1_share", "rec2", "rec2_share", "rec3", "rec3_share",
            "top_a", "top_b", "agree", "dept_rule", "fallback", "fallback_group", "pediatric_top", "er_share", "is_injury"]
    write_csv(J(cc["output"]), cols, rows)

    # ---------- fallback_departments ----------
    never = set(fb_cfg["never"])
    inj = Counter(r["rec1"] for r in rows if r["is_injury"] == "true" and r["path_used"] in ("A", "B", "B+A")
                  and r["rec1"] and r["rec1"] not in never)
    inj_kept = [(d, n) for d, n in sorted(inj.items(), key=lambda x: (-x[1], x[0])) if n >= fb_cfg["injury_min_support"]]
    fb_rows = [{"group": "injury", "rank": i, "dept": d, "n_symptoms": n}
               for i, (d, n) in enumerate(inj_kept[:fb_cfg["injury_top_n"]], 1)]
    for g in ("pediatric", "general"):
        fb_rows += [{"group": g, "rank": i, "dept": d, "n_symptoms": ""}
                    for i, d in enumerate(fb_cfg[f"{g}_departments"], 1)]
    write_csv(J(cc["fallback_output"]), ["group", "rank", "dept", "n_symptoms"], fb_rows)

    write_report(cfg, cc, std, rows, detail, pb, fb_rows, inj)


def write_report(cfg, cc, std, rows, detail, pb, fb_rows, inj):
    by = {r["symptom_id"]: r for r in rows}
    old = {r["symptom_id"]: r for r in read_csv(J(cc["path_b_2a1_file"]))}
    path_cnt = Counter(r["path_used"] for r in rows)

    def recs(r):
        out = []
        for i in (1, 2, 3):
            if r[f"rec{i}"]:
                out.append(r[f"rec{i}"] + (f" ({float(r[f'rec{i}_share']):.1%})" if r[f"rec{i}_share"] else ""))
            else:
                out.append("—")
        return " / ".join(out)

    def old_recs(sid):
        o = old.get(sid)
        if not o:
            return "(v2.1 새 증상)"
        return " / ".join(o[f"rec{i}_dept"] or "—" for i in (1, 2, 3))

    L = []
    w = L.append
    w("# 2A-2 결과: 경로 A + 경로 B → 최종 진료과 추천")
    w("")
    w("- 작성일: 2026-11-13")
    w("- 스크립트: `pipeline/step2a_department.py`(경로 B, v2.1) → `pipeline/04b_path_a.py`(경로 A) → `pipeline/step2c_combine.py`")
    w("- 규칙: `config/recommend.yaml`의 combine·fallback 절. 결정: \"경로 B가 후보를 정하고, 경로 A는 순서만 정한다\"")
    w(f"- 출력: `{cc['output']}`, `{cc['fallback_output']}`")
    w("- 2026-11-13 결정 반영: (1) hira_indistinct=true여도 path_a_ok=false이고 await_path_a가 아니면 경로 B 그대로, "
      "(2) is_injury에서 119 범주 21·24·25·27 제외, (3) B+A에서 경로 A 1위가 경로 B 의원급 share 20% 미만이면 "
      "rec1은 경로 B 1위 유지")
    w("- 표의 비율: B·B+A는 경로 B share(의원급, 없으면 병원급), A는 후처리 뒤 경로 A 점수")
    w("")
    w("## 1. path_used별 증상 수")
    w("")
    w("| path_used | 증상 수 | 뜻 |")
    w("|---|---|---|")
    mean = {"B": "경로 B 그대로", "B+A": "B 후보를 A 순서로", "A": "경로 A 단독", "none": "추천 없음(fallback)",
            "rule": "직접 지정(dept_override)", "parent": "하위로 나뉜 상위 증상(추천 없음)"}
    for p in ("B", "B+A", "A", "none", "rule", "parent"):
        w(f"| {p} | {path_cnt.get(p, 0)} | {mean[p]} |")
    w(f"| 합계 | {len(rows)} | |")
    w("")
    b_dec1 = [r for r in rows if r["path_used"] == "B" and detail[r["symptom_id"]]["indistinct"]]
    w(f"B {path_cnt.get('B', 0)}개 중 {len(b_dec1)}개는 결정 1(hira_indistinct=true이지만 path_a_ok=false이고 await가 아님)로 B를 쓴 증상: "
      + ", ".join(r["symptom_id"] for r in b_dec1))
    w("")
    w("### 2A-1에서 추천이 있었는데 지금 없는 증상")
    w("")
    lost = [sid for sid, o in old.items() if o["rec1_dept"] and o["is_parent"] != "true" and not by[sid]["rec1"]]
    w(f"{len(lost)}개" + (": " + ", ".join(lost) if lost else "."))
    w("")
    w("## 2. B+A로 rec1이 B 단독 때와 달라진 증상")
    w("")
    w("B 단독 = 경로 B 순위에 2A 추천 규칙(의원급 우선, 생식기 규칙)을 그대로 적용했을 때의 rec1 (await_path_a로 비우기 전).")
    w("")
    w("| 증상 | B 단독 rec1 | B+A rec1 | B+A rec1~3 | 연결 질환 수 |")
    w("|---|---|---|---|---|")
    ba = [r for r in rows if r["path_used"] == "B+A"]
    changed = [r for r in ba if r["rec1"] != detail[r["symptom_id"]]["b_only_rec1"]]
    for r in changed:
        d = detail[r["symptom_id"]]
        w(f"| {r['symptom_id']} {r['name_ko']} | {d['b_only_rec1'] or '—'} | {r['rec1']} | {recs(r)} | {d['n_dis']} |")
    w("")
    w(f"B+A {len(ba)}개 중 rec1이 바뀐 증상 {len(changed)}개.")
    w("")
    kept = [r for r in ba if "kept_b_top" in detail[r["symptom_id"]]]
    w(f"결정 3으로 rec1을 경로 B 1위로 유지한 증상 {len(kept)}개 "
      f"(경로 A 순서 1위의 경로 B 의원급 share < {cfg['combine']['rec1_change_min_clinic_share']:.0%}):")
    w("")
    w("| 증상 | 경로 A 순서 1위 (B 의원급/병원급 share) | 유지한 rec1 | 최종 rec1~3 |")
    w("|---|---|---|---|")
    for r in kept:
        sid = r["symptom_id"]
        a1 = detail[sid]["kept_b_top"]
        cr = {c["dept"]: c["share"] for c in json.loads(pb[sid]["clinic_ranking"] or "[]")}
        hr = {h["dept"]: h["share"] for h in json.loads(pb[sid]["hospital_ranking"] or "[]")}
        w(f"| {sid} {r['name_ko']} | {a1} ({cr.get(a1, 0):.1%} / {hr.get(a1, 0):.1%}) | {r['rec1']} | {recs(r)} |")
    w("")
    w("## 3. 확인용 증상의 최종 추천")
    w("")
    groups = [
        ("상식 점검 20개", ["A03", "R05", "D01", "D02", "D11", "N01", "N17", "L03", "S02", "S06", "R21", "F02",
                           "H01", "U01", "K04", "K07", "P06", "P03", "X02", "T01"]),
        ("D20 하위 4개", ["D20-01", "D20-02", "D20-03", "D20-04"]),
        ("2A-1에서 비었던 21개 (await_path_a)", sorted(s for s, o in old.items() if not o["rec1_dept"] and o["is_parent"] != "true")),
    ]
    for title, ids in groups:
        w(f"### {title}")
        w("")
        w("| 증상 | path_used | 최종 rec1 / rec2 / rec3 | 2A-1 rec1 / rec2 / rec3 | top_a | top_b |")
        w("|---|---|---|---|---|---|")
        for sid in ids:
            r = by[sid]
            w(f"| {sid} {r['name_ko']} | {r['path_used']} | {recs(r)} | {old_recs(sid)} | {r['top_a'] or '—'} | {r['top_b'] or '—'} |")
        w("")
    w("## 4. agree=false인 증상 (경로 B를 쓴 증상 중 A와 1위가 다른 것)")
    w("")
    w("path_used가 B 또는 B+A인 증상. top_a = 후처리 뒤 경로 A 1위, top_b = 경로 B 의원급 1위.")
    w("")
    w("| 증상 | path_used | top_a | top_b | 최종 rec1 | 연결 질환 수 |")
    w("|---|---|---|---|---|---|")
    dis = [r for r in rows if r["path_used"] in ("B", "B+A") and r["agree"] == "false"]
    for r in dis:
        w(f"| {r['symptom_id']} {r['name_ko']} | {r['path_used']} | {r['top_a']} | {r['top_b']} | {r['rec1']} | {detail[r['symptom_id']]['n_dis']} |")
    both = [r for r in rows if r["path_used"] in ("B", "B+A") and r["agree"]]
    w("")
    w(f"B·B+A 중 top_a·top_b가 둘 다 있는 {len(both)}개 중 agree=false {len(dis)}개 "
      f"(일치율 {1 - len(dis) / len(both):.1%}).")
    w("")
    w("## 5. fallback 증상과 fallback 진료과")
    w("")
    fbs = [r for r in rows if r["fallback"] == "true"]
    w(f"fallback 증상 {len(fbs)}개 (path_used=none). 이유: await_path_a인데 path_a_ok가 아니거나, B·A 순위가 모두 없음.")
    w("")
    w(f"is_injury = 119 범주 {', '.join(str(c) for c in cfg['fallback']['injury_triage_categories'])} 연결 "
      f"또는 ICPC {cfg['fallback']['injury_icpc_codes'][0]}~{cfg['fallback']['injury_icpc_codes'][-1]}.")
    w("")
    w(f"fallback_group: injury(is_injury) → pediatric(ICPC preferred에 "
      f"{', '.join(cfg['fallback']['pediatric_preferred_keywords'])}) → general 순서로 처음 맞는 것.")
    w("")
    w("| 증상 | fallback_group | is_injury | 경로 B 상태 | path_a_ok | 연결 질환 수 | 2A-1 rec1 / rec2 / rec3 |")
    w("|---|---|---|---|---|---|---|")
    for r in fbs:
        d = detail[r["symptom_id"]]
        st = "순위 없음" if not d["has_b"] else "await_path_a" if d["await"] else "hira_indistinct" if d["indistinct"] else "-"
        w(f"| {r['symptom_id']} {r['name_ko']} | {r['fallback_group']} | {r['is_injury']} | {st} | {str(d['a_ok']).lower()} | "
          f"{d['n_dis']} | {old_recs(r['symptom_id'])} |")
    w("")
    none_rule = [r for r in rows if r["path_used"] == "none" and r["fallback"] == "false"]
    if none_rule:
        w(f"path_used=none이지만 생식기 규칙으로 rec1만 남긴 증상 {len(none_rule)}개: "
          + ", ".join(f"{r['symptom_id']}({r['rec1']})" for r in none_rule))
        w("")
    w("### fallback_departments.csv")
    w("")
    w("| group | rank | dept | n_symptoms |")
    w("|---|---|---|---|")
    for r in fb_rows:
        w(f"| {r['group']} | {r['rank']} | {r['dept']} | {r['n_symptoms']} |")
    w("")
    n_inj = sum(1 for r in rows if r["is_injury"] == "true" and r["path_used"] in ("A", "B", "B+A") and r["rec1"])
    w(f"injury: is_injury=true이고 path_used가 A·B·B+A인 증상 {n_inj}개의 rec1 분포 = "
      + ", ".join(f"{d} {n}" for d, n in sorted(inj.items(), key=lambda x: (-x[1], x[0])))
      + f". 근거 증상 {cfg['fallback']['injury_min_support']}개 이상인 과만 남김.")
    w("")
    w("## 6. 경로 B를 v2.1로 다시 계산하며 2A-1과 달라진 v2 증상")
    w("")
    w("새 증상 34개가 3자리 코드를 함께 쓰면서 share_count가 바뀌어 생긴 차이다.")
    w("")
    w("| 증상 | 2A-1 rec1 / rec2 / rec3 (hira_indistinct, dept_rule) | v2.1 경로 B |")
    w("|---|---|---|")
    for sid, o in old.items():
        n = pb[sid]
        a = (o["rec1_dept"], o["rec2_dept"], o["rec3_dept"], o["hira_indistinct"], o["dept_rule"])
        bb = (n["rec1_dept"], n["rec2_dept"], n["rec3_dept"], n["hira_indistinct"], n["dept_rule"])
        if a != bb:
            f = lambda t: " / ".join(x or "—" for x in t[:3]) + f" ({t[3]}, {t[4] or '-'})"  # noqa: E731
            w(f"| {sid} {by[sid]['name_ko']} | {f(a)} | {f(bb)} |")
    w("")
    with open(J(cc["report"]), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(L) + "\n")
    print(f"저장: {cc['report']}")
    stats = {"path_used": dict(path_cnt), "ba_rec1_changed": [r["symptom_id"] for r in changed],
             "b_by_decision1": [r["symptom_id"] for r in b_dec1], "ba_kept_b_top": [r["symptom_id"] for r in kept],
             "lost_vs_2a1": lost,
             "agree_false": len(dis), "agree_both": len(both), "fallback": [r["symptom_id"] for r in fbs],
             "fallback_departments": fb_rows}
    with open(J(cc["stats"]), "w", encoding="utf-8", newline="\n") as f:
        json.dump(stats, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps(stats, ensure_ascii=False))


if __name__ == "__main__":
    main()
