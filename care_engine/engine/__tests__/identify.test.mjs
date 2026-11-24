import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadIntakeData} from '../intake-data.mjs';
import {normalizeAnswers} from '../answers.mjs';
import {identify} from '../identify.mjs';
import {matchSymptoms} from '../dictionary-match.mjs';
import {checkFollowUpContract, buildSymptomConfirm} from '../../llm/confirm-question.mjs';
import {classifySymptom} from '../../llm/index.mjs';
import {createMockProvider} from '../../llm/providers/mock.mjs';
import {getConfig} from '../../llm/config.mjs';

const data = loadIntakeData();
const ref = data.refData;
const BASE = {Q0: 'no', N1: 'yes', N2: 'yes', N3: 'no', T1: 'self', T2: 'female', T3: 'age_19_64'};
const NO_DICT = '속이 영 이상하고 불편해요'; // 지어낸 문장(사전 매칭 0개)
const C24 = '식은땀이 나고 가슴이 꽉 조이는 느낌이에요'; // 지어낸 문장: 사전이 부수 증상(땀)만 맞힘

/** 가짜 classifySymptom: 호출 기록 + 정해진 결과 */
function fakeLlm(result, {delayMs = 0} = {}) {
  const calls = [];
  const fn = async (input) => {
    calls.push(input);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return typeof result === 'function' ? result(input) : result;
  };
  return {calls, fn};
}

async function run({answers = {}, messages = [], llm = fakeLlm({status: 'fallback', reason: 'no_match', meta: {}}), deadlineMs = 5000, deps = {}} = {}) {
  const list = Object.entries({...BASE, ...answers}).map(([questionId, value]) => ({questionId, value}));
  const {codes, engine} = normalizeAnswers(list, data);
  const now = Date.now;
  const r = await identify({
    engineAnswers: engine, messages, codes, data,
    deps: {llm: {classifySymptom: llm.fn}, ...deps},
    ctx: {consent: {granted: true, provider: 'mock', version: 'test-v1', healthInfo: true}, deadlineAt: now() + deadlineMs, requestId: 'r1', reason: 'followup', now},
  });
  return {r, calls: llm.calls};
}

const confirmFor = (picks) => ({status: 'confirm', followUp: buildSymptomConfirm(picks, ref, 'ko'), meta: {provider: 'fake', candidateCount: 3}});

test('a. SYM_CONFIRM 답: 증상 ID → 확정(llm_confirm), sym_none·sym_unsure·이상한 값 → 모름, LLM 0회', async () => {
  let x = await run({answers: {SYM_CONFIRM: 'sym_R05'}, messages: [NO_DICT]});
  assert.deepEqual(x.r, {kind: 'symptom', symptomId: 'R05', source: 'llm_confirm'});
  assert.equal(x.calls.length, 0);
  for (const v of ['sym_none', 'sym_unsure', 'weird', 'sym_ZZZ99']) {
    x = await run({answers: {SYM_CONFIRM: v}, messages: [NO_DICT]});
    assert.deepEqual(x.r, {kind: 'unknown', source: 'llm_confirm'}, v);
    assert.equal(x.calls.length, 0);
  }
  // SYM_CONFIRM이 있으면 사전 확인의 sym_other보다 우선(LLM 다시 안 부름)
  x = await run({answers: {SYM_DICT_CONFIRM: 'sym_other', SYM_CONFIRM: 'sym_A11'}, messages: [C24]});
  assert.deepEqual(x.r, {kind: 'symptom', symptomId: 'A11', source: 'llm_confirm'});
  assert.equal(x.calls.length, 0);
});

test('b. SYM_DICT_CONFIRM 답: 증상 ID → 확정(dict_confirm), sym_unsure·이상한 값 → 모름', async () => {
  let x = await run({answers: {SYM_DICT_CONFIRM: 'sym_R05'}, messages: ['기침이 나요']});
  assert.deepEqual(x.r, {kind: 'symptom', symptomId: 'R05', source: 'dict_confirm'});
  for (const v of ['sym_unsure', 'sym_D20', 'nonsense']) {
    x = await run({answers: {SYM_DICT_CONFIRM: v}, messages: ['기침이 나요']});
    assert.deepEqual(x.r, {kind: 'unknown', source: 'dict_confirm'}, v);
    assert.equal(x.calls.length, 0);
  }
});

