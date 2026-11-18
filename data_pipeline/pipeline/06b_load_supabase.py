"""6·7단계: 시드 CSV를 Supabase ref 스키마에 넣는다.

    python pipeline/06b_load_supabase.py --dry-run   # 접속 없이: 시드 행 수, SQL과 컬럼 순서, FK 검사
    python pipeline/06b_load_supabase.py             # 실제 적재 (pip install "psycopg[binary]")

- 시드: config/seed.yaml의 seed_dir (db/seed/<data_version>/*.csv, pipeline/06a_build_seed.py가 만듦)
- 스키마: db/migrations/001_ref_schema.sql, 001b_ref_functions.sql이 먼저 실행되어 있어야 한다(이 스크립트는 실행하지 않음)
- 접속: data_pipeline/.env의 SUPABASE_DB_URL을 변수로만 읽는다. 주소·키·비밀번호는 화면·로그에 찍지 않는다.
- 한 트랜잭션: 같은 data_version 행 삭제(FK 역순) → 테이블 순서대로 COPY(FK 순서) → 행 수 확인 → 커밋.
  다른 data_version 행이 있으면 넣지 않고 멈춘다(PK가 겹치므로 버전 교체는 따로 정한다).
"""
import argparse
import csv
import io
import json
import os
import re
import sys
from collections import defaultdict

from ruamel.yaml import YAML

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: os.path.join(ROOT, *p)  # noqa: E731
csv.field_size_limit(10 ** 8)

# 적재 순서 (FK 순서)
ORDER = ["data_version", "source", "department", "triage_category", "symptom", "symptom_synonym",
         "symptom_department", "symptom_department_variant", "fallback_department", "app_config",
         # D5 문진 (003_ref_intake.sql, pipeline/06d_build_intake_seed.py)
         "questionnaire", "questionnaire_item", "questionnaire_answer_option", "questionnaire_enable_when",
         "safety_rule", "safety_rule_condition", "output_mapping", "item_topic",
         # 다국어 번역 (005_ref_i18n.sql, pipeline/06f_build_i18n_seed.py)
         "text_i18n"]
# 컬럼 순서 검사용(실행 순서대로). 004는 ref.symptom의 ICPC 원본 칸을 뺀다
MIGRATIONS = ["001_ref_schema.sql", "003_ref_intake.sql", "004_drop_icpc_text.sql", "005_ref_i18n.sql"]
# (테이블, 컬럼) → (참조 테이블, 참조 컬럼)
FK = [
    ("source", "data_version", "data_version", "version"),
    ("department", "data_version", "data_version", "version"),
    ("triage_category", "data_version", "data_version", "version"),
    ("symptom", "parent_id", "symptom", "symptom_id"),
    ("symptom", "source_id", "source", "source_id"),
    ("symptom", "data_version", "data_version", "version"),
    ("symptom_synonym", "symptom_id", "symptom", "symptom_id"),
    ("symptom_synonym", "source_id", "source", "source_id"),
    ("symptom_synonym", "data_version", "data_version", "version"),
    ("symptom_department", "symptom_id", "symptom", "symptom_id"),
    ("symptom_department", "rec1_dept_id", "department", "dept_id"),
    ("symptom_department", "rec2_dept_id", "department", "dept_id"),
    ("symptom_department", "rec3_dept_id", "department", "dept_id"),
    ("symptom_department", "top_a", "department", "dept_id"),
    ("symptom_department", "top_b", "department", "dept_id"),
    ("symptom_department", "data_version", "data_version", "version"),
    ("symptom_department_variant", "symptom_id", "symptom", "symptom_id"),
    ("symptom_department_variant", "dept_id", "department", "dept_id"),
    ("symptom_department_variant", "data_version", "data_version", "version"),
    ("fallback_department", "dept_id", "department", "dept_id"),
    ("fallback_department", "data_version", "data_version", "version"),
    ("app_config", "data_version", "data_version", "version"),
    ("questionnaire", "data_version", "data_version", "version"),
    ("questionnaire_item", "questionnaire_id", "questionnaire", "id"),
    ("questionnaire_item", "data_version", "data_version", "version"),
    ("questionnaire_answer_option", "link_id", "questionnaire_item", "link_id"),
    ("questionnaire_answer_option", "data_version", "data_version", "version"),
    ("questionnaire_enable_when", "link_id", "questionnaire_item", "link_id"),
    ("questionnaire_enable_when", "question", "questionnaire_item", "link_id"),
    ("questionnaire_enable_when", "data_version", "data_version", "version"),
    ("safety_rule", "triage_category_id", "triage_category", "id"),
    ("safety_rule", "data_version", "data_version", "version"),
    ("safety_rule_condition", "rule_id", "safety_rule", "rule_id"),
    ("safety_rule_condition", "question", "questionnaire_item", "link_id"),
    ("safety_rule_condition", "data_version", "data_version", "version"),
    ("output_mapping", "question", "questionnaire_item", "link_id"),
    ("output_mapping", "rule_id", "safety_rule", "rule_id"),
    ("output_mapping", "data_version", "data_version", "version"),
    ("item_topic", "question", "questionnaire_item", "link_id"),
    ("item_topic", "data_version", "data_version", "version"),
    ("text_i18n", "data_version", "data_version", "version"),
]
PK = {"data_version": ["version"], "source": ["source_id"], "department": ["dept_id"], "triage_category": ["id"],
      "symptom": ["symptom_id"], "symptom_synonym": ["id"], "symptom_department": ["symptom_id"],
      "symptom_department_variant": ["symptom_id", "sex", "age_band", "rank"],
      "fallback_department": ["grp", "rank"], "app_config": ["key"],
      "questionnaire": ["id"], "questionnaire_item": ["link_id"], "questionnaire_answer_option": ["link_id", "code"],
      "questionnaire_enable_when": ["id"], "safety_rule": ["rule_id"], "safety_rule_condition": ["id"],
      "output_mapping": ["id"], "item_topic": ["id"], "text_i18n": ["target", "key", "locale"]}


