import {createAccountSession,normalizeAccountSession} from './account-session.mjs';
import {createFavorites,favoriteRecord,normalizeFavorites,FAVORITES_LIMIT} from './favorites.mjs';
import {createHealthUpdates,normalizeHealthUpdates,validateHealthUpdateEvidence,applyHealthUpdateSelection,healthUpdateFields} from './health-updates.mjs';
import {defaultEmergencyGuides} from './emergency-resources.mjs';
import {createReportImport,canUsePreviousReport,reviewedPreviousReport} from './report-import.mjs';
import {createHealthConsent,normalizeHealthNotice,healthConsentKey,hasHealthConsent} from './health-consent.mjs';
import {createEmergency,normalizeEmergency,normalizeEmergencyGuides,visibleEmergency,requestEmergencyPosition,lookupEmergencyAddress} from './emergency.mjs';
import {createRecommendations,recommendationSnapshot,normalizeRecommendations} from './recommendations.mjs';
import {createWorkspace,intakeSnapshot} from './workspace-model.mjs';
import {bindSearchSuggestions,alternativeKey,alternativeItems,comparisonDepartments,releaseSearchSuggestions} from './discovery.mjs';
import {createAssistantState,assistantContent,assistantContentKey,assistantSearchContext,assistantInputKey,normalizeAssistantResponse} from './assistant.mjs';
import {mockIntakeQuestionnaire,normalizeIntakeQuestionnaire,buildIntakeSubmission,intakeSelection} from './intake-data.mjs';
import {renderIntakeSteps} from './intake-view.mjs';
import {uiIcon} from './ui-icons.mjs';
import {copy} from './copy.mjs';
import {travelModes,routeContext,routeQuery,routeEntry} from './routing.mjs';
import {reportFieldKeys,unifiedReportValues,reportSource,reportSourceSignature,cleanReport,reportText,renderReport,reportMessage} from './report.mjs';
import {enrichPublicHours} from './public-hours.mjs';
import {facilityAddress,createLiveState,liveQueryKey,liveCriteria,displayedFacilities,resetLiveRequest,acceptLiveResponse} from './live-data.mjs';
import {searchKakao,suggestKakaoPlaces,mountKakaoMap,releaseKakaoMap,requestLocation,getKakaoMapCenter,validCenter} from './kakao-client.mjs';
import {emptyProfile,cleanProfile,loadProfile,persistProfile,renderProfile,normalizeAge,hasProfileChanges} from './profile.mjs';
import {buildSuggestion,conversationStarters} from './care-context.mjs';
import {createConversation,appendChat,chatNotes,setChatOpen} from './chat-model.mjs';
import {renderEntry,renderChat,robotIcon} from './chat-view.mjs';
import {emptyDraft,prepareDraft,appendSymptom,buildIntakeContext} from './flow.mjs';
import {emptyCriteria,searchFacilities} from './facilities.mjs';
import {renderExplore,positionMarkers} from './facilities-view.mjs';

let appMounted=false,appGeneration=0,configController=null,configSequence=0,clockTimer=null;
const activeRouteControllers=new Set();
let viewRenderer=null;
const bindingCleanups=[];
function listen(node,type,handler){
 if(!node)return;
 node.addEventListener(type,handler);
 if(viewRenderer)bindingCleanups.push(()=>node.removeEventListener(type,handler));
}
function clearBindings(){for(const cleanup of bindingCleanups.splice(0))cleanup();}
const icon=uiIcon;
const escape=(value)=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));





