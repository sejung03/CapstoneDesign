// 11/17 EF F1(S1): 위험 표현·병원 찾기 문장은 첫 응답으로 Q0를 받는다. 약국 찾기만 0문항 search.
// 문장은 모두 지어낸 짧은 문장이다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {call, fakeLlm} from './helpers.mjs';
import {simulate, makeLlm, pharmacyStarterText} from '../../eval/engine_scenarios.mjs';

const SAFE = {Q0: 'no', N1: 'yes', N2: 'yes', N3: 'no', T1: 'self', T2: 'female', T3: 'age_19_64'};

// 검토 S1의 네 유형과 같은 구조(쓰러짐+병원, 호흡+병원, 응급실+병원, 자해·자살+진료과) + 그 밖 재현 유형
const RISK_FIRST = [
  '아빠가 쓰러졌어요 병원 어디예요',
  '숨을 못 쉬겠어요 병원 어디',
  '응급실 있는 병원 찾아줘',
  '자살하고 싶어요 정신과 어디',
  '자해를 했어요 정신과 알려줘',
  '의식이 없어요 근처 병원 알려줘',
  '피를 토해요 병원 찾아',
  '가슴이 답답해요 병원 찾아줘',
  '화상 입었어요 병원 어디',
  '숨이 안 쉬어지는데 약국 어디',
];
// 위험 단서 목록에 없는 병원 찾기 문장: 약국이 아니므로 역시 Q0부터
const HOSPITAL_FIRST = ['정형외과 어디 있어요', '지금 여는 병원 있나요', '소아과 추천해 주세요', '머리가 깨질 것 같아요 병원 어디', '애가 경기를 해요 소아과 어디'];

for (const [label, list, reasons] of [['위험 단서', RISK_FIRST, ['blocked_risk']], ['병원 찾기', HOSPITAL_FIRST, ['no_pharmacy']]]) {
  test(`F1 S1: ${label} 문장 → 첫 응답은 Q0 followUp(search·LLM 없음)`, async () => {
    for (const m of list) {
      const llm = fakeLlm();
      const {out, calls} = await call({messages: [m], llm});
      assert.equal(out.response.followUp?.id, 'Q0', m);
      assert.equal(out.response.search, undefined, m);
      assert.equal(calls.classify.length + calls.profile.length, 0, m);
      assert.ok(reasons.includes(out.trace.facilityKeyword), `${m}: ${out.trace.facilityKeyword}`);
      assert.ok(!JSON.stringify(out.trace).includes(m), '원문이 trace에 없음');
    }
  });
}

test('F1 S1: 약국 시작 문장(프론트 파일) → 0문항 pharmacy search, trace.facilityKeyword = search', async () => {
  const {out, calls} = await call({messages: [pharmacyStarterText()]});
  assert.deepEqual(out.response, {search: {type: 'pharmacy', department: 'pharmacy', openOnly: true}});
  assert.equal(out.trace.facilityKeyword, 'search');
  assert.equal(calls.classify.length, 0);
});

test('F1 S1: 답이 생긴 뒤 요청은 키워드를 보지 않는다(trace.facilityKeyword = null)', async () => {
  const {out} = await call({reason: 'followup', messages: [pharmacyStarterText()], answers: {Q0: 'no'}});
  assert.equal(out.trace.facilityKeyword, null);
  assert.equal(out.response.followUp.id, 'N1');
});

test('F1 S1: 병원 찾기 문장 → Q0 → N1~N3 → T1~T3 → LLM 의도 facility_search(가짜) → search(7문항)', async () => {
  const r = await simulate({name: 'f1_hospital', messages: ['정형외과 어디 있어요'], answers: SAFE,
    llm: makeLlm({classify: {status: 'route', intent: 'facility_search', meta: {}}})});
  assert.deepEqual(r.asked, ['Q0', 'N1', 'N2', 'N3', 'T1', 'T2', 'T3']);
  assert.deepEqual(r.final, {search: {type: 'hospital', department: 'orthopedics'}});
  assert.equal(r.llmCalls.classify, 1);
  assert.equal(r.contractErrors.length, 0);
});

test('F1 S1: 위험 단서 문장 + Q0=예 → 응급(search 없음). riskCues는 판정에 쓰지 않으므로 Q0=아니요면 문진 계속', async () => {
  const yes = await call({reason: 'followup', messages: ['아빠가 쓰러졌어요 병원 어디예요'], answers: {Q0: 'yes'}});
  assert.equal(yes.out.response.emergency?.active, true);
  assert.equal(yes.out.response.search, undefined);
  const no = await call({reason: 'followup', messages: ['아빠가 쓰러졌어요 병원 어디예요'], answers: {Q0: 'no'}});
  assert.equal(no.out.response.emergency, undefined);
  assert.equal(no.out.response.followUp.id, 'N1');
});
