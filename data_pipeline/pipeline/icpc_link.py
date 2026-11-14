"""표준 증상의 ICPC-2 연결 칸을 저장소 밖(data/interim)으로 나눠 두는 도우미 (ICPC-2 저작권 대응, 2026-11-14)

표준 증상 파일(data/processed/v2/standard_symptoms_v2.csv, v3/standard_symptoms_v2_1.csv)은 커밋되므로
ICPC-2e 원본에서 온 칸(영어 이름, ICD-10 연결표와 거기서 나온 값)은 빼고,
같은 행 순서의 연결 파일(data/interim/.../standard_icpc_link_*.csv, git 제외)에 따로 쓴다.
읽는 쪽은 merge()로 다시 붙여 예전과 같은 행을 얻는다. 연결 파일은 01e·03c를 돌리면 다시 만들어진다
(입력: data/raw/icpc2/icpc-2e-v7.0.xlsx → 01b, 상병마스터·심평원 통계 → 01c).
"""
import os
import sys

# 원래 표준 증상 파일의 컬럼 순서 (01e가 정한 순서)
FULL_COLS = ["symptom_id", "icpc2_code", "icpc2_preferred", "chapter", "chapter_ko", "name_ko", "name_status",
             "name_ko_alt", "body_part_ui", "sex_restriction", "icd10_list", "icd10_3_list", "kcd_name_ko",
             "hira_has_data", "hira_shared_code", "hira_shared_codes", "triage_category", "triage_status",
             "n_terms_agreed", "source", "parent_id", "is_parent", "note"]
# ICPC-2e 원본에서 온 칸: 영어 이름, ICD-10 연결표(전체·3자리), 연결된 코드의 상병명, 연결 코드 중 공유 코드
LINK_COLS = ["icpc2_preferred", "icd10_list", "icd10_3_list", "kcd_name_ko", "hira_shared_codes"]
STD_COLS = [c for c in FULL_COLS if c not in LINK_COLS]


def write(std_path, link_path, rows, write_csv):
    """rows(FULL_COLS 모양)를 표준 파일(코드·한국어 칸)과 연결 파일(symptom_id + LINK_COLS)로 나눠 쓴다."""
    extra = {k for r in rows for k in r} - set(FULL_COLS)
    if extra:   # csv.DictWriter와 같이 모르는 칸은 오류로 멈춘다
        sys.exit(f"표준 증상 행에 모르는 칸: {sorted(extra)}")
    # 빠진 칸은 csv.DictWriter의 기본값처럼 빈 문자열
    write_csv(std_path, STD_COLS, [{c: r.get(c, "") for c in STD_COLS} for r in rows])
    write_csv(link_path, ["symptom_id"] + LINK_COLS, [{c: r.get(c, "") for c in ["symptom_id"] + LINK_COLS} for r in rows])


def merge(std_rows, link_rows):
    """표준 파일 행에 연결 파일 칸을 다시 붙여 FULL_COLS 모양으로 돌려준다(행 순서는 표준 파일)."""
    by_id = {r["symptom_id"]: r for r in link_rows}
    if [r["symptom_id"] for r in std_rows] != [r["symptom_id"] for r in link_rows]:
        sys.exit("표준 증상 파일과 ICPC 연결 파일의 증상 목록·순서가 다름. 01e(또는 03c_merge_labels_t3)를 다시 돌릴 것")
    return [{c: (by_id[s["symptom_id"]][c] if c in LINK_COLS else s[c]) for c in FULL_COLS} for s in std_rows]


def link_path_for(std_path):
    """표준 파일 경로 → 연결 파일 경로 (data/processed/vN/standard_symptoms_X.csv → data/interim/vN/standard_icpc_link_X.csv)"""
    d, name = os.path.split(std_path)
    ver = os.path.basename(d)
    root = os.path.dirname(os.path.dirname(d))   # data/
    return os.path.join(root, "interim", ver, name.replace("standard_symptoms_", "standard_icpc_link_"))


def load_full(std_path, read_csv):
    """표준 파일 + 연결 파일을 읽어 FULL_COLS 모양 행 목록을 돌려준다."""
    lp = link_path_for(std_path)
    if not os.path.exists(lp):
        sys.exit(f"ICPC 연결 파일 없음: {lp} (01e 또는 03c_merge_labels_t3를 먼저 돌릴 것. ICPC-2e 원본 필요)")
    return merge(read_csv(std_path), read_csv(lp))
