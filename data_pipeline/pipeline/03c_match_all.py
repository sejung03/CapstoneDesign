"""3단계 S3-5 (4~6): 증상 답변 전체에 사전 v3를 매칭해 질환별 증상을 만든다 (LLM을 쓰지 않는다)

    python pipeline/03c_match_all.py      (03c_merge_labels_t3.py 뒤에 돌린다)

- 설정: config/match_all.yaml (입출력·span 가중치), config/symptom_match.yaml (매칭 방법),
        config/symptom_exclusion.yaml (문맥 제외), config/recommend.yaml의 path_a (kept 기준값)
- 매칭
    사전 = 동의어 term + 표준 증상 name_ko.
    한 글자 표현은 바로 뒤에 single_char_terms.next_chars 중 하나가 붙을 때만 매칭한다("멍이" O, "혹은" X).
    표현 안의 공백은 무시한다(답변과 표현 모두 공백을 빼고 비교, 위치는 원문 기준으로 되돌린다).
    왼쪽 경계: 표현 앞이 글 시작이거나 blocked_before 글자가 아닐 때만. 오른쪽은 제한하지 않는다.
    겹치면 긴 표현(공백 제외 글자 수)만 남긴다. 길이가 같으면 앞에서 시작한 것.
- 문맥 제외 (매칭 위치 하나마다)
    after_window : 표현 끝 바로 뒤 window 글자. window_stop_chars를 만나면 거기서 끊는다.
                   ignore_keyword_inside_term이면 키워드가 다른 사전 표현의 매칭 범위 안에 있을 때 무시한다.
    same_sentence: 표현이 든 문장에 키워드가 있으면 버린다. 키워드 안의 공백은 무시한다.
    버려지지 않은 위치가 하나라도 있으면 그 답변에서 그 증상은 남는다.
- 세기: 같은 답변에서 같은 증상은 한 번. span 표현은 span_weight(0.5), 그 밖은 1. 둘 다 있으면 큰 값.
- 출력
    data/processed/v3/disease_symptom.csv
      (disease_ko, symptom_id, n_answers_mentioned, n_symptom_answers, share, kept)
      kept = share ≥ min_share 그리고 n_answers_mentioned ≥ min(min_answers, n_symptom_answers)
    data/interim/v3/answer_symptom.csv (answer_key, symptom_id, weight — 답변 본문 없음)
    data/interim/v3/step3_examples.csv (제외 예시. 답변 문맥이 들어 있으므로 커밋하지 않는다)
    reports/step3_build.md (증상 id·개수·규칙 이름만. AI Hub 답변 문장·구절은 넣지 않는다)
    data/interim/v3/s3_5_match_stats.json
- 멱등: 답변은 answer_key 순, 출력은 정렬 고정, utf-8-sig.
"""
import csv
import json
import os
import re
import statistics
import sys
from collections import Counter, defaultdict

from ruamel.yaml import YAML

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: os.path.join(ROOT, *p)  # noqa: E731
WS = re.compile(r"\s")
csv.field_size_limit(10 ** 8)


def load_yaml(path):
    if not os.path.exists(path):
        sys.exit(f"설정 파일 없음: {path}")
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
    return f"{x:g}"


class Dictionary:
    """공백을 뺀 표현 → {symptom_id: 가중치}."""

    def __init__(self, syn_path, std_path, span_weight):
        self.terms = defaultdict(dict)

        def add(term, sid, w):
            key = WS.sub("", term)
            if key:
                self.terms[key][sid] = max(w, self.terms[key].get(sid, 0))

        for r in read_csv(syn_path):
            add(r["term"], r["symptom_id"], span_weight if r["term_type"] == "span" else 1.0)
        for r in read_csv(std_path):
            add(r["name_ko"], r["symptom_id"], 1.0)
        keys = sorted(self.terms, key=lambda k: (-len(k), k))
        self.longest = re.compile("(?=(" + "|".join(map(re.escape, keys)) + "))")
        self.lengths = sorted({len(k) for k in keys}, reverse=True)