function intake(){return renderIntakeSteps(state,t,icon,escape);}
// Future API adapters call this after fetching a successful question response.
// Validation is atomic; changing the questionnaire clears unsubmitted answers.
export function setIntakeQuestionnaire(raw){
 const questionnaire=normalizeIntakeQuestionnaire(raw);
 saveInputs();
 state.intakeQuestionnaire=questionnaire;state.intakeAnswers={};state.intakeStep=0;
 if(state.workspace)state.workspace.intake=true;
 state.draft={...state.draft,symptom:'',onset:''};
 render();
}
function changePreviousReport(action){
 if(action.policy){state.healthConsent.open=true;state.healthConsent.pending='reportImport';render();return;}
 if(action.cancel){state.reportImport.open=false;render();document.getElementById('composer-attach')?.focus({preventScroll:true});return;}
 if(action.open){state.reportImport.mode=action.mode==='pdf'?'pdf':'text';if(!requestHealthAccess('reportImport'))return;saveInputs();state.reportImport.open=true;render();if(action.mode==='pdf')document.getElementById('previous-report-file')?.click();else document.getElementById('previous-report-text')?.focus();return;}
 if(action.remove){state.reportImport=createReportImport();resetAssistant();recommendationController?.abort();recommendationSequence++;state.recommendations=createRecommendations();render();return;}
 if(!canUsePreviousReport(state)){requestHealthAccess('reportImport');return;}
 if(action.confirm){
  saveInputs();const record=reviewedPreviousReport(action.confirm);
  state.reportImport={open:false,confirmed:record};
  if(viewRenderer){resetAssistant();state.workspace.panel=null;state.workspace.intake=!assistantAdapter;render();if(assistantAdapter)void requestAssistant('previousReport');else document.querySelector('.wizard-question')?.focus();}
  else{render();if(assistantAdapter)void requestAssistant('previousReport');}
 }
}
export function setHealthUpdateCandidates(raw){
 if(!hasHealthConsent(state))throw new Error('Health consent required');
 saveInputs();const items=validateHealthUpdateEvidence(normalizeHealthUpdates(raw),state);
 state.healthUpdates={...createHealthUpdates(),revision:state.healthUpdates.revision+1,phase:items.length?'pending':'idle',items,baseline:Object.fromEntries(healthUpdateFields.map(key=>[key,state.profile[key]||''])),contentKey:assistantContentKey(state)};render();
}
function reviewHealthUpdates(action){
 saveInputs();const batch=state.healthUpdates;
 if(action.type==='dismiss'){state.healthUpdates=createHealthUpdates();render();return {ok:true};}
 if(batch.phase!=='pending'||!hasHealthConsent(state)||batch.contentKey!==assistantContentKey(state))return {error:'stale'};
 if(action.type==='session'){state.healthUpdates={...batch,phase:'session',items:[]};render();return {ok:true};}
 if(action.type!=='apply')return {error:'invalid'};
 try{
  const result=applyHealthUpdateSelection(batch,action,state.profile,state.profileDraft);
  state.profile=result.profile;state.profileDraft=result.draft;if(action.ids.some(id=>batch.items.find(item=>item.id===id)?.field==='age'))state.profileConfirmedAt=new Date().toISOString();
  state.healthUpdates={...batch,phase:'applied',items:[],reviewedAt:new Date().toISOString()};
  recommendationController?.abort();recommendationSequence++;state.recommendations=createRecommendations();render();return {ok:true};
 }catch(error){return {error:error.message==='conflict'?'conflict':'invalid'};}
}
export function setHealthNotice(value=null){
 state.healthConsent.notice=value===null?null:normalizeHealthNotice(value);state.healthConsent.checked=false;
 if(!hasHealthConsent(state)){assistantController?.abort();assistantSequence++;recommendationController?.abort();recommendationSequence++;state.assistant.response=null;state.recommendations=createRecommendations();}
 render();
}
function requestHealthAccess(pending){
 if(hasHealthConsent(state))return true;
 saveInputs();if(pending!=='chat')state.healthConsent.starter='';state.healthConsent.open=true;state.healthConsent.pending=pending;state.healthConsent.checked=false;render();
 document.getElementById('health-consent-heading')?.focus({preventScroll:true});document.getElementById('health-consent-card')?.scrollIntoView({block:'nearest'});return false;
}
function closePendingHealthAccess(pending){
 if(!state.healthConsent.open||state.healthConsent.pending!==pending)return false;
 state.healthConsent.open=false;state.healthConsent.pending='';state.healthConsent.checked=false;render();return true;
}
function togglePreviousReport(){
 saveInputs();
 if(state.reportImport.open){state.reportImport.open=false;render();return;}
 if(closePendingHealthAccess('reportImport')||!requestHealthAccess('reportImport'))return;
 state.reportImport.open=true;render();
}
function closeEmergencyHelp(){
 saveInputs();emergencyLocationController?.abort();emergencyLocationSequence++;
 state.emergency.manual=false;state.emergency.notice=null;
 if(state.emergency.location.phase==='loading')state.emergency.location.phase='idle';render();document.getElementById('emergency-open')?.focus({preventScroll:true});
}
function toggleEmergencyHelp(){
 if(state.emergency.manual||visibleEmergency(state,assistantContentKey(state))){closeEmergencyHelp();return;}
 saveInputs();state.emergency.manual=true;render();document.getElementById('emergency-card')?.scrollIntoView({block:'nearest'});
}
function toggleIntake(){
 saveInputs();
 if(state.workspace.intake&&hasHealthConsent(state)){state.workspace.intake=false;render();document.getElementById('start-intake')?.focus({preventScroll:true});return;}
 if(closePendingHealthAccess('intake')||!requestHealthAccess('intake'))return;
 state.workspace.intake=true;render();document.querySelector('.wizard-question')?.focus();
}
function clearHealthAccess(){
 saveInputs();resetAssistant(true);recommendationController?.abort();recommendationSequence++;state.recommendations=createRecommendations();
 state.healthConsent.acceptedKey='';state.healthConsent.acceptedAt=null;state.healthConsent.open=false;state.healthConsent.checked=false;state.healthConsent.pending='';state.healthConsent.starter='';
 state.healthUpdates=createHealthUpdates();state.reportImport=createReportImport();state.chat={...createConversation(),open:true};state.intakeAnswers={};state.intakeStep=0;if(state.workspace)state.workspace.intake=false;
 state.draft={...emptyDraft(),region:state.draft.region};state.suggestion=null;state.report={saved:null,draft:null,editing:false,signature:'',updatedAt:Date.now()};state.emergency.notice=null;
 for(const key of ['age','allergies','medications','history']){state.profile[key]='';state.profileDraft[key]='';}
 state.profileConfirmedAt=null;state.profileError=false;state.search.origin='manual';render();
}
let emergencyLocationController=null,emergencyLocationSequence=0;
export function setEmergencyGuides(raw=null){
 const guides=raw===null?defaultEmergencyGuides:normalizeEmergencyGuides(raw);
 state.emergencyGuides=guides;render();
}
export function setEmergencyNotice(raw){
 const notice=raw===null?null:normalizeEmergency(raw);
 state.emergency.notice=notice?.active?{...notice,contentKey:assistantContentKey(state)}:null;render();
}
function selectEmergencyLocation(value){
 if(value.draft!==undefined){state.emergency.locationDraft=String(value.draft).slice(0,400);return;}
 saveInputs();emergencyLocationController?.abort();emergencyLocationSequence++;
 const e=state.emergency;
 if(value.clear){e.selectedPoint=null;e.manualLocation='';e.locationDraft='';e.locationSource='';e.location={phase:'idle',point:null,address:''};}
 else{
  e.selectedPoint=validCenter(value.point)?{lat:value.point.lat,lng:value.point.lng}:null;
  e.manualLocation=String(value.address||'').trim().slice(0,400)||(e.selectedPoint?e.selectedPoint.lat.toFixed(6)+', '+e.selectedPoint.lng.toFixed(6):'');
  e.locationSource=value.source;e.locationError=false;
 }
 render();
}
async function locateForEmergency(){
 emergencyLocationController?.abort();const controller=new AbortController();emergencyLocationController=controller;
 const sequence=++emergencyLocationSequence;
 state.emergency.location={phase:'loading',point:null,address:''};saveInputs();render();
 try{
  const point=await requestEmergencyPosition({signal:controller.signal});
  if(controller.signal.aborted||sequence!==emergencyLocationSequence)return;
  state.emergency.location={phase:'ready',point,address:''};saveInputs();render();
  const address=await lookupEmergencyAddress(state.live.key,point,{signal:controller.signal});
  if(controller.signal.aborted||sequence!==emergencyLocationSequence)return;
  state.emergency.location={phase:'ready',point,address};saveInputs();render();
 }catch{if(!controller.signal.aborted&&sequence===emergencyLocationSequence){state.emergency.location={phase:'error',point:null,address:''};saveInputs();render();}}
}
let recommendationAdapter=null,recommendationController=null,recommendationSequence=0;
export function setRecommendationAdapter(adapter=null){
 if(adapter!==null&&typeof adapter!=='function')throw new TypeError('Invalid recommendation adapter');
 recommendationController?.abort();recommendationSequence++;recommendationAdapter=adapter;state.healthConsent.checked=false;state.rankingConnected=!!adapter;
 state.recommendations=createRecommendations();render();
}
function syncRecommendations(){
 const snapshot=recommendationAdapter&&hasHealthConsent(state)?recommendationSnapshot(state):null;
 if(!snapshot){
  if(state.recommendations.key){recommendationController?.abort();recommendationSequence++;state.recommendations=createRecommendations();}
  return;
 }
 if(state.recommendations.key===snapshot.key)return;
 recommendationController?.abort();const controller=new AbortController();recommendationController=controller;
 const sequence=++recommendationSequence,adapter=recommendationAdapter;
 state.recommendations={phase:'loading',key:snapshot.key,items:[]};
 const current=()=>appMounted&&!controller.signal.aborted&&sequence===recommendationSequence&&recommendationSnapshot(state)?.key===snapshot.key;
 void (async()=>{
  let timer;
  try{
   await Promise.resolve();if(!current())return;render();
   const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),8000);});
   const raw=await Promise.race([Promise.resolve().then(()=>{if(!current())throw new Error('cancelled');return adapter(JSON.parse(JSON.stringify(snapshot.payload)),{signal:controller.signal});}),timeout]);
   if(!current())return;
   state.recommendations={phase:'ready',key:snapshot.key,items:normalizeRecommendations(raw,snapshot)};
  }catch{if(current())state.recommendations={phase:'error',key:snapshot.key,items:[]};}
  finally{clearTimeout(timer);if(sequence===recommendationSequence){controller.abort();if(appMounted){saveInputs();render();}}}
 })();
}
let accountAdapter=null,accountController=null,accountSequence=0;
async function applyAccountSession(session,token){
 if(token!==accountSequence)return;
 const changed=state.account.accountId!==session.accountId;state.account=session;
 if(changed){
  if(!viewRenderer)clearHealthAccess();
  void setFavoritesAdapter(session.accountId?accountAdapter?.favorites||null:null,{scope:session.accountId?'account:'+session.accountId:'guest'});
 }
 if(token===accountSequence)render();
}
async function abortableAccountCall(work,signal){
 if(signal.aborted)throw Error('Account request cancelled');
 let abort;const cancelled=new Promise((_,reject)=>{abort=()=>reject(Error('Account request cancelled'));signal.addEventListener('abort',abort,{once:true});});
 try{return await Promise.race([Promise.resolve().then(work),cancelled]);}finally{signal.removeEventListener('abort',abort);}
}
export async function setAccountAdapter(adapter=null){
 if(adapter!==null&&(typeof adapter.getSession!=='function'||typeof adapter.logout!=='function'||adapter.favorites&&(typeof adapter.favorites.list!=='function'||typeof adapter.favorites.set!=='function')))throw new TypeError('Invalid account adapter');
 accountController?.abort();const token=++accountSequence;accountAdapter=adapter;
 if(!adapter){await applyAccountSession(createAccountSession(),token);return;}
 state.account={...state.account,phase:'loading',error:''};render();
 const controller=new AbortController();accountController=controller;const timer=setTimeout(()=>controller.abort(),10000);
 try{const session=normalizeAccountSession(await abortableAccountCall(()=>adapter.getSession({signal:controller.signal}),controller.signal));if(token!==accountSequence||controller.signal.aborted)return;await applyAccountSession(session,token);}
 catch{if(token===accountSequence){state.account={...state.account,phase:'error',error:'session'};render();}}
 finally{clearTimeout(timer);}
}
export async function logoutAccount(){
 if(!accountAdapter||!state.account.accountId||['loading','loggingOut'].includes(state.account.phase))return;
 const adapter=accountAdapter;accountController?.abort();const token=++accountSequence,controller=new AbortController();accountController=controller;
 state.account={...state.account,phase:'loggingOut',error:''};render();const timer=setTimeout(()=>controller.abort(),10000);
 try{await abortableAccountCall(()=>adapter.logout({signal:controller.signal}),controller.signal);if(token!==accountSequence||controller.signal.aborted)return;await applyAccountSession(createAccountSession(),token);}
 catch{if(token===accountSequence){state.account={...state.account,phase:'authenticated',error:'logout'};render();}}
 finally{clearTimeout(timer);}
}
let favoritesAdapter=null,favoritesController=null,favoritesSequence=0;
export async function setFavoritesAdapter(adapter=null,{scope='guest'}={}){
 if(adapter!==null&&(typeof adapter.list!=='function'||typeof adapter.set!=='function'))throw new TypeError('Invalid favorites adapter');
 if(typeof scope!=='string'||!scope||scope.length>128)throw new TypeError('Invalid favorites scope');
 if(viewRenderer&&state.favorites.scope!==scope){clearHealthAccess();state.profileExit=false;pendingProfileExit=null;state.profileConfirmedAt=null;emergencyLocationController?.abort();emergencyLocationSequence++;state.emergency=createEmergency();}
 favoritesController?.abort();const token=++favoritesSequence;favoritesAdapter=adapter;
 state.favorites={...createFavorites(),scope,phase:adapter?'loading':'ready'};render();if(!adapter)return;
 const controller=new AbortController();favoritesController=controller;
 try{const items=normalizeFavorites(await adapter.list({signal:controller.signal}));if(token===favoritesSequence&&!controller.signal.aborted){state.favorites.items=items;state.favorites.phase='ready';}}
 catch{if(token===favoritesSequence&&!controller.signal.aborted){state.favorites.phase='error';state.favorites.error='load';}}
 finally{if(token===favoritesSequence)render();}
}
async function toggleFavorite(id){
 if(state.favorites.pendingId||state.favorites.phase==='loading')return;
 const current=state.favorites.items.find(item=>item.id===id),item=current||state.live.items.find(item=>item.id===id)||state.discovery.items.find(item=>item.id===id)||searchFacilities(emptyCriteria()).find(item=>item.id===id);if(!item)return;
 if(!current&&state.favorites.items.length>=FAVORITES_LIMIT){toast(state.locale==='ko'?'즐겨찾기는 20곳까지 추가할 수 있어요.':'You can add up to 20 favorites.');return;}
 const facility=favoriteRecord(item),adapter=favoritesAdapter,token=favoritesSequence;
 saveInputs();state.favorites.pendingId=id;state.favorites.error='';render();
 const controller=new AbortController();favoritesController=controller;
 try{if(adapter)await adapter.set({facility,favorite:!current},{signal:controller.signal});if(token!==favoritesSequence||controller.signal.aborted)return;
  state.favorites.items=current?state.favorites.items.filter(value=>value.id!==id):[...state.favorites.items,facility];
 }catch{if(token===favoritesSequence&&!controller.signal.aborted){state.favorites.error='update';toast(state.locale==='ko'?'즐겨찾기를 변경하지 못했어요. 다시 시도해 주세요.':'Could not update favorites. Please try again.');}}
 finally{if(token===favoritesSequence){state.favorites.pendingId='';render();}}
}
let assistantAdapter=null,assistantProtocol=null,assistantController=null,assistantSequence=0;
export function setAssistantAdapter(adapter,{questionnaire=null}={}){
 if(adapter!==null&&typeof adapter!=='function')throw new TypeError('Invalid assistant adapter');
 const protocol=questionnaire?normalizeIntakeQuestionnaire(questionnaire):null;
 saveInputs();assistantController?.abort();assistantSequence++;
 if(viewRenderer&&adapter&&state.workspace)state.workspace.intake=false;
 state.healthUpdates=createHealthUpdates();assistantAdapter=adapter;assistantProtocol=protocol;state.healthConsent.checked=false;state.emergency.notice=null;state.assistant=createAssistantState(!!adapter);render();
}
function resetAssistant(clearAnswers=false){
 state.healthUpdates=createHealthUpdates();
 assistantController?.abort();assistantSequence++;
 const answers=clearAnswers?[]:state.assistant.answers,questions=clearAnswers?[]:state.assistant.questions||[];
 state.assistant={...createAssistantState(!!assistantAdapter),answers,questions};
}
async function requestAssistant(reason='message'){
 resetAssistant();
 if(!assistantAdapter||!requestHealthAccess('chat'))return;
 const adapter=assistantAdapter;
 const token=assistantSequence,sourceKey=assistantInputKey(state),contentKey=assistantContentKey(state);
 const controller=new AbortController();assistantController=controller;
 const payload=JSON.parse(JSON.stringify({reason,locale:state.locale,...assistantContent(state),search:assistantSearchContext(state)}));
 state.assistant.status='loading';state.assistant.lastReason=reason;render();
 let timer;
 try{
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(new Error('timeout'));controller.abort();},8000);});
  const raw=await Promise.race([Promise.resolve().then(()=>{if(controller.signal.aborted)throw new Error('cancelled');return adapter(payload,{signal:controller.signal});}),timeout]);
  if(token!==assistantSequence)return;
  if(sourceKey!==assistantInputKey(state)){state.assistant.status='ready';return;}
  const response=normalizeAssistantResponse(raw,assistantProtocol);
  if(response.profileUpdates)validateHealthUpdateEvidence(response.profileUpdates,state);
  state.assistant.response={...response,sourceKey,contentKey};state.assistant.status='ready';
  if(response.profileUpdates)setHealthUpdateCandidates(response.profileUpdates);
  if(response.emergency)state.emergency.notice=response.emergency.active?{...response.emergency,contentKey}:null;
 }catch{
  if(token!==assistantSequence)return;
  state.assistant.status=sourceKey===assistantInputKey(state)?'error':'ready';
 }finally{
  clearTimeout(timer);
  if(token===assistantSequence){saveInputs();render();}
 }
}
function captureAssistant(){
 const input=document.getElementById('assistant-summary');
 if(input)state.assistant.summaryDraft=input.value.slice(0,2000);
}
function bindAssistant(){
 listen(document.getElementById('assistant-retry'),'click',()=>{saveInputs();void requestAssistant(state.assistant.lastReason||'message');});
 listen(document.getElementById('assistant-edit'),'click',()=>{
  saveInputs();const a=state.assistant;
  if(a.response?.contentKey!==assistantContentKey(state))return;
  if(a.editing){a.editing=false;}else{a.summaryDraft=a.confirmed?.text||a.response.summary[state.locale]||a.response.summary.ko;a.editing=true;}
  render();document.getElementById('assistant-summary')?.focus();
 });
 listen(document.getElementById('assistant-confirm'),'click',()=>{
  saveInputs();const a=state.assistant;
  if(a.response?.contentKey!==assistantContentKey(state))return;
  const text=(a.editing?a.summaryDraft:a.response.summary[state.locale]||a.response.summary.ko).trim();
  if(!text)return;
  a.confirmed={text,contentKey:assistantContentKey(state)};a.editing=false;render();
 });
 document.querySelectorAll('[data-assistant-option]').forEach(button=>listen(button,'click',()=>{
  saveInputs();const a=state.assistant;
  if(a.response?.contentKey!==assistantContentKey(state))return;
  const question=a.response.followUp,option=question?.options.find(item=>item.id===button.dataset.assistantOption);
  if(!option)return;
  a.questions=[...(a.questions||[]).filter(item=>item.id!==question.id),question];
  a.answers=[...a.answers.filter(answer=>answer.questionId!==question.id),{questionId:question.id,value:option.id,label:{...question.label},optionLabel:{...option.label}}];
  void requestAssistant('followup');
 }));
 listen(document.getElementById('assistant-skip'),'click',()=>{
  saveInputs();const a=state.assistant;if(a.status!=='ready'||a.response?.contentKey!==assistantContentKey(state)||!a.answers.some(answer=>answer.value!=null))return;
  void requestAssistant('skip');
 });
 document.querySelectorAll('[data-assistant-answer-edit]').forEach(button=>listen(button,'click',()=>{
  saveInputs();const a=state.assistant;if(a.status==='loading'||a.response?.contentKey!==assistantContentKey(state))return;
  const index=a.answers.findIndex(answer=>answer.questionId===button.dataset.assistantAnswerEdit),question=a.questions?.find(item=>item.id===button.dataset.assistantAnswerEdit);
  if(index<0||!question)return;
  const answers=a.answers.slice(0,index);resetAssistant();state.assistant.answers=answers;
  state.assistant.response={summary:null,search:null,followUp:question,contentKey:assistantContentKey(state),sourceKey:assistantInputKey(state)};
  recommendationController?.abort();recommendationSequence++;state.recommendations=createRecommendations();render();document.getElementById('assistant-question')?.focus();
 }));
 listen(document.getElementById('assistant-apply'),'click',()=>{
  saveInputs();const a=state.assistant,response=a.response;
  if(!response?.search||a.applied||response.sourceKey!==assistantInputKey(state))return;
  const {mode,...plan}=response.search,criteria={...state.search.criteria,targetFacilityId:null,targetQuery:null,...plan,sort:'distance'};
  if(Object.hasOwn(plan,'type')&&plan.type!==state.type&&!Object.hasOwn(plan,'department'))criteria.department='all';
  if(Object.hasOwn(plan,'region')){
   delete criteria.center;
   if(!plan.region&&state.live.position)criteria.center={lat:state.live.position.lat,lng:state.live.position.lng};
  }
  state.search.criteria=state.source==='live'?liveCriteria(criteria):criteria;
  state.type=state.search.criteria.type;state.search.department=state.search.criteria.department;
  state.search.openOnly=state.search.criteria.openOnly;state.draft.region=state.search.criteria.region;
  if(mode){state.routing.mode=mode;state.routing.openId=null;}
  state.search.initialized=true;state.search.origin='chat';state.search.selectedId=null;state.search.focusedId=null;
  state.chat.open=true;a.applied=true;state.view='explore';if(state.workspace)state.workspace.panel=null;render(true);
 });
}
function captureIntake(){
 const symptom=document.getElementById('intake-symptom'),region=document.getElementById('intake-region');
 if(symptom)state.draft.symptom=symptom.value.slice(0,1000);
 if(region)state.draft.region=region.value.slice(0,80);
}
function bindIntake(){
 const focusStep=()=>document.querySelector('.wizard-question')?.focus();
 listen(document.getElementById('intake-symptom'),'input',event=>{
  state.draft.symptom=event.target.value.slice(0,1000);
  document.getElementById('intake-count').textContent=state.draft.symptom.length+' / 1,000';
 });
 listen(document.getElementById('intake-wizard'),'submit',event=>{
  event.preventDefault();saveInputs();state.draft=prepareDraft(state.draft);
  const question=state.intakeQuestionnaire.questions[state.intakeStep||0];
  if(question?.required&&!intakeSelection(question,state.intakeAnswers)){
   const error=document.getElementById('intake-error');error.textContent=t('intakeChoiceHelp');error.hidden=false;
   document.querySelector('[data-intake-option]')?.focus();return;
  }
  if((state.intakeStep||0)<state.intakeQuestionnaire.questions.length+1){state.intakeStep=(state.intakeStep||0)+1;render();focusStep();}
  else{
   resetAssistant(true);
   state.chat.intakeContext={...buildIntakeContext(state.draft),...buildIntakeSubmission(state.intakeQuestionnaire,state.intakeAnswers),completion:intakeSnapshot(state.intakeQuestionnaire,state.intakeAnswers,state.draft)};
   if(state.workspace)state.workspace.intake=false;state.chat.open=true;
   state.search.criteria={...emptyCriteria(),region:state.draft.region,sort:'distance'};
   if(!state.draft.region&&state.live.position){
    state.search.criteria.center={lat:state.live.position.lat,lng:state.live.position.lng};
   }
   state.search.initialized=true;state.search.origin='intake';state.search.selectedId=null;state.search.focusedId=null;
   state.type='all';state.search.department='all';state.search.openOnly=false;
   if(viewRenderer){state.workspace.panel=null;state.view='explore';render();}else navigate('explore');
   if(viewRenderer||state.draft.symptom)void requestAssistant('intake');
  }
 });
 listen(document.getElementById('intake-back'),'click',()=>{saveInputs();state.intakeStep=Math.max(0,state.intakeStep-1);render();focusStep();});
 document.querySelectorAll('[data-intake-option]').forEach(button=>listen(button,'click',()=>{
  saveInputs();
  const question=state.intakeQuestionnaire.questions[state.intakeStep];
  const option=question?.options.find(item=>item.id===button.dataset.intakeOption);
  if(!option)return;
  state.intakeAnswers={...state.intakeAnswers,[question.id]:option.id};
  render();document.querySelector('[data-intake-option="'+option.id+'"]')?.focus();
 }));
 document.querySelectorAll('[data-intake-edit]').forEach(button=>listen(button,'click',()=>{saveInputs();state.intakeStep=Number(button.dataset.intakeEdit);render();focusStep();}));
 listen(document.getElementById('intake-report'),'click',()=>navigate('report'));
}

