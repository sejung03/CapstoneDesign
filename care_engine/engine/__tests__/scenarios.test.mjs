// E6: 경로 시나리오(가짜 사용자), 도달 가능성, 원문 유출, 시간·취소·결정성.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {simulate, scenarios, makeLlm, TEXT, fixedQuestionCount} from '../../eval/engine_scenarios.mjs';
import {ENGINE_QUESTION_IDS} from '../answers.mjs';
import {neverAskedItems} from '../flow.mjs';
import {data, SAFE_BASE, fakeLlm, confirmFor, call} from './helpers.mjs';

const results = new Map();
async function get(name) {
  if (!results.has(name)) {
    const s = scenarios().find((x) => x.name === name);
    assert.ok(s, name);
    results.set(name, await simulate(s));
  }
  return results.get(name);
}
const SAFETY_LINE = '응급 확인 질문에 답하지 않았어요.';

test('모든 시나리오: 끝까지 돌고 모든 응답이 계약 검사 통과', async () => {
  for (const s of scenarios()) {
    const r = await get(s.name);
    assert.deepEqual(r.contractErrors, [], s.name);
    assert.ok(!r.resultKind.startsWith('error') && r.resultKind !== 'unfinished', `${s.name}: ${r.resultKind}`);
    // 응급이 아닌 결과에는 emergency가 없고, 응급 결과에는 search가 없다
    if (r.resultKind === 'emergency') assert.equal(r.final.search, undefined, s.name);
  }
});

test('질문 수: 사실 확인 §8 표와 비교(약국 0, 증상 19~24, 증상 확인 직후 skip 8, 증상 모름 20~25, 약 의도 8)', async () => {
  const diffs = [];
  for (const s of scenarios()) {
    if (!s.expect) continue;
    const r = await get(s.name);
    if (r.questionCount < s.expect[0] || r.questionCount > s.expect[1]) diffs.push(`${s.name}: ${r.questionCount} (표 ${s.expect.join('~')})`);
  }
  // c24 형태는 사전 확인 + LLM 확인으로 엔진 질문이 2개(표에 없는 경로). 그 밖에는 표와 같아야 한다.
  assert.deepEqual(diffs, []);
  assert.equal((await get('pharmacy_keyword')).questionCount, 0);
  assert.equal((await get('dict_min')).questionCount, 19);
  assert.equal((await get('dict_max')).questionCount, 24);
  assert.equal((await get('dict_skip_after_identify')).questionCount, 8);
  assert.equal((await get('llm_fail')).questionCount, 25);
  assert.equal((await get('med_pharmacy')).questionCount, 8);
  assert.equal((await get('c24_dict_partial')).engineQuestionCount, 2);
});

test('경로 결과: 약국 키워드·사전·LLM·LLM 실패·약 의도·기관 LLM·시작 질문', async () => {
  assert.deepEqual((await get('pharmacy_keyword')).final, {search: {type: 'pharmacy', department: 'pharmacy', openOnly: true}});
  const dict = await get('dict_min');
  assert.equal(dict.finalTrace.symptom.id, 'R05');
  assert.equal(dict.llmCalls.classify, 0);
  const llm = await get('llm_confirm');
  assert.equal(llm.finalTrace.symptom.source, 'llm_confirm');
  assert.equal(llm.llmCalls.classify, 1);
  const fail = await get('llm_fail');
  assert.ok(fail.asked.includes('SYM_NOT_FOUND') && fail.asked.includes('F2'));
  assert.equal(fail.finalTrace.symptom.fallbackGroup, 'general');
  assert.ok(fail.final.summary.ko.includes('주된 증상: 목록에서 찾지 못함'));
  assert.deepEqual((await get('fallback_injury')).final.search, {type: 'hospital', department: 'orthopedics'});
  assert.ok((await get('keyword_symptom_cue')).asked[0] === 'Q0');
  assert.deepEqual((await get('med_pharmacy')).final, {search: {type: 'pharmacy', department: 'pharmacy'}});
  assert.ok((await get('med_info')).final.summary.ko.includes('약사나 의사에게'));
  assert.ok((await get('med_symptom')).asked.includes('F2'));
  assert.deepEqual((await get('facility_llm')).final, {search: {type: 'hospital'}});
  assert.deepEqual((await get('other_ask_start')).final, {search: {type: 'pharmacy', department: 'pharmacy'}});
  assert.deepEqual((await get('no_message_ask_start')).final, {search: {type: 'hospital'}});
});

