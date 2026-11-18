// 브라우저 → /api/care(문진 엔진) 연결.
// connectCare({requestAssistant: createCareAssistant(), rankFacilities: createCareRanking(), healthNotice: careHealthNotice})로 쓴다.
import {localHealthNotice} from './health-consent.mjs';

const RISK_QUESTION_RE=/^(RISK_CONFIRM|SENSITIVE_CHOICE)_(\d{1,4})$/;

/**
 * OpenAI 전송을 허용하는 처리 안내 버전. 서버(lib/care-engine-server.mjs)는 이 버전을 확인한 요청에만 외부 AI 동의를 넘긴다.
 * 지금은 이 버전의 안내를 쓰지 않는다: 원래 안내를 유지하기로 했으므로 OpenAI는 호출되지 않는다.
 * OpenAI를 쓰려면 외부 전송을 고지하는 안내를 이 버전으로 만들어 careHealthNotice로 바꾼다(법적 검토 필요).
 */
export const CARE_CONSENT_VERSION='care-openai-1';

/**
 * 건강정보 처리 안내: 원래 화면 안내(localHealthNotice) 그대로. 이 안내는 "외부 AI 업체에 제공하지 않습니다"이므로,
 * 이 안내에 동의한 요청은 서버에서 외부 AI 동의가 없는 것으로 처리된다(규칙·사전만으로 문진, OpenAI 0회).
 */
export const careHealthNotice=localHealthNotice;

async function post(fetchImpl,endpoint,body,signal){
 const response=await fetchImpl(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal,credentials:'same-origin'});
 if(!response.ok)throw new Error('care_'+response.status);
 return response.json();
}

/**
 * 엔진은 상태가 없으므로, 답하지 않은 위험 확인·민감 안내 질문 ID를 다음 요청에 value:null로 계속 보낸다
 * (care_engine docs/reports/risk_LC_review.md I3). 민감 종류나 원문은 저장하지 않고 질문 ID만 페이지 메모리에 둔다.
 * 프론트는 처리 안내를 확인한 뒤에만 이 함수를 부르므로, 확인한 안내 버전을 consent로 함께 보낸다(서버가 버전으로 외부 AI 허용 여부를 정함).
 */
export function createCareAssistant({fetchImpl=(...args)=>fetch(...args),endpoint='/api/care'}={}){
 let conversation=null;const pending=new Set();
 return async function requestAssistant(payload,{signal}={}){
  const messages=Array.isArray(payload?.messages)?payload.messages:[];
  const first=messages[0]??null;
  if(first!==conversation){conversation=first;pending.clear();} // 새 대화
  const answers=Array.isArray(payload?.followUpAnswers)?payload.followUpAnswers:[];
  const answered=new Set(answers.map(item=>item?.questionId));
  for(const id of [...pending]){
   const n=Number(RISK_QUESTION_RE.exec(id)?.[2]);
   if(answered.has(id)||!(n>=1&&n<=messages.length))pending.delete(id);
  }
  const body={...payload,consent:{granted:true,version:careHealthNotice.version},followUpAnswers:[...answers,...[...pending].map(questionId=>({questionId,value:null}))]};
  const data=await post(fetchImpl,endpoint,body,signal);
  const id=data?.followUp?.id;
  if(typeof id==='string'&&RISK_QUESTION_RE.test(id)&&!answered.has(id))pending.add(id);
  return data;
 };
}

/** 병원 추천 순위. 서버는 엔진이 안내한 진료과로 순서만 정하고 LLM을 부르지 않는다. 대화 내용은 보내지 않는다. */
export function createCareRanking({fetchImpl=(...args)=>fetch(...args),endpoint='/api/care'}={}){
 return async function rankFacilities(payload,{signal}={}){
  return post(fetchImpl,endpoint,{reason:'recommendations',locale:payload?.locale,search:payload?.search,candidates:payload?.candidates},signal);
 };
}