function report(){return renderReport(state,t,escape);}
function captureReport(){
 if(!document.getElementById('report-editor'))return;
 state.report.draft=Object.fromEntries(reportFieldKeys.map(key=>[key,document.getElementById('report-'+key)?.value??state.report.draft[key]??'']));
}
function bindReport(){
 const r=state.report;
 listen(document.getElementById('report-edit'),'click',()=>{
  r.draft={...(r.saved||reportSource(state,t))};r.editing=true;r.editSignature=r.saved?r.signature:reportSourceSignature(state);render();document.getElementById('report-symptom').focus();
 });
 listen(document.getElementById('report-editor'),'submit',event=>{
  event.preventDefault();captureReport();r.saved=cleanReport(r.draft);r.signature=r.editSignature;r.updatedAt=Date.now();r.editing=false;render();document.getElementById('report-edit').focus();toast(reportMessage(state.locale,'saved'));
 });
 listen(document.getElementById('report-cancel'),'click',()=>{r.editing=false;r.draft=null;render();document.getElementById('report-edit').focus();});
 listen(document.getElementById('report-reset'),'click',()=>{
  if(!window.confirm(reportMessage(state.locale,'resetConfirm')))return;
  r.saved=null;r.draft=null;r.editing=false;r.signature='';r.updatedAt=Date.now();render();document.getElementById('report-edit').focus();
 });
 listen(document.getElementById('report-print'),'click',()=>{if(viewRenderer)navigate('report');window.print();});
 listen(document.getElementById('report-copy'),'click',async()=>{
  try{await navigator.clipboard.writeText(reportText(viewRenderer?unifiedReportValues(state,t):r.saved||reportSource(state,t),state.locale));toast(reportMessage(state.locale,'copied'));}
  catch{toast(reportMessage(state.locale,'copyFailed'));}
 });
}

