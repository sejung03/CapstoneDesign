"""3단계 S3-2: 증상 답변 전체에서 후보 구절을 규칙으로 뽑는다 (LLM을 쓰지 않는다)

    python pipeline/03b_candidate_phrases.py

- 규칙: config/phrase_extract.yaml (문장 나누기 → 나열 항목 → 다듬기 → 길이·종류 거르기)
- 추가 출처: Claude 직접 추출 결과의 고유 구절. source = script / claude_read / both
- 빈도는 두 출처 모두 같은 방법으로 다시 센다 (config/symptom_match.yaml의 왼쪽 경계·공백 무시)
    n_answers  : 그 구절이 나온 서로 다른 답변 수
    n_diseases : 그 답변들의 질환 수
- known: 기존 사전(v2 동의어 term + name_ko)과 같은 구절
- 출력: data/interim/v3/candidate_phrases.csv  (phrase, source, n_answers, n_diseases, known, example)
    답변 본문 일부(example)가 들어 있으므로 커밋하지 않는다.
- 보고(기준값별 개수, 상위 구절, Codex 부분 결과로 본 재현율)는 화면에만 찍는다. 파일로 남기지 않는다.
- 멱등: 답변은 answer_key 순으로 읽고, 출력은 n_answers 내림차순 → phrase 순으로 쓴다.
"""
import csv
import io
import os
import re
import sys
from collections import defaultdict

from ruamel.yaml import YAML

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: os.path.join(ROOT, *p)  # noqa: E731
WS = re.compile(r"\s+")
HANGUL = re.compile(r"[가-힣]")


def load_yaml(path):
    if not os.path.exists(path):
        sys.exit(f"설정 파일 없음: {path}")
    with open(path, encoding="utf-8") as f:
        return YAML(typ="safe", pure=True).load(f) or {}


def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def norm(s):
    """매칭용: 공백을 모두 뺀다 (ignore_inner_whitespace)."""
    return WS.sub("", s)


def has_batchim(ch):
    """한글 음절의 받침 번호(0=없음, 8=ㄹ). 한글이 아니면 None."""
    if not ("가" <= ch <= "힣"):
        return None
    return (ord(ch) - 0xAC00) % 28


class Extractor:
    def __init__(self, cfg):
        self.sent_re = re.compile("[" + re.escape("".join(cfg["sentence_delimiters"])) + "]")
        sp = cfg["item_split"]
        parts = ["[" + re.escape("".join(sp["chars"])) + "]"]
        if sp.get("words"):
            parts.append(r"(?:(?<=\s)|^)(?:" + "|".join(map(re.escape, sp["words"])) + r")(?=\s)")
        if sp.get("particles"):
            parts.append(r"(?<=[가-힣])(?:" + "|".join(map(re.escape, sp["particles"])) + r")(?=\s)")
        self.item_re = re.compile("|".join(parts))
        t = cfg["trim"]
        self.strip_chars = t["strip_chars"]
        self.trailing = sorted(t["trailing_words"], key=len, reverse=True)
        self.trailing_need_space = bool(t.get("trailing_words_need_space"))
        self.particles = sorted(t["particles"], key=len, reverse=True)
        self.batchim_check = bool(t.get("particle_batchim_check"))
        self.keep_endings = tuple(t.get("particle_keep_endings") or [])
        self.min_len, self.max_len = cfg["length"]["min"], cfg["length"]["max"]
        self.drop_digits = bool(cfg.get("drop_digits_only"))
        self.drop_english = bool(cfg.get("drop_english_only"))

    def sentences(self, text):
        return [s for s in self.sent_re.split(text) if s.strip()]

    def _particle_ok(self, particle, prev):
        if not self.batchim_check:
            return True
        b = has_batchim(prev)
        if b is None:           # 숫자·영문·기호 뒤: 판단하지 않고 뗀다
            return True
        if particle in ("이", "은", "을", "으로"):
            return b != 0
        if particle in ("가", "는", "를"):
            return b == 0
        if particle == "로":
            return b in (0, 8)
        return True             # 도, 의

    def trim(self, item):
        s = WS.sub(" ", item).strip(self.strip_chars)
        for w in self.trailing:                       # 끝 낱말 한 번
            if s.endswith(w) and len(s) > len(w):
                head = s[: -len(w)]
                if self.trailing_need_space and not head.endswith(" "):
                    continue
                s = head.strip(self.strip_chars)
                break
        if not s.endswith(self.keep_endings):
            for p in self.particles:                  # 끝 조사 한 번
                if s.endswith(p) and len(s) > len(p) and self._particle_ok(p, s[-len(p) - 1]):
                    s = s[: -len(p)].strip(self.strip_chars)
                    break
        return s

    def keep(self, s):
        if not (self.min_len <= len(s) <= self.max_len):
            return False
        if self.drop_digits and not re.search(r"[A-Za-z가-힣]", s):
            return False
        if self.drop_english and not HANGUL.search(s):
            return False
        return True

    def items(self, text):
        for sent in self.sentences(text):
            for raw in self.item_re.split(sent):
                s = self.trim(raw)
                if s and self.keep(s):
                    yield s


