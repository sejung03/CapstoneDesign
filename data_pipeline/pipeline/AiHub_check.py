"""
AI Hub 「초거대AI 사전학습용 헬스케어 질의응답 데이터」 점검 스크립트
- 질문(HC-Q-*)과 답변(HC-A-*)이 ID로 연결되는지 확인
- (질환명, 질문의도)로 연결할 때의 커버리지 확인
- intention / entity 종류 / 진료과 분포 집계
- AI Hub만으로 '증상 표현 → 진료과' DB를 만들 수 있는지 판단 근거 출력

사용법 (Python 3.8+, 추가 설치 불필요):
    python aihub_check.py <폴더 / zip / 분할 파일 경로> [...]
    예) python aihub_check.py data/raw                  (폴더 안의 VL.zip.part0 등 자동 인식)
        python aihub_check.py data/raw/VL.zip.part0     (분할 파일 직접 지정, 이름 변경 불필요)
        python aihub_check.py data/raw/TL.zip.part0     (part2147483648 등 나머지 조각 자동으로 이어 읽음)

결과: aihub_check_report.txt, aihub_check_report.json (작은 요약 파일. 이것만 공유하면 됨)
원본 질문·답변 문장은 결과 파일에 저장하지 않음 (예시 몇 개만 앞부분 40자).
"""
import io
import json
import os
import re
import sys
import zipfile
from collections import Counter, defaultdict

MAX_NESTED_ZIP_DEPTH = 2


# ---------- 파일 순회 (폴더, zip, zip 안의 zip 모두 지원) ----------
def _fix_zip_name(info):
    # 한글 파일명이 cp437로 잘못 디코딩된 경우 복구
    name = info.filename
    if info.flag_bits & 0x800:
        return name
    try:
        return name.encode("cp437").decode("cp949")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return name


def _iter_zip(zf, depth):
    for info in zf.infolist():
        if info.is_dir():
            continue
        name = _fix_zip_name(info)
        low = name.lower()
        if low.endswith(".json"):
            with zf.open(info) as f:
                yield name, f.read()
        elif low.endswith(".zip") and depth < MAX_NESTED_ZIP_DEPTH:
            with zf.open(info) as f:
                inner = zipfile.ZipFile(io.BytesIO(f.read()))
                yield from _iter_zip(inner, depth + 1)


PART_RE = re.compile(r"^(.*\.zip)\.part(\d+)$", re.I)


class MultiPartReader(io.RawIOBase):
    """AI Hub 분할 파일(xxx.zip.part0, xxx.zip.part2147483648 ...)을
    합치지 않고 하나의 파일처럼 읽는다. 조각은 숫자(시작 바이트) 순서로 정렬."""

    def __init__(self, paths):
        self.paths = paths
        self.sizes = [os.path.getsize(p) for p in paths]
        self.starts = []
        s = 0
        for z in self.sizes:
            self.starts.append(s)
            s += z
        self.total = s
        self.pos = 0
        self.files = [open(p, "rb") for p in paths]

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        if whence == 0:
            self.pos = offset
        elif whence == 1:
            self.pos += offset
        else:
            self.pos = self.total + offset
        return self.pos

    def readinto(self, b):
        want = len(b)
        got = 0
        while got < want and self.pos < self.total:
            i = max(j for j, st in enumerate(self.starts) if st <= self.pos)
            f = self.files[i]
            f.seek(self.pos - self.starts[i])
            chunk = f.read(min(want - got, self.starts[i] + self.sizes[i] - self.pos))
            if not chunk:
                break
            b[got:got + len(chunk)] = chunk
            got += len(chunk)
            self.pos += len(chunk)
        return got

    def close(self):
        for f in self.files:
            f.close()
        super().close()


def find_parts(part_path):
    m = PART_RE.match(os.path.basename(part_path))
    folder = os.path.dirname(part_path) or "."
    prefix = m.group(1).lower()
    parts = []
    for fn in os.listdir(folder):
        mm = PART_RE.match(fn)
        if mm and mm.group(1).lower() == prefix:
            parts.append((int(mm.group(2)), os.path.join(folder, fn)))
    parts.sort()
    # 조각의 숫자 = 시작 바이트. 앞 조각들의 크기 합과 맞는지 확인
    expected = 0
    for off, p in parts:
        if off != expected:
            print(f"  [경고] {os.path.basename(p)}: 시작 위치 {off}, 예상 {expected}. 조각이 빠졌을 수 있음")
        expected = off + os.path.getsize(p)
    return [p for _, p in parts]


def iter_split_zip(part_path):
    parts = find_parts(part_path)
    print(f"  분할 zip 읽기: {', '.join(os.path.basename(p) for p in parts)}")
    reader = MultiPartReader(parts)
    try:
        with zipfile.ZipFile(io.BufferedReader(reader, buffer_size=1 << 20)) as zf:
            yield from _iter_zip(zf, 0)
    finally:
        reader.close()