function selectFacility(id){
 saveInputs();if(!state.search.selectedId)state.search.resultsScroll=document.querySelector('.facility-results')?.scrollTop||0;
 state.search.selectedId=id;state.routing.openId=null;rerenderSearch('detail-heading');
 const list=document.querySelector('.facility-results');if(list)list.scrollTop=0;
}
async function configureLive(){
 const sequence=++configSequence;
 configController?.abort();
 const controller=new AbortController();configController=controller;const timer=setTimeout(()=>controller.abort(),5000);
 try{
  const response=await fetch('/api/config',{signal:controller.signal,cache:'no-store'});
  if(!response.ok)throw Error('configFailed');
  const config=await response.json();
  if(!appMounted||sequence!==configSequence)return;
  const key=typeof config.map?.javascriptKey==='string'?config.map.javascriptKey.trim():'';
  state.live.configured=config.map?.configured===true&&!!key;state.live.key=key;state.live.hoursConfigured=config.publicData?.configured===true;state.live.routingConfigured=config.routing?.configured===true;
  if(state.live.configured){
   saveInputs();state.source='live';state.search.criteria=liveCriteria(state.search.criteria);
   render();
  }
 }catch{/* Keep real results empty when configuration is unavailable. */}
 finally{clearTimeout(timer);}
}
function renderLiveProgress(resetScroll=false){
 const scroll=resetScroll?0:document.querySelector('.facility-results')?.scrollTop||0;saveInputs();render();
 const list=document.querySelector('.facility-results');if(list)list.scrollTop=scroll;
}
let hoursController=null;
async function updateLiveHours(token){
 hoursController?.abort();const controller=new AbortController();hoursController=controller;
 state.live.hoursPhase='loading';state.live.hoursError='';
 if(state.view==='explore')renderLiveProgress();
 const result=await enrichPublicHours(state.live.items,{signal:controller.signal});
 if(controller.signal.aborted||state.source!=='live'||state.live.token!==token)return;
 state.live.items=result;state.live.hoursPhase='ready';
 state.live.hoursError=result.find(item=>item.hoursError&&item.hoursError!=='hoursNotMatched')?.hoursError||'';
 if(state.view==='explore')renderLiveProgress();
}
async function refreshLiveSearch({append=false}={}){
 if(state.source!=='live'||!state.live.configured)return;
 if(append&&(!state.live.hasMore||state.live.phase!=='ready'||state.live.queryKey!==liveQueryKey(state.search.criteria)))return;
 hoursController?.abort();
 const criteria={...state.search.criteria};const queryKey=liveQueryKey(criteria);
 const page=append?state.live.page+1:1,categories=append?state.live.nextCategories:undefined;
 if(append){state.live={...state.live,token:state.live.token+1,phase:'loadingMore',error:''};}
 else{state.live=resetLiveRequest(state.live,criteria);state.live.mapError='';state.search.selectedId=null;state.search.focusedId=null;}
 const token=state.live.token;
 if(!criteria.region.trim()&&!criteria.center){state.live.phase='queryRequired';state.live.error='';renderLiveProgress(true);return;}
 renderLiveProgress(!append);
 try{
  const result=await searchKakao(state.live.key,criteria,{page,categories});
  if(state.source!=='live'||state.live.token!==token||liveQueryKey(state.search.criteria)!==queryKey)return;
  state.live=acceptLiveResponse(state.live,token,result,{append});
  if(criteria.targetFacilityId&&state.live.items.some(item=>item.id===criteria.targetFacilityId))state.search.selectedId=criteria.targetFacilityId;
  if(state.live.hoursConfigured)updateLiveHours(token);
  if(state.view==='explore')renderLiveProgress();
 }catch(error){
  if(state.source!=='live'||state.live.token!==token||liveQueryKey(state.search.criteria)!==queryKey)return;
  state.live={...state.live,phase:append?'ready':'error',error:['mapLoadFailed','searchTimeout','regionRequired'].includes(error.message)?error.message:'searchFailed'};
  if(state.view==='explore'){renderLiveProgress();if(append)toast(t(state.live.error));}
 }
}
let routeBatch='',routeBatchToken=0,routeBatchRunning=false;
let routeSlots=2;
const routeSlotWaiters=[];
async function acquireRouteSlot(){if(routeSlots>0){routeSlots--;return;}await new Promise(resolve=>routeSlotWaiters.push(resolve));}
function releaseRouteSlot(){const next=routeSlotWaiters.shift();if(next)next();else routeSlots++;}
const routeRequests=new Map();
async function loadRoute(key){
 const generation=appGeneration;
 const cached=state.routing.cache[key];if(cached&&cached.expires>Date.now())return cached;
 if(routeRequests.has(key))return routeRequests.get(key);
 const request=(async()=>{
  await acquireRouteSlot();
  if(!appMounted||generation!==appGeneration){releaseRouteSlot();return {phase:'error',error:'routeTimeout',expires:0};}
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);activeRouteControllers.add(controller);
  let entry;
  try{
   const response=await fetch('/api/route?'+key,{signal:controller.signal,cache:'no-store'});const body=await response.json();
   if(!response.ok)throw Error(body.error||'routeUpstreamFailed');
   if(!Number.isFinite(body.distanceMeters)||body.distanceMeters<0||!Number.isFinite(body.durationSeconds)||body.durationSeconds<0)throw Error('routeInvalidResponse');
   entry={phase:'ready',data:body,expires:Date.now()+120000};
  }catch(error){
   const known=['routeNotFound','routeInvalidResponse','routeAuthFailed','routeQuotaExceeded','routeTimeout','routeBusy','routeKeyMissing'];
   entry={phase:'error',error:controller.signal.aborted?'routeTimeout':known.includes(error.message)?error.message:'routeUpstreamFailed',expires:Date.now()+30000};
  }finally{clearTimeout(timer);activeRouteControllers.delete(controller);releaseRouteSlot();}
  if(generation!==appGeneration)return entry;
  const cache=state.routing.cache,keys=Object.keys(cache);if(keys.length>=128)delete cache[keys[0]];
  cache[key]=entry;return entry;
 })();routeRequests.set(key,request);
 try{return await request;}finally{if(routeRequests.get(key)===request)routeRequests.delete(key);}
}
function syncRoute(){
 if(state.source!=='live'||state.view!=='explore'||!state.live.routingConfigured||!state.live.position){routeBatch='';routeBatchToken++;routeBatchRunning=false;return;}
 const destination=routeContext(state).destination;
 const queries=destination?[routeQuery(state.routing.mode,state.live.position,destination)].filter(Boolean):[];
 const signature=JSON.stringify([...queries].sort());
 if(routeBatch===signature)return;
 const queue=queries.filter(key=>!state.routing.cache[key]||state.routing.cache[key].expires<=Date.now());
 if(routeBatch===signature&&!queue.length)return;
 routeBatch=signature;const batch=++routeBatchToken;
 if(!queue.length){routeBatchRunning=false;return;}
 routeBatchRunning=true;
 const run=async()=>{
  while(queue.length&&routeBatchToken===batch){
   const key=queue.shift();await loadRoute(key);
   if(routeBatchToken!==batch)return;
   if(state.source==='live'&&state.view==='explore')renderLiveProgress();
  }
 };
 Promise.all([run(),run()]).finally(()=>{if(routeBatchToken===batch)routeBatchRunning=false;});
}
let discoveryController=null;
function syncDiscovery(){
 const active=state.live.items.find(item=>item.id===state.search.selectedId)||state.discovery.items.find(item=>item.id===state.search.selectedId);
 const key=state.search.origin!=='favorite'&&state.view==='explore'&&state.live.configured&&state.live.hoursConfigured&&state.live.routingConfigured?alternativeKey(state,active):'';
 if(!key){discoveryController?.abort();state.discovery={key:'',phase:'idle',items:[]};return;}
 if(state.discovery.key===key)return;
 discoveryController?.abort();const controller=new AbortController();discoveryController=controller;
 state.discovery={key,phase:'loading',items:[]};
 const origin={...state.live.position},department=comparisonDepartments(state,active)[0];
 const token=state.live.token,selectedId=state.search.selectedId;
 const current=()=>!controller.signal.aborted&&state.live.token===token&&state.discovery.key===key&&state.view==='explore';
 Promise.resolve().then(async()=>{
  if(!current())return;
  renderLiveProgress();
  try{
   const result=await searchKakao(state.live.key,{...emptyCriteria(),region:'',type:'hospital',department,center:origin});
   if(!current())return;
   const known=new Map(state.live.items.map(item=>[item.id,item]));
   const items=await enrichPublicHours(result.items.filter(item=>item.id!==selectedId).slice(0,15).map(item=>known.get(item.id)||item),{signal:controller.signal});
   if(!current())return;
   state.discovery.items=items;
   if(state.view==='explore')renderLiveProgress();
   if(!current())return;
   state.discovery.phase='ready';renderLiveProgress();
  }catch{if(current()){state.discovery.phase='error';renderLiveProgress();}}
 });
}
function syncLiveView(){
 syncRecommendations();
 syncDiscovery();
 syncRoute();
 if(state.source!=='live'||state.view!=='explore'||!state.live.configured){releaseKakaoMap();return;}
 if(!state.live.locationAttempted){
  state.live.locationAttempted=true;
  requestCurrentLocation(false);
 }
 const queryKey=liveQueryKey(state.search.criteria);
 if(state.live.queryKey!==queryKey&&state.live.scheduledQuery!==queryKey){
  state.live.scheduledQuery=queryKey;
  Promise.resolve().then(()=>{
   if(state.live.scheduledQuery===queryKey)state.live.scheduledQuery='';
   if(state.source==='live'&&state.view==='explore'&&liveQueryKey(state.search.criteria)===queryKey&&state.live.queryKey!==queryKey)refreshLiveSearch();
  });
 }
 if(!document.getElementById('kakao-map')){releaseKakaoMap();return;}
 if(!state.live.mapError){
  mountKakaoMap(state.live.key,displayedFacilities(state,searchFacilities).filter(item=>state.workspace?.panel!=='route'||item.id===state.search.selectedId),state.search.selectedId||state.search.focusedId,selectFacility,{center:state.search.criteria.center||(!state.search.criteria.region.trim()?state.live.position:null),userLocation:state.live.position,routePaths:routeEntry(state,routeContext(state).destination)?.data?.paths||[],routeKey:routeContext(state).key,recenterToken:state.live.recenterToken||0,locale:state.locale,onError:error=>{
   if(state.source!=='live'||state.view!=='explore')return;
   saveInputs();state.live.mapError='mapLoadFailed';render();
  }});
 }
}

