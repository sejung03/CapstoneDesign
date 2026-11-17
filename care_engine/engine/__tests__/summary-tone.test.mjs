// 11/17 요약 말투(S1): 최종 안내 '~습니다'체, 진료과 순위 표기, 경로별 순위 설명 줄. 문장은 지어낸 짧은 문장이다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SUMMARY, TEMPLATE_VERSION} from '../templates.mjs';
import {buildSummary, SUMMARY_MAX} from '../summary.mjs';
import {applyMappings} from '../slots.mjs';
import {call, data, SAFE_BASE} from './helpers.mjs';
import {simulate, scenarios} from '../../eval/engine_scenarios.mjs';

const lineAfter = (lines, prefix) => lines[lines.findIndex((l) => l.startsWith(prefix)) + 1];
/** 끝이 '~에요/~어요/~예요/~아요/~해요'인 문장(해요체)인가 */
const HAEYO = /(에요|어요|예요|아요|해요|여요)[.!)]*$/;

test('요약 말투: templates-v6, 사람이 정한 문구 그대로', () => {
  assert.equal(TEMPLATE_VERSION, 'templates-v6');
  assert.equal(SUMMARY.header, '입력하신 답을 정리한 참고용 내용입니다. 진단이 아닙니다.');
  assert.equal(SUMMARY.deptNoteStats, '같은 증상으로 진료받는 사람이 많은 진료과 순서입니다. 병원 찾기는 1순위 진료과로 먼저 보여 드립니다.');
  assert.equal(SUMMARY.deptNoteFallback, '증상에 맞는 통계가 없어 일반적으로 먼저 찾는 진료과를 안내합니다. 병원 찾기는 1순위 진료과로 먼저 보여 드립니다.');
  assert.equal(SUMMARY.unchecked, '복용 중인 약, 기존 질환, 함께 있는 다른 증상은 확인하지 않았습니다. 해당되면 진료 때 꼭 알려 주세요.');
  assert.equal(SUMMARY.riskUnconfirmed, '응급 증상인지 확인하지 못했습니다. 증상이 심해지거나 걱정되면 바로 119에 연락하거나 응급실로 가세요.');
  assert.ok(SUMMARY.safetyUnanswered.startsWith('응급 확인 질문에 답하지 않았습니다. 의식이 흐리거나'));
  assert.equal(SUMMARY.emergencyHeader, '119에 알릴 내용입니다(참고용).');
  assert.equal(SUMMARY.medInfo, '약의 복용법이나 함께 먹어도 되는지 같은 질문은 약사나 의사에게 확인하는 것이 가장 정확합니다. 가까운 약국을 찾아볼 수 있습니다. (참고용 안내)');
  assert.equal(SUMMARY.footer, '증상이 갑자기 심해지면 119에 연락하세요.'); // 그대로
});

test('진료과 3개(증상 통계 경로) → 1순위 / 2순위 / 3순위와 stats 설명 줄(진료과 줄 바로 다음)', async () => {
  const {out} = await call({reason: 'skip', messages: ['온몸이 쑤셔요'], answers: {...SAFE_BASE, SYM_DICT_CONFIRM: 'sym_A01'}});
  const lines = out.response.summary.ko.split('\n');
  assert.equal(out.trace.symptom.fallbackGroup, null);
  assert.ok(lines.includes('참고할 진료과: 1순위 내과 / 2순위 이비인후과 / 3순위 정형외과'), lines.join('|'));
  assert.equal(lineAfter(lines, '참고할 진료과: '), SUMMARY.deptNoteStats);
  assert.ok(!lines.includes(SUMMARY.deptNoteFallback));
  assert.ok(out.response.summary.ko.length <= SUMMARY_MAX);
});

test('진료과 1개 → 순위 없이 이름만(설명 줄은 경로대로)', async () => {
  const {out} = await call({reason: 'skip', messages: ['열이 나요'], answers: {...SAFE_BASE, SYM_DICT_CONFIRM: 'sym_A03'}});
  const lines = out.response.summary.ko.split('\n');
  assert.ok(lines.includes('참고할 진료과: 내과'), lines.join('|'));
  assert.ok(!lines.some((l) => l.includes('1순위 내과')));
  assert.equal(lineAfter(lines, '참고할 진료과: '), SUMMARY.deptNoteStats);
});

test('fallback 그룹 경로(증상 모름 → general) → fallback 설명 줄', async () => {
  const {out} = await call({reason: 'skip', messages: ['그냥 몸이 안 좋아요'], answers: {...SAFE_BASE, SYM_DICT_CONFIRM: 'sym_unsure'}});
  const lines = out.response.summary.ko.split('\n');
  assert.equal(out.trace.symptom.fallbackGroup, 'general');
  assert.ok(lines.some((l) => /^참고할 진료과: 1순위 .+ \/ 2순위 .+$/.test(l)), lines.join('|'));
  assert.equal(lineAfter(lines, '참고할 진료과: '), SUMMARY.deptNoteFallback);
  assert.ok(!lines.includes(SUMMARY.deptNoteStats));
});

test('진료과가 없으면 진료과 줄·설명 줄 없음(group을 넘겨도)', () => {
  const codes = new Map([['Q0', 'no']]);
  for (const group of [null, 'general', undefined]) {
    const s = buildSummary({slots: applyMappings({codes, data}), codes, symptom: null, departments: [], data, group});
    assert.ok(!s.includes(SUMMARY.departments), String(group));
    assert.ok(!s.includes(SUMMARY.deptNoteStats) && !s.includes(SUMMARY.deptNoteFallback), String(group));
  }
});

test("요약에 '~에요/~어요'로 끝나는 문장이 남지 않는다(선택지 표시 문구에서 온 값 줄은 제외)", async () => {
  // 템플릿 문구 자체
  for (const [k, v] of Object.entries(SUMMARY)) {
    if (typeof v !== 'string') continue;
    for (const sentence of v.split(/(?<=[.!?])\s+/)) assert.ok(!HAEYO.test(sentence.trim()), `${k}: ${sentence}`);
  }
  // 실제 요약(모든 시나리오의 최종 요약). '이름표: 값' 줄은 값이 선택지·증상 표시 문구라 제외
  let n = 0;
  for (const s of scenarios()) {
    const r = await simulate(s);
    const ko = r.final?.summary?.ko;
    if (!ko) continue;
    for (const line of ko.split('\n')) {
      if (/^[^:]{1,20}: /.test(line)) continue;
      for (const sentence of line.split(/(?<=[.!?)])\s+/)) assert.ok(!HAEYO.test(sentence.trim()), `${s.name}: ${sentence}`);
    }
    n += 1;
  }
  assert.ok(n >= 15, `요약이 나온 시나리오 ${n}개`);
});
