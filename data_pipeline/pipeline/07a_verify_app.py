"""7단계 D4: app 스키마 RLS·트리거 검증 → reports/step7_app_schema.md

    python pipeline/07a_verify_app.py

- DB 연결(SUPABASE_DB_URL) 위에서 한 트랜잭션으로 하고 마지막에 rollback한다(가짜 사용자·데이터를 남기지 않는다).
  실패해야 하는 확인은 savepoint 안에서 하고 되돌린다.
- 사용자 흉내: set local role authenticated + request.jwt.claims(sub). 역할 되돌리기는 reset role.
- publishable 키 REST(Accept-Profile: app)로 로그인 없이 조회 → 거부되는지.
- 주소·키·접속 정보는 화면과 보고서에 쓰지 않는다.
"""
import importlib.util
import json
import os
import sys
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: os.path.join(ROOT, *p)  # noqa: E731
_spec = importlib.util.spec_from_file_location("verify06e", J("pipeline", "06e_verify_ref.py"))
v06e = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(v06e)
l06b = v06e.l06b
REPORT = J("reports", "step7_app_schema.md")
PRIVATE_FUNCS = ["handle_new_user()", "has_consent(text)", "favorite_limit()", "on_consent_withdrawn()",
                 "touch_updated_at()"]

# 테스트용 고정 UUID (다시 돌려도 같은 보고서). 트랜잭션 끝에 롤백되어 남지 않는다
A = str(uuid.UUID("00000000-0000-4000-8000-00000000000a"))
B = str(uuid.UUID("00000000-0000-4000-8000-00000000000b"))


def first(rows):
    return rows[0][0] if rows else None