let locationController=null;
async function requestCurrentLocation(force=true){
 if(state.source!=='live'||state.live.locationStatus==='pending')return;
 locationController?.abort();const controller=new AbortController();locationController=controller;
 saveInputs();state.live.locationError='';state.live.locationStatus='pending';
 render();
 const startingKey=liveQueryKey(state.search.criteria);
 const startingToken=state.live.token;
 let appliedKey='';
 const applyPoint=(point,refining=false)=>{
  if(controller.signal.aborted)return;
  state.live.position=point;state.live.locationStatus='ready';
  if(state.source!=='live'||state.view!=='explore')return;
  saveInputs();
  if(refining){
   const viewport=getKakaoMapCenter(),previous=state.search.criteria.center;
   const mapMoved=viewport&&previous&&Math.hypot(viewport.lat-previous.lat,viewport.lng-previous.lng)>.0005;
   if(state.search.origin!=='location'||liveQueryKey(state.search.criteria)!==appliedKey||state.draft.region.trim()||mapMoved){render();return;}
  }else if(liveQueryKey(state.search.criteria)!==startingKey||state.live.token!==startingToken&&state.live.phase!=='queryRequired'){render();return;}
  if(refining||force||!state.search.criteria.region.trim()){
   if(!force&&!refining&&state.draft.region.trim()){render();return;}
   state.draft.region='';state.search.criteria={...state.search.criteria,targetFacilityId:null,targetQuery:null,region:'',center:{lat:point.lat,lng:point.lng}};
   state.search.selectedId=null;state.search.focusedId=null;state.search.origin='location';
   appliedKey=liveQueryKey(state.search.criteria);
   if(force)state.live.recenterToken=(state.live.recenterToken||0)+1;
  }
  render();
 };
 try{
  const point=await requestLocation(undefined,{signal:controller.signal,onRefine:point=>applyPoint(point,true)});
  applyPoint(point);
 }catch(error){
  if(controller.signal.aborted||error.name==='AbortError')return;
  state.live.locationStatus='unavailable';
  state.live.locationError=error.code===1?'locationPermissionDenied':error.code===3?'locationTimeout':'locationDenied';
  if(state.source==='live'&&state.view==='explore'){saveInputs();render();toast(t(state.live.locationError));}
 }
}
function bindLive(){
 listen(document.getElementById('locate-me'),'click',()=>requestCurrentLocation());
 listen(document.getElementById('search-map-area'),'click',()=>{
  const point=getKakaoMapCenter();if(!point){toast(t('mapNotReady'));return;}
  saveInputs();state.draft.region='';state.search.origin='map';
  state.search.criteria={...state.search.criteria,targetFacilityId:null,targetQuery:null,region:'',center:point,type:state.type,department:state.search.department,openOnly:state.search.openOnly};
  state.search.selectedId=null;state.search.focusedId=null;state.search.resultsScroll=0;
  rerenderSearch();refreshLiveSearch();
 });
 listen(document.getElementById('hours-retry'),'click',()=>updateLiveHours(state.live.token));
 listen(document.getElementById('live-retry'),'click',()=>refreshLiveSearch());
 listen(document.getElementById('live-more'),'click',()=>refreshLiveSearch({append:true}));
 listen(document.getElementById('map-retry'),'click',()=>{saveInputs();releaseKakaoMap();state.live.mapError='';render();});
}

function bindSearch(){
 bindSearchSuggestions(state,t,document,{lookup:state.source==='live'&&state.live.configured?((query,options)=>suggestKakaoPlaces(state.live.key,query,options)):null});
 listen(document.getElementById('nearer-retry'),'click',()=>{discoveryController?.abort();state.discovery.key='';syncDiscovery();});
 listen(document.getElementById('route-toggle'),'click',()=>{
  saveInputs();const id=state.search.selectedId;
  if(viewRenderer&&state.workspace?.panel==='detail'){state.workspace.panel='route';state.routing.openId=id;render();document.getElementById('route-heading')?.scrollIntoView({block:'nearest'});return;}
  state.routing.openId=state.routing.openId===id?null:id;renderLiveProgress();
  document.getElementById(state.routing.openId?'route-heading':'route-toggle')?.focus({preventScroll:true});
  if(state.routing.openId)document.getElementById('route-heading')?.scrollIntoView({block:'nearest'});
 });
 document.querySelectorAll('[data-travel-mode]').forEach(button=>listen(button,'click',()=>{
  if(!travelModes.includes(button.dataset.travelMode))return;
  saveInputs();routeBatch='';state.routing.mode=button.dataset.travelMode;renderLiveProgress();document.querySelector('[data-travel-mode="'+state.routing.mode+'"]')?.focus({preventScroll:true});
 }));
 listen(document.getElementById('route-retry'),'click',()=>{delete state.routing.cache[routeContext(state).key];routeBatch='';renderLiveProgress();});
 listen(document.getElementById('search-form'),'submit',event=>{
  event.preventDefault();saveInputs();
  let region=state.draft.region.trim(),center=null;
  const filterWithoutText=state.source==='live'&&!region&&(state.search.openOnly||state.search.suggestionScope);
  state.search.suggestionScope=false;
  if(state.source==='live'&&!region&&!filterWithoutText){toast(t('searchMissing'));document.getElementById('search-region')?.focus();return;}
  if(filterWithoutText){
   region=String(state.search.criteria.region||'').trim();
   if(!region){
    const points=[state.search.criteria.center,state.live.position,getKakaoMapCenter()];
    center=points.find(validCenter)||null;
   }
   state.draft.region=region;
  }
  state.search.origin='manual';state.search.focusedId=null;
  state.search.criteria={...state.search.criteria,targetFacilityId:null,targetQuery:null,region,center,type:state.type,department:state.search.department,openOnly:state.search.openOnly};
  if(filterWithoutText&&!region&&!center){
   state.search.selectedId=null;
   if(state.live.locationStatus==='pending'){locationController?.abort();state.live.locationStatus='idle';}
   requestCurrentLocation(false);return;
  }
  const results=displayedFacilities(state,searchFacilities);
  if(!results.some(item=>item.id===state.search.selectedId))state.search.selectedId=null;
  rerenderSearch('search-region');if(state.source==='live')refreshLiveSearch();toast(t('searchApplied'));
 });
 document.querySelectorAll('[data-reset]').forEach(button=>listen(button,'click',()=>{
  state.search.favoritesOnly=false;
  saveInputs();state.search.origin='manual';state.search.focusedId=null;state.draft.region='';state.type='all';state.search.department='all';state.search.openOnly=false;state.search.criteria=emptyCriteria();state.search.selectedId=null;
  rerenderSearch('search-region');
 }));
 document.querySelectorAll('[data-remove-filter]').forEach(button=>listen(button,'click',()=>{
  saveInputs();state.search.origin='manual';state.search.criteria.targetFacilityId=null;state.search.criteria.targetQuery=null;state.search.focusedId=null;const key=button.dataset.removeFilter;
  if(key==='region'){state.draft.region='';state.search.criteria.region='';}
  if(key==='type'){state.type='all';state.search.criteria.type='all';}
  if(key==='department'){state.search.department='all';state.search.criteria.department='all';}
  if(key==='openOnly'){state.search.openOnly=false;state.search.criteria.openOnly=false;}
  const results=displayedFacilities(state,searchFacilities);
  if(!results.some(item=>item.id===state.search.selectedId))state.search.selectedId=null;
  rerenderSearch('search-region');
 }));
 listen(document.getElementById('sort'),'change',event=>{
  saveInputs();state.search.criteria.sort=event.target.value;rerenderSearch('sort');
 });
 for(const display of ['map','list'])listen(document.getElementById('display-'+display),'click',()=>{
  saveInputs();state.search.display=display;rerenderSearch('display-'+display);
 });

 document.querySelectorAll('[data-card]').forEach(card=>{
  const focusCard=()=>{
   saveInputs();state.search.focusedId=card.dataset.card;rerenderSearch();
   document.querySelector('[data-card="'+card.dataset.card+'"]')?.focus({preventScroll:true});
  };
  listen(card,'click',event=>{
   if(event.target!==card&&(event.target.closest?.('button,a,input,select,textarea')||event.target.tagName==='BUTTON'))return;
   focusCard();
  });
  listen(card,'keydown',event=>{
   if(event.target===card&&['Enter',' '].includes(event.key)){event.preventDefault();focusCard();}
  });
 });
 document.querySelectorAll('[data-facility]').forEach(button=>listen(button,'click',()=>{
  saveInputs();if(!state.search.selectedId)state.search.resultsScroll=document.querySelector('.facility-results')?.scrollTop||0;state.search.selectedId=button.dataset.facility;state.routing.openId=button.dataset.routeJump!==undefined?button.dataset.facility:null;rerenderSearch('detail-heading');
  const list=document.querySelector('.facility-results');if(list)list.scrollTop=0;
  if(button.dataset.routeJump!==undefined){document.getElementById('route-heading')?.focus({preventScroll:true});document.getElementById('route-heading')?.scrollIntoView({block:'nearest'});}
 }));
 listen(document.getElementById('close-detail'),'click',()=>{
  saveInputs();const id=state.search.selectedId;state.search.selectedId=null;state.routing.openId=null;rerenderSearch();
  const list=document.querySelector('.facility-results');if(list)list.scrollTop=state.search.resultsScroll||0;
  document.querySelector('.facility-card [data-facility="'+id+'"]')?.focus({preventScroll:true});
 });
 document.querySelectorAll('[data-demo-action]').forEach(button=>listen(button,'click',()=>toast(t('demoAction'))));
}



