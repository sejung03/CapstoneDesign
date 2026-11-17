// 11/17 R5: 위험 표현 사전(free_text_v1.json)과 runCare 연결. 문장은 모두 지어낸 짧은 문장(평가셋 risk_v1.jsonl)이다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {loadFreeTextRules, compileFreeTextRules, DEFAULT_FREE_TEXT_PATH} from '../free-text.mjs';
import {EMERGENCY_TEXT, withCrisis109, CRISIS_109_ADDON} from '../templates.mjs';
import {call, fakeLlm, SAFE_BASE} from './helpers.mjs';
import {loadRiskCases, runRiskEval} from '../../eval/risk_eval.mjs';
import {pharmacyStarterText} from '../../eval/engine_scenarios.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(readFileSync(DEFAULT_FREE_TEXT_PATH, 'utf8'));
const CRITERIA_DOC = readFileSync(path.resolve(HERE, '../../docs/위험표현_기준표.md'), 'utf8');
const CASES = loadRiskCases();
const POSITIVE = CASES.filter((c) => c.group === 'positive');
const byId = (id) => CASES.find((c) => c.id === id);

/** 기준표 §3(결과 있음) 표의 행: 기준ID → {result, ruleId} */
function criteriaRows() {
  const sec = CRITERIA_DOC.split('## 3.')[1].split('## 4.')[0];
  const rows = new Map();
  for (const line of sec.split(/\r?\n/)) {
    const cells = line.split('|').map((s) => s.trim());
    if (/^C-\d{2}$/.test(cells[1] ?? '')) rows.set(cells[1], {result: cells[4], ruleId: cells[6]});
  }
  return rows;
}

test('R5: free_text_v1.json — 기존 로더 형식 검사 통과, 규칙 40개, 모두 draft·terminal, priority 범위(ES 1~3, UN 4~7, 109 8)', () => {
  const rules = loadFreeTextRules();
  assert.equal(rules.rules.length, 40);
  assert.doesNotThrow(() => compileFreeTextRules(RAW));
  for (const r of RAW.rules) {
    assert.equal(r.review_status, 'draft', r.rule_id);
    assert.equal(r.terminal, true, r.rule_id);
    assert.ok(r.patterns.length <= 20, `${r.rule_id}: 패턴 20개 초과`);
    if (r.result === 'EMERGENCY_STOP') { assert.ok(r.priority >= 1 && r.priority <= 3, r.rule_id); assert.equal(r.message_key, 'freetext_emergency_119'); }
    else if (r.message_key === 'crisis_notice_109') assert.equal(r.priority, 8, r.rule_id);
    else { assert.ok(r.priority >= 4 && r.priority <= 7, r.rule_id); assert.equal(r.message_key, 'freetext_urgent'); }
    for (const p of r.patterns) assert.ok(!/\s/.test(p), `${r.rule_id}: 패턴에 공백`);
  }
});

test('R5: 모든 규칙의 evidence.criteria_id가 기준표(결과 있음)에 있고, 결과·규칙 ID가 서로 맞는다', () => {
  const rows = criteriaRows();
  assert.equal(rows.size, 40);
  const short = {EMERGENCY_STOP: 'ES', URGENT_NOTICE: 'UN'};
  for (const r of RAW.rules) {
    const row = rows.get(r.evidence?.criteria_id);
    assert.ok(row, `${r.rule_id}: 기준표에 ${r.evidence?.criteria_id} 없음`);
    assert.equal(row.ruleId, r.rule_id, r.evidence.criteria_id);
    const expect = r.message_key === 'crisis_notice_109' ? 'UN+109' : short[r.result];
    assert.equal(row.result, expect, r.rule_id);
    assert.ok(['emergency_act_rule_annex1', 'manual_119'].includes(r.evidence.source), r.rule_id);
    assert.ok(typeof r.evidence.ref === 'string' && r.evidence.ref.length > 0, r.rule_id);
  }
  // 기준표의 결과 있는 기준은 모두 규칙이 있다
  assert.deepEqual([...rows.keys()].sort(), RAW.rules.map((r) => r.evidence.criteria_id).sort());
});

test('R5: 평가셋 통과 기준(positive 누락 0, metaphor·nonemergency·facility 오탐 0)', () => {
  const r = runRiskEval();
  assert.equal(r.pass, true, JSON.stringify({fp: r.falsePositives, miss: r.misses, key: r.keyMismatches}));
  assert.equal(r.groups.positive.n, POSITIVE.length);
});

