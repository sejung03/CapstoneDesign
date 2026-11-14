"""6·7단계 D2: ref 적재 검증 → reports/step6_load.md

    python pipeline/06e_verify_ref.py

- DB 연결(SUPABASE_DB_URL): 테이블별 DB 행 수 = 시드 행 수, 표본 조회, 모든 ref 컬럼·함수
- 권한·RPC 확인을 두 경로로 한다
  (가) DB 안에서 role anon으로 바꿔서(호출마다 롤백): 읽기, insert 거부, ref.recommend_departments 경우별
  (나) publishable 키 REST(SUPABASE_URL, Accept-Profile/Content-Profile: ref): 같은 확인.
       ref가 Data API에 노출되지 않았으면(PGRST106) 보류로 적는다
- 주소·키·접속 정보는 화면과 보고서에 쓰지 않는다. HTTP 오류는 상태 코드와 PostgREST 오류 코드만 남긴다.
"""
import csv
import importlib.util
import json
import os
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: os.path.join(ROOT, *p)  # noqa: E731
_spec = importlib.util.spec_from_file_location("load06b", J("pipeline", "06b_load_supabase.py"))
l06b = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(l06b)
REPORT = J("reports", "step6_load.md")


class Rest:
    """publishable 키로 PostgREST 호출"""

    def __init__(self):
        self.base = l06b.read_env("SUPABASE_URL").rstrip("/") + "/rest/v1/"
        self.key = l06b.read_env("SUPABASE_PUBLISHABLE_KEY")

    def call(self, method, path, body=None, profile="ref"):
        h = {"apikey": self.key, "Accept": "application/json"}
        h["Accept-Profile" if method == "GET" else "Content-Profile"] = profile
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            h["Content-Type"] = "application/json"
        req = urllib.request.Request(self.base + path, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status, json.loads(r.read().decode("utf-8") or "null")
        except urllib.error.HTTPError as e:
            try:
                err = json.loads(e.read().decode("utf-8"))
                code = err.get("code", "") if isinstance(err, dict) else ""
                msg = err.get("message", "") if isinstance(err, dict) else ""
            except Exception:
                code, msg = "", ""
            return e.code, {"code": code, "message": msg}
        except urllib.error.URLError as e:
            sys.exit(f"REST 접속 실패 ({type(e.reason).__name__})")

    def read5(self):
        st, body = self.call("GET", "symptom?select=symptom_id,name_ko&order=symptom_id&limit=5")
        ok = st == 200 and isinstance(body, list) and len(body) == 5
        desc = ", ".join(r["symptom_id"] + " " + r["name_ko"] for r in body) if isinstance(body, list) else f"HTTP {st}"
        return ok, len(body) if isinstance(body, list) else 0, desc

    def insert(self, t, row):
        st, body = self.call("POST", t, row)
        b = body if isinstance(body, dict) else {}
        return st in (401, 403), f"HTTP {st} {b.get('code', '')} ({b.get('message', '')})"

    def rpc(self, args):
        st, body = self.call("POST", "rpc/recommend_departments", args)
        return st == 200, body if st == 200 else f"HTTP {st} {body}"


class DbAnon:
    """DB 연결 위에서 role anon으로 바꿔 같은 확인을 한다. 호출마다 롤백한다."""

    def __init__(self, conn):
        self.conn = conn

    def _run(self, sql, params=None):
        import psycopg
        cur = self.conn.cursor()
        try:
            cur.execute("set local role anon")
            cur.execute(sql, params)
            if cur.description is None:
                return True, []
            cols = [c.name for c in cur.description]
            return True, [dict(zip(cols, r)) for r in cur.fetchall()]
        except psycopg.Error as e:
            return False, f"{e.diag.sqlstate} {e.diag.message_primary}"
        finally:
            self.conn.rollback()

    def read5(self):
        ok, rows = self._run("select symptom_id, name_ko from ref.symptom order by symptom_id limit 5")
        if not ok:
            return False, 0, rows
        return len(rows) == 5, len(rows), ", ".join(r["symptom_id"] + " " + r["name_ko"] for r in rows)

    def insert(self, t, row):
        cols = list(row)
        vals = [json.dumps(v) if (t, c) == ("app_config", "value") else v for c, v in row.items()]
        ok, msg = self._run(f"insert into ref.{t} ({', '.join(cols)}) values ({', '.join(['%s'] * len(cols))})", vals)
        return not ok, (msg if not ok else "성공")

    def rpc(self, args):
        sql = "select * from ref.recommend_departments(" + ", ".join(f"{k} => %({k})s" for k in args) + ")"
        ok, rows = self._run(sql, args)
        if ok:
            rows = [{**r, "share": float(r["share"]) if r["share"] is not None else None} for r in rows]
        return ok, rows


def fmt_rpc(rows):
    if not isinstance(rows, list):
        return str(rows)
    if any(r.get("is_fallback") for r in rows):
        return f"is_fallback=true ({len(rows)}행)"
    return " / ".join(f"{r['rank']}. {r['name_ko']}({r['search_key']}, {r['level']})" for r in rows) or "(빈 결과)"


def main():
    seed = l06b.load_yaml(J("config", "seed.yaml"))
    ver, seed_dir = seed["data_version"], J(seed["seed_dir"])
    problems, pending = [], []
    L = []
    w = L.append
    w("# 6단계 적재 검증 (ref 스키마)")
    w("")
    w(f"- data_version: `{ver}`")
    w("- 마이그레이션: `db/migrations/001_ref_schema.sql` → `001b_ref_functions.sql` "
      "(`pipeline/06c_run_migrations.py`, 한 트랜잭션. 두 번 실행해도 오류 없음)")
    w("- 적재: `pipeline/06b_load_supabase.py` (한 트랜잭션: 같은 버전 삭제 → FK 순서로 COPY. 두 번 적재해도 같은 행 수)")
    w("- 검증: `pipeline/06e_verify_ref.py`. 접속 정보와 키는 이 보고서에 쓰지 않는다.")
    w("")

    conn = l06b.connect()
    cur = conn.cursor()
    # 1. 행 수
    w("## 1. 테이블별 행 수 (DB = 시드)")
    w("")
    w("| 테이블 | 시드 | DB | 일치 |")
    w("|---|---|---|---|")
    for t in l06b.ORDER:
        with open(os.path.join(seed_dir, f"{t}.csv"), encoding="utf-8-sig", newline="") as f:
            n_seed = sum(1 for _ in csv.DictReader(f))
        cur.execute(f"select count(*) from ref.{t}")
        n_db = cur.fetchone()[0]
        if n_seed != n_db:
            problems.append(f"행 수 다름: {t}")
        w(f"| {t} | {n_seed} | {n_db} | {'예' if n_seed == n_db else '아니요'} |")
    w("")

    # 2. 표본 조회
    w("## 2. 표본 조회 (DB)")
    w("")
    cur.execute("select s.name_ko, string_agg(y.term, ', ' order by y.id) from ref.symptom s "
                "join ref.symptom_synonym y using (symptom_id) where s.symptom_id = 'D02' group by s.name_ko")
    name, terms = cur.fetchone()
    cur.execute("select path_used, d1.name_ko, d2.name_ko, d3.name_ko from ref.symptom_department sd "
                "left join ref.department d1 on d1.dept_id = sd.rec1_dept_id "
                "left join ref.department d2 on d2.dept_id = sd.rec2_dept_id "
                "left join ref.department d3 on d3.dept_id = sd.rec3_dept_id where sd.symptom_id = 'D02'")
    pu, r1, r2, r3 = cur.fetchone()
    w(f"- **D02 {name}**: 동의어 = {terms}")
    w(f"  - 추천(path_used={pu}): {' / '.join(x or '—' for x in (r1, r2, r3))}")
    cur.execute("select y.span_group, string_agg(y.symptom_id || ' ' || s.name_ko, ', ' order by y.symptom_id) "
                "from ref.symptom_synonym y join ref.symptom s using (symptom_id) "
                "where y.term_norm = '목통증' group by y.span_group")
    w("- **span 표현 \"목 통증\"**: " + "; ".join(f"span_group {g} → {s}" for g, s in cur.fetchall()))
    cur.execute("select s.symptom_id, s.name_ko, s.fallback_group from ref.symptom_department sd "
                "join ref.symptom s using (symptom_id) where sd.fallback order by s.symptom_id")
    fb = cur.fetchall()
    cur.execute("select grp, string_agg(d.name_ko, ', ' order by f.rank) from ref.fallback_department f "
                "join ref.department d using (dept_id) group by grp order by grp")
    fbd = dict(cur.fetchall())
    sid, sname, grp = fb[0]
    w(f"- **fallback 증상 {sid} {sname}**: fallback_group={grp} → fallback 진료과 {fbd.get(grp)}")
    w(f"  - fallback 증상 전체 {len(fb)}개: " + ", ".join(f"{a} {b}({c})" for a, b, c in fb))
    w("")
    cur.execute("""
        select sd.symptom_id, s.name_ko from ref.symptom_department sd join ref.symptom s using (symptom_id)
        where s.sex_restriction is null and 'obstetrics_gynecology' in (sd.rec1_dept_id, sd.rec2_dept_id, sd.rec3_dept_id)
          and 'pediatrics' not in (coalesce(sd.rec1_dept_id, ''), coalesce(sd.rec2_dept_id, ''), coalesce(sd.rec3_dept_id, ''))
        order by sd.symptom_id limit 1""")
    sx_id, sx_name = cur.fetchone()
    cur.execute("select sd.symptom_id, s.name_ko from ref.symptom_department sd join ref.symptom s using (symptom_id) "
                "where sd.rec1_dept_id = 'pediatrics' and sd.symptom_id = 'A02'")
    pd_id, pd_name = cur.fetchone()
    conn.commit()

    # 3·4. 권한과 RPC
    rest = Rest()
    st, body = rest.call("GET", "symptom?select=symptom_id&limit=1")
    channels = [("DB 안에서 role anon", DbAnon(conn))]
    if st == 200:
        channels.append(("publishable 키 REST", rest))
    else:
        b = body if isinstance(body, dict) else {}
        pending.append(f"publishable 키 REST 검증 보류: HTTP {st} {b.get('code', '')} ({b.get('message', '')}). "
                       "Supabase 대시보드 Data API의 Exposed schemas에 ref를 추가한 뒤 이 스크립트를 다시 돌린다")
    sec = 3
    for ch_name, ch in channels:
        w(f"## {sec}. 읽기·쓰기 권한 — {ch_name}")
        w("")
        ok, n, desc = ch.read5()
        if not ok:
            problems.append(f"{ch_name}: ref.symptom 읽기 실패 {desc}")
        w(f"- ref.symptom 5행 읽기: {n}행 ({desc}) → " + ("성공" if ok else "**실패**"))
        for t, row in (("symptom", {"symptom_id": "Z99", "is_parent": False, "name_ko": "테스트", "body_part_ui": "전신",
                                    "is_injury": False, "source_id": "S8", "data_version": ver}),
                       ("app_config", {"key": "test_insert", "value": 1, "data_version": ver})):
            denied, desc = ch.insert(t, row)
            if not denied:
                problems.append(f"{ch_name}: ref.{t} insert가 거부되지 않음 {desc}")
            w(f"- ref.{t} insert 시도: {desc} → " + ("거부됨(정상)" if denied else "**거부되지 않음**"))
        cur.execute("select (select count(*) from ref.symptom where symptom_id = 'Z99') "
                    "+ (select count(*) from ref.app_config where key = 'test_insert')")
        w(f"- insert 시도 뒤 DB에 남은 테스트 행: {cur.fetchone()[0]}")
        conn.commit()
        w("")
        w(f"## {sec + 1}. ref.recommend_departments — {ch_name}")
        w("")
        cases = [
            ("성별 제한 없는 증상 중 산부인과가 있는 것", sx_id, sx_name, [{"p_sex": "female"}, {"p_sex": "male"}]),
            ("소아청소년과가 1위인 증상", pd_id, pd_name, [{"p_age": 5}, {"p_age": 30}, {}]),
            ("fallback 증상", sid, sname, [{}]),
            ("상위 증상(추천 없음)", "D20", "입·혀·입술 불편", [{}]),
            ("허용값이 아닌 성별", sx_id, sx_name, [{"p_sex": "x"}, {"p_sex": "unknown"}]),
        ]
        w("| 확인 | 증상 | 인자 | 결과 |")
        w("|---|---|---|---|")
        res = {}
        for title, s_id, s_name, arglist in cases:
            for a in arglist:
                ok, rows = ch.rpc({"p_symptom_id": s_id, **a})
                if not ok:
                    problems.append(f"{ch_name}: RPC 실패 {s_id} {a}: {rows}")
                res[(s_id, json.dumps(a, sort_keys=True))] = rows if ok else []
                w(f"| {title} | {s_id} {s_name} | `{json.dumps(a, ensure_ascii=False) if a else '(기본)'}` | "
                  f"{fmt_rpc(rows)} |")
        w("")
        g = lambda s, a: res[(s, json.dumps(a, sort_keys=True))]  # noqa: E731
        has = lambda rows, d: any(r["dept_id"] == d for r in rows)  # noqa: E731
        chk = [
            ("female 결과에 산부인과 있음", has(g(sx_id, {"p_sex": "female"}), "obstetrics_gynecology")),
            ("male 결과에 산부인과 없음", not has(g(sx_id, {"p_sex": "male"}), "obstetrics_gynecology")),
            ("age 5 결과에 소아청소년과 있음", has(g(pd_id, {"p_age": 5}), "pediatrics")),
            ("age 30 결과에 소아청소년과 없음", not has(g(pd_id, {"p_age": 30}), "pediatrics")),
            ("age null 결과 = age 5 결과", g(pd_id, {}) == g(pd_id, {"p_age": 5})),
            ("fallback 증상: 행 1개, is_fallback=true", len(g(sid, {})) == 1 and g(sid, {})[0]["is_fallback"] is True),
            ("D20: 행 1개, is_fallback=true", len(g("D20", {})) == 1 and g("D20", {})[0]["is_fallback"] is True),
            ("허용값이 아닌 성별 = unknown 결과", g(sx_id, {"p_sex": "x"}) == g(sx_id, {"p_sex": "unknown"})),
        ]
        for name_, ok in chk:
            if not ok:
                problems.append(f"{ch_name}: RPC 확인 실패: {name_}")
            w(f"- {name_}: {'예' if ok else '**아니요**'}")
        w("")
        sec += 2

    # 컬럼·함수
    w(f"## {sec}. ref 스키마 모든 컬럼 (사용자 원문 저장 컬럼 없음 확인)")
    w("")
    cur.execute("select table_name, string_agg(column_name, ', ' order by ordinal_position) "
                "from information_schema.columns where table_schema = 'ref' group by table_name order by table_name")
    for t, cols in cur.fetchall():
        w(f"- `ref.{t}`: {cols}")
    w("")
    w("사용자 입력·대화 원문을 담는 컬럼은 없다. `term`은 사전 표현이다(30자 이하 CHECK).")
    w("")
    w(f"## {sec + 1}. 함수와 테이블 권한")
    w("")
    cur.execute("select p.proname, p.prosecdef, p.provolatile, array_to_string(p.proconfig, ','), "
                "has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute') "
                "from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'ref'")
    for pn, sdef, vol, conf, anon_x, auth_x in cur.fetchall():
        w(f"- `ref.{pn}`: security {'definer' if sdef else 'invoker'}, volatility {vol}, 설정 `{conf}`, "
          f"anon 실행 {anon_x}, authenticated 실행 {auth_x}")
    cur.execute("select grantee, string_agg(distinct privilege_type, ',' order by privilege_type) "
                "from information_schema.role_table_grants where table_schema = 'ref' "
                "and grantee in ('anon', 'authenticated') group by grantee order by grantee")
    for g_, privs in cur.fetchall():
        w(f"- `{g_}`의 ref 테이블 권한: {privs}")
    cur.execute("select count(*) filter (where c.relrowsecurity), count(*) from pg_class c "
                "join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'ref' and c.relkind = 'r'")
    rls_on, n_t = cur.fetchone()
    w(f"- RLS 켜진 테이블: {rls_on} / {n_t}")
    if rls_on != n_t:
        problems.append("RLS가 꺼진 ref 테이블이 있음")
    w("")
    if pending:
        w("## 보류")
        w("")
        for p_ in pending:
            w(f"- {p_}")
        w("")
    w("## 결과")
    w("")
    w(("문제 없음." if not problems else "\n".join(f"- {p}" for p in problems))
      + (" publishable 키 REST 검증은 보류(위 '보류' 절)." if pending else ""))
    conn.close()
    with open(REPORT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(L) + "\n")
    print(f"저장: {os.path.relpath(REPORT, ROOT)}")
    print("문제 없음" if not problems else "\n".join(problems))
    for p_ in pending:
        print("보류:", p_)
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