function profileStorage(){try{return localStorage;}catch{return null;}}
const restored=loadProfile(profileStorage());
const state={account:createAccountSession(),favorites:createFavorites(),healthUpdates:createHealthUpdates(),emergencyGuides:defaultEmergencyGuides,reportImport:createReportImport(),healthConsent:createHealthConsent(),rankingConnected:false,emergency:createEmergency(),recommendations:createRecommendations(),discovery:{key:'',phase:'idle',items:[]},assistant:createAssistantState(),intakeStep:0,intakeQuestionnaire:mockIntakeQuestionnaire,intakeAnswers:{},routing:{mode:'walk',cache:{},openId:null},report:{saved:null,draft:null,editing:false,signature:'',updatedAt:Date.now()},source:'live',live:createLiveState(),profile:restored.profile,profileDraft:{...restored.profile},profileRemember:restored.remember,profileStorageNotice:restored.storageError,suggestion:null,view:'entry',locale:'ko',theme:'light',draft:emptyDraft(),type:'all',searchStatus:'',chat:{...createConversation(),open:true},chatReturnScroll:0,search:{criteria:emptyCriteria(),department:'all',openOnly:false,selectedId:null,display:'map',initialized:false}};
state.draft.region=state.profile.region;
try{state.theme=localStorage.getItem('medical-theme')==='dark'?'dark':'light';const language=localStorage.getItem('medical-language');state.locale=Object.hasOwn(copy,language)?language:'ko';}catch{}
let toastTimer;
const t=key=>copy[state.locale][key];
function rememberPreferences(){try{localStorage.setItem('medical-theme',state.theme);localStorage.setItem('medical-language',state.locale);}catch{}}
function saveInputs(){
 captureAssistant();
 captureIntake();
 captureReport();
 if(document.getElementById('profile-form')){state.profileDraft=captureProfile();state.profileRemember=document.getElementById('profile-remember')?.checked??state.profileRemember;}
 const input=document.getElementById('composer-input');if(input)state.chat.input=input.value;
 const symptom=document.getElementById('symptom');
 if(symptom)state.draft=prepareDraft({symptom:symptom.value,onset:document.getElementById('onset').value,region:document.getElementById('region').value});
 const region=document.getElementById('search-region');
 if(region){state.draft.region=region.value.trim().slice(0,80);state.type=document.getElementById('facility-type').value;state.search.department=document.getElementById('department').value;state.search.openOnly=document.getElementById('open-only')?.checked||false;}
}
function options(){return ['','today','yesterday','days','longer'].map(key=>'<option value="'+key+'"'+(state.draft.onset===key?' selected':'')+'>'+t(key||'onsetDefault')+'</option>').join('');}
function field(label,content){return '<div class="field"><label>'+label+'</label>'+content+'</div>';}
function explore(){return renderExplore(state,t,icon,escape);}
function toast(message){clearTimeout(toastTimer);const node=document.getElementById('toast');node.textContent=message;node.hidden=false;toastTimer=setTimeout(()=>{node.hidden=true;},6000);}
function render(focus=false){
 if(!appMounted)return;
 if(state.source==='live'){state.search.criteria=liveCriteria(state.search.criteria);}
 const chatScroll=document.getElementById('chat-messages')?.scrollTop||0;
 document.body.dataset.view=state.view;document.body.dataset.chat=state.view==='entry'?'entry':state.chat.open?'open':'closed';
 document.documentElement.lang=state.locale;document.documentElement.dataset.theme=state.theme;
 document.title=state.locale==='ko'?'의료 안내 | 가까운 병원 찾기':'Medical Guide | Find care nearby';
 document.querySelector('.skip-link').textContent=t('skipLink');
 const isEntry=state.view==='entry';
 clearBindings();
 if(viewRenderer){viewRenderer({state,t,onEmergencyLocation:selectEmergencyLocation,onPreviousReport:changePreviousReport,onHealthUpdates:reviewHealthUpdates});}
 else{
 const navigation=(isEntry?[['profile','myInfo']]:[['explore','navExplore'],['report','contextReport'],['profile','myInfo']]).map(([view,label])=>'<button class="header-route'+((state.view===view||(view==='report'&&state.view==='intake'))?' active':'')+'" data-view="'+view+'"'+(state.view===view?' aria-current="page"':'')+'>'+icon({explore:'map',report:'document',profile:'user'}[view])+'<span>'+t(label)+'</span></button>').join('');
 const header='<header class="header"><button class="brand brand-button" data-view="entry"><span class="brand-symbol">'+icon('plus')+'</span>'+t('brand')+'</button><nav class="header-nav" aria-label="'+t('navLabel')+'">'+navigation+'</nav><div class="header-actions"><button id="language" class="text-button" aria-label="'+(state.locale==='ko'?'Switch to English':'한국어로 전환')+'">'+(state.locale==='ko'?'EN':'한국어')+'</button><button id="theme" class="icon-button" aria-label="'+t(state.theme==='light'?'themeDark':'themeLight')+'" aria-pressed="'+(state.theme==='dark')+'">'+icon(state.theme==='light'?'moon':'sun')+'</button></div></header>';
 const shortcuts='';
 const content=isEntry?renderEntry(state,t,icon,escape):({intake,explore,report,profile:()=>renderProfile(state,t,escape)}[state.view])();
 document.getElementById('app').innerHTML=header+'<div class="app-workspace'+(!isEntry&&state.chat.open?' assistant-open':'')+'"><main id="main" tabindex="-1">'+shortcuts+content+'</main>'+(!isEntry&&state.chat.open?renderChat(state,t,icon,escape):'')+'</div>'+(!isEntry&&!state.chat.open?'<button id="chat-open" class="chat-launcher" aria-label="'+t('chatOpen')+'" aria-controls="assistant-panel" aria-expanded="false">'+robotIcon()+'<span>'+t('chatTitle')+'</span></button>':'')+'<div id="toast" class="toast" role="status" aria-live="polite" hidden></div>';
 }
 bind();bindProfile();if(!viewRenderer)bindFacilityPhotos();bindLive();positionMarkers();if(state.view==='explore')bindSearch();
 const messages=document.getElementById('chat-messages');if(messages)messages.scrollTop=chatScroll;
 if(focus){(viewRenderer&&state.workspace?.panel?document.getElementById('workspace-panel')?.querySelector('h1,h2'):document.querySelector('h1'))?.focus();window.scrollTo({top:0,behavior:'instant'});}
 syncLiveView();
}
function navigate(view){
 if(viewRenderer&&state.workspace){
  if(requestProfileExit(()=>navigate(view)))return;
  saveInputs();
  if(view==='entry'){closeWorkspace();return;}
  if(['profile','report'].includes(view))state.chatReturnScroll=document.getElementById('chat-messages')?.scrollTop||state.chatReturnScroll;
  state.workspace.panel=view;state.workspace.expanded=false;
 }
 if(view!=='explore')locationController?.abort();
 saveInputs();
 if(view==='explore'&&!state.search.initialized){const hasProfile=!!(state.profile.region||state.profile.preference!=='distance');state.search.criteria={...emptyCriteria(),region:state.draft.region,priority:state.profile.preference,sort:hasProfile?'recommended':'distance'};state.search.origin=hasProfile?'profile':'manual';if(state.source==='live')state.search.criteria=liveCriteria(state.search.criteria);state.search.initialized=true;}
 
 state.view=view;state.searchStatus='';render(true);
 if(viewRenderer&&['profile','report'].includes(view)){const heading=document.getElementById(view==='report'?'report-heading':'profile-heading');heading?.focus({preventScroll:true});heading?.scrollIntoView({block:'start'});}
}
function rerenderSearch(focusId){
 const listScroll=document.querySelector('.facility-results')?.scrollTop||0;
 render();const list=document.querySelector('.facility-results');if(list)list.scrollTop=listScroll;
 if(focusId)document.getElementById(focusId)?.focus({preventScroll:true});
}
function toggleChat(open){
 if(viewRenderer&&state.workspace){closeWorkspace();return;}
 saveInputs();const scrollBefore=window.scrollY;if(open)state.chatReturnScroll=scrollBefore;
 state.chat=setChatOpen(state.chat,open);render();
 if(open){document.getElementById('composer-input')?.focus({preventScroll:true});if(window.matchMedia('(max-width: 760px)').matches)document.getElementById('assistant-panel').scrollIntoView({block:'start'});}
 else{window.scrollTo({top:window.matchMedia('(max-width: 760px)').matches?state.chatReturnScroll:scrollBefore,behavior:'instant'});document.getElementById('chat-open')?.focus({preventScroll:true});}
}
function captureProfile(){
 const keys=Object.keys(emptyProfile());const values={...state.profileDraft};
 if(viewRenderer)values.nickname='';
 for(const key of keys){const node=document.getElementById('profile-'+key);if(node)values[key]=node.value;}
 return viewRenderer?{...cleanProfile(values),age:String(values.age??'')}:cleanProfile(values);
}
function applySuggestion(){
 saveInputs();if(!state.suggestion?.hasConditions)return;
 const plan=state.suggestion;
 state.draft.region=plan.region;state.type=plan.type;state.search.department=plan.department;state.search.openOnly=plan.openOnly;
 state.search.criteria={...emptyCriteria(),region:plan.region,type:plan.type,department:plan.department,openOnly:plan.openOnly,priority:plan.priority,sort:'recommended'};
 if(state.source==='live'){state.search.criteria=liveCriteria(state.search.criteria);}
 state.search.selectedId=null;state.search.initialized=true;state.search.origin='chat';state.search.resultsScroll=0;
 state.chat=setChatOpen(state.chat,true);state.view='explore';if(state.workspace)state.workspace.panel=null;render(true);
}
function bindFacilityActions(){
 if(!viewRenderer)listen(document.getElementById('toggle-jibun'),'click',()=>{
  const panel=document.getElementById('facility-jibun'),button=document.getElementById('toggle-jibun');
  panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));
  document.getElementById('jibun-toggle-label').textContent=t(panel.hidden?'showJibun':'hideJibun');
 });
 document.querySelectorAll('[data-copy-facility]').forEach(button=>listen(button,'click',async()=>{
  const item=displayedFacilities(state,searchFacilities).find(item=>item.id===button.dataset.copyId);
  if(!item)return;
  const field=button.dataset.copyFacility;
  const value=field==='address'?facilityAddress(item,state.locale):field==='phone'?item.phone:'';
  if(!value)return;
  try{await navigator.clipboard.writeText(value);toast(t(field==='address'?'addressCopied':'phoneCopied'));}
  catch{toast(t('facilityCopyFailed'));}
 }));
}
function bindFacilityPhotos(){
 document.querySelectorAll('[data-facility-photo]').forEach(img=>listen(img,'error',()=>{img.hidden=true;const fallback=document.getElementById(img.dataset.facilityPhoto+'-fallback');if(fallback)fallback.hidden=false;const badge=document.getElementById(img.dataset.facilityPhoto+'-badge');if(badge)badge.hidden=true;}));
}
let pendingProfileExit=null;
function requestProfileExit(action){
 if(!viewRenderer||state.workspace?.panel!=='profile')return false;
 saveInputs();if(!hasProfileChanges(state.profile,state.profileDraft))return false;
 pendingProfileExit=action;state.profileExit=true;render();return true;
}
function commitProfile(){
 if(!hasHealthConsent(state))return false;
 saveInputs();const raw=state.profileDraft.age;
 if(raw!==''&&normalizeAge(raw)===''){state.profileError=true;state.profileExit=false;pendingProfileExit=null;render();document.getElementById('profile-age')?.focus();return false;}
 state.profile=cleanProfile(state.profileDraft);state.profileDraft={...state.profile};state.profileError=false;state.profileConfirmedAt=new Date().toISOString();return true;
}
function bindProfile(){
 listen(document.getElementById('account-retry'),'click',()=>{if(accountAdapter)void setAccountAdapter(accountAdapter);});
 listen(document.getElementById('account-logout'),'click',()=>{if(window.confirm(state.locale==='ko'?'로그아웃할까요? 저장하지 않은 입력과 이번 대화는 지워집니다.':'Log out? Unsaved entries and this conversation will be cleared.'))void logoutAccount();});
 listen(document.getElementById('profile-pdf'),'click',function exportProfilePdf(){if(requestProfileExit(exportProfilePdf))return;window.print();});
 listen(document.getElementById('profile-health-start'),'click',()=>{requestHealthAccess('profile');});
 for(const choice of ['save','discard','cancel'])listen(document.getElementById('profile-leave-'+choice),'click',()=>{
  const action=pendingProfileExit;if(choice==='save'&&!commitProfile())return;
  if(choice==='discard'){state.profileDraft={...state.profile};state.profileError=false;}
  state.profileExit=false;pendingProfileExit=null;render();
  if(choice!=='cancel')action?.();
 });
 listen(document.getElementById('profile-form'),'submit',event=>{
  event.preventDefault();if(viewRenderer){if(commitProfile()){render();toast(state.locale==='ko'?'건강정보를 저장했어요. 현재 페이지에서만 유지됩니다.':'Health information saved for this page.');}return;}
  saveInputs();state.profile=cleanProfile(state.profileDraft);
  const stored=persistProfile(profileStorage(),state.profile,state.profileRemember);
  if(stored)state.profileStorageNotice=false;
  state.draft.region=state.profile.region||state.draft.region;
  state.search.criteria={...state.search.criteria,region:state.draft.region,sort:'recommended',priority:state.profile.preference};
  if(state.source==='live'){state.search.criteria=liveCriteria(state.search.criteria);}
  state.search.selectedId=null;state.search.initialized=true;state.search.origin='profile';
  if(state.suggestion)state.suggestion=buildSuggestion('',state.profile,{...state.suggestion,region:state.draft.region,priority:state.profile.preference});
  render();toast(t(!stored?'profileStorageError':state.profileRemember?'profileSaved':'profileSession'));
 });
 listen(document.getElementById('profile-delete'),'click',()=>{
  const question=viewRenderer?(state.locale==='ko'?'건강정보를 지울까요? 수정한 상담 내용은 유지됩니다.':'Clear health information? Edited consultation notes will be kept.'):t('profileDeleteConfirm');
  if(!window.confirm(question))return;
  if(viewRenderer){const cleared={age:'',allergies:'',medications:'',history:''};state.profile={...state.profile,...cleared};state.profileDraft={...state.profile};state.profileError=false;state.profileConfirmedAt=null;render();toast(t('profileDeleted'));return;}
  const oldRegion=state.profile.region;const removed=persistProfile(profileStorage(),emptyProfile(),false);
  state.profile=emptyProfile();state.profileDraft=emptyProfile();state.profileRemember=false;state.profileStorageNotice=!removed;state.suggestion=null;
  if(state.search.origin==='profile'){
   if(state.draft.region===oldRegion)state.draft.region='';
   state.search.criteria={...state.search.criteria,region:state.draft.region,priority:'distance',sort:'distance'};state.search.origin='manual';state.search.focusedId=null;
  }
  render();toast(t(removed?'profileDeleted':'profileDeleteError'));
 });
}