test('b. sym_other → LLM 1회 → SYM_CONFIRM', async () => {
  const llm = fakeLlm(confirmFor(['A11']));
  const {r, calls} = await run({answers: {SYM_DICT_CONFIRM: 'sym_other'}, messages: [C24], llm});
  assert.equal(calls.length, 1);
  assert.equal(r.kind, 'ask');
  assert.equal(r.followUp.id, 'SYM_CONFIRM');
  assert.equal(r.llmMeta.status, 'confirm');
});

test('c. SYM_NOT_FOUND 답 → 모름, LLM 0회', async () => {
  const {r, calls} = await run({answers: {SYM_NOT_FOUND: 'sym_continue'}, messages: [NO_DICT]});
  assert.deepEqual(r, {kind: 'unknown', source: 'not_found'});
  assert.equal(calls.length, 0);
});

test('d. 메시지 없음 → ASK_START', async () => {
  const {r, calls} = await run({messages: ['  ']});
  assert.equal(r.kind, 'ask');
  assert.equal(r.followUp.id, 'ASK_START');
  assert.deepEqual(r.followUp.options.map((o) => o.id), ['find_hospital', 'find_pharmacy']);
  assert.ok(checkFollowUpContract(r.followUp).ok);
  assert.equal(calls.length, 0);
});

test('e. 사전 후보가 있으면 SYM_DICT_CONFIRM(후보 + sym_other + sym_unsure), LLM 0회', async () => {
  const {r, calls} = await run({messages: ['기침이 나요']});
  assert.equal(calls.length, 0);
  assert.deepEqual(r.followUp, {id: 'SYM_DICT_CONFIRM', type: 'singleChoice', required: true, label: {ko: '말씀하신 증상이 이 중에 있나요?'},
    options: [{id: 'sym_R05', label: {ko: ref.symptoms.get('R05').nameKo}}, {id: 'sym_other', label: {ko: '다른 증상이에요'}}, {id: 'sym_unsure', label: {ko: '잘 모르겠어요'}}]});
  assert.ok(checkFollowUpContract(r.followUp).ok);
});

test('e. deps.matchSymptoms로 사전 매칭을 바꿀 수 있다(후보가 아닌 ID는 버림)', async () => {
  const {r} = await run({messages: [NO_DICT], deps: {matchSymptoms: () => ['D20', 'N01', 'N01']}});
  assert.deepEqual(r.followUp.options.map((o) => o.id), ['sym_N01', 'sym_other', 'sym_unsure']);
});

test('f. 사전 0개 → LLM confirm은 followUp 그대로, 입력은 메시지를 이은 것 + T2 성별', async () => {
  const llm = fakeLlm(confirmFor(['D01', 'D02']));
  const {r, calls} = await run({messages: [NO_DICT, '어제부터요'], llm});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, `${NO_DICT}\n어제부터요`);
  assert.equal(calls[0].sex, 'female');
  assert.equal(calls[0].requestId, 'r1');
  assert.ok(calls[0].consent && Number.isFinite(calls[0].deadlineAt));
  assert.equal(r.kind, 'ask');
  assert.deepEqual(r.followUp.options.slice(0, 2).map((o) => o.id), ['sym_D01', 'sym_D02']);
  // 성별이 female/male이 아니면 null
  const llm2 = fakeLlm(confirmFor(['D01']));
  await run({answers: {T2: 'not_specified'}, messages: [NO_DICT], llm: llm2});
  assert.equal(llm2.calls[0].sex, null);
});

// 11/18: 첫 실패는 SYM_NOT_FOUND 대신 되묻기 SYM_RETRY_<메시지 수>(부위 11개 + 잘 모르겠어요)
const RETRY_OPTIONS = ['area_head', 'area_eye_ear', 'area_nose_throat', 'area_chest', 'area_belly', 'area_mouth', 'area_bone', 'area_skin',
  'area_urine', 'area_mind', 'area_body', 'sym_continue'];