test('c24 형태: 사전 확인(정답 없음) → sym_other → LLM 후보에서 정답 → 확정, LLM 1회', async () => {
  const r = await get('c24_dict_partial');
  assert.deepEqual(r.asked.slice(7, 9), ['SYM_DICT_CONFIRM', 'SYM_CONFIRM']);
  const dictQ = r.responses.find((x) => x.response.followUp?.id === 'SYM_DICT_CONFIRM').response.followUp;
  assert.ok(!dictQ.options.some((o) => o.id === 'sym_A11'));
  assert.equal(r.finalTrace.symptom.id, 'A11');
  assert.equal(r.llmCalls.classify, 1);
});

test('안전·대상 질문(Q0~T3) 동안 LLM 0회, 증상 확인은 T3 다음에만', async () => {
  for (const s of scenarios()) {
    const r = await get(s.name);
    const idx = r.asked.findIndex((id) => ENGINE_QUESTION_IDS.includes(id));
    if (idx >= 0) {
      assert.equal(r.asked[idx - 1], 'T3', `${s.name}: ${r.asked.join(',')}`);
      // 엔진 질문이 처음 나오기 전 응답들의 trace에는 LLM 호출이 없다
      const before = r.responses.slice(0, idx);
      assert.ok(before.every((x) => !x.trace.llm.classify.called), s.name);
    }
  }
});

test('응급: Q0=예 → E 문항 → emergency + 119 정리, N1 모름 → 긴급 안내만', async () => {
  const q0 = await get('q0_emergency');
  assert.deepEqual(q0.asked, ['Q0', 'E1', 'E2', 'E4', 'E5', 'E6', 'E7', 'E8', 'E8-1', 'E9', 'E9-1']);
  assert.ok(q0.responses.slice(1).every((x) => x.response.emergency?.active === true && !x.response.search));
  assert.ok(q0.final.summary.ko.startsWith('119에 알릴 내용이에요'));
  const n1 = await get('n1_unknown');
  assert.deepEqual(Object.keys(n1.final), ['emergency']);
});

test('대상: 아이 → 소아청소년과, 남성 → 산부인과 없음(같은 증상 여성은 있음), 아이 + 증상 모름 → general', async () => {
  assert.deepEqual((await get('child_known')).final.search, {type: 'hospital', department: 'pediatrics'});
  const male = await get('male');
  assert.ok(!male.final.summary.ko.includes('산부인과'));
  assert.ok((await get('female_adult')).final.summary.ko.includes('산부인과'));
  assert.equal((await get('child_unknown')).finalTrace.symptom.fallbackGroup, 'general');
  // 본인이 아니면 건강정보 추출 0회
  assert.equal((await get('child_known')).llmCalls.profile, 0);
});

test('skip 여러 시점: Q0 직후는 안전 미응답 문구, T1 뒤(안전 질문 답함)는 없음, 증상 확인 직후 8문항', async () => {
  const q0 = await get('skip_after_q0');
  assert.ok(q0.usedSkip);
  assert.ok(q0.final.summary.ko.startsWith(SAFETY_LINE));
  assert.ok(q0.final.search);
  const t1 = await get('skip_after_t1');
  assert.ok(!t1.final.summary.ko.includes(SAFETY_LINE));
  const id = await get('dict_skip_after_identify');
  assert.ok(id.usedSkip && id.final.summary.ko.includes('주된 증상: '));
});

test('도달 가능성: 엔진이 묻는 문항 34개 + 엔진 질문 5개가 시나리오에서 한 번 이상 나온다', async () => {
  const seen = new Set();
  for (const s of scenarios()) for (const id of (await get(s.name)).asked) seen.add(id);
  const never = new Set(neverAskedItems(data));
  const askable = data.items.map((i) => i.linkId).filter((id) => !never.has(id));
  assert.equal(askable.length, 34);
  assert.equal(fixedQuestionCount(), 34);
  const missing = [...askable, ...ENGINE_QUESTION_IDS].filter((id) => !seen.has(id));
  assert.deepEqual(missing, []);
  for (const id of never) assert.ok(!seen.has(id), `${id}가 나옴`);
});

