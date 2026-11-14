"""D5: 문진 YAML → ref 시드 CSV (db/seed/<data_version>/)

    python pipeline/06d_build_intake_seed.py

- 입력: config/intake_v1.yaml. 먼저 pipeline/intake_check.py의 D5 검사를 다시 돌리고, 실패하면 아무것도 쓰지 않는다.
- 출력(003_ref_intake.sql과 같은 컬럼 순서): questionnaire, questionnaire_item, questionnaire_answer_option,
  questionnaire_enable_when, safety_rule, safety_rule_condition, output_mapping, item_topic
- data_version과 폴더는 config/seed.yaml을 따른다(ref 1차 시드와 같은 버전).
- id는 YAML 안의 순서대로 1부터. 같은 입력이면 같은 결과(utf-8-sig).
- FHIR R4 Questionnaire JSON 내보내기(선택 항목)는 이번에 만들지 않았다.
"""
import csv
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: os.path.join(ROOT, *p)  # noqa: E731
_spec = importlib.util.spec_from_file_location("intake_check", J("pipeline", "intake_check.py"))
ic = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ic)

COLS = {
    "questionnaire": ["id", "version", "title", "source", "data_version"],
    "questionnaire_item": ["link_id", "questionnaire_id", "order_no", "text_ko", "text_en", "item_type", "required",
                           "enable_behavior", "flow", "ui", "source", "todo", "engine_condition", "data_version"],
    "questionnaire_answer_option": ["link_id", "code", "order_no", "display_ko", "display_en", "data_version"],
    "questionnaire_enable_when": ["id", "link_id", "question", "operator", "answer", "data_version"],
    "safety_rule": ["rule_id", "priority", "combine", "result", "terminal", "triage_category_id", "message_key",
                    "evidence_source", "evidence_page", "evidence_note", "review_status", "data_version"],
    "safety_rule_condition": ["id", "rule_id", "question", "operator", "answers", "data_version"],
    "output_mapping": ["id", "from_type", "question", "rule_id", "when_code", "slot", "value", "data_version"],
    "item_topic": ["id", "question", "system", "system_version", "code", "data_version"],
}


def b(x):
    return "true" if x else "false"


def s(x):
    if x is None:
        return ""
    if isinstance(x, bool):
        return b(x)
    return str(x)


def pg_text_array(vals):
    out = []
    for v in vals:
        v = str(v)
        if not ic.ID_RE.match(v):
            sys.exit(f"배열 값에 쓸 수 없는 글자: {v!r}")
        out.append(v)
    return "{" + ",".join(out) + "}"


def build(doc, ver):
    q = doc["questionnaire"]
    t = {k: [] for k in COLS}
    t["questionnaire"].append({"id": q["id"], "version": q["version"], "title": q["title"], "source": q["source"],
                               "data_version": ver})
    ew_id = 0
    for it in sorted(doc["items"], key=lambda x: x["order"]):
        t["questionnaire_item"].append({
            "link_id": it["link_id"], "questionnaire_id": q["id"], "order_no": it["order"], "text_ko": it["text"],
            "text_en": s(it.get("text_en")), "item_type": it["type"], "required": b(it["required"]),
            "enable_behavior": s(it.get("enable_behavior")), "flow": it["flow"], "ui": s(it.get("ui")),
            "source": it["source"], "todo": b(it.get("todo")), "engine_condition": s(it.get("engine_condition")),
            "data_version": ver})
        for i, op in enumerate(it.get("answer_options") or [], 1):
            t["questionnaire_answer_option"].append({"link_id": it["link_id"], "code": op["code"], "order_no": i,
                                                     "display_ko": op["display"], "display_en": s(op.get("display_en")),
                                                     "data_version": ver})
        for c in it.get("enable_when") or []:
            ew_id += 1
            t["questionnaire_enable_when"].append({"id": ew_id, "link_id": it["link_id"], "question": c["question"],
                                                   "operator": c["operator"], "answer": s(c["answer"]),
                                                   "data_version": ver})
    cond_id = 0
    for r in doc["safety_rules"]:
        ev = r["evidence"]
        t["safety_rule"].append({
            "rule_id": r["rule_id"], "priority": r["priority"], "combine": r["combine"], "result": r["result"],
            "terminal": b(r["terminal"]), "triage_category_id": s(r.get("triage_category_id")),
            "message_key": r["message_key"], "evidence_source": ev["source"], "evidence_page": s(ev.get("page")),
            "evidence_note": ev["note"], "review_status": r["review_status"], "data_version": ver})
        for c in r["conditions"]:
            cond_id += 1
            vals = c["answers"] if c["operator"] == "in" else [c["answer"]]
            t["safety_rule_condition"].append({"id": cond_id, "rule_id": r["rule_id"], "question": c["question"],
                                               "operator": c["operator"], "answers": pg_text_array(vals),
                                               "data_version": ver})
    for i, m in enumerate(doc["output_mappings"], 1):
        t["output_mapping"].append({"id": i, "from_type": m["from"], "question": s(m.get("question")),
                                    "rule_id": s(m.get("rule_id")), "when_code": s(m.get("when")), "slot": m["slot"],
                                    "value": s(m.get("value")), "data_version": ver})
    for i, tp in enumerate(doc.get("item_topics") or [], 1):
        t["item_topic"].append({"id": i, "question": tp["question"], "system": tp["system"],
                                "system_version": tp["system_version"], "code": s(tp["code"]), "data_version": ver})
    return t


def main():
    seed = ic.load(J("config", "seed.yaml"))
    ver, seed_dir = seed["data_version"], J(seed["seed_dir"])
    path = J("config", "intake_v1.yaml")
    doc = ic.load(path)
    errors, info = ic.check(doc, seed_dir)
    if errors:
        for e in errors:
            print("D5 검사 오류:", e)
        sys.exit(1)
    print(f"D5 검사 통과: 문항 {info['items']}개, 안전 규칙 {info['rules']}개, 결과 매핑 {info['mappings']}개, "
          f"질문 주제 {info['topics']}개, todo {info['todo']}")
    tables = build(doc, ver)
    for name, rows in tables.items():
        p = os.path.join(seed_dir, f"{name}.csv")
        with open(p, "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=COLS[name], lineterminator="\n")
            w.writeheader()
            w.writerows(rows)
        print(f"저장: {os.path.relpath(p, ROOT)} ({len(rows)}행)")


if __name__ == "__main__":
    main()
