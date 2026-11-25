// 브라우저 → /api/care(문진 엔진) 연결.
// connectCare({requestAssistant: createCareAssistant(), rankFacilities: createCareRanking(), healthNotice: careHealthNotice})로 쓴다.
import {careAiHealthNotice} from './health-consent.mjs';

// 11/18 SYM_RETRY_<n>: 증상을 못 찾았을 때 되묻기. 버튼 대신 대화창에 더 적으면 답이 없으므로 value:null로 계속 보내 엔진이 "이미 되물었음"을 안다
const RISK_QUESTION_RE=/^(RISK_CONFIRM|SENSITIVE_CHOICE|SYM_RETRY)_(\d{1,4})$/;

/**
 * OpenAI 전송을 허용하는 처리 안내 버전. 서버(lib/care-engine-server.mjs)는 이 버전을 확인한 요청에만 외부 AI 동의를 넘긴다.
 * 11/18: 이 버전의 외부 AI 안내(health-consent.mjs careAiHealthNotice)를 쓴다 → 사용자가 동의하면 OpenAI가 호출된다.
 * 실제 서비스로 내보내기 전에 안내 문구의 법적 검토가 필요하다. 끄려면 careHealthNotice를 localHealthNotice로 되돌린다.
 */
// 11/25: 음성 입력도 이 안내에 포함되면서 care-openai-2. 버전은 안내 객체 한 곳(health-consent.mjs)에서만 정한다
export const CARE_CONSENT_VERSION=careAiHealthNotice.version;

/**
 * 건강정보 처리 안내: 11/18부터 외부 AI(OpenAI) 처리를 알리는 안내. 이 안내를 확인한 요청만 서버가 외부 AI 동의로 넘긴다.
 * 서버에 LLM_PROVIDER=openai와 OPENAI_API_KEY가 없으면 동의해도 OpenAI를 부르지 않는다(규칙·사전·되묻기로 문진).
 */
export const careHealthNotice=careAiHealthNotice;

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