def main():
    import psycopg
    conn = l06b.connect()
    cur = conn.cursor()
    results = []   # (구분, 확인, 기대, 실제, 통과)

    def q(sql, params=None):
        """'; '로 이은 여러 문장은 하나씩 실행하고(매개변수는 %s 개수대로 나눔) 마지막 결과를 돌려준다."""
        parts = sql.split("; ")
        params = list(params) if params is not None else None
        rows = None
        for part in parts:
            n = part.count("%s")
            p = None if params is None else params[:n]
            if params is not None:
                params = params[n:]
            cur.execute(part, p if p else None)
            rows = cur.fetchall() if cur.description else None
        return rows

    def as_user(uid):
        q("reset role")
        q("select set_config('request.jwt.claims', %s, true)", (json.dumps({"sub": uid, "role": "authenticated"}),))
        q("set local role authenticated")

    def as_admin():
        q("reset role")

    def expect_ok(group, name, sql, params=None, expect=None, check=None):
        q("savepoint t")
        try:
            rows = q(sql, params)
            got = rows if check is None else check(rows)
            ok = True if expect is None else got == expect
            q("release savepoint t")
            results.append((group, name, "성공" + (f" ({expect})" if expect is not None else ""), f"성공 ({got})", ok))
        except psycopg.Error as e:
            q("rollback to savepoint t")
            results.append((group, name, "성공", f"오류 {e.diag.sqlstate} {e.diag.message_primary}", False))

    def expect_fail(group, name, sql, params=None, sqlstate=None, message=None):
        q("savepoint t")
        try:
            rows = q(sql, params)
            q("rollback to savepoint t")
            results.append((group, name, f"실패 {sqlstate or ''}", f"성공해 버림 ({rows})", False))
        except psycopg.Error as e:
            q("rollback to savepoint t")
            ok = (sqlstate is None or e.diag.sqlstate == sqlstate) and (message is None or e.diag.message_primary == message)
            results.append((group, name, f"실패 {sqlstate or ''} {message or ''}".strip(),
                            f"실패 {e.diag.sqlstate} {e.diag.message_primary}", ok))

    try:
        # ---------- 0. 권한 정의 ----------
        g = "권한 정의"
        for f in PRIVATE_FUNCS:
            want = f == "has_consent(text)"
            got = q("select has_function_privilege('authenticated', %s, 'execute')", (f"private.{f}",))[0][0]
            results.append((g, f"authenticated의 private.{f} 실행 권한", str(want).lower(), str(got).lower(), got == want))
            got_a = q("select has_function_privilege('anon', %s, 'execute')", (f"private.{f}",))[0][0]
            results.append((g, f"anon의 private.{f} 실행 권한", "false", str(got_a).lower(), not got_a))
        for role, schema, want in (("anon", "private", False), ("authenticated", "private", True),
                                   ("anon", "app", False), ("authenticated", "app", True)):
            got = q("select has_schema_privilege(%s, %s, 'usage')", (role, schema))[0][0]
            results.append((g, f"{role}의 {schema} 스키마 usage", str(want).lower(), str(got).lower(), got == want))
        fdef = q("select pg_get_functiondef('private.handle_new_user()'::regprocedure)")[0][0]
        has_conflict = "on conflict (user_id) do nothing" in fdef.lower()
        results.append((g, "handle_new_user의 insert가 on conflict do nothing", "예", "예" if has_conflict else "아니요",
                        has_conflict))
        n_anon = q("select count(*) from information_schema.role_table_grants "
                   "where table_schema = 'app' and grantee = 'anon'")[0][0]
        results.append((g, "anon의 app 테이블 권한 수", "0", str(n_anon), n_anon == 0))
        rls = q("select count(*) filter (where c.relrowsecurity), count(*) from pg_class c join pg_namespace n "
                "on n.oid = c.relnamespace where n.nspname = 'app' and c.relkind = 'r'")[0]
        results.append((g, "RLS 켜진 app 테이블", f"{rls[1]} / {rls[1]}", f"{rls[0]} / {rls[1]}", rls[0] == rls[1]))

        # ---------- 1. 가입 트리거 ----------
        g = "가입 트리거"
        for uid, mail in ((A, "mh-test-a@example.invalid"), (B, "mh-test-b@example.invalid")):
            q("insert into auth.users (id, aud, role, email) values (%s, 'authenticated', 'authenticated', %s)", (uid, mail))
        n = q("select count(*) from app.account where user_id in (%s, %s)", (A, B))[0][0]
        results.append((g, "auth.users에 A, B insert → app.account 자동 생성", "2행", f"{n}행", n == 2))
        # 같은 사용자를 두 번 처리: 실제 함수를 임시 테이블 트리거로 같은 id에 한 번 더 실행
        q("create temp table mh_users_again (id uuid) on commit drop")
        q("create trigger mh_again after insert on mh_users_again for each row execute function private.handle_new_user()")
        expect_ok(g, "handle_new_user를 같은 사용자(A)에 두 번째 실행 → 오류 없음, account 1행",
                  "insert into mh_users_again values (%s); select count(*) from app.account where user_id = %s",
                  (A, A), expect=1, check=first)

        # B의 즐겨찾기(관리자로 미리 넣음)
        as_admin()
        q("insert into app.favorite (user_id, facility_id, facility_type, name_ko) values (%s, 'B-1', 'hospital', 'B 병원')", (B,))

        # ---------- 2. A로 확인 ----------
        g = "A 사용자(authenticated)"
        as_user(A)
        expect_ok(g, "1. A favorite 추가",
                  "insert into app.favorite (user_id, facility_id, facility_type, name_ko) "
                  "values (%s, 'F-01', 'hospital', '테스트 의원') returning facility_id", (A,),
                  expect="F-01", check=first)
        expect_ok(g, "1. A favorite 조회", "select count(*) from app.favorite where user_id = %s", (A,),
                  expect=1, check=first)
        expect_ok(g, "1. B의 favorite는 0행으로 보임", "select count(*) from app.favorite where user_id = %s", (B,),
                  expect=0, check=first)
        expect_fail(g, "1. B 행 insert", "insert into app.favorite (user_id, facility_id, facility_type, name_ko) "
                    "values (%s, 'F-X', 'hospital', 'x')", (B,), sqlstate="42501")
        expect_fail(g, "1. B가 이미 가진 기관(B-1)을 B 행으로 insert → 존재 여부 노출 없이 거부",
                    "insert into app.favorite (user_id, facility_id, facility_type, name_ko) "
                    "values (%s, 'B-1', 'hospital', 'x')", (B,), sqlstate="42501")
        expect_ok(g, "2. 같은 기관 두 번 insert → 오류 없음, 1행 유지",
                  "insert into app.favorite (user_id, facility_id, facility_type, name_ko) "
                  "values (%s, 'F-01', 'hospital', '테스트 의원'); "
                  "select count(*) from app.favorite where user_id = %s and facility_id = 'F-01'", (A, A),
                  expect=1, check=first)
        expect_ok(g, "3. 20개까지 채움", "insert into app.favorite (user_id, facility_id, facility_type, name_ko) "
                  "select %s, 'F-' || lpad(i::text, 2, '0'), 'pharmacy', '약국 ' || i from generate_series(2, 20) i; "
                  "select count(*) from app.favorite where user_id = %s", (A, A), expect=20, check=first)
        expect_fail(g, "3. 21번째 favorite insert", "insert into app.favorite (user_id, facility_id, facility_type, "
                    "name_ko) values (%s, 'F-21', 'hospital', 'x')", (A,), sqlstate="23514", message="favorite limit 20")
        expect_ok(g, "3. 20개일 때 이미 있는 기관 다시 insert → 오류 없음(멱등)",
                  "insert into app.favorite (user_id, facility_id, facility_type, name_ko) "
                  "values (%s, 'F-05', 'pharmacy', '약국 5'); select count(*) from app.favorite where user_id = %s",
                  (A, A), expect=20, check=first)
        expect_fail(g, "4. healthStorage 동의 없이 health_profile insert",
                    "insert into app.health_profile (user_id, age) values (%s, 30)", (A,), sqlstate="42501")
        expect_ok(g, "5. healthProcessing·healthStorage agreed=true 기록",
                  "insert into app.consent_event (user_id, policy_version, item, agreed) values "
                  "(%s, 'signup-policy-1', 'healthProcessing', true), (%s, 'signup-policy-1', 'healthStorage', true); "
                  "select private.has_consent('healthStorage')", (A, A), expect=True, check=first)
        expect_ok(g, "5. 동의 후 health_profile insert", "insert into app.health_profile (user_id, age, allergies) "
                  "values (%s, 30, '없음') returning age", (A,), expect=30, check=first)
        expect_fail(g, "5. age 121로 update → check 실패",
                    "update app.health_profile set age = 121 where user_id = %s", (A,), sqlstate="23514")
        expect_ok(g, "search_setting insert(updated_at 2000-01-01) 후 update → updated_at 갱신",
                  "insert into app.search_setting (user_id, region, updated_at) values (%s, '춘천', '2000-01-01'); "
                  "update app.search_setting set preference = 'open' where user_id = %s; "
                  "select updated_at > '2000-01-02' from app.search_setting where user_id = %s", (A, A, A),
                  expect=True, check=first)
        expect_fail(g, "consent_event에 created_at 직접 지정 insert(컬럼 권한 없음)",
                    "insert into app.consent_event (user_id, policy_version, item, agreed, created_at) "
                    "values (%s, 'p', 'terms', true, '2000-01-01')", (A,), sqlstate="42501")
        expect_fail(g, "age14가 아닌 age18 항목 insert → check 실패",
                    "insert into app.consent_event (user_id, policy_version, item, agreed) "
                    "values (%s, 'p', 'age18', true)", (A,), sqlstate="23514")
        expect_ok(g, "age14 항목 insert", "insert into app.consent_event (user_id, policy_version, item, agreed) "
                  "values (%s, 'p', 'age14', true) returning item", (A,), expect="age14", check=first)
        expect_ok(g, "6. healthStorage agreed=false 기록 → health_profile 행 삭제",
                  "insert into app.consent_event (user_id, policy_version, item, agreed) "
                  "values (%s, 'signup-policy-1', 'healthStorage', false); "
                  "select private.has_consent('healthStorage')", (A,), expect=False, check=first)
        as_admin()
        n = q("select count(*) from app.health_profile where user_id = %s", (A,))[0][0]
        results.append((g, "6. 철회 뒤 DB의 A health_profile 행(관리자 확인)", "0행", f"{n}행", n == 0))
        as_user(A)
        expect_fail(g, "7. consent_event update", "update app.consent_event set agreed = true where user_id = %s",
                    (A,), sqlstate="42501")
        expect_fail(g, "7. consent_event delete", "delete from app.consent_event where user_id = %s",
                    (A,), sqlstate="42501")
        expect_ok(g, "consent_current: A의 healthStorage 최신 = false",
                  "select agreed from app.consent_current where user_id = %s and item = 'healthStorage'", (A,),
                  expect=False, check=first)

        # ---------- 3. anon ----------
        g = "anon"
        q("reset role")
        q("select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true)")
        q("set local role anon")
        expect_fail(g, "anon으로 app.favorite select", "select * from app.favorite", sqlstate="42501")
        expect_fail(g, "anon으로 private.has_consent 실행", "select private.has_consent('terms')", sqlstate="42501")

        # ---------- 4. 탈퇴 cascade ----------
        g = "탈퇴"
        as_admin()
        tables = ["account", "consent_event", "favorite", "search_setting", "health_profile"]
        before = {t: q(f"select count(*) from app.{t} where user_id = %s", (A,))[0][0] for t in tables}
        q("delete from auth.users where id = %s", (A,))
        after = {t: q(f"select count(*) from app.{t} where user_id = %s", (A,))[0][0] for t in tables}
        results.append((g, "auth.users에서 A 삭제 → A의 app 행 전부 삭제", "모두 0",
                        ", ".join(f"{t} {before[t]}→{after[t]}" for t in tables), all(v == 0 for v in after.values())))
        nb = q("select count(*) from app.favorite where user_id = %s", (B,))[0][0]
        results.append((g, "B의 행은 그대로", "favorite 1행", f"favorite {nb}행", nb == 1))

        cols = q("select table_name, string_agg(column_name, ', ' order by ordinal_position) "
                 "from information_schema.columns where table_schema = 'app' group by table_name order by table_name")
        policies = q("select tablename, policyname, cmd, array_to_string(roles, ',') from pg_policies "
                     "where schemaname = 'app' order by tablename, cmd, policyname")
    finally:
        conn.rollback()
    left = q("select count(*) from auth.users where id in (%s, %s)", (A, B))[0][0]
    conn.close()
    results.append(("정리", "롤백 뒤 남은 가짜 사용자", "0", str(left), left == 0))

    # ---------- REST ----------
    rest = v06e.Rest()
    st, body = rest.call("GET", "favorite?select=user_id&limit=1", profile="app")
    b = body if isinstance(body, dict) else {}
    rest_line = f"HTTP {st} {b.get('code', '')} ({b.get('message', '')})"
    pending = []
    if st == 406 and b.get("code") == "PGRST106":
        pending.append(f"publishable 키 REST(Accept-Profile: app): {rest_line}. app이 Data API에 노출되지 않아 "
                       "권한 단계까지 가지 못했다. Exposed schemas에 app을 추가한 뒤 다시 돌려 401/42501 거부를 확인한다")
        rest_ok = None
    else:
        rest_ok = st in (401, 403)
        results.append(("REST", "publishable 키로 로그인 없이 app.favorite 조회", "거부(401/403)", rest_line, rest_ok))

    # ---------- 보고서 ----------
    L = []
    w = L.append
    w("# 7단계 app 스키마 적용·RLS 검증")
    w("")
    w("- 마이그레이션: `db/migrations/002_app_schema.sql` (`pipeline/06c_run_migrations.py`). 먼저 실행 후 롤백으로 점검, "
      "적용, 한 번 더 실행해도 오류 없음")
    w("- 검증: `pipeline/07a_verify_app.py`. DB 연결 위 한 트랜잭션에서 가짜 사용자 A·B로 확인하고 마지막에 rollback")
    w("- 사용자 흉내: `set local role authenticated` + `request.jwt.claims`의 sub")
    w("- 접속 정보와 키는 이 보고서에 쓰지 않는다.")
    w("")
    w("## 1. 확인 결과")
    w("")
    w("| 구분 | 확인 | 기대 | 실제 | 통과 |")
    w("|---|---|---|---|---|")
    for grp, name, exp, got, ok in results:
        w(f"| {grp} | {name} | {exp} | {got} | {'예' if ok else '**아니요**'} |")
    w("")
    w("## 2. 정책")
    w("")
    w("| 테이블 | 정책 | 명령 | 역할 |")
    w("|---|---|---|---|")
    for t, p, c, r in policies:
        w(f"| app.{t} | {p} | {c} | {r} |")
    w("")
    w("## 3. app 테이블·뷰 컬럼 (증상·대화 원문 컬럼 없음 확인)")
    w("")
    for t, c in cols:
        w(f"- `app.{t}`: {c}")
    w("")
    w("증상·대화·문진 답변·분석서·응급 위치·상담 대상 성별·나이·조회한 진료과를 담는 컬럼은 없다. "
      "`health_profile`의 allergies·medications·history는 healthStorage 동의가 있을 때만 읽고 쓴다.")
    w("")
    if pending:
        w("## 보류")
        w("")
        for p in pending:
            w(f"- {p}")
        w("")
    failed = [r for r in results if not r[4]]
    w("## 결과")
    w("")
    w(f"확인 {len(results)}개 중 통과 {len(results) - len(failed)}개." + (" 문제 없음." if not failed else "")
      + (" REST 확인은 보류(위 '보류' 절)." if pending else ""))
    for grp, name, exp, got, ok in failed:
        w(f"- 실패: {grp} / {name}: 기대 {exp}, 실제 {got}")
    with open(REPORT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(L) + "\n")
    print(f"저장: {os.path.relpath(REPORT, ROOT)}  확인 {len(results)}개, 실패 {len(failed)}개")
    for r in failed:
        print("실패:", r)
    for p in pending:
        print("보류:", p)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
