import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifySymptom, extractProfileUpdates, hasExternalAiConsent} from '../index.mjs';
import {createMockProvider} from '../providers/mock.mjs';
import {getConfig} from '../config.mjs';
import {loadRefData} from '../ref-data.mjs';
import {buildCandidates} from '../candidates.mjs';
import {checkFollowUpContract} from '../confirm-question.mjs';

const ref = loadRefData();
const config = getConfig({});
const consent = {granted: true, provider: 'mock', version: 'test-v1', healthInfo: true};
// 고유 표지 문자열: 로그 어디에도 나오면 안 된다
const MARK = '표지QZ7';
const TEXT = `머리가 지끈지끈 아프고 어지러워요 ${MARK}`;
const ids = buildCandidates(TEXT, ref).map((c) => c.symptomId);

function setup(entry, extra = {}) {
  const logs = [];
  const provider = createMockProvider({symptom_pick_v1: {[TEXT]: entry}, ...extra});
  return {logs, provider, deps: {provider, refData: ref, config, log: (e) => logs.push(e)}};
}

function assertNoLeak(logs, ...secrets) {
  const all = JSON.stringify(logs);
  for (const s of [MARK, ...secrets]) assert.ok(!all.includes(s), `로그에 '${s}'가 있다`);
}

test('hasExternalAiConsent: 업체명·버전이 있는 동의만 인정', () => {
  assert.equal(hasExternalAiConsent(consent, 'mock'), true);
  assert.equal(hasExternalAiConsent(true, 'mock'), false);
  assert.equal(hasExternalAiConsent({granted: true, version: 'v'}, 'mock'), false);
  assert.equal(hasExternalAiConsent({granted: true, provider: 'gemini', version: 'v'}, 'mock'), false);
  assert.equal(hasExternalAiConsent({granted: true, provider: 'mock', version: ' '}, 'mock'), false);
  assert.equal(hasExternalAiConsent({granted: false, provider: 'mock', version: 'v'}, 'mock'), false);
});

test('classifySymptom: picks → confirm(계약 통과), meta 채움, 로그에 원문 없음', async () => {
  assert.ok(ids.length >= 3);
  const {deps, logs} = setup({data: {intent: 'symptom', status: 'matched', picks: [ids[1], ids[0]]}});
  const r = await classifySymptom({text: TEXT, consent}, deps);
  assert.equal(r.status, 'confirm');
  assert.equal(checkFollowUpContract(r.followUp).ok, true);
  assert.deepEqual(r.followUp.options.slice(0, 2).map((o) => o.id), [`sym_${ids[1]}`, `sym_${ids[0]}`]);
  assert.deepEqual(Object.keys(r.meta).sort(), ['attempts', 'candidateCount', 'candidateMode', 'dataVersion', 'error', 'latencyMs', 'model', 'promptId', 'provider', 'schemaId'].sort());
  assert.equal(r.meta.provider, 'mock');
  assert.equal(r.meta.promptId, 'symptom_v1');
  assert.equal(r.meta.schemaId, 'symptom_pick_v1');
  assert.equal(r.meta.dataVersion, 'v2.1-20261113');
  assert.equal(r.meta.candidateMode, 'retrieve');
  assert.equal(r.meta.candidateCount, ids.length);
  assert.equal(r.meta.attempts, 1);
  assert.equal(r.meta.error, null);
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0].picks, [ids[1], ids[0]]);
  assertNoLeak(logs, '지끈');
  assertNoLeak([r.meta], '지끈');
});

test('classifySymptom: 동의 없음 → LLM 안 부름, fallback no_consent', async () => {
  const {deps, provider, logs} = setup({data: {intent: 'symptom', status: 'matched', picks: [ids[0]]}});
  for (const c of [undefined, true, {granted: true, provider: 'openai', version: 'v'}]) {
    const r = await classifySymptom({text: TEXT, consent: c}, deps);
    assert.deepEqual([r.status, r.reason, r.meta.error], ['fallback', 'no_consent', 'no_consent']);
  }
  assert.equal(provider.callCount, 0);
  assertNoLeak(logs);
});

