// 11/18 절충 1: 고쳐 쓰기 + 위험 신호(risk_v2 정의 그대로) 결합. 위험 신호는 고쳐 쓴 표현이 아니라 원래 문장으로 본다.
import rewritePrompt from './symptom_rewrite_v1.mjs';
import riskPrompt from './risk_v2.mjs';

export const id = 'symptom_rewrite_risk_v1';
export const system = `${rewritePrompt.system}\n\n${riskPrompt.system}\n고쳐 쓴 증상 표현과 risk_signal을 한 JSON 객체로 함께 출력한다.`;
export const buildUser = ({text, riskText}) => [
  `상담 문장(증상 표현용):\n${text}`,
  `가장 최근 문장(risk_signal 전용):\n${riskText ?? text}`,
].join('\n\n');
export default {id, system, buildUser};