def iter_json(path):
    if os.path.isdir(path):
        seen_split = set()
        for root, _, files in os.walk(path):
            for fn in sorted(files):
                p = os.path.join(root, fn)
                low = fn.lower()
                m = PART_RE.match(fn)
                if m:
                    key = os.path.join(root, m.group(1).lower())
                    if key not in seen_split:
                        seen_split.add(key)
                        yield from iter_split_zip(p)
                elif low.endswith(".json"):
                    with open(p, "rb") as f:
                        yield p, f.read()
                elif low.endswith(".zip"):
                    yield from iter_json(p)
    elif PART_RE.match(os.path.basename(path)):
        yield from iter_split_zip(path)
    elif path.lower().endswith(".zip"):
        with zipfile.ZipFile(path) as zf:
            yield from _iter_zip(zf, 0)
    elif path.lower().endswith(".json"):
        with open(path, "rb") as f:
            yield path, f.read()


def load(raw):
    for enc in ("utf-8-sig", "utf-8", "cp949"):
        try:
            return json.loads(raw.decode(enc))
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
    return None


# ---------- 유틸 ----------
ID_RE = re.compile(r"HC-([QA])-(\d+)", re.I)


def parse_id(file_name, path):
    for s in (file_name or "", os.path.basename(path)):
        m = ID_RE.search(s)
        if m:
            return m.group(1).upper(), m.group(2)
    return None, None


def dname(d):
    dn = d.get("disease_name") or {}
    if isinstance(dn, dict):
        return (dn.get("kor") or "").strip()
    return str(dn).strip()


def as_list(x):
    if x is None:
        return []
    if isinstance(x, list):
        return [str(v).strip() for v in x if str(v).strip()]
    return [s.strip() for s in str(x).split(",") if s.strip()]


