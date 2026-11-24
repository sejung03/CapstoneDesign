import {phrase,expandLocales,localizedLabels} from './i18n.mjs';
import {normalizeHealthUpdates} from './health-updates.mjs';
import {canUsePreviousReport} from './report-import.mjs';
import {normalizeEmergency} from './emergency.mjs';
import {departmentCatalog} from './departments.mjs';
import {travelModes} from './routing.mjs';
import {normalizeIntakeQuestionnaire,intakeLabel} from './intake-data.mjs';
export function createAssistantState(connected=false){
 return {connected,status:connected?'ready':'disconnected',response:null,confirmed:null,answers:[],questions:[],editing:false,summaryDraft:'',applied:false};
}
export function assistantContent(state){
 const profile=state.profile||{};
 return {
  ...(state.reportImport?.confirmed&&canUsePreviousReport(state)?{previousReport:state.reportImport.confirmed}:{}),
  intake:state.chat.intakeContext||null,
  messages:state.chat.messages.filter(message=>message.role==='user').map(message=>message.text),
  followUpAnswers:state.assistant?.answers||[],
  profile:{age:profile.age||'',allergies:profile.allergies||'',medications:profile.medications||'',history:profile.history||''}
 };
}
export function assistantContentKey(state){return JSON.stringify(assistantContent(state));}
export function assistantSearchContext(state){
 const criteria=state.search?.criteria||{};
 return {region:criteria.region||'',type:criteria.type||'all',department:criteria.department||'all',openOnly:!!criteria.openOnly,mode:state.routing?.mode||'walk'};
}
export function assistantInputKey(state){return JSON.stringify([assistantContent(state),assistantSearchContext(state)]);}
export function normalizeAssistantResponse(raw,questionnaire=null){
 const fail=()=>{throw new TypeError('Invalid assistant response');};
 const label=value=>{
  try{return localizedLabels(value,2000);}catch{return fail();}
 };
 if(!raw||typeof raw!=='object')return fail();
 const summary=raw.summary==null?null:label(raw.summary);
 let followUp=null,search=null;
 if(raw.followUpQuestionId!=null){
  const question=questionnaire?.questions.find(item=>item.id===raw.followUpQuestionId);
  if(!question)return fail();
  followUp=JSON.parse(JSON.stringify(question));
 }
 if(raw.followUp!=null){
  if(raw.followUpQuestionId!=null)return fail();
  try{followUp=normalizeIntakeQuestionnaire({id:'assistant-question',version:'1',questions:[raw.followUp]}).questions[0];}catch{return fail();}
 }
 if(raw.search!=null){
  const plan=raw.search;
  if(typeof plan!=='object'||Array.isArray(plan)||Object.keys(plan).some(key=>!['region','type','department','openOnly','mode'].includes(key)))return fail();
  search={};
  if(Object.hasOwn(plan,'region')){
   if(typeof plan.region!=='string'||plan.region.length>80)return fail();
   search.region=plan.region.trim();
  }
  if(Object.hasOwn(plan,'type')){
   if(!['all','hospital','pharmacy'].includes(plan.type))return fail();
   search.type=plan.type;
  }
  if(Object.hasOwn(plan,'department')){
   if(plan.department!=='all'&&!departmentCatalog.some(item=>item.key===plan.department))return fail();
   search.department=plan.department;
   if(plan.department!=='all'){
    const type=plan.department==='pharmacy'?'pharmacy':'hospital';
    if(search.type&&search.type!==type)return fail();
    search.type=type;
   }
  }
  if(Object.hasOwn(plan,'openOnly')){
   if(typeof plan.openOnly!=='boolean')return fail();
   search.openOnly=plan.openOnly;
  }
  if(Object.hasOwn(plan,'mode')){
   if(!travelModes.includes(plan.mode))return fail();
   search.mode=plan.mode;
  }
  if(!Object.keys(search).length)search=null;
 }
 const profileUpdates=raw.profileUpdates==null?null:normalizeHealthUpdates(raw.profileUpdates);
 const emergency=raw.emergency==null?null:normalizeEmergency(raw.emergency);
 if(!summary&&!followUp&&!search&&!emergency&&!profileUpdates?.length)return fail();
 // 11/18 문진 재설계: 증상 확인 뒤 상세 질문의 진행(추가 질문 n/전체). 형식이 맞을 때만 쓰고, 틀려도 응답 전체를 버리지 않는다
 const p=raw.progress,progress=followUp&&p&&typeof p==='object'&&Number.isInteger(p.current)&&Number.isInteger(p.total)&&p.current>=1&&p.current<=p.total&&p.total<=20?{current:p.current,total:p.total}:null;
 return {summary,followUp,search,...(progress?{progress}:{}),...(profileUpdates?{profileUpdates}:{}),...(emergency?{emergency}:{})};
}
export function assistantReportNotes(state){
 const assistant=state.assistant;
 if(!assistant)return '';
 const lines=assistant.answers.map(answer=>intakeLabel(answer.label,state.locale)+': '+intakeLabel(answer.optionLabel,state.locale));
 if(assistant.confirmed?.contentKey===assistantContentKey(state)){
  lines.push((phrase(state.locale,"Reviewed summary"))+': '+assistant.confirmed.text);
 }
 return lines.join('\n');
}
export function renderAssistant(state,t,escape){
 const assistant=state.assistant;
 if(!assistant?.connected)return '';
 const history=assistant.answers.length?'<dl>'+assistant.answers.map(answer=>'<div><dt>'+escape(intakeLabel(answer.label,state.locale))+'</dt><dd>'+escape(intakeLabel(answer.optionLabel,state.locale))+'</dd></div>').join('')+'</dl>':'';
 const wrap=body=>'<section class="chat-intake-context assistant-result" aria-label="'+t('assistantSection')+'">'+history+body+'</section>';
 if(assistant.status==='loading')return wrap('<p role="status">'+t('assistantLoading')+(assistant.slow?' '+t('assistantSlow'):'')+'</p>');
 if(assistant.status==='error')return wrap('<p role="status">'+t('assistantError')+'</p><button class="secondary-button" id="assistant-retry" type="button">'+t('assistantRetry')+'</button>');
 const response=assistant.response;
 if(!response)return '';
 if(response.contentKey!==assistantContentKey(state))return wrap('<p>'+t('assistantOutdated')+'</p>');
 let body='';
 if(response.summary){
  body+='<strong>'+t('assistantSummary')+'</strong>';
  if(assistant.editing)body+='<label class="sr-only" for="assistant-summary">'+t('assistantSummary')+'</label><textarea id="assistant-summary" maxlength="2000" rows="4">'+escape(assistant.summaryDraft)+'</textarea>';
  else body+='<p class="assistant-summary-text">'+escape(assistant.confirmed?.text||intakeLabel(response.summary,state.locale))+'</p>';
  body+='<div class="assistant-actions">'+(assistant.confirmed&&!assistant.editing?'<span role="status">'+t('assistantConfirmed')+'</span>':'<button id="assistant-confirm" class="secondary-button" type="button">'+t('assistantConfirm')+'</button>')+
  '<button id="assistant-edit" class="text-button" type="button">'+t(assistant.editing?'assistantCancel':'assistantEdit')+'</button></div>';
 }
 if(response.followUp){
  const question=response.followUp;
  if(response.progress)body+='<span class="assistant-progress">'+escape(phrase(state.locale,'Follow-up question {0} of {1}',[response.progress.current,response.progress.total]))+'</span>';
  body+='<strong id="assistant-question">'+escape(intakeLabel(question.label,state.locale))+'</strong><div class="onset-options" role="group" aria-labelledby="assistant-question">'+question.options.map(option=>'<button type="button" data-assistant-option="'+escape(option.id)+'">'+escape(intakeLabel(option.label,state.locale))+'</button>').join('')+'</div>';
 }
 if(response.search){
  const plan=response.search,labels=[];
  if(Object.hasOwn(plan,'region'))labels.push(plan.region||t('intakeCurrentLocation'));
  if(plan.type)labels.push(t(plan.type==='all'?'all':plan.type==='hospital'?'hospitals':'pharmacies'));
  if(plan.department)labels.push(t(plan.department==='all'?'allDepartments':plan.department));
  if(Object.hasOwn(plan,'openOnly'))labels.push(t(plan.openOnly?'openOnly':'assistantAnyHours'));
  if(plan.mode)labels.push(t({walk:'assistantWalk',traffic:'assistantTraffic',car:'assistantCar'}[plan.mode]));
  const current=response.sourceKey===assistantInputKey(state);
  body+='<strong>'+t('assistantSearch')+'</strong><div class="suggestion-chips">'+labels.map(value=>'<span>'+escape(value)+'</span>').join('')+'</div><p>'+t(assistant.applied?'assistantApplied':current?'assistantSearchHelp':'assistantSearchOutdated')+'</p>'+
  '<button id="assistant-apply" type="button" class="primary-button"'+(!current||assistant.applied?' disabled':'')+'>'+t('assistantApply')+'</button>';
 }
 return wrap(body);
}