test('R5(+RF2): 첫 메시지가 positive 표현 → 첫 응답은 emergency(+ freetext_urgent면 확인 질문), search·진료과 없음, LLM 0', async () => {
  // 11/17 RF2: freetext_urgent는 확인 질문(RISK_CONFIRM_1)이 함께 나가고 아직 terminal이 아니다('예'일 때만 terminal)
  for (const c of POSITIVE) {
    const llm = fakeLlm();
    const {out, calls} = await call({messages: [c.text], llm});
    const urgent = c.expect_key === 'freetext_urgent';
    assert.deepEqual(Object.keys(out.response).sort(), urgent ? ['emergency', 'followUp'] : ['emergency'], c.id);
    if (urgent) assert.equal(out.response.followUp.id, 'RISK_CONFIRM_1', c.id);
    assert.equal(out.response.emergency.active, true, c.id);
    assert.equal(out.response.emergency.message.ko, EMERGENCY_TEXT[c.expect_key].message, c.id);
    assert.equal(out.trace.terminal, !urgent, c.id);
    assert.equal(calls.classify.length + calls.profile.length, 0, c.id);
  }
});

test('R5: EMERGENCY_STOP 표현은 Q0=예일 때만 E 문항(119 정리)이 이어진다. URGENT는 Q0=예여도 답 규칙(EMERGENCY_STOP)이 먼저', async () => {
  const es = byId('r003'); // 숨을 안 쉼
  const yes = await call({reason: 'followup', messages: [es.text], answers: {Q0: 'yes'}});
  assert.equal(yes.out.response.emergency.active, true);
  assert.equal(yes.out.response.followUp?.id, 'E1');
  const no = await call({reason: 'followup', messages: [es.text], answers: {Q0: 'no'}});
  assert.deepEqual(Object.keys(no.out.response), ['emergency']);
});

test('R5: 약국 시작 문장 + 위험 표현 → 약국 지름길이 아니라 응급 안내(안전 규칙이 먼저)', async () => {
  const {out} = await call({messages: [pharmacyStarterText(), byId('r041').text]});
  assert.equal(out.response.search, undefined);
  assert.equal(out.response.emergency.active, true);
  assert.equal(out.trace.facilityKeyword, null);
  assert.deepEqual(out.trace.ruleHits, ['FT-GIBLEED-01']);
});

test('R5(+RF2): 위험 표현 뒤 Q0=아니요·안전 답 SAFE로는 응급 안내가 풀리지 않는다 — RISK_CONFIRM 답으로만 풀린다', async () => {
  // 11/17 RF2로 바꾼 이유: 예전에는 한 번 걸리면 대화 끝까지 응급 안내만 나갔다(검토 I7). 이제 freetext_urgent는
  // 확인 질문 답(예/아니요/잘 모르겠어요)으로만 처리가 바뀌고, Q0·N1~N3 같은 안전 답으로는 풀리지 않는다.
  const m = byId('r025').text; // 가슴 쥐어짜는 통증
  for (const answers of [{Q0: 'no'}, {...SAFE_BASE}]) {
    const {out} = await call({reason: 'followup', messages: [m], answers});
    assert.equal(out.response.emergency.active, true);
    assert.equal(out.response.followUp.id, 'RISK_CONFIRM_1');
    assert.ok(out.trace.ruleHits.includes('FT-CHEST-01'));
  }
  // 확인 전 skip → '예'로 본다(보수적): 응급 안내만
  const skip = await call({reason: 'skip', messages: [m], answers: {Q0: 'no'}});
  assert.deepEqual(Object.keys(skip.out.response), ['emergency']);
  // RISK_CONFIRM_1 = 아니요 → 안내 해제(active:false) + 문진 계속
  const no = await call({reason: 'followup', messages: [m], answers: {Q0: 'no', RISK_CONFIRM_1: 'risk_no'}});
  assert.equal(no.out.response.emergency.active, false);
  assert.equal(no.out.response.followUp.id, 'N1');
});

test('R5: 자해·자살 생각 → crisis_notice_109 문구의 emergency, 진료과·search 없음', async () => {
  for (const id of ['r077', 'r078', 'r079', 'r080', 'o007']) {
    const {out} = await call({messages: [byId(id).text]});
    assert.deepEqual(Object.keys(out.response), ['emergency'], id);
    assert.equal(out.response.emergency.title.ko, EMERGENCY_TEXT.crisis_notice_109.title, id);
    assert.equal(out.response.emergency.message.ko, EMERGENCY_TEXT.crisis_notice_109.message, id);
    assert.deepEqual(out.trace.ruleHits, ['FT-SELFHARM-THINK-01'], id);
  }
});