test('답 수정: 안전 답을 바꾸면(뒤 답은 프론트가 지움) 규칙이 다시 계산된다', async () => {
  let r = (await call({reason: 'followup', messages: [TEXT.dict], answers: {...SAFE_BASE}})).out;
  assert.equal(r.response.followUp.id, 'SYM_DICT_CONFIRM');
  r = (await call({reason: 'followup', messages: [TEXT.dict], answers: {Q0: 'no', N1: 'yes', N2: 'no'}})).out;
  assert.deepEqual(Object.keys(r.response), ['emergency']);
  r = (await call({reason: 'followup', messages: [TEXT.dict], answers: {Q0: 'no', N1: 'yes', N2: 'yes'}})).out;
  assert.equal(r.response.followUp.id, 'N3');
  assert.equal(r.response.emergency, undefined);
});

test('원문 유출: 표식 문자열이 trace·로그에 없다(LLM·건강정보 경로 포함)', async () => {
  const MARK = 'LEAK_SENTINEL_9f3';
  const item = {id: 'age-1', field: 'age', operation: 'set', value: '30', evidence: {kind: 'message', index: 0, quote: MARK}};
  const runs = [
    await simulate({name: 'leak_llm', messages: [`${TEXT.noDict} ${MARK}`], answers: {...SAFE_BASE, SYM_CONFIRM: 'sym_D01'},
      llm: makeLlm({classify: confirmFor(['D01']), profile: {items: [item], meta: {}}})}),
    await simulate({name: 'leak_dict', messages: [`${TEXT.dict} ${MARK}`], answers: {...SAFE_BASE, SYM_DICT_CONFIRM: 'sym_R05'}, skipAt: 'N5',
      llm: makeLlm({profile: {items: [item], meta: {}}})}),
    await simulate({name: 'leak_kw', messages: [`문 연 약국 ${MARK}`], answers: {}}),
    await simulate({name: 'leak_em', messages: [MARK], answers: {Q0: 'yes'}}),
  ];
  for (const r of runs) {
    for (const x of r.responses) assert.ok(!JSON.stringify(x.trace).includes(MARK), `${r.name} trace`);
    assert.ok(!JSON.stringify(r.logs).includes(MARK), `${r.name} log`);
  }
  // 응답의 profileUpdates quote는 계약상 원문 조각이다(프론트가 확인) — trace에는 개수·field만
  assert.deepEqual(runs[0].final.profileUpdates, [item]);
  assert.deepEqual(runs[0].finalTrace.llm.profile.fields, ['age']);
});

test('시간: LLM이 deadline 뒤에 끝나면 SYM_NOT_FOUND', async () => {
  const llm = fakeLlm({classify: confirmFor(['D01']), classifyDelayMs: 400});
  const t0 = Date.now();
  const {out} = await call({reason: 'followup', messages: [TEXT.noDict], answers: SAFE_BASE, llm, ctx: {deadlineAt: Date.now() + 60}});
  assert.equal(out.response.followUp.id, 'SYM_NOT_FOUND');
  assert.equal(out.trace.llm.classify.fallbackReason, 'timeout');
  assert.ok(Date.now() - t0 < 350, '늦은 LLM을 기다리지 않는다');
});

test('취소: LLM 호출 중 signal이 끊기면 aborted', async () => {
  const ctrl = new AbortController();
  const llm = fakeLlm({classify: confirmFor(['D01']), classifyDelayMs: 300});
  setTimeout(() => ctrl.abort(), 20);
  const {out} = await call({reason: 'followup', messages: [TEXT.noDict], answers: SAFE_BASE, llm, ctx: {signal: ctrl.signal}});
  assert.deepEqual([out.response, out.error], [null, 'aborted']);
});

test('결정성: 같은 입력 두 번 → 같은 응답·trace', async () => {
  const args = {reason: 'followup', messages: [TEXT.noDict], answers: {...SAFE_BASE, SYM_CONFIRM: 'sym_D01', N5: 'yes'}};
  const a = await call({...args, llm: fakeLlm({classify: confirmFor(['D01'])})});
  const b = await call({...args, llm: fakeLlm({classify: confirmFor(['D01'])})});
  assert.deepEqual(a.out, b.out);
  const c = await call({reason: 'followup', messages: [TEXT.noDict], answers: SAFE_BASE, llm: fakeLlm({classify: confirmFor(['D01', 'D02'])})});
  const d = await call({reason: 'followup', messages: [TEXT.noDict], answers: SAFE_BASE, llm: fakeLlm({classify: confirmFor(['D01', 'D02'])})});
  assert.deepEqual(c.out, d.out);
});
