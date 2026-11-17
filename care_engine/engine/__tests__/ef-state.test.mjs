// 11/17 EF F3: 상태 판단 정리 — I2(성별과 증상 불일치), G3(시작 선택 고정 해제), G4(보이는 답에서만 성별),
// G5(F2는 묻는 상태일 때만), G6(하드코딩 정리). 문장은 모두 지어낸 짧은 문장이다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {call, fakeLlm, data, ref, SAFE_BASE} from './helpers.mjs';
import {safetyCheckItemIds} from '../rules.mjs';
import {sexFromCodes} from '../identify.mjs';
import {visibleCodes} from '../answers.mjs';
import {symptomSexMismatch} from '../recommend.mjs';
import {TARGET_ITEM_ID, INJURY_ITEM_ID} from '../constants.mjs';
import {WARNING_SYMPTOM_SEX_MISMATCH, WARNING_START_CHOICE_OVERRIDDEN} from '../index.mjs';

const OBGYN_KEY = data.departments.get('obstetrics_gynecology').searchKey;
const restricted = [...ref.symptoms.values()].filter((s) => s.sexRestriction && s.isCandidate);
const opposite = (sex) => (sex === 'female' ? 'male' : 'female');

// ---- I2 ----
test('F3 I2: 여성 제한 증상(W·X) 확정 + T2=male → 증상 모름(general), 산부인과 없음, warning symptom_sex_mismatch', async () => {
  const w = restricted.find((s) => s.id.startsWith('W') && s.sexRestriction === 'female');
  assert.ok(w, '시드에 W장 여성 제한 증상이 없음');
  const {out} = await call({reason: 'skip', messages: ['지어낸 문장이에요'], answers: {...SAFE_BASE, T2: 'male', SYM_DICT_CONFIRM: `sym_${w.id}`}});
  assert.equal(out.trace.symptom.id, null);
  assert.equal(out.trace.symptom.source, 'sex_mismatch');
  assert.equal(out.trace.symptom.fallbackGroup, 'general');
  assert.ok(out.trace.warnings.includes(WARNING_SYMPTOM_SEX_MISMATCH));
  assert.ok(!out.trace.warnings.some((x) => x.includes(w.id)), 'warning에 값(증상 ID)을 넣지 않음');
  assert.notEqual(out.response.search.department, OBGYN_KEY);
  assert.ok(!out.response.summary.ko.includes('산부인과'));
  assert.ok(out.response.summary.ko.includes('목록에서 찾지 못함'));
  // 대조: 같은 증상 + 여성 → 확정 그대로
  const ok = await call({reason: 'skip', messages: ['지어낸 문장이에요'], answers: {...SAFE_BASE, T2: 'female', SYM_DICT_CONFIRM: `sym_${w.id}`}});
  assert.equal(ok.out.trace.symptom.id, w.id);
  assert.ok(!ok.out.trace.warnings.includes(WARNING_SYMPTOM_SEX_MISMATCH));
});

test('F3 I2: 성별 제한 증상 전부 × 반대 성별(SYM_CONFIRM·SYM_DICT_CONFIRM) → 증상 모름, 성별 모름이면 그대로', async () => {
  for (const s of restricted) {
    for (const qid of ['SYM_CONFIRM', 'SYM_DICT_CONFIRM']) {
      const bad = await call({reason: 'skip', answers: {...SAFE_BASE, T2: opposite(s.sexRestriction), [qid]: `sym_${s.id}`}});
      assert.equal(bad.out.trace.symptom.source, 'sex_mismatch', `${s.id} ${qid}`);
      assert.ok(bad.out.trace.warnings.includes(WARNING_SYMPTOM_SEX_MISMATCH));
      const unk = await call({reason: 'skip', answers: {...SAFE_BASE, T2: 'unknown', [qid]: `sym_${s.id}`}});
      assert.equal(unk.out.trace.symptom.id, s.id, `${s.id} 성별 모름이면 확정 유지`);
    }
  }
  assert.equal(symptomSexMismatch(null, 'male'), false);
  assert.equal(symptomSexMismatch({sexRestriction: 'female'}, 'unknown'), false);
});