test('classifySymptom: intent가 symptom이 아니면 route', async () => {
  for (const intent of ['facility_search', 'medication_question', 'other']) {
    const {deps} = setup({data: {intent, status: 'no_match', picks: []}});
    const r = await classifySymptom({text: TEXT, consent}, deps);
    assert.deepEqual([r.status, r.intent], ['route', intent]);
  }
});

test('classifySymptom: no_match·unclear·picks 0·엉뚱한 ID → fallback no_match', async () => {
  for (const data of [
    {intent: 'symptom', status: 'no_match', picks: []},
    {intent: 'symptom', status: 'unclear', picks: [ids[0]]},
    {intent: 'symptom', status: 'matched', picks: []},
    {intent: 'symptom', status: 'matched', picks: ['ZZ99', 'K01']},
  ]) {
    const {deps} = setup({data});
    const r = await classifySymptom({text: TEXT, consent}, deps);
    assert.deepEqual([r.status, r.reason], ['fallback', 'no_match'], JSON.stringify(data));
  }
});

test('classifySymptom: 형식 위반 → fallback bad_json, 재시도 안 함', async () => {
  for (const entry of [{text: '{"intent":'}, {data: {intent: 'symptom', status: 'matched'}}, {error: 'bad_json'}]) {
    const {deps, provider} = setup(entry);
    const r = await classifySymptom({text: TEXT, consent}, deps);
    assert.deepEqual([r.status, r.reason], ['fallback', 'bad_json']);
    assert.equal(provider.callCount, 1);
  }
});

test('classifySymptom: blocked·timeout은 재시도 없이 fallback', async () => {
  for (const error of ['blocked', 'timeout']) {
    const {deps, provider} = setup({error});
    const r = await classifySymptom({text: TEXT, consent}, deps);
    assert.deepEqual([r.status, r.reason, r.meta.attempts], ['fallback', error, 1]);
    assert.equal(provider.callCount, 1);
  }
});

test('classifySymptom: rate_limit·server·network는 1회 재시도 → 성공하면 confirm', async () => {
  for (const error of ['rate_limit', 'server', 'network']) {
    const {deps, provider} = setup([{error}, {data: {intent: 'symptom', status: 'matched', picks: [ids[0]]}}]);
    const r = await classifySymptom({text: TEXT, consent}, deps);
    assert.equal(r.status, 'confirm', error);
    assert.equal(r.meta.attempts, 2);
    assert.equal(provider.callCount, 2);
  }
});

test('classifySymptom: 재시도는 1회뿐', async () => {
  const {deps, provider} = setup({error: 'server'});
  const r = await classifySymptom({text: TEXT, consent}, deps);
  assert.deepEqual([r.status, r.reason, r.meta.attempts], ['fallback', 'server', 2]);
  assert.equal(provider.callCount, 2);
});

test('classifySymptom: 남은 시간이 3000ms 미만이면 재시도하지 않는다', async () => {
  let t = 0;
  const provider = {name: 'mock', model: 'fake', calls: 0, async generateStructured() { this.calls += 1; t += 4500; return {ok: false, error: 'server', meta: {}}; }};
  const r = await classifySymptom({text: TEXT, consent}, {provider, refData: ref, config, now: () => t});
  assert.deepEqual([r.status, r.reason, r.meta.attempts], ['fallback', 'server', 1]);
  assert.equal(provider.calls, 1);
});

test('classifySymptom: deadlineAt이 이미 지났으면 호출 없이 timeout', async () => {
  const {deps, provider} = setup({data: {intent: 'symptom', status: 'matched', picks: [ids[0]]}});
  const r = await classifySymptom({text: TEXT, consent, deadlineAt: Date.now() - 1}, deps);
  assert.deepEqual([r.status, r.reason], ['fallback', 'timeout']);
  assert.equal(provider.callCount, 0);
});

test('classifySymptom: 1회 제한 시간 초과 → timeout(어댑터가 늦어도 바깥에서 끊음)', async () => {
  const slow = {name: 'mock', model: 'slow', generateStructured: () => new Promise(() => {})};
  const cfg = {...config, timeoutMs: 30};
  const r = await classifySymptom({text: TEXT, consent}, {provider: slow, refData: ref, config: cfg});
  assert.deepEqual([r.status, r.reason], ['fallback', 'timeout']);
  const {deps} = setup({delayMs: 200, data: {intent: 'symptom', status: 'matched', picks: [ids[0]]}});
  const r2 = await classifySymptom({text: TEXT, consent}, {...deps, config: cfg});
  assert.deepEqual([r2.status, r2.reason], ['fallback', 'timeout']);
});