test('f. fallback 사유별(timeout·no_consent·no_match) → 되묻기 SYM_RETRY_<n>', async () => {
  for (const reason of ['timeout', 'no_consent', 'no_match']) {
    const {r} = await run({messages: [NO_DICT], llm: fakeLlm({status: 'fallback', reason, meta: {error: reason}})});
    assert.equal(r.followUp.id, 'SYM_RETRY_1', reason);
    assert.deepEqual(r.followUp.options.map((o) => o.id), RETRY_OPTIONS);
    assert.ok(checkFollowUpContract(r.followUp).ok);
    assert.equal(r.llmMeta.fallbackReason, reason);
  }
  const {r} = await run({messages: [NO_DICT, '그냥 좀 그래요'], llm: fakeLlm({status: 'fallback', reason: 'no_match', meta: {}})});
  assert.equal(r.followUp.id, 'SYM_RETRY_2');
});

test('11/18 되묻기: 더 적지 않았으면 LLM 없이 같은 질문, 더 적었는데 또 실패하면 SYM_NOT_FOUND, 사전이 맞으면 사전 확인', async () => {
  const fail = () => fakeLlm({status: 'fallback', reason: 'no_match', meta: {}});
  // 답 없는 SYM_RETRY_1(value null) + 메시지 그대로 → LLM 0회, 같은 질문
  let x = await run({answers: {SYM_RETRY_1: null}, messages: [NO_DICT], llm: fail()});
  assert.equal(x.r.followUp.id, 'SYM_RETRY_1');
  assert.equal(x.calls.length, 0);
  // 더 적었는데 또 못 찾음 → LLM 1회(메시지 전체) → SYM_NOT_FOUND
  x = await run({answers: {SYM_RETRY_1: null}, messages: [NO_DICT, '그냥 좀 그래요'], llm: fail()});
  assert.equal(x.calls.length, 1);
  assert.equal(x.calls[0].text, `${NO_DICT}\n그냥 좀 그래요`);
  assert.equal(x.r.followUp.id, 'SYM_NOT_FOUND');
  // 더 적은 말이 사전에 맞으면 LLM 없이 사전 확인
  x = await run({answers: {SYM_RETRY_1: null}, messages: [NO_DICT, '기침이 나요'], llm: fail()});
  assert.equal(x.calls.length, 0);
  assert.equal(x.r.followUp.id, 'SYM_DICT_CONFIRM');
  // 더 적은 말로 LLM이 찾으면 SYM_CONFIRM
  assert.deepEqual(matchSymptoms(`${NO_DICT}\n어제부터 계속 그래요`, ref), []);
  x = await run({answers: {SYM_RETRY_1: null}, messages: [NO_DICT, '어제부터 계속 그래요'], llm: fakeLlm(confirmFor(['D06']))});
  assert.equal(x.r.followUp.id, 'SYM_CONFIRM');
  // sym_other 뒤 실패 → 되묻기 → 더 적었는데 또 실패 → SYM_NOT_FOUND
  x = await run({answers: {SYM_DICT_CONFIRM: 'sym_other', SYM_RETRY_1: null}, messages: [C24, '모르겠어요'], llm: fail()});
  assert.equal(x.r.followUp.id, 'SYM_NOT_FOUND');
});

test('11/18 되묻기 버튼: 잘 모르겠어요 → 모름(LLM 0회), 부위 → 부위 증상 고르기(성별 거름), 고른 증상 → 확정, 여기 없어요 → 모름', async () => {
  let x = await run({answers: {SYM_RETRY_1: 'sym_continue'}, messages: [NO_DICT]});
  assert.deepEqual(x.r, {kind: 'unknown', source: 'retry_skip'});
  assert.equal(x.calls.length, 0);
  x = await run({answers: {SYM_RETRY_1: 'area_urine'}, messages: [NO_DICT]}); // BASE T2 = female
  assert.equal(x.r.followUp.id, 'SYM_AREA_PICK');
  assert.deepEqual(x.r.followUp.options.map((o) => o.id), ['sym_U01', 'sym_U02', 'sym_U06', 'sym_X02', 'sym_X14', 'sym_X07', 'sym_other']);
  assert.ok(checkFollowUpContract(x.r.followUp).ok);
  assert.equal(x.calls.length, 0);
  x = await run({answers: {T2: 'male', SYM_RETRY_1: 'area_urine'}, messages: [NO_DICT]});
  assert.deepEqual(x.r.followUp.options.map((o) => o.id), ['sym_U01', 'sym_U02', 'sym_U06', 'sym_Y02', 'sym_Y07', 'sym_Y03', 'sym_other']);
  x = await run({answers: {SYM_RETRY_1: 'area_bone', SYM_AREA_PICK: 'sym_L16'}, messages: [NO_DICT]});
  assert.deepEqual(x.r, {kind: 'symptom', symptomId: 'L16', source: 'area_pick'});
  for (const v of ['sym_other', 'sym_ZZZ', 'weird']) {
    x = await run({answers: {SYM_RETRY_1: 'area_bone', SYM_AREA_PICK: v}, messages: [NO_DICT]});
    assert.deepEqual(x.r, {kind: 'unknown', source: 'area_pick'}, v);
  }
  x = await run({answers: {SYM_RETRY_1: 'area_nowhere'}, messages: [NO_DICT]});
  assert.deepEqual(x.r, {kind: 'unknown', source: 'retry'});
});