test('F3 I2: 불일치로 증상 모름이 되면 F2를 묻는다(문진 계속, LLM 없음)', async () => {
  const w = restricted.find((s) => s.sexRestriction === 'female');
  const answers = {...SAFE_BASE, T2: 'male', SYM_DICT_CONFIRM: `sym_${w.id}`, N5: 'no', 'N5-1': 'onset_1_3d', N6: 'yes', N7: 'no', N8: 'no', N9: 'no', N10: 'no', N11: 'no', N12: 'no', N13: 'no', P0: 'no'};
  const llm = fakeLlm();
  const {out, calls} = await call({reason: 'followup', messages: ['지어낸 문장이에요'], answers, llm});
  assert.equal(out.response.followUp.id, INJURY_ITEM_ID);
  assert.equal(calls.classify.length, 0);
});

// ---- G3 ----
test('F3 G3: ASK_START=find_pharmacy 뒤 증상 메시지 → 검색 대신 증상 흐름(LLM 없음), warning start_choice_overridden', async () => {
  // 사전 매칭 있음 → 사전 확인 질문
  const dict = await call({reason: 'followup', messages: ['그냥 이야기하고 싶어요', '기침이 나요'], answers: {...SAFE_BASE, ASK_START: 'find_pharmacy'}});
  assert.equal(dict.out.response.search, undefined);
  assert.equal(dict.out.response.followUp.id, 'SYM_DICT_CONFIRM');
  assert.ok(dict.out.trace.warnings.includes(WARNING_START_CHOICE_OVERRIDDEN));
  // 증상 단서만(사전 0개) → LLM 부르지 않고 증상 모름 → 다음 문항
  const llm = fakeLlm();
  const cue = await call({reason: 'followup', messages: ['그냥 이야기하고 싶어요', '배가 아파요'], answers: {...SAFE_BASE, ASK_START: 'find_hospital'}, llm});
  assert.equal(cue.out.response.search, undefined);
  assert.equal(cue.out.response.followUp.id, 'N5');
  assert.equal(cue.out.trace.symptom.source, 'start_choice');
  assert.equal(cue.calls.classify.length, 0);
  // 위험 단서 → 정상 흐름
  const risk = await call({reason: 'followup', messages: ['쓰러질 것 같아요'], answers: {...SAFE_BASE, ASK_START: 'find_hospital'}});
  assert.equal(risk.out.response.search, undefined);
  assert.ok(risk.out.trace.warnings.includes(WARNING_START_CHOICE_OVERRIDDEN));
  // 단서 없음 → 기존대로 검색
  const plain = await call({reason: 'followup', messages: ['그냥 이야기하고 싶어요'], answers: {...SAFE_BASE, ASK_START: 'find_pharmacy'}});
  assert.deepEqual(plain.out.response, {search: {type: 'pharmacy', department: 'pharmacy'}});
  const none = await call({reason: 'followup', messages: [], answers: {...SAFE_BASE, ASK_START: 'find_hospital'}});
  assert.deepEqual(none.out.response, {search: {type: 'hospital'}});
});

test('F3 G3: MED_CHOICE med_pharmacy·med_info + 증상 단서 → 정상 흐름, med_symptom은 기존대로, 단서 없으면 검색', async () => {
  for (const v of ['med_pharmacy', 'med_info']) {
    const {out, calls} = await call({reason: 'followup', messages: ['약 먹고 배가 아파요'], answers: {...SAFE_BASE, MED_CHOICE: v}});
    assert.equal(out.response.search, undefined, v);
    assert.equal(out.response.followUp.id, 'N5', v);
    assert.equal(calls.classify.length, 0, v);
  }
  const sym = await call({reason: 'followup', messages: ['약 먹고 배가 아파요'], answers: {...SAFE_BASE, MED_CHOICE: 'med_symptom'}});
  assert.equal(sym.out.response.followUp.id, 'N5');
  assert.ok(!sym.out.trace.warnings.includes(WARNING_START_CHOICE_OVERRIDDEN));
  const plain = await call({reason: 'followup', messages: ['먹는 약 때문에 궁금한 게 있어요'], answers: {...SAFE_BASE, MED_CHOICE: 'med_pharmacy'}});
  assert.deepEqual(plain.out.response, {search: {type: 'pharmacy', department: 'pharmacy'}});
});