test('classifySymptom: signal 취소 → aborted', async () => {
  const {deps} = setup({delayMs: 500, data: {intent: 'symptom', status: 'matched', picks: [ids[0]]}});
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 10);
  const r = await classifySymptom({text: TEXT, consent, signal: ctrl.signal}, deps);
  assert.deepEqual([r.status, r.reason], ['fallback', 'aborted']);
});

test('classifySymptom: 어댑터가 예외를 던지면 server로 처리', async () => {
  const bad = {name: 'mock', model: 'x', async generateStructured() { throw new Error(MARK); }};
  const logs = [];
  const r = await classifySymptom({text: TEXT, consent}, {provider: bad, refData: ref, config, log: (e) => logs.push(e)});
  assert.deepEqual([r.status, r.reason], ['fallback', 'server']);
  assertNoLeak(logs);
});

test('classifySymptom: not_implemented 업체 → fallback', async () => {
  const p = {name: 'gemini', model: 'm', async generateStructured() { return {ok: false, error: 'not_implemented', meta: {}}; }};
  const r = await classifySymptom({text: TEXT, consent: {...consent, provider: 'gemini'}}, {provider: p, refData: ref, config});
  assert.deepEqual([r.status, r.reason], ['fallback', 'not_implemented']);
});

test('classifySymptom: 후보 0개면 mode=all로 한 번 더', async () => {
  const text = `ㅋㅋㅋ ${MARK}`;
  assert.equal(buildCandidates(text, ref).length, 0);
  const all = buildCandidates(text, ref, {mode: 'all'}).map((c) => c.symptomId);
  const provider = createMockProvider({symptom_pick_v1: {[text]: {data: {intent: 'symptom', status: 'matched', picks: [all[3]]}}}});
  let seenEnum = null;
  const spy = {...provider, name: 'mock', model: 'mock-v0', generateStructured: (req) => { seenEnum = req.schema.properties.picks.items.enum; return provider.generateStructured(req); }};
  const r = await classifySymptom({text, consent}, {provider: spy, refData: ref, config});
  assert.equal(r.status, 'confirm');
  assert.equal(r.meta.candidateMode, 'all');
  assert.equal(r.meta.candidateCount, all.length);
  assert.deepEqual(seenEnum, all);
});

test('classifySymptom: PII를 가린 문장만 provider로 간다', async () => {
  const phone = '010-9876-5432';
  const text = `머리가 아파요 연락처 ${phone}`;
  let sent = null;
  const spy = {name: 'mock', model: 'spy', async generateStructured(req) { sent = req.user; return {ok: true, data: {intent: 'symptom', status: 'no_match', picks: []}, meta: {}}; }};
  const logs = [];
  await classifySymptom({text, consent}, {provider: spy, refData: ref, config, log: (e) => logs.push(e)});
  assert.ok(!sent.includes(phone));
  assert.ok(sent.endsWith('[전화번호]'));
  assertNoLeak(logs, phone, '머리가');
});

test('classifySymptom: 500자 넘으면 마지막 500자만 보낸다', async () => {
  let sent = null;
  const spy = {name: 'mock', model: 'spy', async generateStructured(req) { sent = req.user; return {ok: true, data: {intent: 'other', status: 'no_match', picks: []}, meta: {}}; }};
  const text = '가'.repeat(600) + '머리가 아파요';
  await classifySymptom({text, consent}, {provider: spy, refData: ref, config});
  const userText = sent.split('사용자 문장:\n')[1];
  assert.equal(Array.from(userText).length, 500);
  assert.ok(userText.endsWith('머리가 아파요'));
});

test('classifySymptom: sex=male이면 female 제한 증상을 후보로 보내지 않는다', async () => {
  let en = null;
  const spy = {name: 'mock', model: 'spy', async generateStructured(req) { en = req.schema.properties.picks.items.enum; return {ok: true, data: {intent: 'other', status: 'no_match', picks: []}, meta: {}}; }};
  await classifySymptom({text: '생리통이 심하고 아랫배가 아파요', sex: 'male', consent}, {provider: spy, refData: ref, config});
  assert.ok(en.every((id) => ref.symptoms.get(id).sexRestriction !== 'female'));
});