class Matcher:
    def __init__(self, mcfg, ecfg):
        lb = mcfg.get("left_boundary") or {}
        self.blocked = re.compile("[" + lb["blocked_before"] + "]") if lb.get("enabled") else None
        if not mcfg.get("ignore_inner_whitespace", True):
            sys.exit("ignore_inner_whitespace=false는 구현하지 않았음")
        if "min_term_length" in mcfg:
            sys.exit("symptom_match.yaml의 min_term_length는 없앴음(single_char_terms로 대체)")
        self.single_next_list = list((mcfg.get("single_char_terms") or {}).get("next_chars") or [])
        self.single_next = set(self.single_next_list)
        self.sent_delims = set(ecfg["sentence_delimiters"])
        self.rules = ecfg["rules"]
        for r in self.rules:
            if r["type"] not in ("after_window", "same_sentence"):
                sys.exit(f"모르는 제외 규칙 type: {r['type']}")

    def find(self, text, d):
        """겹침을 정리한 매칭 목록: (원문 시작, 원문 끝, 표현 key)."""
        pos = [i for i, ch in enumerate(text) if not ch.isspace()]
        comp = "".join(text[i] for i in pos)
        cands = []
        for m in d.longest.finditer(comp):
            s = m.start()
            o = pos[s]
            if self.blocked and o > 0 and self.blocked.match(text[o - 1]):
                continue
            longest = len(m.group(1))
            for L in d.lengths:
                if L <= longest and comp[s:s + L] in d.terms:
                    if L == 1:   # 한 글자 표현: 원문에서 바로 뒤 글자가 next_chars일 때만
                        nxt = text[o + 1] if o + 1 < len(text) else ""
                        if nxt not in self.single_next:
                            continue
                    cands.append((s, s + L))
        cands.sort(key=lambda x: (-(x[1] - x[0]), x[0]))
        used = bytearray(len(comp))
        kept = []
        for s, e in cands:
            if any(used[s:e]):
                continue
            used[s:e] = b"\x01" * (e - s)
            kept.append((pos[s], pos[e - 1] + 1, comp[s:e]))
        kept.sort()
        return kept

    def sentence(self, text, start, end):
        a = start
        while a > 0 and text[a - 1] not in self.sent_delims:
            a -= 1
        b = end
        while b < len(text) and text[b] not in self.sent_delims:
            b += 1
        return text[a:b]

    def excluded(self, text, m, matches):
        """버리는 규칙 id (없으면 None)."""
        s, e, _ = m
        for r in self.rules:
            if r["type"] == "after_window":
                stops = set(r.get("window_stop_chars") or [])
                win_end = e
                while win_end < len(text) and win_end - e < r["window"] and text[win_end] not in stops:
                    win_end += 1
                for k in r["keywords"]:
                    kre = re.compile(r"\s*".join(map(re.escape, WS.sub("", k))))
                    for km in kre.finditer(text, e, win_end):
                        if r.get("ignore_keyword_inside_term") and any(
                                o is not m and o[0] <= km.start() and km.end() <= o[1] for o in matches):
                            continue
                        return r["id"]
            else:
                sent = WS.sub("", self.sentence(text, s, e))
                if any(WS.sub("", k) in sent for k in r["keywords"]):
                    return r["id"]
        return None


def run(answers, d, matcher, want_detail=False):
    """답변별 {symptom_id: weight}와 제외 기록."""
    per_answer, excl, n_raw = {}, [], 0
    for a in answers:
        text = a["text"]
        ms = matcher.find(text, d)
        got = {}
        for m in ms:
            n_raw += 1
            rule = matcher.excluded(text, m, ms)
            if rule:
                if want_detail:
                    excl.append((a["answer_key"], rule, m))
                else:
                    excl.append(rule)
                continue
            for sid, w in d.terms[m[2]].items():
                got[sid] = max(w, got.get(sid, 0))
        per_answer[a["answer_key"]] = (got, len(ms))
    return per_answer, excl, n_raw