test('F3 G3: 시작 선택 고정 해제 뒤 skip → 증상 모름 추천(LLM 없음), 안전 규칙은 여전히 먼저', async () => {
  const skip = await call({reason: 'skip', messages: ['배가 아파요'], answers: {...SAFE_BASE, ASK_START: 'find_pharmacy'}});
  assert.equal(skip.out.response.search.type, 'hospital');
  assert.ok(skip.out.response.summary);
  assert.equal(skip.calls.classify.length, 0);
  const emerg = await call({reason: 'followup', messages: ['배가 아파요'], answers: {Q0: 'no', N1: 'no', ASK_START: 'find_pharmacy'}});
  assert.equal(emerg.out.response.emergency.active, true);
  assert.equal(emerg.out.response.search, undefined);
});

// ---- G4 ----
test('F3 G4: 성별은 보이는 답에서만(Q0=예면 T2가 숨겨져 성별 없음), identify에는 보이는 답이 간다', async () => {
  const codes = new Map([['Q0', 'yes'], ['T2', 'male']]);
  assert.equal(sexFromCodes(visibleCodes(codes, data), data), null);
  assert.equal(sexFromCodes(visibleCodes(new Map([['Q0', 'no'], ['T2', 'male']]), data), data), 'male');
  const seen = [];
  const matchSymptoms = (text, refData, opts) => { seen.push(opts?.sex ?? null); return []; };
  const llm = fakeLlm();
  await call({reason: 'followup', messages: ['지어낸 문장이에요'], answers: {...SAFE_BASE, T2: 'male'}, llm, deps: {matchSymptoms}});
  assert.ok(seen.includes('male'));
  assert.equal(llm.calls.classify[0].sex, 'male');
});

// ---- G5 ----
test('F3 G5: 증상이 확정되면 F2 답은 추천에 쓰지 않는다(variant 행이 없어 fallback이어도)', async () => {
  // variant 행을 비운 데이터 사본: 확정 증상 R05가 fallback 경로로 간다
  const noVariants = {...data, variants: new Map()};
  const known = await call({reason: 'skip', answers: {...SAFE_BASE, SYM_DICT_CONFIRM: 'sym_R05', F2: 'yes'}, deps: {refStore: noVariants}});
  assert.equal(known.out.trace.symptom.id, 'R05');
  assert.equal(known.out.trace.symptom.fallbackGroup, 'general');
  // 증상 모름이면 F2=예 → injury
  const unknown = await call({reason: 'skip', answers: {...SAFE_BASE, SYM_DICT_CONFIRM: 'sym_unsure', F2: 'yes'}});
  assert.equal(unknown.out.trace.symptom.fallbackGroup, 'injury');
});

// ---- G6 ----
test('F3 G6: 안전 미응답 판단 문항 = 답 규칙이 가리키는 문항 = {Q0, N1, N2, N3}(시드가 바뀌면 이 테스트가 깨진다)', () => {
  assert.deepEqual(safetyCheckItemIds(data), ['Q0', 'N1', 'N2', 'N3']);
});

test('F3 G6: ID로 읽는 예외 문항(T1·F2)은 결과 매핑 slot이 없다(slot이 생기면 slot으로 바꿀 것)', () => {
  for (const id of [TARGET_ITEM_ID, INJURY_ITEM_ID]) {
    assert.ok(data.itemById.has(id), id);
    assert.ok(!data.mappings.some((m) => m.from === 'answer' && m.question === id), `${id}에 결과 매핑 slot이 생김`);
  }
  assert.equal(data.itemById.get(INJURY_ITEM_ID).engineCondition, 'symptom_is_fallback');
  // symptom_is_fallback 문항(F1·F2·F3) 중 F2만 선택형으로 묻고, F2에는 slot이 없다(F3의 report.notes는 string 문항이라 묻지 않음)
  assert.ok(data.items.filter((it) => it.engineCondition === 'symptom_is_fallback').map((it) => it.linkId).includes(INJURY_ITEM_ID));
});