# ---------- 메인 ----------
def main(paths):
    q_ids, a_ids = {}, {}                 # 숫자ID -> (질환, 의도)
    q_key = Counter()                     # (질환, 의도) -> 질문 수
    a_key = defaultdict(list)             # (질환, 의도) -> [진료과 tuple]
    disease_depts = defaultdict(Counter)  # 질환 -> 진료과 Counter
    intent_q, intent_a = Counter(), Counter()
    entity_types = Counter()
    entity_examples = defaultdict(Counter)
    symptom_q = 0
    symptom_q_with_symptom_entity = 0
    dept_names = Counter()
    dept_len = Counter()
    unknown, broken = 0, 0
    q_examples = defaultdict(list)
    folders = Counter()

    n = 0
    for path in paths:
        for p, raw in iter_json(path):
            n += 1
            if n % 50000 == 0:
                print(f"  {n:,}개 읽음...", flush=True)
            d = load(raw)
            if not isinstance(d, dict):
                broken += 1
                continue
            folders[os.path.dirname(p).split("/")[-1] if "/" in p else os.path.dirname(p)] += 1
            kind, num = parse_id(d.get("fileName"), p)
            if kind is None:
                kind = "A" if "answer" in d or "department" in d else ("Q" if "question" in d else None)
            dis = dname(d)
            intent = (d.get("intention") or "").strip()
            key = (dis, intent)

            if kind == "Q":
                intent_q[intent] += 1
                q_key[key] += 1
                if num:
                    q_ids[num] = key
                ents = d.get("entities") or []
                has_sym = False
                for e in ents:
                    et = str(e.get("entity", "")).strip()
                    entity_types[et] += 1
                    if len(entity_examples[et]) < 200:
                        entity_examples[et][str(e.get("text", "")).strip()] += 1
                    if "증상" in et:
                        has_sym = True
                if intent == "증상":
                    symptom_q += 1
                    if has_sym:
                        symptom_q_with_symptom_entity += 1
                if len(q_examples[intent]) < 3:
                    q_examples[intent].append((d.get("question") or "")[:40])
            elif kind == "A":
                intent_a[intent] += 1
                depts = tuple(sorted(as_list(d.get("department"))))
                a_key[key].append(depts)
                dept_len[len(depts)] += 1
                for dp in depts:
                    dept_names[dp] += 1
                    disease_depts[dis][dp] += 1
                if num:
                    a_ids[num] = key
            else:
                unknown += 1

    # ---------- 1) ID 직접 연결 검사 ----------
    def norm(x):
        return x.lstrip("0") or "0"

    q_norm = {norm(k): v for k, v in q_ids.items()}
    a_norm = {norm(k): v for k, v in a_ids.items()}
    common = set(q_norm) & set(a_norm)
    same_key = sum(1 for k in common if q_norm[k] == a_norm[k])
    id_link = {
        "질문_ID수": len(q_ids),
        "답변_ID수": len(a_ids),
        "질문_ID_자릿수": dict(Counter(len(k) for k in q_ids).most_common()),
        "답변_ID_자릿수": dict(Counter(len(k) for k in a_ids).most_common()),
        "질문_ID_범위": [min(q_ids, key=int), max(q_ids, key=int)] if q_ids else None,
        "답변_ID_범위": [min(a_ids, key=int), max(a_ids, key=int)] if a_ids else None,
        "숫자가_같은_Q_A_쌍": len(common),
        "그중_질환과_의도까지_같은_쌍": same_key,
    }
    if common:
        id_link["판정"] = (
            "ID로 연결 가능성 높음" if same_key / len(common) > 0.9
            else "숫자만 우연히 겹침 (ID로 연결 불가)"
        )
    else:
        id_link["판정"] = "겹치는 ID 없음 → ID로 연결 불가, (질환명, 의도)로 연결해야 함"

    # ---------- 2) (질환, 의도) 키 연결 검사 ----------
    q_keys, a_keys = set(q_key), set(a_key)
    q_cov = sum(c for k, c in q_key.items() if k in a_keys)
    total_q = sum(q_key.values())
    multi_dept_set = sum(1 for v in a_key.values() if len(set(v)) > 1)
    key_link = {
        "질문의_(질환,의도)_종류": len(q_keys),
        "답변의_(질환,의도)_종류": len(a_keys),
        "공통_종류": len(q_keys & a_keys),
        "답변과_연결되는_질문_비율": round(q_cov / total_q * 100, 1) if total_q else 0,
        "같은_(질환,의도)인데_답변마다_진료과가_다른_경우": multi_dept_set,
    }

    # ---------- 3) 질환-진료과 ----------
    n_dis = len(disease_depts)
    dept_per_disease = Counter(len(c) for c in disease_depts.values())
    inconsistent = {
        d: dict(c.most_common()) for d, c in disease_depts.items() if len(c) > 1
    }

    # ---------- 4) 증상 질문 ----------
    symptom = {
        "intention=증상_질문수": symptom_q,
        "그중_증상_엔티티가_있는_질문수": symptom_q_with_symptom_entity,
        "증상_질문이_있는_질환수": len({k[0] for k in q_key if k[1] == "증상"}),
        "증상_질문의_질환중_진료과가_있는_질환수": len(
            {k[0] for k in q_key if k[1] == "증상"} & set(disease_depts)
        ),
    }

    report = {
        "읽은_JSON수": n,
        "깨진_파일수": broken,
        "질문/답변_판별불가": unknown,
        "1_ID_직접연결": id_link,
        "2_질환의도_키연결": key_link,
        "3_질환별_진료과": {
            "질환수": n_dis,
            "질환당_진료과_개수_분포": dict(sorted(dept_per_disease.items())),
            "답변당_진료과_개수_분포": dict(sorted(dept_len.items())),
            "진료과_이름_목록(답변수)": dict(dept_names.most_common()),
            "진료과가_여러개인_질환(최대50)": dict(list(inconsistent.items())[:50]),
        },
        "4_증상질문": symptom,
        "intention_질문": dict(intent_q.most_common()),
        "intention_답변": dict(intent_a.most_common()),
        "entity_종류": dict(entity_types.most_common()),
        "entity_예시(종류별_상위15)": {
            k: [t for t, _ in v.most_common(15)] for k, v in entity_examples.items()
        },
        "질문_예시(의도별_3개,앞40자)": dict(q_examples),
    }

    with open("aihub_check_report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    lines = []
    def w(s=""):
        lines.append(s)
    w(f"읽은 JSON: {n:,} (깨짐 {broken}, 판별불가 {unknown})")
    w("\n[1] 질문 ID ↔ 답변 ID 직접 연결")
    for k, v in id_link.items():
        w(f"  {k}: {v}")
    w("\n[2] (질환명, 의도)로 연결")
    for k, v in key_link.items():
        w(f"  {k}: {v}")
    w("\n[3] 질환별 진료과")
    w(f"  질환 수: {n_dis}")
    w(f"  질환당 진료과 개수 분포: {dict(sorted(dept_per_disease.items()))}")
    w(f"  답변당 진료과 개수 분포: {dict(sorted(dept_len.items()))}")
    w(f"  진료과 이름 {len(dept_names)}종: {', '.join(f'{k}({v})' for k, v in dept_names.most_common())}")
    w("\n[4] 증상 질문")
    for k, v in symptom.items():
        w(f"  {k}: {v}")
    w(f"\nintention(질문): {dict(intent_q.most_common())}")
    w(f"intention(답변): {dict(intent_a.most_common())}")
    w(f"entity 종류: {dict(entity_types.most_common())}")
    with open("aihub_check_report.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("\n".join(lines))
    print("\n저장: aihub_check_report.txt, aihub_check_report.json")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1:])