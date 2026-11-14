"""마이그레이션 SQL을 한 트랜잭션으로 실행한다.

    python pipeline/06c_run_migrations.py db/migrations/001_ref_schema.sql db/migrations/001b_ref_functions.sql
    python pipeline/06c_run_migrations.py --rollback <파일...>   # 실행해 보고 되돌림(문법·권한 점검)

- 접속: data_pipeline/.env의 SUPABASE_DB_URL을 변수로만 읽는다. 주소·키·비밀번호는 찍지 않는다.
- 파일은 주어진 순서대로 실행한다. 하나라도 실패하면 전부 롤백한다.
"""
import argparse
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("load06b", os.path.join(ROOT, "pipeline", "06b_load_supabase.py"))
l06b = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(l06b)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--rollback", action="store_true", help="실행한 뒤 커밋하지 않고 되돌린다")
    args = ap.parse_args()
    import psycopg
    conn = l06b.connect()
    try:
        with conn.cursor() as cur:
            for p in args.files:
                path = p if os.path.isabs(p) else os.path.join(ROOT, p)
                with open(path, encoding="utf-8") as f:
                    sql = f.read()
                try:
                    cur.execute(sql)
                except psycopg.Error as e:
                    d = e.diag
                    print(f"실패: {os.path.relpath(path, ROOT)}: {d.sqlstate} {d.message_primary}"
                          + (f" / {d.context}" if d.context else ""))
                    conn.rollback()
                    sys.exit(1)
                print(f"실행: {os.path.relpath(path, ROOT)}")
        if args.rollback:
            conn.rollback()
            print("롤백(점검만)")
        else:
            conn.commit()
            print("커밋 완료")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
