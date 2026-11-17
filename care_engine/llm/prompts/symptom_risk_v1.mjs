import symptomPrompt from './symptom_v1.mjs';
import riskPrompt from './risk_v1.mjs';

export const id = 'symptom_risk_v1';
export const system = `${symptomPrompt.system}\n\n${riskPrompt.system}\n증상 선택 결과와 risk_signal을 한 JSON 객체로 함께 출력한다.`;
export const buildUser = ({text, riskText, candidatesText}) => [
  `증상 목록:\n${candidatesText}`,
  `상담 문장(증상 선택용):\n${text}`,
  `가장 최근 문장(risk_signal 전용):\n${riskText ?? text}`,
].join('\n\n');
export default {id, system, buildUser};
