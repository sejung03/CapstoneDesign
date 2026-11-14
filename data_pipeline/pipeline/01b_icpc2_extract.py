"""v2 P1-1: ICPC-2 증상 코드(component 1) 추출 → data/interim/v2/icpc2_symptoms_all.csv

    python pipeline/01b_icpc2_extract.py

- 입력: data/raw/icpc2/icpc-2e-v7.0.xlsx (읽기만 함. 환경 변수 MH_RAW_DIR가 있으면 그 폴더의 icpc2/)
- 규칙·검증값: config/icpc2_filter.yaml
- 검증값과 다르면 파일을 쓰지 않고 종료 코드 1로 멈춘다.
- 멱등: 같은 입력이면 같은 출력 (코드 순 정렬, utf-8-sig)
"""
import csv
import os
import re
import sys
import warnings

import openpyxl
from ruamel.yaml import YAML

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, os.environ.get("MH_RAW_DIR") or os.path.join("data", "raw"))
XLSX = os.path.join(RAW, "icpc2", "icpc-2e-v7.0.xlsx")
CONFIG = os.path.join(ROOT, "config", "icpc2_filter.yaml")
OUT_DIR = os.path.join(ROOT, "data", "interim", "v2")
OUT = os.path.join(OUT_DIR, "icpc2_symptoms_all.csv")

CHAPTER_KO = {
    "A": "전신", "B": "혈액", "D": "소화기", "F": "눈", "H": "귀", "K": "순환기", "L": "근골격",
    "N": "신경", "P": "정신", "R": "호흡기", "S": "피부", "T": "내분비·대사", "U": "비뇨",
    "W": "임신·출산·가족계획", "X": "여성 생식기", "Y": "남성 생식기", "Z": "사회 문제",
}
COLS = ["code", "chapter", "chapter_ko", "preferred", "short_title", "inclusion", "exclusion",
        "icd10_list", "icd10_3_list", "excluded", "excluded_reason"]


def load_rows():
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # openpyxl의 '알 수 없는 확장' 경고
        wb = openpyxl.load_workbook(XLSX, read_only=True)
        rows = list(wb.worksheets[0].iter_rows(values_only=True))
        wb.close()
    head = [str(h).strip() for h in rows[0]]
    return [dict(zip(head, r)) for r in rows[1:]]


def clean(v):
    return "" if v is None else str(v).strip()


def split_icd(v):
    """'R52.0; R52.1' → ['R52.0', 'R52.1'] (순서 유지, 중복 제거). 원본에 ','로 나뉜 칸이 1개 있어 함께 처리"""
    out = []
    for p in re.split(r"\s*[;,]\s*", clean(v)):
        p = p.strip().upper()
        if p and p not in out:
            out.append(p)
    return out


def main():
    with open(CONFIG, encoding="utf-8") as f:
        cfg = YAML(typ="safe", pure=True).load(f)
    c1 = cfg["component1"]
    pat = re.compile(c1["code_pattern"])
    rules = cfg["exclude"]

    items = []
    for r in load_rows():
        code = clean(r.get("Code")).upper()
        if not pat.match(code) or not (c1["number_min"] <= int(code[1:]) <= c1["number_max"]):
            continue
        pref = clean(r.get("preferred"))
        reasons = []
        if code[0] in (rules.get("chapters") or {}):
            reasons.append(rules["chapters"][code[0]])
        for prefix, reason in (rules.get("preferred_prefixes") or {}).items():
            if pref.startswith(prefix) and reason not in reasons:
                reasons.append(reason)
        extra = (rules.get("codes") or {}).get(code)
        if extra and extra not in reasons:
            reasons.append(extra)
        icd = split_icd(r.get("icd10"))
        icd3 = []
        for c in icd:
            if c[:3] not in icd3:
                icd3.append(c[:3])
        items.append({
            "code": code, "chapter": code[0], "chapter_ko": CHAPTER_KO.get(code[0], "확인 필요"),
            "preferred": pref, "short_title": clean(r.get("shortTitle")),
            "inclusion": clean(r.get("inclusion")), "exclusion": clean(r.get("exclusion")),
            "icd10_list": "; ".join(icd), "icd10_3_list": "; ".join(icd3),
            "excluded": "true" if reasons else "false", "excluded_reason": ";".join(reasons),
        })
    items.sort(key=lambda x: x["code"])

    got = {"component1": len(items), "remaining": sum(x["excluded"] == "false" for x in items)}
    for reason in list((rules.get("chapters") or {}).values()) + list((rules.get("preferred_prefixes") or {}).values()):
        got[reason] = sum(reason in x["excluded_reason"].split(";") for x in items)
    exp = cfg["expected"]
    diff = {k: (exp[k], got.get(k)) for k in exp if exp[k] != got.get(k)}
    print("집계:", got)
    if diff:
        print("검증값과 다름 (기대, 실제):", diff)
        print("파일을 쓰지 않고 멈춤. config/icpc2_filter.yaml의 규칙 또는 expected를 확인할 것.")
        sys.exit(1)

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        w.writeheader()
        w.writerows(items)
    print(f"저장: {OUT} ({len(items)}행, 남은 코드 {got['remaining']})")


if __name__ == "__main__":
    main()