test('f. route 3갈래: facility_search → search, medication_question → MED_CHOICE, other → ASK_START', async () => {
  let x = await run({messages: ['문 연 약국 가고 싶어요'], llm: fakeLlm({status: 'route', intent: 'facility_search', meta: {}})});
  assert.deepEqual(x.r.search, {type: 'pharmacy', department: 'pharmacy', openOnly: true});
  assert.equal(x.r.kind, 'search');
  x = await run({messages: [NO_DICT], llm: fakeLlm({status: 'route', intent: 'medication_question', meta: {}})});
  assert.equal(x.r.followUp.id, 'MED_CHOICE');
  assert.deepEqual(x.r.followUp.options.map((o) => o.id), ['med_symptom', 'med_pharmacy', 'med_info']);
  x = await run({messages: [NO_DICT], llm: fakeLlm({status: 'route', intent: 'other', meta: {}})});
  assert.equal(x.r.followUp.id, 'ASK_START');
});

test('f. 이상한 결과·예외·계약 위반 followUp·늦은 응답 → 되묻기 SYM_RETRY_1', async () => {
  for (const result of [null, {status: 'weird'}, {status: 'confirm', followUp: {id: 'SYM_CONFIRM', options: []}}, () => { throw new Error('x'); }]) {
    const {r} = await run({messages: [NO_DICT], llm: fakeLlm(result)});
    assert.equal(r.followUp.id, 'SYM_RETRY_1');
  }
  const {r} = await run({messages: [NO_DICT], llm: fakeLlm(confirmFor(['D01']), {delayMs: 300}), deadlineMs: 30});
  assert.equal(r.followUp.id, 'SYM_RETRY_1');
  assert.equal(r.llmMeta.fallbackReason, 'timeout');
});

test('c24 형태: 사전이 부수 증상만 맞힘 → sym_other → LLM 후보에 정답 → 확정', async () => {
  const dict = matchSymptoms(C24, ref);
  assert.ok(dict.includes('A09') && !dict.includes('A11'), `사전 결과 ${dict}`);
  // 1) 사전 확인 질문: 정답(A11)이 없다
  let x = await run({messages: [C24]});
  const ids = x.r.followUp.options.map((o) => o.id);
  assert.equal(x.r.followUp.id, 'SYM_DICT_CONFIRM');
  assert.ok(ids.includes('sym_A09') && !ids.includes('sym_A11') && ids.includes('sym_other'));
  assert.equal(x.calls.length, 0);
  // 2) 사용자가 "다른 증상이에요" → LLM 1회 → 정답이 든 SYM_CONFIRM
  const llm = fakeLlm(confirmFor(['A11', 'A09']));
  x = await run({answers: {SYM_DICT_CONFIRM: 'sym_other'}, messages: [C24], llm});
  assert.equal(x.calls.length, 1);
  assert.ok(x.r.followUp.options.some((o) => o.id === 'sym_A11'));
  // 3) 사용자가 고름 → 확정
  x = await run({answers: {SYM_DICT_CONFIRM: 'sym_other', SYM_CONFIRM: 'sym_A11'}, messages: [C24], llm: fakeLlm(null)});
  assert.deepEqual(x.r, {kind: 'symptom', symptomId: 'A11', source: 'llm_confirm'});
});

