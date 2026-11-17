// 엔진 테스트 공용 도우미(테스트 파일 아님). 지어낸 짧은 문장만 쓴다.
import {runCare} from '../index.mjs';
import {loadIntakeData} from '../intake-data.mjs';
import {buildSymptomConfirm} from '../../llm/confirm-question.mjs';

export const data = loadIntakeData();
export const ref = data.refData;
export const CONSENT = Object.freeze({granted: true, provider: 'mock', version: 'test-v1', healthInfo: true});

/** 안전·대상 질문을 "안전" 쪽으로 답한 묶음 */
export const SAFE_BASE = Object.freeze({Q0: 'no', N1: 'yes', N2: 'yes', N3: 'no', T1: 'self', T2: 'female', T3: 'age_19_64'});

export const toAnswers = (obj) => Object.entries(obj).map(([questionId, value]) => ({questionId, value}));

/** 가짜 LLM: 호출 기록. classify/profile 결과는 값 또는 함수. */
export function fakeLlm({classify = {status: 'fallback', reason: 'no_match', meta: {}},
  combined = {status: 'fallback', reason: 'no_match', riskSignal: 'none', meta: {}},
  risk = {riskSignal: 'none', meta: {}}, profile = {items: [], meta: {}}, classifyDelayMs = 0} = {}) {
  const calls = {classify: [], combined: [], risk: [], profile: []};
  return {
    calls,
    llm: {
      classifySymptom: async (input) => {
        calls.classify.push(input);
        if (classifyDelayMs) await new Promise((r) => setTimeout(r, classifyDelayMs));
        return typeof classify === 'function' ? classify(input) : classify;
      },
      classifySymptomWithRisk: async (input) => {
        calls.combined.push(input);
        return typeof combined === 'function' ? combined(input) : combined;
      },
      detectRiskSignal: async (input) => {
        calls.risk.push(input);
        return typeof risk === 'function' ? risk(input) : risk;
      },
      extractProfileUpdates: async (input) => {
        calls.profile.push(input);
        return typeof profile === 'function' ? profile(input) : profile;
      },
    },
  };
}

export const confirmFor = (picks) => ({status: 'confirm', followUp: buildSymptomConfirm(picks, ref, 'ko'), meta: {provider: 'fake'}});

/** runCare 한 번. */
export async function call({reason = 'message', messages = [], answers = {}, answerList = null, llm = fakeLlm(), deps = {}, ctx = {}, extra = {}} = {}) {
  const logs = [];
  const payload = {reason, locale: 'ko', messages, followUpAnswers: answerList ?? toAnswers(answers), profile: {age: '', allergies: '', medications: '', history: ''}, ...extra};
  const out = await runCare(payload, {consent: CONSENT, requestId: 'req-test', deadlineAt: Date.now() + 5000, ...ctx}, {llm: llm.llm, log: (e) => logs.push(e), ...deps});
  return {out, logs, calls: llm.calls, payload};
}
