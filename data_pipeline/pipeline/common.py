"""1단계 공용: 경로, AiHub_check 함수 import, 답변 본문 꺼내기."""
import ast
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 원본 폴더: 환경 변수 MH_RAW_DIR가 있으면 그 경로(상대 경로면 data_pipeline/ 기준), 없으면 data/raw/
RAW = os.path.join(ROOT, os.environ.get("MH_RAW_DIR") or os.path.join("data", "raw"))
INTERIM = os.path.join(ROOT, "data", "interim")
REPORTS = os.path.join(ROOT, "reports")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # AiHub_check.py는 pipeline/ 안에 있다
try:
    from aihub_check import iter_json, load, dname  # noqa: E402,F401
except ModuleNotFoundError:  # 실제 파일명이 AiHub_check.py (import는 대소문자 구분)
    from AiHub_check import iter_json, load, dname  # noqa: E402,F401


def answer_text(d):
    """answer 칸은 dict 또는 dict 모양의 문자열. intro+body+conclusion을 합쳐 돌려준다."""
    ans = d.get("answer") or {}
    if isinstance(ans, str):
        try:
            ans = ast.literal_eval(ans)
        except (ValueError, SyntaxError):
            return ans
    if not isinstance(ans, dict):
        return str(ans)
    return "\n".join(str(ans.get(k) or "") for k in ("intro", "body", "conclusion")).strip()


def is_symptom_answer(d):
    name = str(d.get("fileName") or "")
    return name.upper().startswith("HC-A-") and (d.get("intention") or "").strip() == "증상"


def find_master():
    for fn in os.listdir(RAW):
        if "상병마스터" in fn:
            return os.path.join(RAW, fn)
    raise FileNotFoundError(f"{RAW}에 상병마스터 파일이 없음")