test('R5: 우선순위 — EMERGENCY_STOP 표현 + 자해 생각 표현이 함께 있으면 EMERGENCY_STOP(119 문구), 걸린 규칙은 모두 trace', async () => {
  // 11/17 R6(검토 I5): 앞선 규칙 문구에 109 한 문장이 덧붙는다(109가 사라지지 않게)
  const {out} = await call({messages: [byId('r077').text, byId('r019').text]});
  assert.equal(out.response.emergency.title.ko, EMERGENCY_TEXT.freetext_emergency_119.title);
  assert.equal(out.response.emergency.message.ko, withCrisis109({message: {ko: EMERGENCY_TEXT.freetext_emergency_119.message}}).message.ko);
  assert.ok(out.response.emergency.message.ko.startsWith('생명이 위험할 수 있는 상황으로 보여요. 바로 119에 전화하세요.'));
  assert.ok(out.response.emergency.message.ko.includes('109'));
  assert.ok(out.response.emergency.message.ko.endsWith('이 서비스는 진단을 하지 않아요.'));
  assert.deepEqual(out.trace.ruleHits, ['FT-SELFHARM-ACT-01', 'FT-SELFHARM-THINK-01']);
  // 11/17 RF2: URGENT(확인 전) + 109 → 109 안내(확인 질문 없음). 확인 전 urgent는 top 후보에서 빠진다
  const u = await call({messages: [byId('r078').text, byId('r023').text]});
  assert.equal(u.out.response.emergency.message.ko, EMERGENCY_TEXT.crisis_notice_109.message);
  assert.equal(u.out.response.followUp, undefined);
  // 109가 함께 걸리지 않으면 덧붙이지 않는다('예'로 확인한 urgent)
  const plain = await call({reason: 'followup', messages: [byId('r023').text], answers: {RISK_CONFIRM_1: 'risk_yes'}});
  assert.equal(plain.out.response.emergency.message.ko, EMERGENCY_TEXT.freetext_urgent.message);
  assert.ok(CRISIS_109_ADDON.length > 0);
  // 답 규칙(priority 10 이상)보다 자유 입력 규칙(1~9)이 먼저
  const a = await call({reason: 'followup', messages: [byId('r003').text], answers: {Q0: 'no', N1: 'no'}});
  assert.equal(a.out.trace.ruleHits[0], 'FT-APNEA-01');
  assert.equal(a.out.response.emergency.message.ko, EMERGENCY_TEXT.freetext_emergency_119.message);
});

test('R5: trace.ruleHits에는 rule_id만 — 원문·패턴이 trace·로그에 없다(표식 문자열)', async () => {
  const MARK = 'LEAK_SENTINEL_r5';
  const patterns = RAW.rules.flatMap((r) => r.patterns);
  for (const c of [...POSITIVE.slice(0, 20), byId('r077'), byId('r019')]) {
    const text = `${c.text} ${MARK}`;
    const {out, logs} = await call({messages: [text]});
    const seen = JSON.stringify({trace: out.trace, logs});
    assert.ok(!seen.includes(MARK), c.id);
    assert.ok(!seen.includes(c.text), c.id);
    for (const id of out.trace.ruleHits) assert.match(id, /^FT-[A-Z0-9-]+$/);
    for (const p of patterns.filter((x) => x.length >= 6)) assert.ok(!seen.includes(p), `${c.id}: 패턴이 trace·로그에`);
    assert.ok(!JSON.stringify(out.response).includes(MARK), c.id);
  }
});

test('R5: 위험 표현이 없는 평가 문장(nonemergency·metaphor·facility)은 응급 안내 없이 기존 흐름(Q0 또는 약국 지름길)', async () => {
  for (const c of CASES.filter((x) => ['nonemergency', 'metaphor', 'facility'].includes(x.group))) {
    const {out} = await call({messages: [c.text]});
    assert.equal(out.response.emergency, undefined, c.id);
    assert.deepEqual(out.trace.ruleHits, [], c.id);
    assert.ok(out.response.followUp?.id === 'Q0' || out.response.search?.type === 'pharmacy', c.id);
  }
});

test('R6(검토 S6): 구두점·이모지·홀로 쓴 자모가 어간 사이에 있어도 걸린다(두 번째 정규화 문자열), 완성형 음절은 지우지 않는다', async () => {
  const {stripNoise, matchFreeText} = await import('../free-text.mjs');
  const rules = loadFreeTextRules();
  assert.equal(stripNoise('숨을...안쉬어요'), '숨을안쉬어요');
  assert.equal(stripNoise('가나다ㅠㅠ'.normalize('NFKC')), '가나다'); // 자음+모음 자모(ㄱㅠ)는 NFKC가 음절(규)로 합치므로 지워지지 않는다(보고서에 적음)
  for (const t of ['숨을...안 쉬어요', '숨을 ㅠㅠ 안쉬어요', '의식이, 없어요!!', '피를 🩸 토했어요']) {
    assert.ok(matchFreeText([t], rules).length > 0, t);
  }
  assert.deepEqual(matchFreeText(['오늘 점심 뭐 먹지?? ㅋㅋ'], rules), []);
});
