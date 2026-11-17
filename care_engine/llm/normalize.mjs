// 문자열 정규화.
// normalizeTerm은 data_pipeline/pipeline/01e_merge_labels.py의 norm()과 같은 규칙이다
// (03c_merge_labels_t3.py도 같은 함수를 불러 쓴다):
//   "".join(unicodedata.normalize("NFKC", term).lower().split())
// Python str.split()이 자르는 공백 문자 집합(str.isspace + 0x1C~0x1F)을 그대로 옮겼다.

// Python 공백 문자의 코드 포인트(소스에 보이지 않는 문자를 직접 넣지 않으려고 숫자로 적는다)
const PY_WHITESPACE_CODES = [
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
];
const PY_WHITESPACE = new Set(PY_WHITESPACE_CODES);

export const INPUT_MAX_CHARS = 500;

export function normalizeTerm(s) {
  if (s == null) return '';
  let out = '';
  for (const ch of String(s).normalize('NFKC').toLowerCase()) {
    if (!PY_WHITESPACE.has(ch.codePointAt(0))) out += ch;
  }
  return out;
}

/** 문자열의 마지막 max 글자(코드 포인트 기준). */
export function tailChars(s, max = INPUT_MAX_CHARS) {
  const cps = Array.from(String(s ?? ''));
  return cps.length > max ? cps.slice(cps.length - max).join('') : cps.join('');
}

/** 사용자 입력용: normalizeTerm 후 500자 제한(넘으면 마지막 500자). */
export function normalizeInput(s) {
  return tailChars(normalizeTerm(s), INPUT_MAX_CHARS);
}