test('연결: 실제 llm/index.mjs classifySymptom + mock provider(네트워크 없음)', async () => {
  const provider = createMockProvider({symptom_pick_v1: {[NO_DICT]: {data: {intent: 'symptom', status: 'matched', picks: ['D01', 'A03']}}}});
  const logs = [];
  const real = (input) => classifySymptom(input, {provider, refData: ref, config: getConfig({LLM_SYMPTOM_MODE: 'full'}), log: (e) => logs.push(e)});
  const {r, calls} = await run({messages: [NO_DICT], llm: fakeLlm(real)});
  assert.equal(calls.length, 1);
  assert.equal(provider.callCount, 1);
  assert.equal(r.kind, 'ask');
  assert.equal(r.followUp.id, 'SYM_CONFIRM');
  assert.deepEqual(r.followUp.options.map((o) => o.id), ['sym_D01', 'sym_A03', 'sym_none', 'sym_unsure']);
  assert.equal(r.llmMeta.provider, 'mock');
  assert.ok(!JSON.stringify([r.llmMeta, logs]).includes('이상하고'));
  // 동의 없음 → 실제 모듈이 fallback no_consent → 되묻기(11/18), 업체 호출 0회
  const list = Object.entries(BASE).map(([questionId, value]) => ({questionId, value}));
  const {codes, engine} = normalizeAnswers(list, data);
  const r2 = await identify({engineAnswers: engine, messages: [NO_DICT], codes, data,
    deps: {llm: {classifySymptom: real}}, ctx: {consent: undefined, deadlineAt: Date.now() + 5000, now: Date.now}});
  assert.equal(r2.followUp.id, 'SYM_RETRY_1');
  assert.equal(r2.llmMeta.fallbackReason, 'no_consent');
  assert.equal(provider.callCount, 1);
});

// 11/18 절충 1: 고쳐 쓰기 → 사전 후보 확인(SYM_REWRITE_CONFIRM)
test('11/18 SYM_REWRITE_CONFIRM: 받아서 그대로 묻고, 증상 → 확정, 다른 증상이에요 → 전체 목록 LLM(forceFull) 1번, 잘 모르겠어요 → 모름', async () => {
  const {buildRewriteConfirm} = await import('../../llm/confirm-question.mjs');
  const rwq = buildRewriteConfirm(['D07', 'D01'], ref);
  assert.deepEqual(rwq.options.map((o) => o.id), ['sym_D07', 'sym_D01', 'sym_other', 'sym_unsure']);
  assert.ok(checkFollowUpContract(rwq).ok);
  let x = await run({messages: [NO_DICT], llm: fakeLlm({status: 'confirm', followUp: rwq, meta: {}})});
  assert.equal(x.r.followUp.id, 'SYM_REWRITE_CONFIRM');
  assert.equal(x.calls[0].forceFull, undefined);
  x = await run({answers: {SYM_REWRITE_CONFIRM: 'sym_D07'}, messages: [NO_DICT]});
  assert.deepEqual(x.r, {kind: 'symptom', symptomId: 'D07', source: 'rewrite_confirm'});
  assert.equal(x.calls.length, 0);
  for (const v of ['sym_unsure', 'weird']) {
    x = await run({answers: {SYM_REWRITE_CONFIRM: v}, messages: [NO_DICT]});
    assert.deepEqual(x.r, {kind: 'unknown', source: 'rewrite_confirm'}, v);
  }
  // 다른 증상이에요 → forceFull 호출, 그 결과 SYM_CONFIRM
  const llm = fakeLlm(confirmFor(['D06']));
  x = await run({answers: {SYM_REWRITE_CONFIRM: 'sym_other'}, messages: [NO_DICT], llm});
  assert.equal(llm.calls.length, 1);
  assert.equal(llm.calls[0].forceFull, true);
  assert.equal(x.r.followUp.id, 'SYM_CONFIRM');
  // forceFull인데 또 고쳐 쓰기 후보가 오면(계약 위반) 받지 않고 되묻기
  x = await run({answers: {SYM_REWRITE_CONFIRM: 'sym_other'}, messages: [NO_DICT], llm: fakeLlm({status: 'confirm', followUp: rwq, meta: {}})});
  assert.equal(x.r.followUp.id, 'SYM_RETRY_1');
  // 그 뒤 SYM_CONFIRM 답이 우선
  x = await run({answers: {SYM_REWRITE_CONFIRM: 'sym_other', SYM_CONFIRM: 'sym_D06'}, messages: [NO_DICT]});
  assert.deepEqual(x.r, {kind: 'symptom', symptomId: 'D06', source: 'llm_confirm'});
});