def load_yaml(path):
    with open(path, encoding="utf-8") as f:
        return YAML(typ="safe", pure=True).load(f) or {}


def read_seed(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        r = csv.DictReader(f)
        return r.fieldnames, list(r)


def sql_columns(sql_path, out=None):
    """마이그레이션의 create table에서 테이블별 컬럼 순서를 읽고, alter table ... drop column을 반영한다."""
    with open(sql_path, encoding="utf-8") as f:
        sql = f.read()
    out = {} if out is None else out
    for m in re.finditer(r"alter table ref\.(\w+) drop column if exists (\w+);", sql):
        if m.group(2) in out.get(m.group(1), []):
            out[m.group(1)].remove(m.group(2))
    for m in re.finditer(r"create table if not exists ref\.(\w+) \((.*?)\n\);", sql, re.S):
        cols = []
        for line in m.group(2).split("\n"):
            line = line.strip()
            if not line or line.startswith("--"):
                continue
            tok = line.split()[0]
            # 제약 줄과 여러 줄 check의 이어지는 줄(or/and/괄호로 시작)은 컬럼이 아니다
            if tok.lower() in ("check", "primary", "unique", "foreign", "constraint", "or", "and") or tok.startswith("("):
                continue
            cols.append(tok)
        out[m.group(1)] = cols
    return out


def dry_run(seed_dir, ver):
    problems = []
    cols_sql = {}
    for m in MIGRATIONS:   # 실행 순서대로: create table → 이후 drop column 반영
        sql_columns(J("db", "migrations", m), cols_sql)
    data = {}
    print(f"시드: {os.path.relpath(seed_dir, ROOT)}")
    print("| 테이블 | 행 수 | SQL 컬럼 순서 |")
    print("|---|---|---|")
    for t in ORDER:
        p = os.path.join(seed_dir, f"{t}.csv")
        if not os.path.exists(p):
            problems.append(f"시드 파일 없음: {t}.csv")
            continue
        cols, rows = read_seed(p)
        data[t] = rows
        same = cols == cols_sql.get(t)
        if not same:
            problems.append(f"{t}: 시드 컬럼 {cols} ≠ SQL {cols_sql.get(t)}")
        if any(r.get("data_version", ver) != ver for r in rows) or (t == "data_version" and rows[0]["version"] != ver):
            problems.append(f"{t}: data_version이 {ver}가 아닌 행")
        keys = [tuple(r[c] for c in PK[t]) for r in rows]
        if len(set(keys)) != len(keys):
            problems.append(f"{t}: PK 중복")
        print(f"| {t} | {len(rows)} | {'같음' if same else '다름'} |")
    fk_bad = defaultdict(set)
    for t, c, rt, rc in FK:
        if t not in data or rt not in data:
            continue
        ref = {r[rc] for r in data[rt]}
        for r in data[t]:
            if r[c] and r[c] not in ref:
                fk_bad[f"{t}.{c} → {rt}.{rc}"].add(r[c])
    # jsonb 순위 안의 dept_id, 배열 안의 119 범주
    depts = {r["dept_id"] for r in data.get("department", [])}
    tri = {r["id"] for r in data.get("triage_category", [])}
    for r in data.get("symptom_department", []):
        for col in ("clinic_ranking", "hospital_ranking"):
            for x in json.loads(r[col] or "[]"):
                if x["dept_id"] not in depts:
                    fk_bad[f"symptom_department.{col}[].dept_id → department.dept_id"].add(x["dept_id"])
    for r in data.get("symptom", []):
        for x in (r["triage_category_ids"].strip("{}").split(",") if r["triage_category_ids"] else []):
            if x not in tri:
                fk_bad["symptom.triage_category_ids[] → triage_category.id"].add(x)
    print()
    print(f"FK 검사: {len(FK)}개 FK + 순위 JSON dept_id + 119 범주 배열 → " + ("이상 없음" if not fk_bad else "문제 있음"))
    for k, v in fk_bad.items():
        problems.append(f"FK 위반 {k}: {sorted(v)}")
    return problems, data


def read_env(name):
    path = J(".env")
    if name in os.environ:
        return os.environ[name]
    if os.path.exists(path):
        with open(path, encoding="utf-8-sig") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    if k.strip() == name:
                        return v.strip().strip('"').strip("'")
    sys.exit(f"{name}가 .env나 환경 변수에 없음")


def connect():
    """SUPABASE_DB_URL로 접속. 접속 문자열은 찍지 않는다(실패 시 오류 종류만)."""
    try:
        import psycopg
    except ModuleNotFoundError:
        sys.exit('psycopg가 없음: pip install "psycopg[binary]"')
    url = read_env("SUPABASE_DB_URL")
    try:
        return psycopg.connect(url, connect_timeout=15)
    except Exception as e:  # 접속 문자열이 오류 메시지에 섞이지 않게 종류만 찍는다
        sys.exit(f"DB 접속 실패 ({type(e).__name__})")


def load(seed_dir, ver, data):
    conn = connect()
    with conn:
        with conn.cursor() as cur:
            cur.execute("select version from ref.data_version where version <> %s", (ver,))
            other = [r[0] for r in cur.fetchall()]
            if other:
                raise SystemExit(f"다른 data_version이 이미 있음: {other}. 버전 교체 방법을 정한 뒤 다시 실행")
            for t in reversed(ORDER):
                col = "version" if t == "data_version" else "data_version"
                cur.execute(f"delete from ref.{t} where {col} = %s", (ver,))
            for t in ORDER:
                with open(os.path.join(seed_dir, f"{t}.csv"), encoding="utf-8-sig", newline="") as f:
                    text = f.read()
                cols = next(csv.reader(io.StringIO(text)))
                with cur.copy(f"copy ref.{t} ({', '.join(cols)}) from stdin with (format csv, header true)") as cp:
                    cp.write(text.encode("utf-8"))
                cur.execute(f"select count(*) from ref.{t}")
                n = cur.fetchone()[0]
                if n != len(data[t]):
                    raise SystemExit(f"{t}: DB {n}행 ≠ 시드 {len(data[t])}행. 롤백")
                print(f"적재: ref.{t} {n}행")
    conn.close()
    print("커밋 완료")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="접속 없이 시드 행 수·컬럼 순서·FK만 검사")
    args = ap.parse_args()
    seed = load_yaml(J("config", "seed.yaml"))
    ver, seed_dir = seed["data_version"], J(seed["seed_dir"])
    problems, data = dry_run(seed_dir, ver)
    if problems:
        for p in problems:
            print("문제:", p)
        sys.exit(1)
    if args.dry_run:
        print("dry-run: 접속하지 않음")
        return
    load(seed_dir, ver, data)


if __name__ == "__main__":
    main()