function bind(){
 bindWorkspace();
 bindAssistant();
 bindIntake();
 bindReport();
 bindFacilityActions();
 listen(document.getElementById('apply-suggestion'),'click',applySuggestion);
 listen(document.getElementById('review-conditions'),'click',()=>toggleChat(true));
 listen(document.getElementById('review-intake'),'click',()=>{
  toggleChat(true);
  const summary=document.getElementById('chat-intake-context');
  summary?.focus({preventScroll:true});summary?.scrollIntoView({block:'nearest'});
 });
 document.getElementById('app').querySelectorAll('button[data-view]').forEach(button=>listen(button,'click',event=>{event.preventDefault();if(viewRenderer&&button.id==='skip'){skipConversationIntake();return;}navigate(button.dataset.view);}));
 listen(document.getElementById('theme'),'click',()=>{saveInputs();state.theme=state.theme==='light'?'dark':'light';rememberPreferences();render();document.getElementById('theme').focus();});
 listen(document.getElementById('language-select'),'change',event=>{if(!Object.hasOwn(copy,event.target.value))return;saveInputs();state.locale=event.target.value;state.searchStatus='';rememberPreferences();render();document.getElementById('language-select')?.focus();});
 listen(document.getElementById('language'),'click',()=>{saveInputs();state.locale=state.locale==='ko'?'en':'ko';state.searchStatus='';rememberPreferences();render();document.getElementById('language').focus();});
 listen(document.getElementById('chat-open'),'click',()=>toggleChat(true));
 listen(document.getElementById('chat-close'),'click',()=>toggleChat(false));
 listen(document.getElementById('symptom'),'input',event=>{document.getElementById('count').textContent=event.target.value.length+'/1,000';document.getElementById('symptom-error').hidden=true;event.target.removeAttribute('aria-invalid');});
 listen(document.getElementById('intake-form'),'submit',event=>{
  event.preventDefault();saveInputs();
  if(!state.draft.symptom){const err=document.getElementById('symptom-error');err.textContent=t('missing');err.hidden=false;document.getElementById('symptom').setAttribute('aria-invalid','true');document.getElementById('symptom').focus();return;}
  navigate('report');
 });
 listen(document.getElementById('clear'),'click',()=>{
  if(!window.confirm(t('clearConfirm')))return;
  resetAssistant(true);
  const open=state.chat.open;state.intakeAnswers={};state.intakeStep=0;state.draft={...emptyDraft(),region:state.profile.region};state.chat={...createConversation(),open};state.suggestion=null;state.search.criteria={...emptyCriteria(),region:state.profile.region};state.type='all';state.search.department='all';state.search.openOnly=false;state.search.selectedId=null;state.search.origin='manual';state.search.focusedId=null;render();document.getElementById('clear').focus();toast(t('cleared'));
 });
 listen(document.getElementById('composer-input'),'keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();document.getElementById('composer-form').requestSubmit();}});
 listen(document.getElementById('composer-form'),'submit',event=>{event.preventDefault();saveInputs();submitChatText(state.chat.input);});

}
function submitChatText(text,starter=null){
 if(!requestHealthAccess('chat'))return;
 saveInputs();const result=appendChat(state.chat,text);
 if(!result.ok){if(result.reason==='limit')toast(t('noteLimit'));document.getElementById('composer-input')?.focus();return;}
 state.chat=result.conversation;
 if(viewRenderer&&assistantAdapter){state.workspace.intake=false;render();void requestAssistant('message');return;}
 if(viewRenderer&&starter?.search){state.suggestion={...buildSuggestion(text,state.profile,state.search.criteria),...starter.search,hasConditions:true};applySuggestion();return;}
 if(viewRenderer&&!state.chat.intakeContext){resetAssistant();state.workspace.intake=true;state.workspace.panel=null;render();document.querySelector('.wizard-question')?.focus();return;}
 state.suggestion=buildSuggestion(text,state.profile,state.suggestion||state.search.criteria);render();document.getElementById('composer-input')?.focus({preventScroll:true});
 const messages=document.getElementById('chat-messages');if(messages)messages.scrollTop=messages.scrollHeight;
 void requestAssistant('message');
}
function closeWorkspace(){
 if(viewRenderer&&state.workspace?.panel==='report'){navigate('profile');return;}
 if(requestProfileExit(closeWorkspace))return;
 saveInputs();state.workspace.panel=null;state.workspace.expanded=false;state.routing.openId=null;
 state.view=state.search.initialized?'explore':'entry';state.chat.open=true;render();
 const log=document.getElementById('chat-messages');if(log)log.scrollTop=state.chatReturnScroll||0;
 if(hasHealthConsent(state))document.getElementById('composer-input')?.focus({preventScroll:true});
 else document.querySelector('.conversation-heading h1')?.focus({preventScroll:true});
}
function skipConversationIntake(){
 saveInputs();
 state.chat.intakeContext={...buildIntakeContext(state.draft),...buildIntakeSubmission(state.intakeQuestionnaire,state.intakeAnswers),completion:intakeSnapshot(state.intakeQuestionnaire,state.intakeAnswers,state.draft,{skipped:true,step:state.intakeStep})};
 state.workspace.intake=false;state.workspace.panel=null;
 state.search.initialized=true;state.search.criteria={...emptyCriteria(),region:state.draft.region};
 state.type='all';state.search.department='all';state.search.openOnly=false;state.search.origin='intake';
 state.view='explore';render();
 if(assistantAdapter)void requestAssistant('intake');
}
function bindWorkspace(){
 if(!viewRenderer||!state.workspace)return;
 document.querySelectorAll('[data-conversation-starter]').forEach(button=>listen(button,'click',()=>{
  const starter=conversationStarters.find(item=>item.id===button.dataset.conversationStarter);if(!starter)return;
  if(!hasHealthConsent(state)){state.healthConsent.starter=starter.id;requestHealthAccess('chat');return;}
  submitChatText(starter.text[state.locale]||starter.text.ko,starter);
 }));
 document.querySelectorAll('[data-favorite]').forEach(button=>listen(button,'click',event=>{event.stopPropagation?.();void toggleFavorite(button.dataset.favorite);}));
 listen(document.getElementById('favorites-clear-filter'),'click',()=>{state.search.favoritesOnly=false;render();});
 listen(document.getElementById('favorites-only'),'change',event=>{saveInputs();state.search.favoritesOnly=event.target.checked;state.search.selectedId=null;render();});
 listen(document.getElementById('favorites-retry'),'click',()=>{if(favoritesAdapter)void setFavoritesAdapter(favoritesAdapter,{scope:state.favorites.scope});});
 document.querySelectorAll('[data-favorite-find]').forEach(button=>listen(button,'click',()=>{
  const item=state.favorites.items.find(value=>value.id===button.dataset.favoriteFind);if(!item)return;
  saveInputs();state.search.favoritesOnly=false;state.draft.region=item.name[state.locale]||item.name.ko;state.type=item.type;state.search.department='all';state.search.openOnly=false;
  state.search.origin='favorite';state.routing.openId=null;
  const query=[item.name.ko,...String(item.address||'').trim().split(/\s+/).slice(0,2)].filter(Boolean).join(' ');
  state.search.criteria={...emptyCriteria(),region:state.draft.region,type:item.type,targetFacilityId:item.id,targetQuery:query};state.search.initialized=true;state.search.selectedId=null;navigate('explore');
 }));
 const composer=document.getElementById('composer-input');
 const enterChat=()=>{if(!hasHealthConsent(state)&&!state.healthConsent.open)requestHealthAccess('chat');};
 listen(composer,'focus',()=>{Promise.resolve().then(()=>{if(document.activeElement===composer)enterChat();});});listen(composer,'click',enterChat);
 listen(document.getElementById('previous-report-intake'),'click',toggleIntake);
 listen(document.getElementById('start-health-chat'),'click',()=>{if(closePendingHealthAccess('chat'))return;if(requestHealthAccess('chat'))document.getElementById('composer-input')?.focus();});
 listen(document.getElementById('health-consent-check'),'change',event=>{state.healthConsent.checked=event.target.checked;});
 listen(document.getElementById('health-consent-form'),'submit',event=>{
  event.preventDefault();const c=state.healthConsent,key=healthConsentKey(state);
  if(!key||!document.getElementById('health-consent-check')?.checked)return;
  const starter=conversationStarters.find(item=>item.id===c.starter);c.starter='';
  const pending=c.pending;c.acceptedKey=key;c.acceptedAt=new Date().toISOString();c.open=false;c.checked=false;c.pending='';
  if(pending==='intake'){state.workspace.intake=true;state.intakeStep=0;}
  if(pending==='reportImport')state.reportImport.open=true;
  render();if(pending==='chat'&&starter){submitChatText(starter.text[state.locale]||starter.text.ko,starter);return;}
  if(pending==='chat')document.getElementById('composer-input')?.focus();
  if(pending==='profile')document.getElementById('profile-age')?.focus();
  if(pending==='reportImport')document.getElementById(state.reportImport.mode==='pdf'?'previous-report-file':'previous-report-text')?.focus();
 });
 listen(document.getElementById('health-consent-open'),'click',()=>{saveInputs();const c=state.healthConsent;c.open=!c.open;c.checked=false;if(!c.open)c.pending='';render();if(c.open)document.getElementById('health-consent-card')?.scrollIntoView({block:'nearest'});});
 listen(document.getElementById('health-consent-close'),'click',()=>{const pending=state.healthConsent.pending;state.healthConsent.open=false;state.healthConsent.pending='';state.healthConsent.starter='';render();if(pending==='chat')document.getElementById('composer-attach')?.focus({preventScroll:true});if(pending==='profile')document.getElementById('profile-health-start')?.focus({preventScroll:true});});
 listen(document.getElementById('health-consent-revoke'),'click',clearHealthAccess);
 listen(document.getElementById('emergency-open'),'click',toggleEmergencyHelp);
 listen(document.getElementById('emergency-close'),'click',closeEmergencyHelp);
 listen(document.getElementById('emergency-locate'),'click',()=>void locateForEmergency());
 listen(document.getElementById('workspace-close'),'click',closeWorkspace);
 listen(document.getElementById('inline-facility-close'),'click',()=>{saveInputs();state.workspace.panel=null;state.routing.openId=null;render();});
 listen(document.getElementById('recommendations-retry'),'click',()=>{state.recommendations.key='';syncRecommendations();});
 listen(document.getElementById('workspace-expand'),'click',()=>{saveInputs();state.workspace.expanded=!state.workspace.expanded;render();});
 listen(document.getElementById('start-intake'),'click',toggleIntake);
 listen(document.getElementById('new-conversation'),'click',function beginNewConversation(){
  if(requestProfileExit(beginNewConversation))return;
  if(!window.confirm(t('conversationNewConfirm')))return;
  saveInputs();resetAssistant(true);hoursController?.abort();discoveryController?.abort();locationController?.abort();
  releaseSearchSuggestions();releaseKakaoMap();routeBatchToken++;routeBatch='';
  recommendationController?.abort();recommendationSequence++;state.recommendations=createRecommendations();
  emergencyLocationController?.abort();emergencyLocationSequence++;state.emergency=createEmergency();
  state.healthUpdates=createHealthUpdates();state.reportImport=createReportImport();state.healthConsent={...state.healthConsent,open:false,pending:'',starter:'',checked:false};state.profileDraft={...state.profile};state.profileError=false;
  state.workspace=createWorkspace();state.draft={...emptyDraft(),region:state.profile.region};
  state.intakeAnswers={};state.intakeStep=0;state.chat={...createConversation(),open:true};state.suggestion=null;
  state.report={saved:null,draft:null,editing:false,signature:'',updatedAt:Date.now()};
  state.search={criteria:emptyCriteria(),department:'all',openOnly:false,selectedId:null,display:'map',initialized:false};state.type='all';
  state.routing.openId=null;state.discovery={key:'',phase:'idle',items:[]};
  const config=state.live;state.live={...createLiveState(),configured:config.configured,key:config.key,hoursConfigured:config.hoursConfigured,routingConfigured:config.routingConfigured,token:(config.token||0)+1};
  state.view='entry';render();document.querySelector('.conversation-heading h1')?.focus({preventScroll:true});
 });
 document.querySelectorAll('[data-workspace-facility]').forEach(button=>listen(button,'click',()=>{
  saveInputs();
  const card=button.closest('.conversation-facility');
  if(card&&!button.closest('.conversation-facility-expanded')){state.workspace.anchorId=card.dataset.conversationFacility;state.workspace.resultIds=[...document.querySelectorAll('[data-conversation-facility]')].map(node=>node.dataset.conversationFacility);}
  state.workspace.panel=button.dataset.workspaceRoute!==undefined?'route':'detail';state.workspace.expanded=false;state.search.selectedId=button.dataset.workspaceFacility;
  state.routing.openId=button.dataset.workspaceRoute!==undefined?button.dataset.workspaceFacility:null;state.view='explore';render();document.querySelector('.conversation-facility-expanded')?.scrollIntoView({block:'nearest'});
 }));
}
function onDocumentKeydown(event){if(viewRenderer&&state.workspace){if(event.key==='Escape'&&state.workspace.panel){event.preventDefault();closeWorkspace();}return;}if(event.key==='Escape'&&state.view!=='entry'&&state.chat.open){event.preventDefault();toggleChat(false);}}
export function mountMedicalApp({renderView=null}={}){
 if(appMounted)throw new Error('Medical app is already mounted');
 viewRenderer=renderView;
 if(viewRenderer&&!state.workspace)state.workspace=createWorkspace();
 if(viewRenderer)state.healthConsent.enabled=true;
 appMounted=true;
 document.addEventListener('keydown',onDocumentKeydown);
 render();
 if(typeof fetch==='function')void configureLive();
 if(typeof window.setInterval==='function')clockTimer=window.setInterval(()=>{if(state.view==='explore'&&state.source==='live'&&state.live.items.some(item=>item.schedule)){saveInputs();rerenderSearch();}},60000);
 let disposed=false;
 return ()=>{
  if(disposed)return;saveInputs();disposed=true;appMounted=false;appGeneration++;
  accountController?.abort();accountSequence++;
  favoritesController?.abort();favoritesSequence++;state.favorites.pendingId='';
  emergencyLocationController?.abort();emergencyLocationSequence++;
  configSequence++;configController?.abort();assistantController?.abort();assistantSequence++;recommendationController?.abort();recommendationSequence++;state.recommendations=createRecommendations();
  hoursController?.abort();discoveryController?.abort();locationController?.abort();
  for(const controller of activeRouteControllers)controller.abort();
  routeRequests.clear();
  routeBatchToken++;routeBatch='';routeBatchRunning=false;
  state.live.token++;state.live.scheduledQuery='';state.live.queryKey='';
  if(state.live.phase==='loading')state.live.phase='idle';
  if(state.live.locationStatus==='pending'){state.live.locationStatus='idle';state.live.locationAttempted=false;}
  if(state.discovery.phase==='loading')state.discovery={key:'',phase:'idle',items:[]};
  if(state.assistant.status==='loading')state.assistant.status='ready';
  clearTimeout(toastTimer);if(clockTimer!==null)window.clearInterval(clockTimer);clockTimer=null;
  document.removeEventListener('keydown',onDocumentKeydown);
  releaseSearchSuggestions();releaseKakaoMap();
  clearBindings();
  if(!viewRenderer)document.getElementById('app')?.replaceChildren();
  viewRenderer=null;
 };
}