def count_frequencies(answers, norms, blocked_re, sent_re):
    """norms(공백 뺀 구절)마다 답변 수·질환 집합·예문 하나.

    왼쪽 경계: 구절 바로 앞이 글 처음이거나 공백이거나 blocked 글자가 아닐 때만 센다.
    """
    by_prefix = defaultdict(set)
    for n in norms:
        by_prefix[n[:2]].add(len(n))
    by_prefix = {k: sorted(v) for k, v in by_prefix.items()}
    n_answers = defaultdict(int)
    diseases = defaultdict(set)
    example = {}
    for a_idx, row in enumerate(answers):
        text = row["text"]
        pos = [i for i, ch in enumerate(text) if not ch.isspace()]
        s = "".join(text[i] for i in pos)
        found = {}
        for i in range(len(s) - 1):
            lens = by_prefix.get(s[i:i + 2])
            if not lens:
                continue
            if i and pos[i] == pos[i - 1] + 1 and blocked_re.match(s[i - 1]):
                continue
            for ln in lens:
                cand = s[i:i + ln]
                if len(cand) < ln:
                    break
                if cand in norms and cand not in found:
                    found[cand] = pos[i]
        for n, at in found.items():
            n_answers[n] += 1
            diseases[n].add(row["disease_ko"])
            if n not in example:
                left = max((m.end() for m in sent_re.finditer(text, 0, at)), default=0)
                m = sent_re.search(text, at)
                right = m.start() if m else len(text)
                example[n] = WS.sub(" ", text[left:right]).strip()
    return n_answers, diseases, example


