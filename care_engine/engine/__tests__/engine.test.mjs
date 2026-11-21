import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {ENGINE_VERSION} from '../index.mjs';
import {loadFreeTextRules} from '../free-text.mjs';
import {checkResponseContract} from '../contract.mjs';
import {data, SAFE_BASE, fakeLlm, confirmFor, call} from './helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const testRules = loadFreeTextRules(path.join(HERE, 'fixtures', 'free_text_test.json'));
const PHARMACY_TEXT = readFileSync(path.resolve(HERE, '../../../frontend/care-context.mjs'), 'utf8').match(/id:'pharmacy'[^\n]*?text:(?:expandLocales\()?\{ko:'([^']+)'/)[1];
const DETAIL_SAFE = {N5: 'yes', 'N5-1': 'onset_today', N6: 'yes', N7: 'no', N8: 'no', N9: 'no', N10: 'no', N11: 'no', N12: 'no', N13: 'no', P0: 'no'};

const ok = (out) => {
  assert.ok(out.response, `오류: ${out.error} ${JSON.stringify(out.trace?.warnings)}`);
  assert.ok(checkResponseContract(out.response).ok);
  return out.response;
};

test('지원하지 않는 reason → unsupported_reason', async () => {
  for (const reason of ['recommendations', 'other', undefined]) {
    const {out} = await call({extra: {reason}});
    assert.deepEqual([out.response, out.error], [null, 'unsupported_reason']);
    assert.equal(out.trace.reason, 'unsupported');
  }
});

test('첫 메시지(증상) → Q0, LLM 0회, trace 버전', async () => {
  const {out, calls} = await call({messages: ['기침이 나요']});
  const r = ok(out);
  assert.equal(r.followUp.id, 'Q0');
  assert.deepEqual(Object.keys(r), ['followUp']);
  assert.equal(out.trace.phase, 'question');
  assert.equal(out.trace.nextQuestionId, 'Q0');
  assert.equal(out.trace.engineVersion, ENGINE_VERSION);
  assert.equal(out.trace.dataVersion, 'v2.1-20261113');
  assert.equal(out.trace.questionnaireVersion, 'intake-v1');
  assert.equal(out.trace.freeTextVersion, 'free-text-v1');
  assert.equal(calls.classify.length, 0);
});

test('약국 시작 문장 → search만(0문항), 문진 없음', async () => {
  const {out, calls} = await call({messages: [PHARMACY_TEXT]});
  assert.deepEqual(ok(out), {search: {type: 'pharmacy', department: 'pharmacy', openOnly: true}});
  assert.equal(out.trace.phase, 'facility_keyword');
  assert.equal(calls.classify.length, 0);
});

test('Q0=예 → emergency + 다음 E 문항, search·진료과 없음', async () => {
  const r = ok((await call({reason: 'followup', messages: ['기침이 나요'], answers: {Q0: 'yes'}})).out);
  assert.equal(r.emergency.active, true);
  assert.equal(r.emergency.title.ko, '지금 119에 연락하세요');
  assert.equal(r.followUp.id, 'E1');
  assert.equal(r.search, undefined);
});

test('Q0=예 + E 문항 끝 → emergency + 119 정리 요약(답한 것만), skip이면 남은 E 문항 없이 정리', async () => {
  const answers = {Q0: 'yes', E1: 'no', E2: 'yes', E4: 'yes', E5: 'unknown', E6: 'no', E7: 'no', E8: 'no', E9: 'yes', 'E9-1': 'onset_1_6h'};
  const {out} = await call({reason: 'followup', answers});
  const r = ok(out);
  assert.deepEqual(Object.keys(r).sort(), ['emergency', 'summary']);
  const lines = r.summary.ko.split('\n');
  assert.equal(lines[0], '119에 알릴 내용입니다(참고용).');
  assert.ok(lines.includes('환자가 본인: 아니요'));
  assert.ok(lines.includes('정상 호흡: 확인 불가'));
  assert.ok(lines.includes('환자 수: 1명'));
  assert.ok(lines.includes('증상 시작: 1~6시간'));
  assert.equal(out.trace.terminal, true);
  // skip: E2까지만 답해도 정리 요약
  const r2 = ok((await call({reason: 'skip', answers: {Q0: 'yes', E1: 'yes'}})).out);
  assert.equal(r2.followUp, undefined);
  assert.ok(r2.summary.ko.includes('환자가 본인: 예'));
  // 정리할 답이 없으면 emergency만
  assert.deepEqual(Object.keys(ok((await call({reason: 'skip', answers: {Q0: 'yes'}})).out)), ['emergency']);
});

test('URGENT_NOTICE terminal(N1·N2·N3) → emergency만', async () => {
  for (const [q, v, key] of [['N1', 'no', '의식이'], ['N2', 'unknown', '숨쉬기가'], ['N3', 'yes', '갑작스러운 마비']]) {
    const {out, calls} = await call({reason: 'followup', messages: ['기침이 나요'], answers: {Q0: 'no', [q]: v}});
    const r = ok(out);
    assert.deepEqual(Object.keys(r), ['emergency'], q);
    assert.ok(r.emergency.message.ko.includes(key));
    assert.equal(calls.classify.length + calls.profile.length, 0);
  }
});

test('자유 입력 규칙(테스트 규칙): Q0 미응답이면 E 문항이 보이지 않으므로 emergency만, 모르는 message_key는 일반 문구 + warning', async () => {
  let {out} = await call({messages: ['테스트위험표현'], deps: {freeTextRules: testRules}});
  assert.deepEqual(Object.keys(ok(out)), ['emergency']);
  assert.deepEqual(out.trace.ruleHits, ['FT-TEST-STOP']);
  ({out} = await call({messages: ['테스트주의표현'], deps: {freeTextRules: testRules}}));
  assert.equal(ok(out).emergency.message.ko, '지금 119에 연락하거나 가까운 응급실로 가세요.');
  assert.ok(out.trace.warnings.includes('unknown_message_key:FT-TEST-NOTICE'));
  // 시작 선택(약국 찾기)을 골라도 걸린 위험 규칙은 풀리지 않는다
  ({out} = await call({messages: ['테스트위험표현'], answers: {ASK_START: 'find_pharmacy'}, deps: {freeTextRules: testRules}}));
  assert.equal(ok(out).search, undefined);
});

test('T3까지 답함 + 사전 후보 → SYM_DICT_CONFIRM, 고르면 N5', async () => {
  let {out, calls} = await call({reason: 'followup', messages: ['기침이 나요'], answers: SAFE_BASE});
  assert.equal(ok(out).followUp.id, 'SYM_DICT_CONFIRM');
  assert.equal(out.trace.phase, 'identify');
  assert.equal(calls.classify.length, 0);
  ({out} = await call({reason: 'followup', messages: ['기침이 나요'], answers: {...SAFE_BASE, SYM_DICT_CONFIRM: 'sym_R05'}}));
  assert.equal(ok(out).followUp.id, 'N5');
  assert.deepEqual(out.trace.symptom, {id: 'R05', source: 'dict_confirm', fallback: false, fallbackGroup: null});
});

test('완료: 요약 + 진료과 search + (본인) profileUpdates', async () => {
  const item = {id: 'age-1', field: 'age', operation: 'set', value: '30', evidence: {kind: 'message', index: 0, quote: '30살'}};
  const llm = fakeLlm({profile: {items: [item], meta: {error: null}}});
  const {out, calls} = await call({reason: 'followup', messages: ['30살인데 기침이 나요'], answers: {...SAFE_BASE, SYM_DICT_CONFIRM: 'sym_R05', ...DETAIL_SAFE}, llm});
  const r = ok(out);
  assert.equal(out.trace.phase, 'complete');
  assert.equal(r.search.type, 'hospital');
  assert.equal(r.search.department, data.departments.get(data.variants.get('R05|female|adult')[0].deptId).searchKey);
  assert.deepEqual(r.profileUpdates, [item]);
  assert.equal(calls.profile.length, 1);
  assert.equal(calls.profile[0].messages[0], '30살인데 기침이 나요');
  const lines = r.summary.ko.split('\n');
  assert.equal(lines[0], '입력하신 답을 정리한 참고용 내용입니다. 진단이 아닙니다.');
  assert.ok(lines.includes('상담 대상: 본인'));
  assert.ok(lines.includes(`주된 증상: ${data.refData.symptoms.get('R05').nameKo}`));
  assert.ok(lines.includes('시작: 오늘'));
  assert.ok(lines.includes('경과: 계속 나타남(예), 점점 심해짐(아니요)'));
  assert.ok(lines.some((l) => l.startsWith('참고할 진료과: ')));
  assert.ok(lines.includes('복용 중인 약, 기존 질환, 함께 있는 다른 증상은 확인하지 않았습니다. 해당되면 진료 때 꼭 알려 주세요.'));
  assert.equal(lines.at(-1), '증상이 갑자기 심해지면 119에 연락하세요.');
  assert.ok(!r.summary.ko.includes('30살인데'));
  assert.deepEqual(out.trace.llm.profile, {called: true, itemCount: 1, fields: ['age'], error: null});
});

test('완료: 상담 대상이 본인이 아니면 extractProfileUpdates를 부르지 않는다, 빈 배열이면 생략', async () => {
  for (const t1 of ['child', 'other']) {
    const {out, calls} = await call({reason: 'followup', messages: ['기침이 나요'], answers: {...SAFE_BASE, T1: t1, SYM_DICT_CONFIRM: 'sym_R05', ...DETAIL_SAFE}});
    assert.equal(ok(out).profileUpdates, undefined);
    assert.equal(calls.profile.length, 0);
  }
  const {out, calls} = await call({reason: 'followup', messages: ['기침이 나요'], answers: {...SAFE_BASE, SYM_DICT_CONFIRM: 'sym_R05', ...DETAIL_SAFE}});
  assert.equal(calls.profile.length, 1);
  assert.equal(ok(out).profileUpdates, undefined);
  // 계약에 안 맞는 후보는 버린다
  const bad = fakeLlm({profile: {items: [{id: 'x', field: 'weight', operation: 'set', value: '1', evidence: {kind: 'message', index: 0, quote: 'a'}}]}});
  const o2 = (await call({reason: 'followup', messages: ['기침이 나요'], answers: {...SAFE_BASE, SYM_DICT_CONFIRM: 'sym_R05', ...DETAIL_SAFE}, llm: bad})).out;
  assert.equal(ok(o2).profileUpdates, undefined);
  assert.ok(o2.trace.warnings.includes('profile_updates_invalid'));
});

test('skip: Q0만 답한 직후 → 요약 첫 줄에 안전 질문 미응답 문구, 증상 모름 → general 진료과', async () => {
  const {out, calls} = await call({reason: 'skip', messages: ['기침이 나요'], answers: {Q0: 'no'}});
  const r = ok(out);
  assert.ok(r.summary.ko.startsWith('응급 확인 질문에 답하지 않았습니다.'));
  assert.ok(r.summary.ko.includes('주된 증상: 목록에서 찾지 못함'));
  assert.deepEqual(r.search, {type: 'hospital', department: 'internal'});
  assert.equal(out.trace.symptom.source, 'skip');
  assert.equal(out.trace.symptom.fallbackGroup, 'general');
  assert.equal(calls.classify.length, 0);
  // 안전 질문을 다 답했으면 그 문구가 없다
  const r2 = ok((await call({reason: 'skip', messages: ['기침이 나요'], answers: {...SAFE_BASE, SYM_DICT_CONFIRM: 'sym_R05'}})).out);
  assert.ok(!r2.summary.ko.includes('응급 확인 질문에 답하지 않았습니다'));
});

test('LLM 경로: 사전 0개 → classifySymptom 1회 → SYM_CONFIRM, 답하면 LLM 0회', async () => {
  const llm = fakeLlm({classify: confirmFor(['D01'])});
  let {out, calls} = await call({reason: 'followup', messages: ['속이 영 이상하고 불편해요'], answers: SAFE_BASE, llm});
  assert.equal(ok(out).followUp.id, 'SYM_CONFIRM');
  assert.equal(calls.classify.length, 1);
  assert.equal(out.trace.llm.classify.status, 'confirm');
  const llm2 = fakeLlm({classify: confirmFor(['D01'])});
  ({out, calls} = await call({reason: 'followup', messages: ['속이 영 이상하고 불편해요'], answers: {...SAFE_BASE, SYM_CONFIRM: 'sym_D01'}, llm: llm2}));
  assert.equal(ok(out).followUp.id, 'N5');
  assert.equal(calls.classify.length, 0);
});

test('약 의도 3갈래와 시작 선택 답', async () => {
  const base = {...SAFE_BASE};
  let r = ok((await call({reason: 'followup', messages: ['이 약 궁금해요'], answers: {...base, MED_CHOICE: 'med_info'}})).out);
  assert.deepEqual(r.search, {type: 'pharmacy', department: 'pharmacy'});
  assert.ok(r.summary.ko.includes('약사나 의사에게'));
  r = ok((await call({reason: 'followup', messages: ['이 약 궁금해요'], answers: {...base, MED_CHOICE: 'med_pharmacy'}})).out);
  assert.deepEqual(r, {search: {type: 'pharmacy', department: 'pharmacy'}});
  const {out, calls} = await call({reason: 'followup', messages: ['이 약 궁금해요'], answers: {...base, MED_CHOICE: 'med_symptom'}});
  assert.equal(ok(out).followUp.id, 'N5');
  assert.equal(out.trace.symptom.source, 'med_symptom');
  assert.equal(calls.classify.length, 0);
  r = ok((await call({reason: 'followup', answers: {...base, ASK_START: 'find_hospital'}})).out);
  assert.deepEqual(r, {search: {type: 'hospital'}});
});

test('이상한 답 값: 버리고 경고, 다시 묻는다', async () => {
  const {out} = await call({reason: 'followup', messages: ['기침이 나요'], answers: {Q0: 'perhaps'}});
  assert.equal(ok(out).followUp.id, 'Q0');
  assert.ok(out.trace.warnings.includes('invalid_answer:Q0'));
});

test('오류 코드: data·aborted·internal·contract (예외를 던지지 않는다)', async () => {
  let {out} = await call({deps: {refStore: () => { throw new Error('boom'); }}});
  assert.deepEqual([out.response, out.error], [null, 'data']);
  const ctrl = new AbortController();
  ctrl.abort();
  ({out} = await call({messages: ['기침이 나요'], ctx: {signal: ctrl.signal}}));
  assert.equal(out.error, 'aborted');
  ({out} = await call({messages: ['기침이 나요'], deps: {refStore: {dataVersion: 'x'}}}));
  assert.equal(out.error, 'internal');
  // 계약 위반 응답: 문항 문구가 300자를 넘는 데이터를 직접 주입
  const longItems = data.items.map((i) => (i.linkId === 'Q0' ? {...i, textKo: '가'.repeat(301)} : i));
  const bad = {...data, items: longItems, itemById: new Map(longItems.map((i) => [i.linkId, i]))};
  ({out} = await call({messages: ['기침이 나요'], deps: {refStore: bad}}));
  assert.deepEqual([out.response, out.error], [null, 'contract']);
  assert.ok(out.trace.warnings.some((w) => w.startsWith('contract:')));
});

test('로그: engine.run 한 번, 원문 없음', async () => {
  const {logs} = await call({reason: 'followup', messages: ['기침이 나요 LEAKMARK'], answers: SAFE_BASE});
  const runs = logs.filter((e) => e.event === 'engine.run');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].phase, 'identify');
  assert.equal(runs[0].nextQuestionId, 'SYM_DICT_CONFIRM');
  assert.ok(Number.isFinite(runs[0].latencyMs));
  assert.ok(!JSON.stringify(logs).includes('LEAKMARK'));
});
