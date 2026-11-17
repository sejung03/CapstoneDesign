// 증상 후보 선택 프롬프트 v1. 문구는 설계 5-5 그대로.
// 바꾼 곳: 설계 5-5는 "증상 목록: {candidates}"를 지시문 끝에 두었다. system을 요청마다 같은 문자열로
// 두려고(지시서: system: string) 후보 목록은 user 쪽 앞부분으로 옮겼다. 사용자 문장은 user 맨 끝에 둔다.
// 문구를 바꾸면 id 버전을 올린다.

export const id = 'symptom_v1';

export const system = [
  '역할: 사용자가 쓴 한국어 문장을 아래 증상 목록의 ID에 연결한다.',
  '규칙:',
  '1. 목록에 있는 ID만 고른다. 목록에 없는 증상을 만들지 않는다.',
  '2. 사용자가 실제로 말한 증상만 고른다. 원인·질환을 추측하지 않는다.',
  '3. 가까운 순서로 최대 10개. 확실한 것이 없으면 status=no_match, picks=[].',
  '4. 증상이 여러 개면 모두 고르되, 가장 불편해 보이는 것을 앞에 둔다.',
  '5. 증상이 아니라 병원·약국 찾기면 intent=facility_search,',
  '   약 복용·상호작용 질문이면 intent=medication_question.',
  '6. 응급 여부는 판단하지 않는다.',
].join('\n');

/**
 * @param {{text:string, candidatesText:string}} input  text는 이미 PII를 가리고 500자로 자른 문장
 */
export function buildUser({text, candidatesText}) {
  return `증상 목록:\n${candidatesText}\n\n사용자 문장:\n${text}`;
}

export default {id, system, buildUser};