def main():
    if hasattr(sys.stdout, "buffer"):
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    cfg = load_yaml(J("config", "phrase_extract.yaml"))
    match = load_yaml(J("config", "symptom_match.yaml"))
    min_term = int(cfg.get("min_phrase_length") or 1)
    lb = match.get("left_boundary") or {}
    blocked_re = re.compile("[" + lb["blocked_before"] + "]") if lb.get("enabled") else re.compile(r"(?!x)x")

    answers = sorted(read_csv(J(*cfg["input"]["answers"].split("/"))), key=lambda r: r["answer_key"])
    ex = Extractor(cfg)

    # 1~4. 규칙 추출
    script = set()
    for row in answers:
        script.update(ex.items(row["text"]))
    script = {p for p in script if len(norm(p)) >= min_term}

    # 5. Claude 직접 추출 결과
    cr = cfg["claude_read"]
    claude_all = {r[cr["column"]].strip() for r in read_csv(J(*cr["path"].split("/")))} - {""}
    claude = {p for p in claude_all if len(norm(p)) >= min_term}
    claude_short = sorted(claude_all - claude)

    phrases = script | claude
    norms = {norm(p) for p in phrases}

    # 6. 빈도
    n_answers, diseases, example = count_frequencies(answers, norms, blocked_re, ex.sent_re)

    # 7. known
    known_raw = {r["term"].strip() for r in read_csv(J(*cfg["input"]["synonyms"].split("/")))}
    known_raw |= {r["name_ko"].strip() for r in read_csv(J(*cfg["input"]["standard"].split("/")))}
    known_raw.discard("")
    if cfg.get("known_ignore_whitespace"):
        known_norm = {norm(k) for k in known_raw}
        is_known = lambda p: norm(p) in known_norm  # noqa: E731
    else:
        is_known = lambda p: p in known_raw  # noqa: E731

    rows = []
    for p in phrases:
        n = norm(p)
        src = "both" if (p in script and p in claude) else ("script" if p in script else "claude_read")
        rows.append({"phrase": p, "source": src, "n_answers": n_answers.get(n, 0),
                     "n_diseases": len(diseases.get(n, ())), "known": "true" if is_known(p) else "false",
                     "example": example.get(n, "")})
    rows.sort(key=lambda r: (-r["n_answers"], r["phrase"]))
    out = J(*cfg["output"].split("/"))
    with open(out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["phrase", "source", "n_answers", "n_diseases", "known", "example"])
        w.writeheader()
        w.writerows(rows)
    print(f"저장: {os.path.relpath(out, ROOT)} ({len(rows)}행)")

    # ---------- 보고 (화면에만) ----------
    rep = cfg.get("report") or {}
    by_src = defaultdict(int)
    for r in rows:
        by_src[r["source"]] += 1
    n_known = sum(r["known"] == "true" for r in rows)
    print(f"\n답변 {len(answers)}개 / 고유 구절 {len(rows)} / known {n_known}")
    print(f"source: script만 {by_src['script']} / claude_read만 {by_src['claude_read']} / both {by_src['both']}")
    print(f"공백만 다른 구절을 하나로 보면 {len(norms)}개")
    if claude_short:
        print(f"min_phrase_length({min_term})보다 짧아 뺀 Claude 구절 {len(claude_short)}개: {', '.join(claude_short)}")
    unknown = [r for r in rows if r["known"] == "false"]
    print("\nknown이 아닌 구절의 n_answers 기준값별 개수")
    suggested = None
    for t in rep.get("thresholds") or []:
        c = sum(r["n_answers"] >= t for r in unknown)
        cn = len({norm(r["phrase"]) for r in unknown if r["n_answers"] >= t})
        print(f"  >= {t:>2}: {c}개 (공백만 다른 것을 합치면 {cn})")
    budget = rep.get("label_budget")
    if budget:
        counts = sorted((r["n_answers"] for r in unknown), reverse=True)
        t = 1
        while sum(c >= t for c in counts) > budget:
            t += 1
        suggested = t
        print(f"  라벨링 대상이 {budget}개 이하가 되는 가장 낮은 기준값: n_answers >= {t} "
              f"({sum(c >= t for c in counts)}개, 바로 아래 >= {t - 1}: {sum(c >= t - 1 for c in counts)}개)")
    if suggested:
        top = [r for r in unknown if r["n_answers"] >= suggested][: rep.get("top_n", 50)]
        print(f"\n기준값 {suggested}에서 상위 {len(top)}개 (known 제외)")
        for i, r in enumerate(top, 1):
            print(f"  {i:>2}. {r['phrase']} | {r['source']} | 답변 {r['n_answers']} | 질환 {r['n_diseases']}")

    cx_path = rep.get("codex_path") and J(*rep["codex_path"].split("/"))
    if cx_path and os.path.exists(cx_path):
        codex = {r["phrase"].strip() for r in read_csv(cx_path)} - {""}
        script_n, claude_n = {norm(p) for p in script}, {norm(p) for p in claude}
        in_all = {p for p in codex if p in phrases}
        in_script = {p for p in codex if p in script}
        in_all_n = {p for p in codex if norm(p) in script_n | claude_n}
        in_script_n = {p for p in codex if norm(p) in script_n}
        print(f"\n재현율 검증 (Codex 부분 결과 고유 구절 {len(codex)}개)")
        print(f"  후보(script + claude_read)에 포함: {len(in_all)} ({len(in_all) / len(codex):.1%})"
              f" / 공백 무시 {len(in_all_n)} ({len(in_all_n) / len(codex):.1%})")
        print(f"  script만으로 포함: {len(in_script)} ({len(in_script) / len(codex):.1%})"
              f" / 공백 무시 {len(in_script_n)} ({len(in_script_n) / len(codex):.1%})")
        missed = sorted(codex - in_all_n)
        print(f"  포함 안 된 구절 {len(missed)}개 중 20개: {' / '.join(missed[:: max(1, len(missed) // 20)][:20])}")
        missed_s = sorted(codex - in_script_n)
        print(f"  script에 없는 구절 {len(missed_s)}개 중 20개: {' / '.join(missed_s[:: max(1, len(missed_s) // 20)][:20])}")


if __name__ == "__main__":
    main()
