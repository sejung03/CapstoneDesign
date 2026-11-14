"""D5 문진 YAML 검사 (config/intake_v1.yaml)

    python pipeline/intake_check.py [config/intake_v1.yaml]

다음 단계의 pipeline/06d_build_intake_seed.py도 check()를 불러 같은 검사를 다시 돌린다.
검사:
- 지원 범위 밖 기능(중첩 items, repeats, 복수 선택, 다른 type·operator, 조건 안의 조건, 모르는 키) → 실패
- link_id·rule_id 유일, order 중복 없음, ID 형식(영문·숫자·밑줄·하이픈 1~80자), 문구 300자 이하
- choice 선택지 1~12개(todo: true면 비워 둠만 허용), 선택지 code 유일
- enable_when: question이 있고 자기보다 앞 순서, 순환 없음, 답 code가 그 문항에 있음,
  어떤 답 조합으로도 안 보이는 문항 없음(앞 문항 답을 모두 따져 봄)
- 안전 규칙: 조건 문항·code가 있음, evidence 필수, Q0 = yes와 N1~N3 위험 답(모름 포함)이 모두 규칙에 걸림
- 결과 매핑: slot이 목록 안, 가리키는 문항·code·규칙이 있음
- 질문 주제: code가 ref 시드(db/seed/<data_version>/)에 실제로 있음
"""
import csv
import itertools
import os
import re
import sys

from ruamel.yaml import YAML

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: os.path.join(ROOT, *p)  # noqa: E731

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
MAX_TEXT = 300
TYPES = {"choice", "string", "display"}
OPS_WHEN = {"=", "!=", "exists"}
OPS_RULE = {"=", "in"}
FLOWS = {"start", "emergency", "safety", "target", "detail", "pain", "fallback"}
ITEM_KEYS = {"link_id", "order", "text", "text_en", "type", "required", "answer_options", "enable_when",
             "enable_behavior", "flow", "ui", "source", "todo", "engine_condition"}
WHEN_KEYS = {"question", "operator", "answer"}
SLOTS = {
    "card": {"is_self", "with_patient", "location_known", "consciousness", "breathing", "bleeding", "injury",
             "patient_count", "onset"},
    "report": {"symptom", "onset", "notes"},
    "filter": {"sex", "age_band", "infant"},
    "detail": {"continuous", "worsening", "prior_episode", "aggravating", "relieving", "self_treatment",
               "daily_impact", "related_condition", "pain_score", "pain_site", "pain_quality"},
    "flow": {"emergency_stop", "urgent_notice"},
}
SLOT_VALUES = {"filter.age_band": {"child", "adult", "unknown"}, "filter.infant": {"true", "false"},
               "filter.sex": {"female", "male", "unknown"}}
# 위험 답: 이 답들이 모두 어떤 안전 규칙에 걸려야 한다
DANGER = {"Q0": ["yes"], "N1": ["no", "unknown"], "N2": ["no", "unknown"], "N3": ["yes", "unknown"]}


def load(path):
    with open(path, encoding="utf-8") as f:
        return YAML(typ="safe", pure=True).load(f)


