// E6 전수: Q0(예/아니요/미응답) × N1·N2·N3(예/아니요/모름/미응답) = 192가지, skip 요청과 일반 요청 모두.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkResponseContract} from '../contract.mjs';
import {fakeLlm, call} from './helpers.mjs';

const Q0 = ['yes', 'no', null];
const N = ['yes', 'no', 'unknown', null];
const RISKY = {N1: ['no', 'unknown'], N2: ['no', 'unknown'], N3: ['yes', 'unknown']};
const SAFETY_LINE = '응급 확인 질문에 답하지 않았어요.';

function combos() {
  const out = [];
  for (const q0 of Q0) for (const n1 of N) for (const n2 of N) for (const n3 of N) out.push({Q0: q0, N1: n1, N2: n2, N3: n3});
  return out;
}

test('전수 192가지 × (skip, followup): 위험 답이 보이면 emergency만(진료과·search 없음), 없으면 emergency 없음', async () => {
  const all = combos();
  assert.equal(all.length, 192);
  let checked = 0;
  for (const c of all) {
    const answers = Object.fromEntries(Object.entries(c).filter(([, v]) => v !== null));
    // N 문항은 Q0=no일 때만 보인다
    const risky = c.Q0 === 'yes' || (c.Q0 === 'no' && Object.entries(RISKY).some(([q, vals]) => vals.includes(c[q])));
    const anyUnanswered = c.Q0 === null || (c.Q0 === 'no' && [c.N1, c.N2, c.N3].includes(null));
    for (const reason of ['skip', 'followup']) {
      const llm = fakeLlm();
      const {out} = await call({reason, messages: ['기침이 나요'], answers, llm});
      const tag = `${reason} ${JSON.stringify(c)}`;
      assert.ok(out.response, `${tag}: ${out.error}`);
      assert.ok(checkResponseContract(out.response).ok, tag);
      const r = out.response;
      if (risky) {
        assert.equal(r.emergency?.active, true, tag);
        assert.equal(r.search, undefined, tag);
        assert.ok(!r.summary || !r.summary.ko.includes('참고할 진료과'), tag);
        if (r.followUp) assert.equal(r.followUp.id.startsWith('E'), true, tag); // 119 정리용 E 문항만
        assert.equal(out.trace.terminal, true, tag);
      } else {
        assert.equal(r.emergency, undefined, tag);
        if (reason === 'skip') {
          assert.ok(r.search && r.summary, tag);
          assert.equal(r.summary.ko.startsWith(SAFETY_LINE), anyUnanswered, tag);
        }
      }
      assert.equal(llm.calls.classify.length, 0, tag); // 안전 질문 단계에서는 LLM 0회
      checked += 1;
    }
  }
  assert.equal(checked, 384);
});
