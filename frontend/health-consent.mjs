export const localHealthNotice={version:'local-health-2',controller:'HearO',purpose:'문진과 증상 정리, 진료과 및 의료기관 탐색 보조, 분석서 작성',items:['증상과 문진 답변','만 나이, 알레르기, 복용 중인 약, 기저질환','사용자가 확인한 이전 분석서 내용'],retention:'이 페이지를 새로고침하거나 닫을 때까지 보유·이용합니다. 문진, 대화와 분석서는 새 대화를 시작할 때도 초기화됩니다. 내려받은 PDF와 복사한 내용은 사용자가 관리합니다.',processing:'현재 건강정보를 외부 AI 업체에 제공하지 않습니다.'};
export function createHealthConsent(enabled=false){return {enabled,notice:null,acceptedKey:'',acceptedAt:null,open:false,pending:'',starter:'',checked:false};}
export function normalizeHealthNotice(value){
 if(!value||typeof value!=='object')throw new TypeError('Invalid health notice');
 const result={};
 for(const key of ['version','controller','purpose','retention','processing']){
  if(typeof value[key]!=='string'||!value[key].trim()||value[key].length>2000)throw new TypeError('Invalid health notice '+key);
  result[key]=value[key].trim();
 }
 if(!Array.isArray(value.items)||!value.items.length||value.items.length>20||value.items.some(item=>typeof item!=='string'||!item.trim()||item.length>200))throw new TypeError('Invalid health notice items');
 if(value.allowReportImport!==undefined&&typeof value.allowReportImport!=='boolean')throw new TypeError('Invalid report import scope');
 result.allowReportImport=value.allowReportImport===true;result.items=value.items.map(item=>item.trim());return result;
}
export function healthConsentKey(state){
 const consent=state.healthConsent,external=!!(state.assistant?.connected||state.rankingConnected);
 if(external&&!consent?.notice)return '';
 return JSON.stringify([external?'external':'local',consent?.notice||localHealthNotice]);
}
export function hasHealthConsent(state){
 if(!state.healthConsent?.enabled)return true; // Legacy renderer is regression-test-only.
 const key=healthConsentKey(state);return !!key&&state.healthConsent.acceptedKey===key;
}

// Remember explicit consent to the exact notice on this browser, per signed-in account.
const accountConsentRecord=state=>state.account?.accountId?'medical-health-consent:'+state.account.accountId:null;
export function rememberAccountHealthConsent(state,storage){
 const record=accountConsentRecord(state);
 if(record&&hasHealthConsent(state)&&state.healthConsent.acceptedAt){
  try{storage.setItem(record,JSON.stringify([state.healthConsent.acceptedKey,state.healthConsent.acceptedAt]));}catch{}
 }
}
export function restoreAccountHealthConsent(state,storage){
 const record=accountConsentRecord(state),key=healthConsentKey(state);
 if(!record||!key||hasHealthConsent(state))return;
 try{
  const [savedKey,acceptedAt]=JSON.parse(storage.getItem(record)||'[]');
  if(savedKey!==key||typeof acceptedAt!=='string'||!Number.isFinite(Date.parse(acceptedAt)))return;
  Object.assign(state.healthConsent,{acceptedKey:key,acceptedAt});
 }catch{}
}
export function forgetAccountHealthConsent(state,storage){
 const record=accountConsentRecord(state);
 if(record)try{storage.removeItem(record);}catch{}
}

export const localHealthNoticeEn={version:localHealthNotice.version,controller:'HearO',purpose:'Questionnaire, symptom summaries, care navigation and health notes',items:['Symptoms and questionnaire answers','Age in completed years, allergies, medications and existing conditions','User-reviewed text from previous notes'],retention:'Retained and used until this page is refreshed or closed. Questionnaire answers, chat and notes are also cleared when a new conversation starts. You manage downloaded PDFs and copied text.',processing:'Health information is not currently provided to an external AI provider.'};

// 11/18: 외부 AI(OpenAI) 처리 안내. care-adapter.mjs CARE_CONSENT_VERSION과 version이 같아야 서버가 외부 AI 동의로 본다.
// 원래 안내(localHealthNotice)와 다른 곳은 version·processing뿐이다. processing은 실제 동작(care_engine/llm)과 맞춰 썼다:
//   보내는 것 = 대화창 문장(최근 500자, 증상 해석·위험 신호·건강정보 후보 추출), 가리는 것 = 전화·이메일·주민번호·카드번호(llm/pii.mjs),
//   요청 = store:false(llm/providers/openai.mjs). OpenAI 보관·학습 정책 문장은 배포 전에 OpenAI 최신 정책으로 다시 확인한다.
export const careAiHealthNotice={...localHealthNotice,version:'care-openai-1',processing:'증상을 더 정확히 알아듣기 위해 대화창에 적은 문장(최근 500자 이내)을 미국 OpenAI의 AI에 보내 해석합니다. 보내기 전에 전화번호·이메일·주민등록번호·카드번호는 가리지만 이름·주소 등은 가려지지 않으니 적지 마세요. OpenAI에는 결과를 저장하지 않도록 요청하며, OpenAI 정책상 API로 받은 내용은 AI 학습에 쓰이지 않고 남용 감시를 위해 최대 30일 보관될 수 있습니다. AI는 증상을 정리할 뿐 진단하지 않습니다.'};
export const careAiHealthNoticeEn={...localHealthNoticeEn,version:careAiHealthNotice.version,processing:'To understand your symptoms more accurately, the sentences you type in the chat (up to the latest 500 characters) are sent to the AI of OpenAI (USA) for interpretation. Phone numbers, email addresses, resident registration numbers and card numbers are masked before sending, but names and addresses are not, so please do not include them. We ask OpenAI not to store the results. Under OpenAI\'s policy, API content is not used to train AI and may be kept for up to 30 days for abuse monitoring. The AI only organizes your symptoms and does not diagnose.'};
/** 안내 version → 영어 원본(다른 언어는 locales/*.json으로 번역). 한국어는 안내 객체 그대로. */
export const healthNoticeEnByVersion=Object.freeze({[localHealthNotice.version]:localHealthNoticeEn,[careAiHealthNotice.version]:careAiHealthNoticeEn});
export const healthNoticeKoByVersion=Object.freeze({[localHealthNotice.version]:localHealthNotice,[careAiHealthNotice.version]:careAiHealthNotice});