def read_seed(name, seed_dir):
    with open(os.path.join(seed_dir, name), encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def check(doc, seed_dir):
    """(errors, info) 반환. errors가 비어 있으면 통과."""
    E = []
    info = {}
    known_top = {"questionnaire", "items", "safety_rules", "output_mappings", "item_topics"}
    for k in doc:
        if k not in known_top and not str(k).startswith("_"):
            E.append(f"모르는 최상위 키: {k}")
    q = doc.get("questionnaire") or {}
    for k in ("id", "version", "title", "source"):
        if not q.get(k):
            E.append(f"questionnaire.{k} 없음")

    items = doc.get("items") or []
    by_id = {}
    orders = {}
    for it in items:
        lid = it.get("link_id")
        where = f"문항 {lid}"
        for k in it:
            if k not in ITEM_KEYS:
                E.append(f"{where}: 지원하지 않는 키 '{k}'(중첩·반복·복수 선택 등은 지원 범위 밖)")
        if not isinstance(lid, str) or not ID_RE.match(lid):
            E.append(f"{where}: link_id 형식 오류")
        if lid in by_id:
            E.append(f"{where}: link_id 중복")
        by_id[lid] = it
        o = it.get("order")
        if not isinstance(o, int) or isinstance(o, bool):
            E.append(f"{where}: order가 정수가 아님")
        elif o in orders:
            E.append(f"{where}: order {o}가 {orders[o]}와 중복")
        else:
            orders[o] = lid
        if it.get("type") not in TYPES:
            E.append(f"{where}: type '{it.get('type')}' 지원 안 함")
        if it.get("flow") not in FLOWS:
            E.append(f"{where}: flow '{it.get('flow')}' 지원 안 함")
        if it.get("source") not in ("team_pdf", "added"):
            E.append(f"{where}: source 값 오류")
        if it.get("ui") not in (None, "frontend"):
            E.append(f"{where}: ui 값 오류")
        if not isinstance(it.get("required"), bool):
            E.append(f"{where}: required가 true/false가 아님")
        for tk in ("text", "text_en"):
            t = it.get(tk)
            if tk == "text" and not t:
                E.append(f"{where}: text 없음")
            if t and len(str(t)) > MAX_TEXT:
                E.append(f"{where}: {tk} {len(str(t))}자 > {MAX_TEXT}")
        opts = it.get("answer_options")
        if it.get("type") == "choice":
            if not isinstance(opts, list):
                E.append(f"{where}: answer_options가 목록이 아님")
                opts = []
            if it.get("todo") is True:
                if opts:
                    E.append(f"{where}: todo인데 선택지가 있음")
            elif not 1 <= len(opts) <= 12:
                E.append(f"{where}: 선택지 {len(opts)}개(1~12개여야 함)")
            codes = [op.get("code") for op in opts]
            if len(set(codes)) != len(codes):
                E.append(f"{where}: 선택지 code 중복")
            for op in opts:
                if set(op) - {"code", "display", "display_en"}:
                    E.append(f"{where}: 선택지에 지원하지 않는 키 {sorted(set(op) - {'code', 'display', 'display_en'})}")
                if not isinstance(op.get("code"), str) or not ID_RE.match(op["code"]):
                    E.append(f"{where}: 선택지 code 형식 오류 {op.get('code')!r}")
                for dk in ("display", "display_en"):
                    if dk == "display" and not op.get(dk):
                        E.append(f"{where}: 선택지 {op.get('code')} display 없음")
                    if op.get(dk) and len(str(op[dk])) > MAX_TEXT:
                        E.append(f"{where}: 선택지 {op.get('code')} {dk} > {MAX_TEXT}자")
        elif opts:
            E.append(f"{where}: {it.get('type')} 문항에 선택지가 있음")
        if it.get("todo") not in (None, True):
            E.append(f"{where}: todo는 true일 때만 적는다")
        if it.get("todo") and it.get("type") != "choice":
            E.append(f"{where}: todo는 choice 문항에만")

    codes_of = {lid: {op["code"] for op in (it.get("answer_options") or []) if isinstance(op, dict) and "code" in op}
                for lid, it in by_id.items()}

    # ---------- enable_when ----------
    n_err_before_when = len(E)
    deps = {}
    for lid, it in by_id.items():
        where = f"문항 {lid}"
        ew = it.get("enable_when") or []
        if not isinstance(ew, list):
            E.append(f"{where}: enable_when이 목록이 아님")
            ew = []
        if it.get("enable_behavior") not in (None, "all", "any"):
            E.append(f"{where}: enable_behavior 값 오류")
        if len(ew) > 1 and it.get("enable_behavior") is None:
            E.append(f"{where}: 조건이 둘 이상인데 enable_behavior 없음")
        deps[lid] = []
        for c in ew:
            if not isinstance(c, dict) or set(c) - WHEN_KEYS:
                E.append(f"{where}: 조건 형식 오류(조건 안의 조건 등 지원 안 함): {c}")
                continue
            ref, op, ans = c.get("question"), c.get("operator"), c.get("answer")
            if op not in OPS_WHEN:
                E.append(f"{where}: operator '{op}' 지원 안 함")
            if ref not in by_id:
                E.append(f"{where}: enable_when 문항 {ref} 없음")
                continue
            deps[lid].append(ref)
            if by_id[ref].get("order", 0) >= it.get("order", 0):
                E.append(f"{where}: enable_when 문항 {ref}가 자기보다 앞 순서가 아님")
            if by_id[ref].get("type") == "display":
                E.append(f"{where}: display 문항 {ref}를 조건으로 씀")
            if op == "exists":
                if not isinstance(ans, bool):
                    E.append(f"{where}: exists의 answer는 true/false")
            else:
                if by_id[ref].get("type") != "choice":
                    E.append(f"{where}: {op} 조건은 choice 문항에만({ref})")
                elif ans not in codes_of[ref]:
                    E.append(f"{where}: 답 code {ans!r}가 {ref}에 없음")

    # 순환
    state = {}

    def visit(n, path):
        if state.get(n) == 1:
            E.append(f"enable_when 순환: {' → '.join(path + [n])}")
            return
        if state.get(n) == 2:
            return
        state[n] = 1
        for d in deps.get(n, []):
            visit(d, path + [n])
        state[n] = 2
    for n in deps:
        visit(n, [])

    # 볼 수 있는지: 조상 문항들의 답(없음 포함)을 모두 따져 본다
    def ancestors(n, acc):
        for d in deps.get(n, []):
            if d not in acc:
                acc.add(d)
                ancestors(d, acc)
        return acc

    def visible(lid, answers):
        it = by_id[lid]
        conds = it.get("enable_when") or []
        if not conds:
            return True
        res = []
        for c in conds:
            a = answers.get(c["question"])
            if c["operator"] == "exists":
                res.append((a is not None) == c["answer"])
            elif c["operator"] == "=":
                res.append(a == c["answer"])
            else:
                res.append(a is not None and a != c["answer"])
        return all(res) if (it.get("enable_behavior") or "all") == "all" else any(res)

    never = []
    if len(E) > n_err_before_when:   # 조건 형식 오류·순환이 있으면 도달 검사는 하지 않는다(위 오류부터 고친다)
        E.append("enable_when 오류가 있어 '보이지 않는 문항' 검사를 건너뜀")
    else:
        for lid in by_id:
            anc = sorted(ancestors(lid, set()), key=lambda x: by_id[x]["order"])
            choices = []
            for a in anc:
                t = by_id[a].get("type")
                vals = sorted(codes_of[a]) if t == "choice" and codes_of[a] else ["__answered__"]
                choices.append([None] + vals)
            ok = False
            for combo in itertools.product(*choices):
                ans = {}
                for a, v in zip(anc, combo):
                    if v is not None and not visible(a, ans):
                        break          # 안 보이는 문항에는 답할 수 없다
                    ans[a] = v
                else:
                    if visible(lid, ans):
                        ok = True
                        break
            if not ok:
                never.append(lid)
    for lid in never:
        E.append(f"문항 {lid}: 어떤 답 조합으로도 보이지 않음")

    # ---------- 안전 규칙 ----------
    rules = doc.get("safety_rules") or []
    rule_ids = set()
    for r in rules:
        rid = r.get("rule_id")
        where = f"규칙 {rid}"
        if not isinstance(rid, str) or not ID_RE.match(rid):
            E.append(f"{where}: rule_id 형식 오류")
        if rid in rule_ids:
            E.append(f"{where}: rule_id 중복")
        rule_ids.add(rid)
        if not isinstance(r.get("priority"), int):
            E.append(f"{where}: priority가 정수가 아님")
        if r.get("combine") not in ("all", "any"):
            E.append(f"{where}: combine 값 오류")
        if r.get("result") not in ("EMERGENCY_STOP", "URGENT_NOTICE"):
            E.append(f"{where}: result 값 오류")
        if not isinstance(r.get("terminal"), bool):
            E.append(f"{where}: terminal이 true/false가 아님")
        if r.get("review_status") not in ("draft", "team_reviewed"):
            E.append(f"{where}: review_status 값 오류")
        if not r.get("message_key") or not ID_RE.match(str(r.get("message_key"))):
            E.append(f"{where}: message_key 형식 오류")
        ev = r.get("evidence") or {}
        if ev.get("source") not in ("team_pdf", "manual_119") or not ev.get("note"):
            E.append(f"{where}: evidence(source·note) 필수")
        for c in r.get("conditions") or []:
            qn, op = c.get("question"), c.get("operator")
            if op not in OPS_RULE:
                E.append(f"{where}: operator '{op}' 지원 안 함")
            if qn not in by_id:
                E.append(f"{where}: 조건 문항 {qn} 없음")
                continue
            vals = c.get("answers") if op == "in" else [c.get("answer")]
            for v in vals or []:
                if v not in codes_of[qn]:
                    E.append(f"{where}: {qn}에 code {v!r} 없음")
        if not r.get("conditions"):
            E.append(f"{where}: 조건 없음")
    prios = [r.get("priority") for r in rules]
    if len(set(prios)) != len(prios):
        E.append("안전 규칙 priority 중복")

    def fires(r, qn, v):
        res = []
        for c in r.get("conditions") or []:
            if c.get("question") != qn:
                res.append(False)
                continue
            res.append(v in (c.get("answers") or []) if c.get("operator") == "in" else v == c.get("answer"))
        return all(res) if r.get("combine") == "all" else any(res)
    coverage = {}
    for qn, vals in DANGER.items():
        for v in vals:
            hit = [r["rule_id"] for r in rules if fires(r, qn, v)]
            coverage[f"{qn}={v}"] = hit
            if not hit:
                E.append(f"위험 답 {qn}={v}가 어떤 안전 규칙에도 걸리지 않음")
    info["coverage"] = coverage

    # ---------- 결과 매핑 ----------
    for m in doc.get("output_mappings") or []:
        where = f"매핑 {m}"
        slot = str(m.get("slot", ""))
        grp, _, name = slot.partition(".")
        if name not in SLOTS.get(grp, set()):
            E.append(f"{where}: slot '{slot}'가 목록에 없음")
        if m.get("from") == "answer":
            qn = m.get("question")
            if qn not in by_id:
                E.append(f"{where}: 문항 {qn} 없음")
            elif m.get("when") != "any" and m.get("when") not in codes_of[qn]:
                E.append(f"{where}: {qn}에 code {m.get('when')!r} 없음")
            if m.get("rule_id"):
                E.append(f"{where}: answer 매핑에 rule_id가 있음")
        elif m.get("from") == "rule":
            if m.get("rule_id") not in rule_ids:
                E.append(f"{where}: 규칙 {m.get('rule_id')} 없음")
            if m.get("question"):
                E.append(f"{where}: rule 매핑에 question이 있음")
        else:
            E.append(f"{where}: from 값 오류")
        if slot in SLOT_VALUES and m.get("value") is not None and m["value"] not in SLOT_VALUES[slot]:
            E.append(f"{where}: {slot} 값 {m['value']!r} 허용 안 됨")
        # 값을 정하지 않은 매핑은 답 code를 그대로 넘기므로, 넘길 수 있는 code가 허용값 안이어야 한다
        if slot in SLOT_VALUES and m.get("value") is None and m.get("from") == "answer" and m.get("question") in codes_of:
            passed = codes_of[m["question"]] if m.get("when") == "any" else {m.get("when")}
            if not passed <= SLOT_VALUES[slot]:
                E.append(f"{where}: {slot}로 그대로 넘기는 code {sorted(passed - SLOT_VALUES[slot])}가 허용값 밖")
    # filter.sex·age_band: 그 슬롯을 채우는 문항은 모든 답 code가 매핑되어야 한다(빠진 답은 필터 값이 비게 됨)
    for slot in ("filter.sex", "filter.age_band"):
        rows_ = [m for m in doc.get("output_mappings") or [] if m.get("slot") == slot and m.get("from") == "answer"]
        for qn in {m.get("question") for m in rows_}:
            if qn not in codes_of:
                continue
            covered = codes_of[qn] if any(m.get("when") == "any" for m in rows_ if m.get("question") == qn) \
                else {m.get("when") for m in rows_ if m.get("question") == qn}
            if codes_of[qn] - covered:
                E.append(f"{slot}: {qn}의 답 {sorted(codes_of[qn] - covered)}가 매핑되지 않음")

    # ---------- 질문 주제 ----------
    tri = {r["id"] for r in read_seed("triage_category.csv", seed_dir)}
    sym = read_seed("symptom.csv", seed_dir)
    sym_ids = {r["symptom_id"] for r in sym}
    icpc = {r["icpc2_code"] for r in sym if r["icpc2_code"]}
    for t in doc.get("item_topics") or []:
        where = f"주제 {t}"
        if t.get("question") not in by_id:
            E.append(f"{where}: 문항 없음")
        sysname, code = t.get("system"), str(t.get("code"))
        known = {"triage_119": tri, "symptom_id": sym_ids, "icpc2": icpc}.get(sysname)
        if known is None:
            E.append(f"{where}: system 값 오류")
        elif code not in known:
            E.append(f"{where}: code {code}가 ref 데이터에 없음")
        if not t.get("system_version"):
            E.append(f"{where}: system_version 없음")

    info["items"] = len(items)
    info["by_flow"] = {f: sum(1 for it in items if it.get("flow") == f) for f in sorted(FLOWS)}
    info["todo"] = [it["link_id"] for it in items if it.get("todo")]
    info["rules"] = len(rules)
    info["mappings"] = len(doc.get("output_mappings") or [])
    info["topics"] = len(doc.get("item_topics") or [])
    return E, info


def main():
    path = J(sys.argv[1]) if len(sys.argv) > 1 else J("config", "intake_v1.yaml")
    seed = load(J("config", "seed.yaml"))
    errors, info = check(load(path), J(seed["seed_dir"]))
    print(f"검사: {os.path.relpath(path, ROOT)}")
    print(f"문항 {info['items']}개 {info['by_flow']}, 안전 규칙 {info['rules']}개, 결과 매핑 {info['mappings']}개, "
          f"질문 주제 {info['topics']}개")
    print(f"todo 문항: {info['todo']}")
    for k, v in info.get("coverage", {}).items():
        print(f"  위험 답 {k} → {v}")
    if errors:
        for e in errors:
            print("오류:", e)
        sys.exit(1)
    print("검사 통과")


if __name__ == "__main__":
    main()
