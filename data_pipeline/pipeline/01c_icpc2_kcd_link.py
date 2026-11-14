"""v2 P1-2: ICPC-2 증상 코드의 ICD-10 → KCD(상병마스터)·심평원 통계 연결 확인
→ data/interim/v2/icpc2_kcd_link.csv

    python pipeline/01c_icpc2_kcd_link.py      (01b를 먼저 돌려야 함)

- 한 행 = ICPC 코드 1개 × ICD-10 코드 1개 (320개 코드 전부. excluded 칸으로 구분)
- 상병마스터: 상병기호는 점 없는 표기(R10.4 → R104). 같은 코드에 행이 여러 개면 첫 행이 대표명.
- 심평원 통계: 주상병코드가 3자리뿐이라 icd10_3 기준으로 환자수 합계를 붙인다.
- 공유 표시는 excluded=false인 코드끼리만 계산한다 (제외된 코드는 빈칸).
    icd10_3_shared_with : 이 행의 3자리 코드를 함께 쓰는 다른 ICPC 코드 (행 단위)
    hira_shared_code    : 이 증상의 3자리 코드 중 하나라도 다른 ICPC 코드와 겹치면 true (증상 단위)
    hira_shared_codes   : 겹치는 3자리 코드 목록 (증상 단위)
  겹치는 코드는 심평원 통계로 증상끼리 구분할 수 없다.
- 멱등: 코드 순 정렬, utf-8-sig
"""
import csv
import os
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, os.environ.get("MH_RAW_DIR") or os.path.join("data", "raw"))  # MH_RAW_DIR가 있으면 그 경로
V2 = os.path.join(ROOT, "data", "interim", "v2")
SRC = os.path.join(V2, "icpc2_symptoms_all.csv")
OUT = os.path.join(V2, "icpc2_kcd_link.csv")
EXPECTED_SHARED_BUNDLES = 79  # 3자리 코드 하나 = 묶음 하나. 다르면 멈춘다.

COLS = ["code", "excluded", "icd10", "kcd_code", "in_master", "kcd_name_ko",
        "icd10_3", "in_master_3", "kcd_name_ko_3",
        "hira_clinic_patients", "hira_hospital_patients", "in_hira_clinic", "in_hira_hospital",
        "icd10_3_shared_with", "hira_shared_code", "hira_shared_codes"]


def find_raw(*keywords):
    for fn in sorted(os.listdir(RAW)):
        if fn.lower().endswith(".csv") and all(k in fn for k in keywords):
            return os.path.join(RAW, fn)
    raise FileNotFoundError(f"{RAW}에서 {keywords} 파일을 찾을 수 없음")


def read_csv(path):
    for enc in ("cp949", "utf-8-sig"):
        try:
            with open(path, encoding=enc, newline="") as f:
                return list(csv.DictReader(f))
        except UnicodeDecodeError:
            continue
    raise RuntimeError(f"인코딩을 알 수 없음: {path}")


def to_int(s):
    s = (s or "").replace(",", "").replace(" ", "").strip()
    return int(float(s)) if s else 0


def load_master():
    names = {}
    for r in read_csv(find_raw("상병마스터")):
        c = r["상병기호"].strip().upper()
        if c and c not in names:
            names[c] = r["한글명"].strip()
    return names


def load_patients(path):
    out = defaultdict(int)
    for r in read_csv(path):
        out[r["주상병코드"].strip().upper()[:3]] += to_int(r["환자수"])
    return out


def b(v):
    return "true" if v else "false"


def main():
    if not os.path.exists(SRC):
        sys.exit(f"{SRC} 없음. pipeline/01b_icpc2_extract.py를 먼저 돌릴 것.")
    with open(SRC, encoding="utf-8-sig", newline="") as f:
        symptoms = list(csv.DictReader(f))
    master = load_master()
    clinic = load_patients(find_raw("의원급", "표시과목"))
    hospital = load_patients(find_raw("병원급", "진료과목"))

    users = defaultdict(list)  # 3자리 코드 → 그 코드를 쓰는 ICPC 코드 (excluded=false만)
    for s in symptoms:
        if s["excluded"] == "false":
            for c3 in filter(None, s["icd10_3_list"].split("; ")):
                users[c3].append(s["code"])
    shared = {c3: codes for c3, codes in users.items() if len(codes) > 1}
    if len(shared) != EXPECTED_SHARED_BUNDLES:
        sys.exit(f"공유 묶음 수가 다름 (기대 {EXPECTED_SHARED_BUNDLES}, 실제 {len(shared)}). 파일을 쓰지 않고 멈춤.")

    rows = []
    for s in symptoms:
        kept = s["excluded"] == "false"
        mine = [c3 for c3 in filter(None, s["icd10_3_list"].split("; ")) if c3 in shared] if kept else []
        for icd in filter(None, s["icd10_list"].split("; ")):
            kcd, c3 = icd.replace(".", ""), icd[:3]
            rows.append({
                "code": s["code"], "excluded": s["excluded"], "icd10": icd, "kcd_code": kcd,
                "in_master": b(kcd in master), "kcd_name_ko": master.get(kcd, ""),
                "icd10_3": c3, "in_master_3": b(c3 in master), "kcd_name_ko_3": master.get(c3, ""),
                "hira_clinic_patients": clinic.get(c3, 0), "hira_hospital_patients": hospital.get(c3, 0),
                "in_hira_clinic": b(c3 in clinic), "in_hira_hospital": b(c3 in hospital),
                "icd10_3_shared_with": "; ".join(x for x in shared.get(c3, []) if x != s["code"]) if kept else "",
                "hira_shared_code": b(mine) if kept else "",
                "hira_shared_codes": "; ".join(mine),
            })
    rows.sort(key=lambda r: (r["code"], r["icd10"]))

    with open(OUT, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        w.writeheader()
        w.writerows(rows)

    kept_rows = [r for r in rows if r["excluded"] == "false"]
    uniq = lambda key, cond: sorted({r[key] for r in kept_rows if cond(r)})
    print(f"저장: {OUT} ({len(rows)}행, 그중 excluded=false {len(kept_rows)}행)")
    print("공유 묶음(3자리 코드):", len(shared),
          "/ 공유 코드가 있는 증상:", len({r["code"] for r in kept_rows if r["hira_shared_code"] == "true"}))
    print("[excluded=false 기준]")
    print("상병마스터에 없는 ICD-10 코드:", uniq("icd10", lambda r: r["in_master"] == "false"))
    print("상병마스터에 없는 3자리 코드:", uniq("icd10_3", lambda r: r["in_master_3"] == "false"))
    print("의원급 통계에 없는 3자리 코드:", uniq("icd10_3", lambda r: r["in_hira_clinic"] == "false"))
    print("병원급 통계에 없는 3자리 코드:", uniq("icd10_3", lambda r: r["in_hira_hospital"] == "false"))


if __name__ == "__main__":
    main()
