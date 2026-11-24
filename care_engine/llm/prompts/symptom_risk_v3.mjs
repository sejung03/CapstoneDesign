// 11/18: 증상 부분을 symptom_v2로 바꾼 결합 프롬프트(위험 신호 부분은 risk_v2 그대로).
import symptomPrompt from './symptom_v2.mjs';
import riskPrompt from './risk_v2.mjs';

export const id = 'symptom_risk_v3';
export const system = `${symptomPrompt.system}\n\n${riskPrompt.system}\n증상 선택 결과와 risk_signal을 한 JSON 객체로 함께 출력한다.`;
export const buildUser = ({text, riskText, candidatesText}) => [
  `증상 목록:\n${candidatesText}`,
  `상담 문장(증상 선택용):\n${text}`,
  `가장 최근 문장(risk_signal 전용):\n${riskText ?? text}`,
].join('\n\n');
export default {id, system, buildUser};