def main():
    cfg = load_yaml(J("config", "match_all.yaml"))
    mcfg = load_yaml(J("config", "symptom_match.yaml"))
    ecfg = load_yaml(J("config", "symptom_exclusion.yaml"))
    pa = load_yaml(J("config", "recommend.yaml")).get("path_a")
    if not pa:
        sys.exit("config/recommend.yaml에 path_a 절이 없음")
    rep = cfg["report"]
    answers = sorted(read_csv(J(cfg["answers"])), key=lambda r: r["answer_key"])
    matcher = Matcher(mcfg, ecfg)

    dicts, results = {}, {}
    for ver in ("v2", "v3"):
        dc = cfg["dictionaries"][ver]
        dicts[ver] = Dictionary(J(dc["synonyms"]), J(dc["standard"]), cfg["span_weight"])
        results[ver] = run(answers, dicts[ver], matcher, want_detail=(ver == "v3"))
        print(f"{ver}: 표현 {len(dicts[ver].terms)}개, 매칭 {results[ver][2]}, 제외 {len(results[ver][1])}")

    per_answer, excl, n_raw = results["v3"]
    std = read_csv(J(cfg["dictionaries"]["v3"]["standard"]))
    std_v2 = read_csv(J(cfg["dictionaries"]["v2"]["standard"]))
    name_of = {r["symptom_id"]: r["name_ko"] for r in std}

    # ---------- 답변별 / 질환별 ----------
    disease_of = {a["answer_key"]: a["disease_ko"] for a in answers}
    n_ans = Counter(a["disease_ko"] for a in answers)
    mention = defaultdict(float)
    ans_rows = []
    for key in sorted(per_answer):
        got = per_answer[key][0]
        for sid in sorted(got):
            mention[(disease_of[key], sid)] += got[sid]
            ans_rows.append({"answer_key": key, "symptom_id": sid, "weight": fmt(got[sid])})
    write_csv(J(cfg["output"]["answer_symptom"]), ["answer_key", "symptom_id", "weight"], ans_rows)

    ds_rows = []
    for (dis, sid) in sorted(mention):
        n = mention[(dis, sid)]
        share = n / n_ans[dis]
        ds_rows.append({"disease_ko": dis, "symptom_id": sid, "n_answers_mentioned": fmt(n),
                        "n_symptom_answers": n_ans[dis], "share": f"{share:.4f}",
                        "kept": "true" if share >= pa["min_share"] and n >= min(pa["min_answers"], n_ans[dis]) else "false"})
    write_csv(J(cfg["output"]["disease_symptom"]),
              ["disease_ko", "symptom_id", "n_answers_mentioned", "n_symptom_answers", "share", "kept"], ds_rows)

    # ---------- 수치 ----------
    t3 = json.load(open(J("data", "interim", "v3", "s3_5_merge_stats.json"), encoding="utf-8"))
    syn_v2 = read_csv(J(cfg["dictionaries"]["v2"]["synonyms"]))
    syn_v3 = read_csv(J(cfg["dictionaries"]["v3"]["synonyms"]))

    def zero_rate(ver, after=True):
        pa_ = results[ver][0]
        z = sum(1 for g, n in pa_.values() if (not g if after else n == 0))
        return z, z / len(pa_)

    kept = [r for r in ds_rows if r["kept"] == "true"]
    kept_per_dis = Counter(r["disease_ko"] for r in kept)
    diseases = sorted(n_ans)
    dist = Counter(kept_per_dis.get(d, 0) for d in diseases)
    bins = [("0", lambda x: x == 0), ("1", lambda x: x == 1), ("2", lambda x: x == 2), ("3", lambda x: x == 3),
            ("4~5", lambda x: 4 <= x <= 5), ("6~10", lambda x: 6 <= x <= 10), ("11 이상", lambda x: x >= 11)]
    zero_dis = [d for d in diseases if kept_per_dis.get(d, 0) == 0]
    dis_per_sym = Counter(r["symptom_id"] for r in kept)
    sym_ranked = sorted(dis_per_sym.items(), key=lambda x: (-x[1], x[0]))
    v2_ids = [r["symptom_id"] for r in std_v2]
    v2_zero = [s for s in v2_ids if dis_per_sym.get(s, 0) == 0]
    new_ids = [r["symptom_id"] for r in t3["new_symptoms"]]
    new_zero = [s for s in new_ids if dis_per_sym.get(s, 0) == 0]
    excl_by_rule = Counter(x[1] for x in excl)

    stats = {
        "answers": len(answers), "diseases": len(diseases),
        "dict_terms": {v: len(dicts[v].terms) for v in dicts},
        "matches": {v: results[v][2] for v in results},
        "excluded": {v: len(results[v][1]) for v in results}, "excluded_by_rule_v3": dict(excl_by_rule),
        "zero_after": {v: zero_rate(v)[0] for v in results}, "zero_before": {v: zero_rate(v, False)[0] for v in results},
        "disease_symptom_rows": len(ds_rows), "kept_pairs": len(kept),
        "kept_per_disease_dist": {k: sum(v for x, v in dist.items() if f(x)) for k, f in bins},
        "zero_kept_diseases": zero_dis, "v2_zero_symptoms": v2_zero, "new_zero_symptoms": new_zero,
    }
    with open(J(cfg["output"]["stats"]), "w", encoding="utf-8", newline="\n") as f:
        json.dump(stats, f, ensure_ascii=False, indent=1, sort_keys=True)

    # ---------- 제외 예시 → data/interim (답변 문맥이 들어 있으므로 reports에 넣지 않는다) ----------
    text_of = {a["answer_key"]: a["text"] for a in answers}
    step = max(1, len(excl) // rep["excluded_examples"])
    examples = excl[::step][:rep["excluded_examples"]]
    ctx = rep["example_context"]

    def snippet(key, m):
        t = text_of[key]
        s, e = m[0], m[1]
        return (t[max(0, s - ctx):s] + "【" + t[s:e] + "】" + t[e:e + ctx]).replace("\n", " ")

    write_csv(J(cfg["output"]["examples"]), ["rule", "answer_key", "term", "symptom_ids", "context"],
              [{"rule": rule, "answer_key": key, "term": m[2], "symptom_ids": "; ".join(sorted(dicts["v3"].terms[m[2]])),
                "context": snippet(key, m)} for key, rule, m in examples])
    excl_sym = defaultdict(Counter)   # 규칙 → 증상 id별 버려진 위치 수
    for _, rule, m in excl:
        for sid in dicts["v3"].terms[m[2]]:
            excl_sym[rule][sid] += 1
    single = sorted({sid for k, v in dicts["v3"].terms.items() if len(k) == 1 for sid in v})

    # ---------- 보고서: 증상 id·개수·규칙 이름만 (AI Hub 답변 문장·구절 없음) ----------
    L = []
    w = L.append
    w("# 3단계 S3-5 결과: 사전 v3와 질환별 증상")
    w("")
    w("`python pipeline/03c_merge_labels_t3.py` → `python pipeline/03c_match_all.py`로 만든다. LLM은 쓰지 않았다.")
    w("규칙: `config/v2_merge.yaml`(T1 규칙), `config/label_t3.yaml`, `config/match_all.yaml`, `config/symptom_match.yaml`, "
      "`config/symptom_exclusion.yaml`, `config/recommend.yaml`의 `path_a`")
    w("")
    w("## 1. T3 라벨 합치기")
    w("")
    w("| status | 개수 |")
    w("|---|---|")
    for s in ("agreed", "agreed_partial", "agreed_span", "none", "disagree"):
        w(f"| {s} | {t3['t3'].get(s, 0)} |")
    w(f"| 합계 | {t3['t3']['total']} |")
    w("")
    w(f"채택된 item {t3['adopted_items']}개. 라벨은 variants의 모든 표기에 적용했다.")
    w("")
    w(f"### 새로 추가된 증상 (v2.1): {len(t3['new_symptoms'])}개")
    w("")
    w(f"표준 증상 {t3['standard']['v2']} → {t3['standard']['v2_1']}행 (`data/processed/v3/standard_symptoms_v2_1.csv`). "
      "이름·119 범주는 v2 T2 라벨 합치기 결과를 그대로 썼다. 나머지 컬럼(body_part_ui, sex_restriction, icd10_3_list 등)도 "
      "01e와 같은 방법으로 채웠으므로 2A 규칙(code_specificity, 성별 필터, 치과 범위, 생식기 규칙)이 그대로 적용된다. 2A는 다시 돌리지 않았다.")
    w("")
    w("채택된 표현은 `data/processed/v3/term_to_symptom_T3.csv`에 있다.")
    w("")
    w("| symptom_id | name_ko | name_status | 화면 그룹 | 성별 | 119 범주 | 채택 표현 수 | 연결 질환(kept) |")
    w("|---|---|---|---|---|---|---|---|")
    for r in t3["new_symptoms"]:
        w(f"| {r['symptom_id']} | {r['name_ko']} | {r['name_status']} | {r['body_part_ui']} | {r['sex_restriction']} | "
          f"{r['triage_category'] or '-'} | {r['n_terms']} | {dis_per_sym.get(r['symptom_id'], 0)} |")
    w("")
    w("## 2. 사전 v2 → v3")
    w("")
    w(f"- 동의어 파일 행: {len(syn_v2)} → {len(syn_v3)} (T3 추가 {t3['synonyms']['added']}행, source=aihub_T3)")
    w(f"- 매칭에 쓰는 고유 표현(공백 제외, 동의어 + name_ko): {len(dicts['v2'].terms)} → {len(dicts['v3'].terms)}")
    w(f"- 한 글자 표현이 있는 증상: {', '.join(single) or '없음'} "
      f"(바로 뒤에 {'·'.join(matcher.single_next_list)} 중 하나가 붙을 때만 매칭)")
    w("")
    w("## 3. 전체 답변 매칭률")
    w("")
    w(f"증상 답변 {len(answers):,}개, 질환 {len(diseases)}개.")
    w("")
    w("| 사전 | 매칭 위치 수 | 제외된 위치 | 매칭 0개 답변(제외 전) | 매칭 0개 답변(제외 후) |")
    w("|---|---|---|---|---|")
    for v in ("v2", "v3"):
        zb, rb = zero_rate(v, False)
        za, ra = zero_rate(v)
        w(f"| {v} | {results[v][2]:,} | {len(results[v][1]):,} | {zb:,} ({rb:.1%}) | {za:,} ({ra:.1%}) |")
    w("")
    w("## 4. 제외 규칙으로 버려진 매칭 (v3)")
    w("")
    w(f"버려진 매칭 위치 {len(excl):,}개 / 전체 {n_raw:,}개.")
    w("")
    w("| 규칙 | 개수 |")
    w("|---|---|")
    for r in matcher.rules:
        w(f"| {r['id']} | {excl_by_rule.get(r['id'], 0):,} |")
    w("")
    w(f"규칙별로 버려진 위치가 많은 증상 (상위 {rep['excluded_examples']}개, 증상 id: 개수)")
    w("")
    w("| 규칙 | 증상 |")
    w("|---|---|")
    for r in matcher.rules:
        top = sorted(excl_sym[r["id"]].items(), key=lambda x: (-x[1], x[0]))[:rep["excluded_examples"]]
        w(f"| {r['id']} | {', '.join(f'{s}: {c}' for s, c in top) or '-'} |")
    w("")
    w(f"문맥이 있는 예시 {len(examples)}개는 `{cfg['output']['examples']}`에 있다(답변 문장이 들어 있어 커밋하지 않는다).")
    w("")
    w("## 5. 질환별 증상 (`data/processed/v3/disease_symptom.csv`)")
    w("")
    w(f"kept = share ≥ {pa['min_share']} 그리고 n_answers_mentioned ≥ min({pa['min_answers']}, n_symptom_answers). "
      f"span 표현은 {cfg['span_weight']}로 셌다.")
    w("")
    w(f"- 질환-증상 쌍 {len(ds_rows):,}개 중 kept {len(kept):,}개")
    kv = [kept_per_dis.get(d, 0) for d in diseases]
    w(f"- 질환당 kept 증상 수: 평균 {statistics.mean(kv):.2f}, 중앙값 {statistics.median(kv):g}, 최대 {max(kv)}")
    w("")
    w("| 질환당 kept 증상 수 | 질환 수 |")
    w("|---|---|")
    for k, _ in bins:
        w(f"| {k} | {stats['kept_per_disease_dist'][k]} |")
    w("")
    w(f"### kept 증상이 0개인 질환: {len(zero_dis)}개")
    w("")
    w(", ".join(f"{d}({n_ans[d]})" for d in zero_dis) if zero_dis else "없음")
    w("")
    w("(괄호 = 그 질환의 증상 답변 수)")
    w("")
    w("## 6. 증상별로 연결된 질환 수 (kept 기준)")
    w("")
    n = rep["top_n"]
    w(f"연결된 질환이 1개 이상인 증상 {len(sym_ranked)}개 / 표준 증상 {len(std)}개.")
    w("")
    w(f"### 상위 {n}")
    w("")
    w("| symptom_id | name_ko | 질환 수 |")
    w("|---|---|---|")
    for sid, c in sym_ranked[:n]:
        w(f"| {sid} | {name_of.get(sid, '')} | {c} |")
    w("")
    w(f"### 하위 {n} (1개 이상인 증상 중)")
    w("")
    w("| symptom_id | name_ko | 질환 수 |")
    w("|---|---|---|")
    for sid, c in sorted(sym_ranked, key=lambda x: (x[1], x[0]))[:n]:
        w(f"| {sid} | {name_of.get(sid, '')} | {c} |")
    w("")
    w(f"### 연결된 질환이 0개인 v2 증상: {len(v2_zero)}개 / {len(v2_ids)}개")
    w("")
    w("| symptom_id | name_ko | 비고 |")
    w("|---|---|---|")
    std_by = {r["symptom_id"]: r for r in std}
    for sid in v2_zero:
        r = std_by[sid]
        memo = "상위 증상(하위로 나뉨)" if r["is_parent"] == "true" else "예외 증상" if r["source"] == "exception" else ""
        w(f"| {sid} | {r['name_ko']} | {memo} |")
    w("")
    w(f"참고: v2.1 새 증상 중 연결된 질환이 0개인 것 {len(new_zero)}개: {', '.join(new_zero) or '없음'}")
    w("")
    os.makedirs(os.path.dirname(J(cfg["output"]["report"])), exist_ok=True)
    with open(J(cfg["output"]["report"]), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(L))
    print(f"저장: {cfg['output']['report']}")
    print(json.dumps({k: stats[k] for k in ("dict_terms", "matches", "excluded", "excluded_by_rule_v3", "zero_after",
                                            "zero_before", "kept_pairs", "kept_per_disease_dist")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
