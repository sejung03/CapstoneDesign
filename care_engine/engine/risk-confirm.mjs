// 11/17 RF2: 위험 표현 확인 질문(검토 I7, 지시서 "이번에 정한 것 2" 중간안).
// 대상: message_key가 freetext_urgent인 자유 입력 규칙 hit만. EMERGENCY_STOP·민감 안내(109·112·1366)는 대상이 아니다.
//
// 상태 없이 계산하는 법(계약 안: followUp.id·followUpAnswers·messages만 씀)
//  - 확인 질문 ID는 RISK_CONFIRM_<n>. n = 질문을 낼 때의 사용자 메시지 수. 답은 질문 ID별로 따로 남는다.
//  - 메시지 j(0부터)의 urgent hit는 n > j인 확인 답이 "덮는다". 덮는 답이 여럿이면 가장 보수적인 것(예 > 잘 모르겠어요 > 아니요).
//  - 덮이지 않은 hit가 있으면 확인 전이다. 그중 가장 이른 메시지 i에 대해 지금까지 낸 횟수 = (메시지 수 L) − i.
//    (hit가 처음 나온 요청에서 1번, 답 없이 메시지를 하나 더 보내면 2번.) 2번을 넘으면 '잘 모르겠어요'로 처리(무한 반복 금지).
//  - reason=skip인데 확인 전이면 '잘 모르겠어요'로 본다(11/17 RG1: 답하지 않은 것은 우리 규칙에서 '잘 모르겠어요'. 두 번 무응답과 같은 처리).
import {RISK_ANSWERS, RISK_CONFIRM_KEY, RISK_CONFIRM_MAX_ASKS, RISK_CONFIRM_PREFIX} from './constants.mjs';

const SEVERITY = {[RISK_ANSWERS.yes]: 3, [RISK_ANSWERS.unsure]: 2, [RISK_ANSWERS.no]: 1};

/**
 * @param {{hits:Array<{messageKey:string, source:string, messageIndexes?:number[]}>, riskConfirms:Array<{n:number, value:string}>,
 *          messageCount:number, reason:string}} input
 * @returns {{state:'none'|'yes'|'no'|'unsure'|'pending', askId:string|null, asks:number, unconfirmedByTimeout:boolean}}
 *   none: urgent hit 없음 / yes: 하나라도 '예' / pending: 확인 질문을 낸다 / unsure: 잘 모르겠어요(또는 2번 무응답·확인 전 skip) / no: 모두 '아니요'
 */
export function resolveRiskConfirm({hits, riskConfirms = [], messageCount, reason}) {
  const idx = new Set();
  for (const h of hits) {
    if (h.source !== 'free_text' || h.messageKey !== RISK_CONFIRM_KEY) continue;
    for (const i of h.messageIndexes ?? []) idx.add(i);
  }
  if (idx.size === 0) return {state: 'none', askId: null, asks: 0, unconfirmedByTimeout: false};
  const answers = riskConfirms.filter((a) => Number.isInteger(a.n) && a.n >= 1 && a.n <= messageCount);
  let worst = 0;
  const uncovered = [];
  for (const i of idx) {
    const covering = answers.filter((a) => a.n > i);
    if (covering.length === 0) { uncovered.push(i); continue; }
    worst = Math.max(worst, ...covering.map((a) => SEVERITY[a.value] ?? 0));
  }
  if (worst === 3) return {state: 'yes', askId: null, asks: 0, unconfirmedByTimeout: false};
  if (uncovered.length > 0) {
    if (reason === 'skip') return {state: 'unsure', askId: null, asks: 0, unconfirmedByTimeout: true}; // 11/17 RG1
    // 11/17 RF6(검토 I3): 덮이지 않은 hit 메시지마다 낸 횟수(L − i)를 따로 센다. 2번 이하인 메시지가 하나라도 있으면
    // 새로 묻는다(그 질문의 답이 앞의 무응답 hit까지 덮는다). 모두 2번을 넘었으면 '잘 모르겠어요'.
    const fresh = uncovered.filter((i) => messageCount - i <= RISK_CONFIRM_MAX_ASKS);
    if (fresh.length > 0) {
      const asks = messageCount - Math.min(...fresh);
      return {state: 'pending', askId: `${RISK_CONFIRM_PREFIX}${messageCount}`, asks, unconfirmedByTimeout: false};
    }
    return {state: 'unsure', askId: null, asks: messageCount - Math.min(...uncovered), unconfirmedByTimeout: true};
  }
  if (worst === 2) return {state: 'unsure', askId: null, asks: 0, unconfirmedByTimeout: false};
  return {state: 'no', askId: null, asks: 0, unconfirmedByTimeout: false};
}
