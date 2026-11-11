export const localHealthNotice={version:'local-health-2',controller:'의료 안내',purpose:'문진과 증상 정리, 진료과 및 의료기관 탐색 보조, 분석서 작성',items:['증상과 문진 답변','만 나이, 알레르기, 복용 중인 약, 기저질환','사용자가 확인한 이전 분석서 내용'],retention:'이 페이지를 새로고침하거나 닫을 때까지 보유·이용합니다. 문진, 대화와 분석서는 새 대화를 시작할 때도 초기화됩니다. 내려받은 PDF와 복사한 내용은 사용자가 관리합니다.',processing:'현재 건강정보를 외부 AI 업체에 제공하지 않습니다.'};
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

export const localHealthNoticeEn={version:localHealthNotice.version,controller:'Medical Guide',purpose:'Questionnaire, symptom summaries, care navigation and health notes',items:['Symptoms and questionnaire answers','Age in completed years, allergies, medications and existing conditions','User-reviewed text from previous notes'],retention:'Retained and used until this page is refreshed or closed. Questionnaire answers, chat and notes are also cleared when a new conversation starts. You manage downloaded PDFs and copied text.',processing:'Health information is not currently provided to an external AI provider.'};