// ---- profile ----
const PMSG = [`저는 32살이고 ${MARK} 혈압약을 먹고 있어요`, '머리가 아파요', '땅콩 알레르기가 있어요'];

function profileSetup(entry) {
  const logs = [];
  const provider = createMockProvider({profile_extract_v1: {[PMSG[2]]: entry}});
  return {logs, provider, deps: {provider, config, log: (e) => logs.push(e)}};
}

test('extractProfileUpdates: 정상 → 0.18.0 항목, 로그에 quote·value 없음', async () => {
  const {deps, logs} = profileSetup({data: {items: [
    {field: 'age', value: '32', messageIndex: 0, quote: '32살'},
    {field: 'medications', value: '혈압약', messageIndex: 0, quote: '혈압약을 먹고 있어요'},
    {field: 'allergies', value: '땅콩', messageIndex: 2, quote: '땅콩 알레르기'},
  ]}});
  const r = await extractProfileUpdates({messages: PMSG, consent}, deps);
  assert.deepEqual(r.items.map((i) => i.id), ['age-1', 'medications-1', 'allergies-1']);
  assert.equal(r.meta.promptId, 'profile_v1');
  assert.equal(r.meta.schemaId, 'profile_extract_v1');
  assert.equal(r.meta.attempts, 1);
  assertNoLeak(logs, '혈압약', '땅콩', '32살');
  assert.deepEqual(logs[0].fields, ['age', 'medications', 'allergies']);
});

test('extractProfileUpdates: 신호어 없으면 호출 없이 items []', async () => {
  const {deps, provider} = profileSetup({data: {items: []}});
  const r = await extractProfileUpdates({messages: ['머리가 아파요', '열이 나요'], consent}, deps);
  assert.deepEqual(r.items, []);
  assert.equal(r.meta.attempts, 0);
  assert.equal(provider.callCount, 0);
});

test('extractProfileUpdates: 신호어 있는 메시지만 보낸다(번호 유지)', async () => {
  let sent = null;
  const spy = {name: 'mock', model: 'spy', async generateStructured(req) { sent = req.user; return {ok: true, data: {items: [{field: 'history', value: '머리가 아파요', messageIndex: 1, quote: '머리가 아파요'}]}, meta: {}}; }};
  const r = await extractProfileUpdates({messages: PMSG, consent}, {provider: spy, config});
  assert.ok(sent.includes('메시지 0:') && sent.includes('메시지 2:'));
  assert.ok(!sent.includes('메시지 1:'));
  // 보내지 않은 메시지(1번)를 가리키는 항목은 버린다
  assert.deepEqual(r.items, []);
});

test('extractProfileUpdates: 동의 없음(건강정보 동의 포함) → 호출 없이 items []', async () => {
  const {deps, provider} = profileSetup({data: {items: []}});
  for (const c of [undefined, {...consent, healthInfo: false}, {granted: true, provider: 'mock', version: 'v'}]) {
    const r = await extractProfileUpdates({messages: PMSG, consent: c}, deps);
    assert.deepEqual([r.items, r.meta.error], [[], 'no_consent']);
  }
  assert.equal(provider.callCount, 0);
});

test('extractProfileUpdates: 오류·시간 초과·형식 위반 → items []', async () => {
  for (const [entry, err] of [[{error: 'timeout'}, 'timeout'], [{error: 'blocked'}, 'blocked'], [{text: '{'}, 'bad_json'], [{data: {foo: 1}}, 'bad_json']]) {
    const {deps} = profileSetup(entry);
    const r = await extractProfileUpdates({messages: PMSG, consent}, deps);
    assert.deepEqual([r.items, r.meta.error], [[], err]);
  }
});

test('extractProfileUpdates: 틀린 항목만 버린다', async () => {
  const {deps} = profileSetup({data: {items: [
    {field: 'age', value: '33', messageIndex: 0, quote: '32살'},
    {field: 'allergies', value: '땅콩', messageIndex: 2, quote: '땅콩 알레르기'},
  ]}});
  const r = await extractProfileUpdates({messages: PMSG, consent}, deps);
  assert.deepEqual(r.items.map((i) => i.field), ['allergies']);
});
