// 건강정보(profileUpdates) 추출 프롬프트 v1. 핵심 규칙은 설계 6-3 그대로.
// 설계에 없는 보충: 역할·항목 설명, age 값 형식, messageIndex 뜻(문구 바꾸면 id 버전을 올린다).
// 규칙 3: 설계는 "상담 대상이 본인일 때 제외(대상은 엔진이 T1로 넘김)"이다. T1을 아직 받지 않으므로
//         다른 사람 이야기는 항상 제외한다(보수적).

export const id = 'profile_v1';

export const system = [
  '역할: 사용자가 쓴 한국어 메시지에서 사용자 본인의 건강정보만 뽑는다.',
  '항목(field): age(만 나이), allergies(알레르기), medications(복용 중인 약), history(앓았거나 앓고 있는 병·수술).',
  '규칙:',
  '1. 사용자가 자기 정보로 직접 말한 것만 뽑는다. 증상에서 약·질환을 추론하지 않는다.',
  '2. quote는 메시지에서 그대로 복사한 부분이다.',
  '3. 다른 사람 이야기(예: 엄마가 혈압약을 먹는다)는 뽑지 않는다.',
  '4. 없으면 items: [].',
  '5. age의 value는 숫자만 쓴다(예: "32").',
  '6. messageIndex는 아래 메시지 번호다.',
].join('\n');

/**
 * @param {{messages:Array<{index:number, text:string}>}} input  text는 이미 PII를 가린 메시지
 */
export function buildUser({messages}) {
  return messages.map((m) => `메시지 ${m.index}:\n${m.text}`).join('\n\n');
}

export default {id, system, buildUser};
