"""다국어: 번역 원본(config/i18n_v1.csv, 넓은 표) → ref 시드 text_i18n.csv(긴 표) (접속 없음)

- 설계: care_engine/docs/다국어_설계.md. 한국어가 원본이고 이 표는 en·zh·vi·uz 번역만 담는다.
- 번역 원본은 care_engine/scripts/i18n_sync.mjs가 키 목록을 맞춘다(엔진 문구 키는 엔진에만 있으므로).
- 검사(하나라도 틀리면 저장하지 않고 종료):
  target·review_status 값, key 형식, 문구 길이, 자리 표시({0} 등)가 원문과 같은지,
  숫자(전화번호 119·109·112·1366, 24시간, 기간 등)가 원문과 같은지(사람 검토 없이 쓰므로 번호가 빠지거나 바뀌면 안 됨).
  item·option·symptom·department는 키가 시드에 있는지, 원문(source_ko)이 지금 시드의 한국어와 같은지.
- 원문이 바뀐 행·빈 번역은 오류가 아니라 건너뛰고 개수를 알린다(번역이 없으면 엔진은 한국어를 낸다).
- 같은 입력이면 같은 결과(정렬, utf-8-sig).
"""
import csv
import os
import re
import sys

from ruamel.yaml import YAML

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: os.path.join(ROOT, *p)  # noqa: E731

LOCALES = ["en", "zh", "vi", "uz"]
TARGETS = {"item", "option", "symptom", "department", "template"}
STATUSES = {"draft", "team_reviewed"}
KEY_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,120}$")
SLOT_RE = re.compile(r"\{(?:\d|symptom)\}")  # 11/18: {symptom}(문진 문구의 증상 이름 자리)도 원문과 같아야 한다
NUM_RE = re.compile(r"\d+")
COLS = ["target", "key", "locale", "text", "source_ko", "review_status", "data_version"]
LABEL_MAX = 300      # 질문·선택지·증상·진료과 문구(프론트 계약)
TEMPLATE_MAX = 1000  # 응급 안내 본문·요약 줄


def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def seed_sources(seed_dir):
    """시드에서 지금의 한국어 원문: (target, key) → text."""
    src = {}
    for r in read_csv(os.path.join(seed_dir, "questionnaire_item.csv")):
        src[("item", r["link_id"])] = r["text_ko"]
    for r in read_csv(os.path.join(seed_dir, "questionnaire_answer_option.csv")):
        src[("option", f"{r['link_id']}:{r['code']}")] = r["display_ko"]
    for r in read_csv(os.path.join(seed_dir, "symptom.csv")):
        src[("symptom", r["symptom_id"])] = r["name_ko"]
    for r in read_csv(os.path.join(seed_dir, "department.csv")):
        src[("department", r["dept_id"])] = r["name_ko"]
    return src


def build(rows, sources, ver):
    errors, out = [], []
    stats = {"rows": len(rows), "stale": 0, "empty": 0, "unknown_key": 0}
    seen = set()
    for i, r in enumerate(rows, start=2):
        at = f"{i}행 {r.get('target')}:{r.get('key')}"
        target, key, source_ko, status = r.get("target", ""), r.get("key", ""), r.get("source_ko", ""), r.get("review_status", "")
        if target not in TARGETS:
            errors.append(f"{at}: target 값")
            continue
        if not KEY_RE.match(key):
            errors.append(f"{at}: key 형식")
            continue
        if (target, key) in seen:
            errors.append(f"{at}: 중복")
            continue
        seen.add((target, key))
        if status not in STATUSES:
            errors.append(f"{at}: review_status 값")
        if not source_ko.strip():
            errors.append(f"{at}: source_ko 비어 있음")
            continue
        if target != "template":
            current = sources.get((target, key))
            if current is None:
                stats["unknown_key"] += 1
                errors.append(f"{at}: 시드에 없는 키")
                continue
            if current != source_ko:
                stats["stale"] += 1  # 원문이 바뀜 → 이 행의 번역은 쓰지 않는다
                continue
        limit = TEMPLATE_MAX if target == "template" else LABEL_MAX
        slots = sorted(SLOT_RE.findall(source_ko))
        for loc in LOCALES:
            text = (r.get(loc) or "").strip()
            if not text:
                stats["empty"] += 1
                continue
            if len(text) > limit:
                errors.append(f"{at} {loc}: {limit}자 초과")
                continue
            if sorted(SLOT_RE.findall(text)) != slots:
                errors.append(f"{at} {loc}: 자리 표시 {slots}가 원문과 다름")
                continue
            if sorted(NUM_RE.findall(SLOT_RE.sub("", text))) != sorted(NUM_RE.findall(SLOT_RE.sub("", source_ko))):
                errors.append(f"{at} {loc}: 숫자가 원문과 다름")
                continue
            out.append({"target": target, "key": key, "locale": loc, "text": text, "source_ko": source_ko,
                        "review_status": status, "data_version": ver})
    out.sort(key=lambda x: (x["target"], x["key"], x["locale"]))
    return out, errors, stats


def main():
    yaml = YAML(typ="safe")
    with open(J("config", "seed.yaml"), encoding="utf-8") as f:
        seed = yaml.load(f)
    ver, seed_dir = seed["data_version"], J(seed["seed_dir"])
    rows = read_csv(J("config", "i18n_v1.csv"))
    out, errors, stats = build(rows, seed_sources(seed_dir), ver)
    if errors:
        for e in errors[:50]:
            print("번역 검사 오류:", e)
        print(f"오류 {len(errors)}개 — 저장하지 않음")
        sys.exit(1)
    p = os.path.join(seed_dir, "text_i18n.csv")
    with open(p, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS, lineterminator="\n")
        w.writeheader()
        w.writerows(out)
    by_loc = {loc: sum(1 for x in out if x["locale"] == loc) for loc in LOCALES}
    print(f"번역 검사 통과: 원본 {stats['rows']}행, 원문 바뀜 {stats['stale']}행(건너뜀), 빈 번역 {stats['empty']}칸")
    print(f"저장: {os.path.relpath(p, ROOT)} ({len(out)}행: " + ", ".join(f"{k} {v}" for k, v in by_loc.items()) + ")")


if __name__ == "__main__":
    main()
