"""D5 적재 검증 → reports/step7_intake.md

    python pipeline/07b_verify_intake.py

- 테이블별 DB 행 수 = 시드 행 수
- publishable 키 REST(Accept-Profile: ref): Q0 문항과 선택지, 안전 규칙(조건 포함) 조회, insert 시도 거부
- D5 검사 재실행: (1) config/intake_v1.yaml, (2) DB에서 다시 읽어 만든 문서 — 둘 다 pipeline/intake_check.py로
- 주소·키·접속 정보는 화면과 보고서에 쓰지 않는다.
"""
import csv
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: os.path.join(ROOT, *p)  # noqa: E731


def _load(name, file):
    spec = importlib.util.spec_from_file_location(name, J("pipeline", file))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


v06e = _load("verify06e", "06e_verify_ref.py")
ic = _load("intake_check", "intake_check.py")
l06b = v06e.l06b
REPORT = J("reports", "step7_intake.md")
TABLES = ["questionnaire", "questionnaire_item", "questionnaire_answer_option", "questionnaire_enable_when",
          "safety_rule", "safety_rule_condition", "output_mapping", "item_topic"]


def doc_from_db(cur):
    """DB 행으로 intake_v1.yaml과 같은 모양의 문서를 다시 만든다."""
    def rows(sql):
        cur.execute(sql)
        cols = [c.name for c in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]
    q = rows("select id, version, title, source from ref.questionnaire")[0]
    opts, whens = {}, {}
    for o in rows("select link_id, code, display_ko from ref.questionnaire_answer_option order by link_id, order_no"):
        opts.setdefault(o["link_id"], []).append({"code": o["code"], "display": o["display_ko"]})
    for w in rows("select link_id, question, operator, answer from ref.questionnaire_enable_when order by id"):
        ans = (w["answer"] == "true") if w["operator"] == "exists" else w["answer"]
        whens.setdefault(w["link_id"], []).append({"question": w["question"], "operator": w["operator"], "answer": ans})
    items = []
    for it in rows("select * from ref.questionnaire_item order by order_no"):
        d = {"link_id": it["link_id"], "order": it["order_no"], "text": it["text_ko"], "type": it["item_type"],
             "required": it["required"], "flow": it["flow"], "source": it["source"]}
        for k_db, k in (("text_en", "text_en"), ("enable_behavior", "enable_behavior"), ("ui", "ui"),
                        ("engine_condition", "engine_condition")):
            if it[k_db]:
                d[k] = it[k_db]
        if it["todo"]:
            d["todo"] = True
        if it["item_type"] == "choice":
            d["answer_options"] = opts.get(it["link_id"], [])
        if it["link_id"] in whens:
            d["enable_when"] = whens[it["link_id"]]
        items.append(d)
    conds = {}
    for c in rows("select rule_id, question, operator, answers from ref.safety_rule_condition order by id"):
        cc = {"question": c["question"], "operator": c["operator"]}
        if c["operator"] == "in":
            cc["answers"] = list(c["answers"])
        else:
            cc["answer"] = c["answers"][0]
        conds.setdefault(c["rule_id"], []).append(cc)
    rules = [{"rule_id": r["rule_id"], "priority": r["priority"], "conditions": conds.get(r["rule_id"], []),
              "combine": r["combine"], "result": r["result"], "terminal": r["terminal"],
              "triage_category_id": r["triage_category_id"], "message_key": r["message_key"],
              "evidence": {"source": r["evidence_source"], "page": r["evidence_page"], "note": r["evidence_note"]},
              "review_status": r["review_status"]}
             for r in rows("select * from ref.safety_rule order by priority")]
    maps = []
    for m in rows("select * from ref.output_mapping order by id"):
        d = {"from": m["from_type"], "slot": m["slot"]}
        if m["from_type"] == "answer":
            d.update({"question": m["question"], "when": m["when_code"]})
        else:
            d["rule_id"] = m["rule_id"]
        if m["value"] is not None:
            d["value"] = m["value"]
        maps.append(d)
    topics = [{"question": t["question"], "system": t["system"], "system_version": t["system_version"], "code": t["code"]}
              for t in rows("select * from ref.item_topic order by id")]
    return {"questionnaire": dict(q), "items": items, "safety_rules": rules, "output_mappings": maps,
            "item_topics": topics}


