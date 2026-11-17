// 자유 입력 위험 표현 규칙(설계 §7). v1은 자리만: 규칙 파일 형식 검사와 평가 위치.
// 패턴은 LLM 모듈 normalizeTerm(NFKC → 소문자 → 공백 제거)으로 정규화한 메시지에 적용한다.
// 결과는 rule_id만 돌려준다(원문·걸린 위치는 남기지 않는다).
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {normalizeTerm} from '../llm/normalize.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FREE_TEXT_PATH = path.join(HERE, 'rules', 'free_text_v1.json');

const RULE_ID_RE = /^FT-[A-Za-z0-9-]{1,60}$/;
const RESULTS = new Set(['EMERGENCY_STOP', 'URGENT_NOTICE']);

export class FreeTextRuleError extends Error {
  constructor(problems) {
    super(`free-text rules: ${problems.join(' / ')}`);
    this.name = 'FreeTextRuleError';
    this.problems = problems;
  }
}

/**
 * 규칙 파일 객체를 검사하고 정규식을 만든다. 문제가 있으면 FreeTextRuleError.
 * @returns {{version:string, rules:Array<object>}}
 */
export function compileFreeTextRules(raw) {
  const problems = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new FreeTextRuleError(['객체가 아님']);
  if (typeof raw.version !== 'string' || !raw.version.trim()) problems.push('version 없음');
  if (!Array.isArray(raw.rules)) throw new FreeTextRuleError([...problems, 'rules 배열 없음']);
  const ids = new Set();
  const rules = raw.rules.map((r, i) => {
    const at = `rules[${i}]`;
    if (!r || typeof r !== 'object') { problems.push(`${at}: 객체 아님`); return null; }
    if (typeof r.rule_id !== 'string' || !RULE_ID_RE.test(r.rule_id)) problems.push(`${at}: rule_id 형식(FT-…)`);
    else if (ids.has(r.rule_id)) problems.push(`${at}: rule_id 중복`);
    ids.add(r.rule_id);
    if (!Number.isInteger(r.priority) || r.priority < 1 || r.priority > 9) problems.push(`${at}: priority는 1~9 정수`);
    const regexes = [];
    if (!Array.isArray(r.patterns) || r.patterns.length === 0) problems.push(`${at}: patterns 1개 이상`);
    else {
      r.patterns.forEach((p, j) => {
        if (typeof p !== 'string' || !p) { problems.push(`${at}.patterns[${j}]: 빈 문자열`); return; }
        try { regexes.push(new RegExp(p, 'u')); } catch { problems.push(`${at}.patterns[${j}]: 정규식 오류`); }
      });
    }
    if (!RESULTS.has(r.result)) problems.push(`${at}: result`);
    if (typeof r.terminal !== 'boolean') problems.push(`${at}: terminal 필수(boolean)`);
    if (typeof r.message_key !== 'string' || !r.message_key.trim()) problems.push(`${at}: message_key 필수`);
    if (!r.evidence || typeof r.evidence !== 'object' || typeof r.evidence.source !== 'string' || !r.evidence.source) problems.push(`${at}: evidence 필수(source)`);
    if (r.triage_category_id !== undefined && r.triage_category_id !== null && !Number.isInteger(r.triage_category_id)) problems.push(`${at}: triage_category_id`);
    return {
      ruleId: r.rule_id,
      priority: r.priority,
      result: r.result,
      terminal: r.terminal,
      triageCategoryId: r.triage_category_id ?? null,
      messageKey: r.message_key,
      reviewStatus: r.review_status ?? null,
      regexes,
    };
  });
  if (problems.length > 0) throw new FreeTextRuleError(problems);
  return {version: raw.version, rules};
}

const cache = new Map();

/** 규칙 파일을 읽어 검사한다(캐시). */
export function loadFreeTextRules(file = DEFAULT_FREE_TEXT_PATH) {
  const key = path.resolve(file);
  if (!cache.has(key)) cache.set(key, compileFreeTextRules(JSON.parse(readFileSync(key, 'utf8'))));
  return cache.get(key);
}

/**
 * 정규화한 문자열에서 글자·숫자가 아닌 것과 홀로 쓴 한글 자모를 지운다.
 * NFKC가 호환 자모(ㅠ U+3160 등)를 첫가끝 자모(U+1100~U+11FF)로 바꾸므로 두 범위와 확장 자모를 모두 지운다.
 * 완성형 음절(가~힣)은 NFKC 뒤에도 그대로라 지워지지 않는다.
 */
export function stripNoise(t) {
  return String(t ?? '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .replace(/[ᄀ-ᇿㄱ-ㆎꥠ-꥿ힰ-퟿]/g, '');
}

/**
 * 메시지마다 정규화한 뒤 패턴 검사. 걸린 규칙의 ruleId 목록(중복 없음, 규칙 파일 순서).
 * @param {string[]} messages
 * @param {{rules:Array<object>}} ruleSet compileFreeTextRules 결과
 */
export function matchFreeText(messages, ruleSet) {
  const byMsg = matchFreeTextByMessage(messages, ruleSet);
  const hit = new Set(byMsg.flat());
  return (ruleSet?.rules ?? []).filter((r) => hit.has(r.ruleId)).map((r) => r.ruleId);
}

/**
 * 11/17 RF2: 메시지 위치별로 걸린 규칙(확인 질문 범위 계산용). 결과는 엔진 안에서만 쓰고 trace·로그에 남기지 않는다.
 * @param {string[]} messages 문자열이 아닌 항목은 빈 목록
 * @returns {string[][]} messages와 같은 길이, 각 메시지에서 걸린 ruleId(규칙 파일 순서)
 */
export function matchFreeTextByMessage(messages, ruleSet) {
  const list = Array.isArray(messages) ? messages : [];
  if (!ruleSet?.rules?.length) return list.map(() => []);
  return list.map((m) => {
    if (typeof m !== 'string') return [];
    const t = normalizeTerm(m);
    if (!t) return [];
    const texts = [t];
    const stripped = stripNoise(t);
    if (stripped && stripped !== t) texts.push(stripped);
    return ruleSet.rules.filter((rule) => texts.some((x) => rule.regexes.some((re) => re.test(x)))).map((rule) => rule.ruleId);
  });
}