def main():
    seed = l06b.load_yaml(J("config", "seed.yaml"))
    ver, seed_dir = seed["data_version"], J(seed["seed_dir"])
    problems = []
    L = []
    w = L.append
    w("# 7단계 D5 문진 적재 검증")
    w("")
    w(f"- data_version: `{ver}` (ref 1차 시드와 같은 버전·폴더)")
    w("- 원본: `config/intake_v1.yaml` → `pipeline/06d_build_intake_seed.py`(D5 검사 후 시드 CSV)")
    w("- 마이그레이션: `db/migrations/003_ref_intake.sql` (실행 후 롤백으로 점검 → 적용 → 다시 실행해도 오류 없음)")
    w("- 적재: `pipeline/06b_load_supabase.py`(ref 전체를 한 트랜잭션으로). 검증: `pipeline/07b_verify_intake.py`")
    w("- 접속 정보와 키는 이 보고서에 쓰지 않는다.")
    w("")

    conn = l06b.connect()
    cur = conn.cursor()
    w("## 1. 테이블별 행 수 (DB = 시드)")
    w("")
    w("| 테이블 | 시드 | DB | 일치 |")
    w("|---|---|---|---|")
    for t in TABLES:
        with open(os.path.join(seed_dir, f"{t}.csv"), encoding="utf-8-sig", newline="") as f:
            n_seed = sum(1 for _ in csv.DictReader(f))
        cur.execute(f"select count(*) from ref.{t}")
        n_db = cur.fetchone()[0]
        if n_seed != n_db:
            problems.append(f"행 수 다름: {t}")
        w(f"| {t} | {n_seed} | {n_db} | {'예' if n_seed == n_db else '아니요'} |")
    w("")
    cur.execute("select count(*) filter (where c.relrowsecurity), count(*) from pg_class c join pg_namespace n "
                "on n.oid = c.relnamespace where n.nspname = 'ref' and c.relname = any(%s)", (TABLES,))
    on, n = cur.fetchone()
    cur.execute("select string_agg(distinct privilege_type, ',') from information_schema.role_table_grants "
                "where table_schema = 'ref' and table_name = any(%s) and grantee in ('anon', 'authenticated')", (TABLES,))
    privs = cur.fetchone()[0]
    w(f"- RLS 켜진 문진 테이블: {on} / {n}, anon·authenticated 권한: {privs}")
    if on != n or privs != "SELECT":
        problems.append("문진 테이블 RLS·권한이 다른 ref 테이블과 다름")
    w("")

    # REST
    rest = v06e.Rest()
    w("## 2. publishable 키로 REST 조회 (Accept-Profile: ref)")
    w("")
    st, body = rest.call("GET", "questionnaire_item?link_id=eq.Q0&select=link_id,text_ko,item_type,required,flow")
    ok = st == 200 and isinstance(body, list) and len(body) == 1
    if not ok:
        problems.append(f"REST Q0 조회 실패: {st} {body}")
    w(f"- Q0 문항: HTTP {st} → " + (f"`{body[0]['link_id']}` {body[0]['text_ko']} "
                                   f"(type {body[0]['item_type']}, required {body[0]['required']}, flow {body[0]['flow']})"
                                   if ok else "**실패**"))
    st, body = rest.call("GET", "questionnaire_answer_option?link_id=in.(Q0,N1,N2)&select=link_id,code,display_ko"
                                "&order=link_id,order_no")
    ok = st == 200 and isinstance(body, list) and len(body) == 8
    if not ok:
        problems.append(f"REST 선택지 조회 실패: {st} {body}")
    w(f"- Q0·N1·N2 선택지: HTTP {st}, {len(body) if isinstance(body, list) else 0}행")
    if isinstance(body, list):
        for o in body:
            w(f"  - {o['link_id']} `{o['code']}` {o['display_ko']}")
    st, body = rest.call("GET", "safety_rule?select=rule_id,priority,result,terminal,triage_category_id,"
                                "safety_rule_condition(question,operator,answers)&order=priority")
    ok = st == 200 and isinstance(body, list) and len(body) == 4
    if not ok:
        problems.append(f"REST 안전 규칙 조회 실패: {st} {body}")
    w(f"- 안전 규칙(조건 포함, 테이블 관계로 함께 조회): HTTP {st}, {len(body) if isinstance(body, list) else 0}개")
    if isinstance(body, list):
        w("")
        w("| priority | rule_id | 조건 | result | terminal | 119 범주 |")
        w("|---|---|---|---|---|---|")
        for r in body:
            cs = "; ".join(f"{c['question']} {c['operator']} {', '.join(c['answers'])}" for c in r["safety_rule_condition"])
            w(f"| {r['priority']} | {r['rule_id']} | {cs} | {r['result']} | {r['terminal']} | "
              f"{r['triage_category_id'] or '—'} |")
    w("")
    st, body = rest.call("POST", "safety_rule", {"rule_id": "R-TEST", "priority": 999, "combine": "all",
                                                  "result": "URGENT_NOTICE", "terminal": False, "message_key": "x",
                                                  "evidence_source": "team_pdf", "evidence_note": "x",
                                                  "review_status": "draft", "data_version": ver})
    denied = st in (401, 403)
    if not denied:
        problems.append(f"publishable 키로 safety_rule insert가 거부되지 않음: {st}")
    bb = body if isinstance(body, dict) else {}
    w(f"- `POST ref.safety_rule` insert 시도: HTTP {st} {bb.get('code', '')} ({bb.get('message', '')}) → "
      + ("거부됨(정상)" if denied else "**거부되지 않음**"))
    w("")

    # D5 검사 재실행
    w("## 3. D5 검사 재실행 (`pipeline/intake_check.py`)")
    w("")
    for label, doc in (("config/intake_v1.yaml", ic.load(J("config", "intake_v1.yaml"))), ("DB에서 다시 만든 문서", doc_from_db(cur))):
        errors, info = ic.check(doc, seed_dir)
        if errors:
            problems += [f"{label}: {e}" for e in errors]
        w(f"- **{label}**: " + ("통과" if not errors else f"**오류 {len(errors)}개**") +
          f" — 문항 {info['items']}개, 안전 규칙 {info['rules']}개, 결과 매핑 {info['mappings']}개, 질문 주제 {info['topics']}개")
        if label.startswith("DB"):
            w(f"  - flow별 문항: {info['by_flow']}")
            w(f"  - todo 문항(선택지 비움, v1 엔진은 건너뜀): {', '.join(info['todo'])}")
            w("  - 위험 답 → 안전 규칙: " + "; ".join(f"{k} → {', '.join(v)}" for k, v in info["coverage"].items()))
        for e in errors:
            w(f"  - {e}")
    w("")
    conn.close()
    w("## 결과")
    w("")
    w("문제 없음." if not problems else "\n".join(f"- {p}" for p in problems))
    with open(REPORT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(L) + "\n")
    print(f"저장: {os.path.relpath(REPORT, ROOT)}")
    print("문제 없음" if not problems else "\n".join(problems))
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
